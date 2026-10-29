import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
import { createFrameCollector } from "../packages/jank/src/core/collector.ts";

const sampleCount = 15;
const framesPerSample = 5_000;
const cases = [
  { name: "frames only", scopesPerFrame: 0, snapshotEvery: 0 },
  { name: "8 scopes per frame", scopesPerFrame: 8, snapshotEvery: 0 },
  { name: "128 scopes per frame", scopesPerFrame: 128, snapshotEvery: 0 },
  { name: "8 scopes and snapshot every 6 frames", scopesPerFrame: 8, snapshotEvery: 6 },
];

function runWorkload(workload, enabled) {
  let timeMs = 0;
  let checksum = 0;
  const collector = enabled
    ? createFrameCollector({ now: () => timeMs, costNow: () => performance.now() })
    : null;
  const channel = collector?.createChannel({ id: "work", label: "Work" });
  if (workload.scopesPerFrame > 0) {
    collector?.requestScopes();
  }
  const startedAtMs = performance.now();
  for (let frame = 0; frame < framesPerSample; frame += 1) {
    timeMs = frame * 16;
    collector?.beginFrame(timeMs);
    for (let scope = 0; scope < workload.scopesPerFrame; scope += 1) {
      const token = channel?.begin();
      timeMs += 0.01;
      checksum += timeMs;
      if (channel && token !== undefined) {
        channel.end(token);
      }
    }
    collector?.endFrame({ updateMs: 1, renderMs: 2 });
    if (workload.snapshotEvery > 0 && frame % workload.snapshotEvery === 0) {
      checksum += collector?.snapshot().frames.length ?? 0;
    }
  }
  const elapsedMs = performance.now() - startedAtMs;
  collector?.dispose();
  if (!Number.isFinite(checksum)) {
    throw new Error("Benchmark checksum overflowed");
  }
  return (elapsedMs * 1_000) / framesPerSample;
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    medianUs: sorted[Math.floor(sorted.length / 2)],
    minUs: sorted[0],
    maxUs: sorted.at(-1),
  };
}

const results = cases.map((workload) => {
  // Warm both paths, then alternate ordering to reduce consistent warm-up bias.
  for (let warmup = 0; warmup < 3; warmup += 1) {
    runWorkload(workload, false);
    runWorkload(workload, true);
  }
  const baseline = [];
  const observed = [];
  const added = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const firstEnabled = sample % 2 === 0;
    const first = runWorkload(workload, firstEnabled);
    const second = runWorkload(workload, !firstEnabled);
    const baselineUs = firstEnabled ? second : first;
    const observedUs = firstEnabled ? first : second;
    baseline.push(baselineUs);
    observed.push(observedUs);
    added.push(observedUs - baselineUs);
  }
  return {
    ...workload,
    baseline: summarize(baseline),
    observed: summarize(observed),
    added: summarize(added),
  };
});

const report = {
  measuredAt: new Date().toISOString(),
  environment: {
    node: process.version,
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? "unknown",
  },
  sampleCount,
  framesPerSample,
  units: "microseconds per host frame",
  limitations:
    "Local Node microbenchmark with synthetic frame time and real cost clock. Includes synchronous collection, copying and GC noise; excludes browser layout, paint, GPU, capture, adapters and UI. Baseline is the same host loop without collection, not the previous implementation. Min/max describe batch means, not frame-tail latency.",
  results,
};

mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/collection-benchmark.json", `${JSON.stringify(report, null, 2)}\n`);
console.table(
  results.map(({ name, added }) => ({
    workload: name,
    "median added µs/frame": added.medianUs.toFixed(3),
    "min batch µs/frame": added.minUs.toFixed(3),
    "max batch µs/frame": added.maxUs.toFixed(3),
  })),
);
console.info(report.environment, report.limitations);
