import { measureGpuIntervals } from "../analysis/gpu-intervals.ts";
import {
  type GpuIntervalPass,
  type GpuIntervalSample,
  type GpuMetrics,
  type GpuRejectedPass,
  gpuIncompleteReasons,
  gpuIntervalLimits,
  gpuTimestampRejections,
} from "../core/gpu.ts";
import { recordingLimits } from "./limits.ts";
import { choice, integer, invalid, list, nullable, number, object, text } from "./read-values.ts";

const uint64Max = (1n << 64n) - 1n;

function readTimestamp(value: unknown, path: string): string {
  const timestamp = text(value, path, 20);
  if (!/^(0|[1-9]\d*)$/u.test(timestamp) || BigInt(timestamp) > uint64Max) {
    invalid(path, "Expected a decimal unsigned 64-bit GPU timestamp");
  }
  return timestamp;
}

function readClock(value: unknown, path: string): GpuIntervalSample["clock"] {
  const data = object(value, path);
  const originNs = readTimestamp(data.originNs, `${path}.originNs`);
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
    ...readPassIdentity(data, path),
    startNs,
    endNs: integer(data.endNs, `${path}.endNs`, startNs, gpuIntervalLimits.spanNs),
  };
}

function readPassIdentity(
  data: Record<string, unknown>,
  path: string,
): Omit<GpuIntervalPass, "startNs" | "endNs"> {
  return {
    id: text(data.id, `${path}.id`),
    label: text(data.label, `${path}.label`),
    type: choice(data.type, `${path}.type`, ["compute", "render"]),
    category: nullable(data.category, `${path}.category`, text),
    invocation: integer(data.invocation, `${path}.invocation`, 1),
    rendererFrameId: nullable(data.rendererFrameId, `${path}.rendererFrameId`, integer),
  };
}

function readRejectedPass(value: unknown, path: string): GpuRejectedPass {
  const data = object(value, path);
  return {
    ...readPassIdentity(data, path),
    reason: choice(data.reason, `${path}.reason`, gpuTimestampRejections),
    startNs: nullable(data.startNs, `${path}.startNs`, readTimestamp),
    endNs: nullable(data.endNs, `${path}.endNs`, readTimestamp),
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
  const rejectedPasses = list(
    data.rejectedPasses,
    `${path}.rejectedPasses`,
    recordingLimits.gpuPasses,
    readRejectedPass,
  );
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
  validateRejections(rejectedPasses, { passes, expectedPasses, issues }, path);
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
    rejectedPasses,
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

function validateRejections(
  rejected: readonly GpuRejectedPass[],
  frame: Pick<GpuIntervalSample, "passes" | "expectedPasses" | "issues">,
  path: string,
): void {
  if (rejected.length + frame.passes.length > recordingLimits.gpuPasses) {
    invalid(path, "Accepted and rejected GPU passes exceed the per-frame storage limit");
  }
  const invocations = new Set(frame.passes.map((pass) => pass.invocation));
  let previousInvocation = 0;
  for (const pass of rejected) {
    if (
      pass.invocation <= previousInvocation ||
      pass.invocation > frame.expectedPasses ||
      invocations.has(pass.invocation)
    ) {
      invalid(
        `${path}.rejectedPasses`,
        "Rejected pass invocations must be unique, ordered and omitted from accepted passes",
      );
    }
    if (!frame.issues.includes(pass.reason)) {
      invalid(`${path}.rejectedPasses`, "Rejected timestamp reason must appear in frame issues");
    }
    previousInvocation = pass.invocation;
  }
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
