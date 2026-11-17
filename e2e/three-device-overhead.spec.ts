/// <reference types="@webgpu/types" />
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("physical WebGPU queue counting cost and counter fidelity", async ({
  page,
  browser,
}, info) => {
  test.skip(info.project.name !== "chrome-gpu", "Requires the explicit physical-GPU run");
  test.setTimeout(60_000);
  await page.route("**/viewer.html", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    });
  });
  await page.goto("/viewer.html");
  await page.bringToFront();
  const report = await page.evaluate(async () => {
    const entry = "/src/adapters/three-device.ts";
    const { instrumentThreeDevice } = await import(entry);
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter || adapter.info.isFallbackAdapter) throw new Error("Physical GPU required");
    if (/swiftshader|llvmpipe|software/i.test(adapter.info.description))
      throw new Error("Software GPU is not a hardware measurement");
    const device = await adapter.requestDevice();
    const errors: string[] = [];
    device.addEventListener("uncapturederror", (event) => errors.push(event.error.message));
    const native = {
      writeBuffer: device.queue.writeBuffer,
      submit: device.queue.submit,
    };
    const instrument = instrumentThreeDevice(device, () => {});
    instrument.setEnabled(false);
    const counted = {
      writeBuffer: device.queue.writeBuffer,
      submit: device.queue.submit,
    };
    const buffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const data = new Uint32Array(16).fill(137);
    const callsPerBatch = 4096;
    const batches = 24;
    const median = (values: number[]) =>
      values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
    const trials: {
      workload: string;
      block: number;
      enabled: boolean;
      medianBatchMs: number;
      samplesMs: number[];
    }[] = [];
    let id = 0;
    const setCounting = (enabled: boolean) => {
      for (const method of ["writeBuffer", "submit"] as const)
        Object.defineProperty(device.queue, method, {
          value: (enabled ? counted : native)[method],
          configurable: true,
          writable: true,
        });
    };
    try {
      for (const workload of ["writeBuffer", "submit"] as const) {
        for (let block = 0; block < 3; block++) {
          for (const enabled of [false, true, true, false]) {
            setCounting(enabled);
            const samplesMs: number[] = [];
            for (let batch = 0; batch < batches + 8; batch++) {
              instrument.beginFrame(++id);
              const start = performance.now();
              for (let call = 0; call < callsPerBatch; call++) {
                if (workload === "writeBuffer") device.queue.writeBuffer(buffer, 0, data);
                else device.queue.submit([]);
              }
              const elapsed = performance.now() - start;
              instrument.endFrame();
              const counts = instrument.gpuCalls();
              const actual =
                workload === "writeBuffer" ? counts.bufferWritesPerFrame : counts.submitsPerFrame;
              if (actual !== (enabled ? callsPerBatch : 0)) throw new Error("Counter mismatch");
              if (
                workload === "writeBuffer" &&
                counts.bufferWriteBytesPerFrame !== (enabled ? callsPerBatch * data.byteLength : 0)
              )
                throw new Error("Upload byte count mismatch");
              await device.queue.onSubmittedWorkDone();
              if (batch >= 8) samplesMs.push(elapsed);
            }
            trials.push({ workload, block, enabled, medianBatchMs: median(samplesMs), samplesMs });
          }
        }
      }
      const readback = device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(buffer, 0, readback, 0, 64);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      if (!new Uint32Array(readback.getMappedRange()).every((value) => value === 137))
        throw new Error("Counted uploads changed buffer contents");
      readback.unmap();
      readback.destroy();
      return {
        adapter: {
          vendor: adapter.info.vendor,
          architecture: adapter.info.architecture,
          description: adapter.info.description,
        },
        userAgent: navigator.userAgent,
        crossOriginIsolated,
        callsPerBatch,
        warmupBatches: 8,
        measuredBatches: batches,
        trials,
        errors,
      };
    } finally {
      setCounting(true);
      instrument.dispose();
      buffer.destroy();
      device.destroy();
    }
  });
  expect(report.errors).toEqual([]);
  expect(report.crossOriginIsolated).toBe(true);
  const comparisons = ["writeBuffer", "submit"].flatMap((workload) =>
    [0, 1, 2].map((block) => {
      const trials = report.trials.filter(
        (trial) => trial.workload === workload && trial.block === block,
      );
      const off = trials.filter((trial) => !trial.enabled).map((trial) => trial.medianBatchMs);
      const on = trials.filter((trial) => trial.enabled).map((trial) => trial.medianBatchMs);
      const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
      return {
        workload,
        block,
        offBatchMs: mean(off),
        onBatchMs: mean(on),
        deltaUsPerCall: ((mean(on) - mean(off)) * 1000) / report.callsPerBatch,
        sameSettingSpreadUsPerCall:
          (Math.max(Math.max(...off) - Math.min(...off), Math.max(...on) - Math.min(...on)) *
            1000) /
          report.callsPerBatch,
      };
    }),
  );
  const path = info.outputPath("queue-counting.json");
  await writeFile(
    path,
    JSON.stringify({ browser: browser.version(), ...report, comparisons }, null, 2),
  );
  await info.attach("WebGPU queue counting", { path, contentType: "application/json" });
});
