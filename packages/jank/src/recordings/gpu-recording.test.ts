import { describe, expect, it } from "vitest";
import { gpuIntervalFixture } from "../../../../tests/fixtures/gpu-sample.ts";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import { parseRecording, serializeRecording } from "./codec.ts";

describe("schema 4 GPU recordings", () => {
  it("round trips exact timestamp origins, repeated invocations, metrics and legacy WebGL durations", () => {
    const recording = recordingFixture();
    const mixed = {
      ...recording,
      schemaVersion: 4 as const,
      gpu: [...recording.gpu, gpuIntervalFixture()],
    };
    expect(parseRecording(serializeRecording(mixed))).toEqual({ ok: true, recording: mixed });
  });

  it("rejects version 3 explicitly instead of reinterpreting pass sums", () => {
    expect(
      parseRecording(JSON.stringify({ ...recordingFixture(), schemaVersion: 3 })),
    ).toMatchObject({
      ok: false,
      problem: { code: "unsupported-version" },
    });
  });

  it("retains partial intervals while prohibiting complete totals for an incomplete frame", () => {
    const sample = {
      ...gpuIntervalFixture(),
      expectedPasses: 4,
      omittedPasses: 1,
      completeness: "incomplete" as const,
      issues: ["query-capacity" as const],
      metrics: null,
    };
    const recording = { ...recordingFixture(), gpu: [sample] };
    expect(parseRecording(serializeRecording(recording))).toEqual({ ok: true, recording });
    expect(() =>
      serializeRecording({
        ...recording,
        gpu: [{ ...sample, metrics: gpuIntervalFixture().metrics }],
      }),
    ).toThrow();
  });

  it("rejects duplicate frame identities, timestamp overflow and excessive total pass storage", () => {
    const sample = gpuIntervalFixture();
    const invalidSamples = [
      [sample, sample],
      [{ ...sample, clock: { ...sample.clock, originNs: "18446744073709551615" } }],
      Array.from({ length: 5500 }, (_, sequence) => ({ ...sample, sequence: sequence + 1 })),
    ];
    for (const gpu of invalidSamples) {
      expect(parseRecording(JSON.stringify({ ...recordingFixture(), gpu }))).toMatchObject({
        ok: false,
      });
    }
  });

  it.each([
    { clock: { ...gpuIntervalFixture().clock, originNs: "18446744073709551616" } },
    { clock: { ...gpuIntervalFixture().clock, originNs: "1.5" } },
    { clock: { ...gpuIntervalFixture().clock, unit: "milliseconds" } },
    { metrics: { ...gpuIntervalFixture().metrics, busyMs: 10 } },
    { omittedPasses: 1 },
    { completeness: "incomplete", metrics: null, issues: [] },
    { passes: [{ ...gpuIntervalFixture().passes[0], endNs: -1 }] },
    { passes: [{ ...gpuIntervalFixture().passes[0], startNs: 0.5 }] },
    { passes: [{ ...gpuIntervalFixture().passes[0], type: "cpu" }] },
    { passes: [{ ...gpuIntervalFixture().passes[0], category: "x".repeat(241) }] },
    { passes: gpuIntervalFixture().passes.map((pass) => ({ ...pass, invocation: 1 })) },
  ])("rejects malformed intervals and inconsistent aggregates: %j", (change) => {
    expect(
      parseRecording(
        JSON.stringify({ ...recordingFixture(), gpu: [{ ...gpuIntervalFixture(), ...change }] }),
      ),
    ).toMatchObject({ ok: false });
  });
});
