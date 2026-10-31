import type { GpuRejectedPass } from "../core/gpu.ts";
import { timestampPairRejection } from "./timestamp-pair.ts";
import {
  createTimestampSlot,
  type TimestampDevice,
  type TimestampSlot,
} from "./webgpu-readback.ts";

/** Native GPUDevice satisfies this boundary. The caller retains device and scheduling ownership. */
export interface TimestampDiagnosticDevice extends TimestampDevice {
  readonly features: { has(feature: "timestamp-query"): boolean };
  createTexture(descriptor: GPUTextureDescriptor): Pick<GPUTexture, "createView" | "destroy">;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
  createCommandEncoder(): Omit<
    ReturnType<TimestampDevice["createCommandEncoder"]>,
    "beginRenderPass"
  > & {
    beginRenderPass(
      descriptor: GPURenderPassDescriptor,
    ): Pick<GPURenderPassEncoder, "setPipeline" | "draw" | "end">;
  };
}

export interface TimestampDiagnosticPair {
  readonly draw: boolean;
  /** Two independent query sets; "fresh" starts with the fifth probe and is then drawn once. */
  readonly query: "reused" | "fresh";
  readonly startNs: string | null;
  readonly endNs: string | null;
  readonly durationMs: number | null;
  readonly reason: GpuRejectedPass["reason"] | null;
}

export interface TimestampDiagnosticReport {
  /** Finished means all six probes ran, not that their timestamps passed or the GPU is calibrated. */
  readonly status: "unsupported" | "finished" | "failed";
  readonly pairs: readonly TimestampDiagnosticPair[];
  readonly error: string | null;
}

const shader = `
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
  var p=array<vec2f,3>(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.));
  return vec4f(p[i],0.,1.);
}
@fragment fn fragment()->@location(0) vec4f { return vec4f(1.); }
`;

/** Explicit, bounded six-pass probe. Run while the host is idle, before attaching a timing adapter.
 * Owns two query/readback slots and a 16x16 texture; never destroys the borrowed device.
 * timeoutMs applies to each read, so six reads take at most six times that limit plus submission.
 */
export async function runWebGpuTimestampDiagnostic(
  device: TimestampDiagnosticDevice,
  { timeoutMs = 3000 }: { readonly timeoutMs?: number } = {},
): Promise<TimestampDiagnosticReport> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new RangeError("timeoutMs must be greater than zero and at most 30000");
  }
  const pairs: TimestampDiagnosticPair[] = [];
  if (!device.features.has("timestamp-query")) {
    return { status: "unsupported", pairs, error: null };
  }
  const dispose: (() => void)[] = [];
  try {
    const texture = device.createTexture({ size: [16, 16], format: "rgba8unorm", usage: 16 });
    dispose.push(() => texture.destroy());
    const module = device.createShaderModule({ code: shader });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vertex" },
      fragment: { module, entryPoint: "fragment", targets: [{ format: "rgba8unorm" }] },
    });
    for (const query of ["reused", "fresh"] as const) {
      const slot = createTimestampSlot(device, 1);
      dispose.push(() => slot.dispose());
      const draws = query === "reused" ? [true, false, false, true] : [false, true];
      for (const draw of draws) {
        submitProbe(device, slot, { view: texture.createView(), pipeline, draw });
        const times = await slot.read(1, timeoutMs);
        pairs.push(describePair(times, draw, query));
      }
    }
    return { status: "finished", pairs, error: null };
  } catch (cause) {
    return {
      status: "failed",
      pairs,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    for (const release of dispose.reverse()) {
      release();
    }
  }
}

function submitProbe(
  device: TimestampDiagnosticDevice,
  slot: TimestampSlot,
  probe: {
    view: GPUTextureView;
    pipeline: GPURenderPipeline;
    draw: boolean;
  },
): void {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      { view: probe.view, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] },
    ],
    timestampWrites: {
      querySet: slot.querySet,
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1,
    },
  });
  if (probe.draw) {
    pass.setPipeline(probe.pipeline);
    pass.draw(3);
  }
  pass.end();
  device.queue.submit([encoder.finish()]);
}

function describePair(
  times: BigUint64Array,
  draw: boolean,
  query: TimestampDiagnosticPair["query"],
): TimestampDiagnosticPair {
  const start = times[0];
  const end = times[1];
  const reason = timestampPairRejection(start, end);
  const durationMs =
    reason === null && start !== undefined && end !== undefined
      ? Number(end - start) / 1_000_000
      : null;
  return {
    draw,
    query,
    startNs: start?.toString() ?? null,
    endNs: end?.toString() ?? null,
    durationMs,
    reason,
  };
}
