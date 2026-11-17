/// <reference types="@webgpu/types" />
import type { GpuFrame } from "../src/gpu/model.ts";

/** Serialized into the browser: use real queries and shaders, with no mocked driver results. */
export async function hardwareGpuProbe(backend: "webgl2" | "webgpu") {
  const samples: {
    frameId: number;
    repeats: number;
    block: number;
    nativeMs: number[];
    nativeNanoseconds: string[];
    frame: GpuFrame;
    completionMs: number;
  }[] = [];
  const checks: string[] = [];
  const progress = (message: string) => console.info(`GPU validation: ${backend}: ${message}`);
  const errors: string[] = [];
  const records = new Map<number, GpuFrame>();
  let frameId = 0;
  const require = (ok: boolean, message: string) => {
    if (!ok) throw new Error(message);
  };
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 4));
  const settled = async (id: number, poll = () => {}) => {
    const deadline = performance.now() + 5000;
    while (true) {
      poll();
      const frame = records.get(id);
      if (frame?.invocations.every((pass) => pass.state !== "pending")) return frame;
      require(performance.now() < deadline, `GPU frame ${id} did not settle within 5 seconds`);
      await tick();
    }
  };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  document.body.replaceChildren(canvas);
  const modelPath = "/src/gpu/model.ts";
  const { validateGpuFrame, gpuFrameCoverage } = (await import(
    modelPath
  )) as typeof import("../src/gpu/model.ts");
  const onFrame = (frame: GpuFrame) => records.set(frame.frameId, validateGpuFrame(frame));
  const environment: {
    userAgent: string;
    isolated: boolean;
    resolution: number[];
    visibility: string;
    adapter?: object;
    renderer?: unknown;
  } = {
    userAgent: navigator.userAgent,
    isolated: crossOriginIsolated,
    resolution: [1024, 1024],
    visibility: document.visibilityState,
  };
  const verify = (frame: GpuFrame, nativeMs: number[]) => {
    require(gpuFrameCoverage(frame).completeness ===
      "complete", `Incomplete frame ${frame.frameId}`);
    require(frame.invocations.length === nativeMs.length, "Native query/pass count mismatch");
    frame.invocations.forEach((pass, index) => {
      require(pass.milliseconds ===
        nativeMs[index], `Native duration mismatch in ${frame.frameId}/${index}`);
    });
  };

  if (backend === "webgpu") {
    progress("creating device and pipelines");
    const adapter = await navigator.gpu?.requestAdapter();
    require(!!adapter, "No WebGPU hardware adapter");
    if (!adapter) throw new Error("No WebGPU adapter");
    environment.adapter = {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      device: adapter.info.device,
      description: adapter.info.description,
      fallback: adapter.info.isFallbackAdapter,
    };
    require(!adapter.info.isFallbackAdapter, "Software WebGPU adapter is not hardware validation");
    require(adapter.features.has("timestamp-query"), "Hardware timestamp-query is unavailable");
    const device = await adapter.requestDevice({ requiredFeatures: ["timestamp-query"] });
    device.addEventListener("uncapturederror", (event) => errors.push(event.error.message));
    const modulePath = "/src/gpu/webgpu.ts";
    const { createWebGpuSource } = (await import(
      modulePath
    )) as typeof import("../src/gpu/webgpu.ts");
    const probe = createWebGpuSource(device, onFrame);
    const texture = device.createTexture({
      size: [1024, 1024],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const view = texture.createView();
    const module = device.createShaderModule({
      code: `
      @vertex fn vs(@builtin(vertex_index) i:u32) -> @builtin(position) vec4f {
        let p = array<vec2f,3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
        return vec4f(p[i],0,1);
      }
      @fragment fn fs(@builtin(position) p:vec4f) -> @location(0) vec4f {
        var x=p.x*0.001+p.y*0.002;
        for(var i=0u;i<256u;i++){x=fract(sin(x+f32(i))*43758.5453);}
        return vec4f(x,x*x,1-x,1)*0.01;
      }
      @group(0) @binding(0) var<storage,read_write> output:array<u32>;
      @compute @workgroup_size(64) fn cs(@builtin(global_invocation_id) id:vec3u) {
        var x=output[id.x]+id.x+1u;
        for(var i=0u;i<1024u;i++){x=x*1664525u+1013904223u; x=x^(x>>13u);}
        output[id.x]=x;
      }`,
    });
    const render = await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [
          {
            format: "rgba8unorm",
            blend: {
              color: { srcFactor: "one", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
            },
          },
        ],
      },
    });
    const compute = await device.createComputePipelineAsync({
      layout: "auto",
      compute: { module, entryPoint: "cs" },
    });
    const output = device.createBuffer({
      size: 262144 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const group = device.createBindGroup({
      layout: compute.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: output } }],
    });
    const nativeResolve = device.createBuffer({
      size: 512,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    const nativeRead = device.createBuffer({
      size: 512,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const submit = (repeats: number, passes = 2, oracle = true) => {
      const id = ++frameId;
      probe.beginFrame(id, "complete");
      const encoder = device.createCommandEncoder();
      let querySet: GPUQuerySet | undefined;
      for (let index = 0; index < passes; index++) {
        const kind = index % 2 === 0 ? "render" : "compute";
        const writes = probe.timestampWrites(`${kind} ${index}`, kind);
        querySet ??= writes?.querySet;
        if (kind === "render") {
          const pass = encoder.beginRenderPass({
            colorAttachments: [
              { view, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] },
            ],
            ...(writes ? { timestampWrites: writes } : {}),
          });
          pass.setPipeline(render);
          for (let draw = 0; draw < repeats; draw++) pass.draw(3);
          pass.end();
        } else {
          const pass = encoder.beginComputePass(writes ? { timestampWrites: writes } : {});
          pass.setPipeline(compute);
          pass.setBindGroup(0, group);
          for (let dispatch = 0; dispatch < repeats; dispatch++) pass.dispatchWorkgroups(4096);
          pass.end();
        }
      }
      probe.endFrame(encoder);
      if (oracle && querySet) {
        // Resolve the same native queries into independently owned buffers, without Jank's decoder.
        encoder.resolveQuerySet(querySet, 0, passes * 2, nativeResolve, 0);
        encoder.copyBufferToBuffer(nativeResolve, 0, nativeRead, 0, passes * 16);
      }
      device.queue.submit([encoder.finish()]);
      return id;
    };
    try {
      for (let block = 0; block < 3; block++) {
        progress(`sample block ${block + 1}/3`);
        for (const repeats of [1, 4, 4, 1]) {
          for (let sample = -16; sample < 40; sample++) {
            const start = performance.now();
            const id = submit(repeats);
            probe.readSubmittedFrames();
            await nativeRead.mapAsync(GPUMapMode.READ);
            const values = new BigUint64Array(nativeRead.getMappedRange()).slice(0, 4);
            nativeRead.unmap();
            const nativeMs = [
              Number((values[1] ?? 0n) - (values[0] ?? 0n)) / 1e6,
              Number((values[3] ?? 0n) - (values[2] ?? 0n)) / 1e6,
            ];
            const frame = await settled(id);
            verify(frame, nativeMs);
            const origin =
              // biome-ignore lint/complexity/useMathMinMax: Math.min cannot accept bigint timestamps.
              (values[0] ?? 0n) < (values[2] ?? 0n) ? (values[0] ?? 0n) : (values[2] ?? 0n);
            frame.invocations.forEach((pass, index) => {
              require(pass.startMs ===
                Number((values[index * 2] ?? 0n) - origin) / 1e6, "Native start mismatch");
              require(pass.endMs ===
                Number((values[index * 2 + 1] ?? 0n) - origin) / 1e6, "Native end mismatch");
            });
            if (sample >= 0)
              samples.push({
                frameId: id,
                repeats,
                block,
                nativeMs,
                nativeNanoseconds: Array.from(values, String),
                frame,
                completionMs: performance.now() - start,
              });
          }
        }
      }
      checks.push(
        "render/compute duration and relative endpoints exactly match independent raw readback",
      );
      progress("capacity and lifecycle checks");
      const empty = submit(0, 0, false);
      require(gpuFrameCoverage(await settled(empty)).expected === 0, "Empty frame invented work");
      checks.push("complete-empty frame");
      const capacity = submit(1, 40, false);
      probe.readSubmittedFrames();
      const cap = gpuFrameCoverage(await settled(capacity));
      progress(`capacity evidence ${JSON.stringify(cap)}`);
      require(cap.timed === 32 &&
        cap.omitted === 8 &&
        cap.completeness === "partial", "Pass capacity misreported");
      checks.push("32 timed passes / 8 capacity omissions");
      const burst = Array.from({ length: 9 }, () => submit(1, 2, false));
      const overflow = records.get(burst[8] ?? -1);
      require(overflow?.invocations.every(
        (p) => p.state === "omitted" && p.reason === "GPU readback pool full",
      ) === true, "Readback pool exhaustion hidden");
      probe.readSubmittedFrames();
      await Promise.all(burst.map((id) => settled(id)));
      checks.push("eight-slot readback exhaustion and recovery");
      const pending = submit(1, 2, false);
      probe.setEnabled(false);
      require((await settled(pending)).invocations.every(
        (p) => p.state === "rejected",
      ), "Disabled pending work remained timed");
      probe.readSubmittedFrames();
      await device.queue.onSubmittedWorkDone();
      const disabled = submit(1, 2, false);
      require((await settled(disabled)).invocations.every(
        (p) => p.state === "omitted" && p.milliseconds === null,
      ), "Disabled work became zero");
      checks.push("disable rejects pending work; disabled passes stay missing");
      probe.setEnabled(true);
      const recovered = submit(1, 2, false);
      probe.readSubmittedFrames();
      require(gpuFrameCoverage(await settled(recovered)).timed === 2, "Probe did not recover");
      checks.push("probe re-enable recovers");
      const lost = submit(1, 2, false);
      device.destroy();
      await device.lost;
      require((await settled(lost)).invocations.every(
        (p) => p.state === "rejected" && p.reason?.includes("device lost"),
      ), "Device loss retained pending/timed work");
      checks.push("native device destruction rejects outstanding queries");
    } finally {
      probe.dispose();
      nativeRead.destroy();
      nativeResolve.destroy();
      output.destroy();
      texture.destroy();
      device.destroy();
    }
  } else {
    progress("creating context and shaders");
    const gl = canvas.getContext("webgl2", { antialias: false });
    if (!gl) throw new Error("No native WebGL2 context");
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    environment.renderer = debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    require(!/swiftshader|llvmpipe|software|warp/i.test(
      String(environment.renderer),
    ), "Software WebGL is not hardware validation");
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    if (!ext) throw new Error("Native WebGL timer queries unsupported");
    const modulePath = "/src/gpu/webgl2.ts";
    const { createWebGl2GpuSource } = (await import(
      modulePath
    )) as typeof import("../src/gpu/webgl2.ts");
    const raw = new Map<WebGLQuery, number>();
    let nativeQueries: WebGLQuery[] = [];
    const observed = {
      QUERY_RESULT: gl.QUERY_RESULT,
      QUERY_RESULT_AVAILABLE: gl.QUERY_RESULT_AVAILABLE,
      getExtension: gl.getExtension.bind(gl),
      getParameter: gl.getParameter.bind(gl),
      isContextLost: gl.isContextLost.bind(gl),
      deleteQuery: gl.deleteQuery.bind(gl),
      beginQuery: gl.beginQuery.bind(gl),
      endQuery: gl.endQuery.bind(gl),
      createQuery() {
        const query = gl.createQuery();
        if (query) nativeQueries.push(query);
        return query;
      },
      getQueryParameter(query: WebGLQuery, name: number): unknown {
        const value: unknown = gl.getQueryParameter(query, name);
        if (name === gl.QUERY_RESULT && typeof value === "number") raw.set(query, value);
        return value;
      },
    };
    const probe = createWebGl2GpuSource(observed, onFrame);
    const shader = (type: number, source: string) => {
      const value = gl.createShader(type);
      if (!value) throw new Error("Shader allocation failed");
      gl.shaderSource(value, source);
      gl.compileShader(value);
      require(gl.getShaderParameter(value, gl.COMPILE_STATUS) === true, gl.getShaderInfoLog(
        value,
      ) ?? "Shader error");
      return value;
    };
    const vertex = shader(
      gl.VERTEX_SHADER,
      `#version 300 es
      void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`,
    );
    const fragment = shader(
      gl.FRAGMENT_SHADER,
      `#version 300 es
      precision highp float; out vec4 color;
      void main(){float x=gl_FragCoord.x*.001+gl_FragCoord.y*.002;
      for(int i=0;i<256;i++){x=fract(sin(x+float(i))*43758.5453);}color=vec4(x,x*x,1.0-x,1)*.01;}`,
    );
    const program = gl.createProgram();
    if (!program) throw new Error("Program allocation failed");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    require(gl.getProgramParameter(program, gl.LINK_STATUS) === true, gl.getProgramInfoLog(
      program,
    ) ?? "Link error");
    // biome-ignore lint/correctness/useHookAtTopLevel: This is WebGL, not a component hook.
    gl.useProgram(program);
    // Additive blending keeps repeated draws observable on tile-based GPUs.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const submit = (repeats: number, passes = 1) => {
      const id = ++frameId;
      nativeQueries = [];
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (let index = 0; index < passes; index++) {
        probe.beginPass(`render ${index}`);
        for (let draw = 0; draw < repeats; draw++) gl.drawArrays(gl.TRIANGLES, 0, 3);
        probe.endPass();
      }
      probe.captureFrame(id, "complete");
      gl.flush();
      return { id, queries: nativeQueries };
    };
    try {
      for (let block = 0; block < 3; block++) {
        progress(`sample block ${block + 1}/3`);
        for (const repeats of [1, 4, 4, 1]) {
          for (let sample = -16; sample < 40; sample++) {
            const start = performance.now();
            const { id, queries } = submit(repeats);
            const frame = await settled(id, probe.poll);
            const nativeMs = queries.map((query) => (raw.get(query) ?? Number.NaN) / 1e6);
            verify(frame, nativeMs);
            if (sample >= 0)
              samples.push({
                frameId: id,
                repeats,
                block,
                nativeMs,
                nativeNanoseconds: queries.map((query) => String(raw.get(query))),
                frame,
                completionMs: performance.now() - start,
              });
          }
        }
      }
      checks.push("elapsed durations exactly match native nanosecond query results");
      progress("capacity and lifecycle checks");
      const empty = submit(0, 0);
      require(gpuFrameCoverage(await settled(empty.id, probe.poll)).expected ===
        0, "Empty frame invented work");
      checks.push("complete-empty frame");
      const capacity = submit(0, 40);
      const cap = gpuFrameCoverage(await settled(capacity.id, probe.poll));
      require(cap.timed === 32 &&
        cap.omitted === 8 &&
        cap.completeness === "partial", "Pass capacity misreported");
      checks.push("32 timed passes / 8 capacity omissions");
      const pending = submit(1);
      probe.setEnabled(false);
      require((await settled(pending.id, probe.poll)).invocations.every(
        (p) => p.state === "rejected",
      ), "Disabled pending work remained timed");
      const disabled = submit(1);
      require((await settled(disabled.id, probe.poll)).invocations.every(
        (p) => p.state === "omitted" && p.milliseconds === null,
      ), "Disabled work became zero");
      checks.push("disable rejects pending work; disabled passes stay missing");
      probe.setEnabled(true);
      const recovered = submit(1);
      require(gpuFrameCoverage(await settled(recovered.id, probe.poll)).timed ===
        1, "Probe did not recover");
      checks.push("probe re-enable recovers");
      require(gl.getError() === gl.NO_ERROR, "Unexpected WebGL error");
      const loss = gl.getExtension("WEBGL_lose_context");
      if (!loss) throw new Error("Cannot test native context loss");
      const lostEvent = new Promise<void>((resolve) =>
        canvas.addEventListener(
          "webglcontextlost",
          (event) => {
            event.preventDefault();
            resolve();
          },
          { once: true },
        ),
      );
      const lost = submit(1);
      loss.loseContext();
      await lostEvent;
      progress("context lost");
      require((await settled(lost.id, probe.poll)).invocations.every(
        (p) => p.state === "rejected",
      ), "Context loss retained pending work");
      const restored = new Promise<void>((resolve) =>
        canvas.addEventListener("webglcontextrestored", () => resolve(), { once: true }),
      );
      // Chrome allows restoration only after the loss event has finished dispatching.
      await tick();
      loss.restoreContext();
      await restored;
      progress("context restored");
      probe.poll();
      const fresh = submit(0);
      const freshFrame = await settled(fresh.id, probe.poll);
      require(freshFrame.epoch === 1 &&
        gpuFrameCoverage(freshFrame).timed ===
          1, "Context restoration did not restart the timing epoch");
      checks.push("native context loss and restored timing epoch");
    } finally {
      probe.dispose();
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  }
  require(errors.length === 0, errors.join("\n"));
  return { backend, environment, samples, checks, errors };
}
