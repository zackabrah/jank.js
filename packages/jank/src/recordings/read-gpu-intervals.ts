import { measureGpuIntervals } from "../analysis/gpu-intervals.ts";
import {
  type GpuIntervalPass,
  type GpuIntervalSample,
  type GpuMetrics,
  gpuIncompleteReasons,
  gpuIntervalLimits,
} from "../core/gpu.ts";
import { recordingLimits } from "./limits.ts";
import { choice, integer, invalid, list, nullable, number, object, text } from "./read-values.ts";

const uint64Max = (1n << 64n) - 1n;

function readClock(value: unknown, path: string): GpuIntervalSample["clock"] {
  const data = object(value, path);
  const originNs = text(data.originNs, `${path}.originNs`, 20);
  if (!/^(0|[1-9]\d*)$/u.test(originNs) || BigInt(originNs) > uint64Max) {
    invalid(`${path}.originNs`, "Expected a decimal unsigned 64-bit GPU timestamp");
  }
  return {
    id: text(data.id, `${path}.id`),
    domain: choice(data.domain, `${path}.domain`, ["webgpu-timestamp"]),
    unit: choice(data.unit, `${path}.unit`, ["nanoseconds"]),
    originNs,
  };
}

function readPass(value: unknown, path: string): GpuIntervalPass {
  const data = object(value, path);
  const startNs = integer(data.startNs, `${path}.startNs`, 0, gpuIntervalLimits.spanNs);
  return {
    id: text(data.id, `${path}.id`),
    label: text(data.label, `${path}.label`),
    type: choice(data.type, `${path}.type`, ["compute", "render"]),
    category: nullable(data.category, `${path}.category`, text),
    invocation: integer(data.invocation, `${path}.invocation`, 1),
    rendererFrameId: nullable(data.rendererFrameId, `${path}.rendererFrameId`, integer),
    startNs,
    endNs: integer(data.endNs, `${path}.endNs`, startNs, gpuIntervalLimits.spanNs),
  };
}

function readMetrics(value: unknown, path: string, passes: readonly GpuIntervalPass[]): GpuMetrics {
  const data = object(value, path);
  const expected = measureGpuIntervals(passes);
  for (const [key, result] of Object.entries(expected)) {
    const measured = number(data[key], `${path}.${key}`);
    if (Math.abs(measured - result) > 1e-9) {
      invalid(`${path}.${key}`, "Metric does not match the recorded GPU intervals");
    }
  }
  return expected;
}

export function readGpuIntervals(value: unknown, path: string): GpuIntervalSample {
  const data = object(value, path);
  const clock = readClock(data.clock, `${path}.clock`);
  const passes = list(data.passes, `${path}.passes`, recordingLimits.gpuPasses, readPass);
  const expectedPasses = integer(data.expectedPasses, `${path}.expectedPasses`);
  const omittedPasses = integer(data.omittedPasses, `${path}.omittedPasses`);
  const completeness = choice(data.completeness, `${path}.completeness`, [
    "complete",
    "incomplete",
  ]);
  const issues = list(data.issues, `${path}.issues`, gpuIncompleteReasons.length, (value, path) =>
    choice(value, path, gpuIncompleteReasons),
  );
  if (passes.length + omittedPasses !== expectedPasses || new Set(issues).size !== issues.length) {
    invalid(path, "Inconsistent GPU pass counts or duplicate issues");
  }
  validatePasses(passes, { expectedPasses, originNs: clock.originNs }, path);
  if (
    completeness === "complete"
      ? omittedPasses > 0 || issues.length > 0
      : issues.length === 0 || data.metrics !== null
  ) {
    invalid(path, "Incomplete GPU frames need a reason and cannot have complete totals");
  }
  return {
    measurement: "intervals",
    clock,
    passes,
    expectedPasses,
    omittedPasses,
    completeness,
    issues,
    frameId: nullable(data.frameId, `${path}.frameId`, (value, path) => integer(value, path, 1)),
    rendererFrameId: integer(data.rendererFrameId, `${path}.rendererFrameId`),
    sequence: integer(data.sequence, `${path}.sequence`, 1),
    metrics:
      completeness === "complete" ? readMetrics(data.metrics, `${path}.metrics`, passes) : null,
  };
}

function validatePasses(
  passes: readonly GpuIntervalPass[],
  frame: { expectedPasses: number; originNs: string },
  path: string,
): void {
  let previousInvocation = 0;
  for (const pass of passes) {
    if (pass.invocation <= previousInvocation || pass.invocation > frame.expectedPasses) {
      invalid(`${path}.passes`, "Pass invocations must be unique and ordered within the frame");
    }
    if (BigInt(frame.originNs) + BigInt(pass.endNs) > uint64Max) {
      invalid(`${path}.passes`, "GPU timestamp exceeds uint64 range");
    }
    previousInvocation = pass.invocation;
  }
}
