import { expect, it } from "vitest";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import { copyGpuSample } from "../core/gpu.ts";
import { parseRecording, serializeRecording } from "../recordings/codec.ts";
import { finishGpuFrame, type GpuFrameTiming } from "./gpu-interval-frame.ts";

function timing(count: number): GpuFrameTiming {
  return {
    frameId: 1,
    rendererFrameId: 10,
    sequence: 1,
    expectedPasses: count,
    issues: new Set(),
    passes: Array.from({ length: count }, (_, index) => ({
      id: "cloud-shadows",
      label: "Cloud shadows",
      type: "render",
      category: "clouds",
      invocation: index + 1,
      rendererFrameId: 10,
    })),
  };
}

it.each([
  [[], "missing-timestamp", null, null],
  [[12n], "missing-timestamp", "12", null],
  [[0n, 0n], "zero-timestamp", "0", "0"],
  [[0n, 12n], "zero-timestamp", "0", "12"],
  [[12n, 0n], "zero-timestamp", "12", "0"],
  [[12n, 11n], "reversed-timestamp", "12", "11"],
  [[1n, 60_000_000_002n], "out-of-range-timestamp", "1", "60000000002"],
] as const)(
  "classifies rejected timestamps %s without inventing timing",
  (values, reason, startNs, endNs) => {
    const sample = finishGpuFrame(timing(1), new BigUint64Array(values), "device");
    expect(sample).toMatchObject({
      completeness: "incomplete",
      metrics: null,
      passes: [],
      omittedPasses: 1,
      issues: [reason],
      rejectedPasses: [
        {
          id: "cloud-shadows",
          label: "Cloud shadows",
          type: "render",
          category: "clouds",
          invocation: 1,
          rendererFrameId: 10,
          reason,
          startNs,
          endNs,
        },
      ],
    });
    const recording = { ...recordingFixture(), gpu: [sample] };
    expect(parseRecording(serializeRecording(recording))).toEqual({ ok: true, recording });
    const detached = copyGpuSample(sample);
    expect(detached.rejectedPasses).not.toBe(sample.rejectedPasses);
    expect(detached.rejectedPasses[0]).not.toBe(sample.rejectedPasses[0]);
  },
);

it("preserves valid quantized zero durations and exact large rejected timestamps", () => {
  const origin = 18_446_744_000_000_000_000n;
  const sample = finishGpuFrame(
    timing(3),
    new BigUint64Array([origin, origin, origin + 10n, origin + 9n, origin + 5n, origin + 8n]),
    "device",
  );
  expect(sample.passes.map((pass) => [pass.invocation, pass.startNs, pass.endNs])).toEqual([
    [1, 0, 0],
    [3, 5, 8],
  ]);
  expect(sample.rejectedPasses[0]).toMatchObject({
    invocation: 2,
    reason: "reversed-timestamp",
    startNs: String(origin + 10n),
    endNs: String(origin + 9n),
  });
  expect(sample.metrics).toBeNull();
  expect(finishGpuFrame(timing(1), new BigUint64Array([10n, 10n]), "device")).toMatchObject({
    completeness: "complete",
    rejectedPasses: [],
    metrics: { busyMs: 0 },
  });
});

it("diagnoses excessive frame span separately from a rejected individual pair", () => {
  const sample = finishGpuFrame(
    timing(2),
    new BigUint64Array([1n, 2n, 60_000_000_001n, 60_000_000_002n]),
    "device",
  );
  expect(sample.passes).toHaveLength(1);
  expect(sample.rejectedPasses[0]).toMatchObject({
    invocation: 2,
    reason: "out-of-range-timestamp",
    startNs: "60000000001",
    endNs: "60000000002",
  });
  expect(sample.metrics).toBeNull();
});

it("orders mixed pair and frame-span rejections by their original pass invocation", () => {
  const sample = finishGpuFrame(
    timing(3),
    new BigUint64Array([60_000_000_001n, 60_000_000_002n, 1n, 2n, 12n, 11n]),
    "device",
  );
  expect(sample.rejectedPasses.map((pass) => pass.invocation)).toEqual([1, 3]);
  const recording = { ...recordingFixture(), gpu: [sample] };
  expect(parseRecording(serializeRecording(recording))).toEqual({ ok: true, recording });
});

it("validates diagnostic identities, reasons, uint64 values and storage bounds on import", () => {
  const sample = finishGpuFrame(timing(1), new BigUint64Array([12n, 11n]), "device");
  const rejected = sample.rejectedPasses[0];
  for (const change of [
    { startNs: "-1" },
    { endNs: "18446744073709551616" },
    { startNs: "01" },
    { reason: "unknown" },
    { invocation: 2 },
    { id: "" },
  ]) {
    expect(
      parseRecording(
        JSON.stringify({
          ...recordingFixture(),
          gpu: [
            {
              ...sample,
              rejectedPasses: [{ ...rejected, ...change }],
            },
          ],
        }),
      ).ok,
    ).toBe(false);
  }
  for (const rejectedPasses of [[rejected, rejected], Array(257).fill(rejected)]) {
    expect(
      parseRecording(
        JSON.stringify({ ...recordingFixture(), gpu: [{ ...sample, rejectedPasses }] }),
      ).ok,
    ).toBe(false);
  }
});
