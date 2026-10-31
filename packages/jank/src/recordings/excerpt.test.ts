import { describe, expect, it } from "vitest";
import { gpuIntervalFixture } from "../../../../tests/fixtures/gpu-sample.ts";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import { viewerReferenceFixture } from "../../../../tests/fixtures/viewer-reference.ts";
import { parseRecording, serializeRecording } from "./codec.ts";
import { extractCapture } from "./excerpt.ts";

describe("offline capture extraction", () => {
  it("keeps a bounded frame window, original clocks and associated evidence without mutating its source", () => {
    const source = viewerReferenceFixture();
    const capture = extractCapture(source, 168);
    expect(capture.frames).toHaveLength(241);
    expect(capture.frames[0]?.id).toBe(48);
    expect(capture.frames.at(-1)?.id).toBe(288);
    expect(capture.capture).toEqual({ kind: "manual" });
    expect(capture.truncated).toBe(false);
    expect(
      capture.gpu.every(
        (sample) => sample.frameId !== null && sample.frameId >= 48 && sample.frameId <= 288,
      ),
    ).toBe(true);
    expect(capture.events.map((event) => event.label)).toEqual(["wave 3", "load", "wave 3"]);
    expect(capture.frames[0]).not.toBe(source.frames[47]);
    expect(parseRecording(serializeRecording(capture)).ok).toBe(true);
    expect(source.frames).toHaveLength(360);
  });
  it("flags clipped windows and omitted unlinked GPU evidence instead of claiming completeness", () => {
    const source = viewerReferenceFixture();
    expect(extractCapture(source, 336).truncated).toBe(true);
    const sample = recordingFixture().gpu[0];
    if (!sample) {
      throw new Error("Missing GPU sample");
    }
    const withUnlinked = { ...source, gpu: [...source.gpu, { ...sample, frameId: null }] };
    const capture = extractCapture(withUnlinked, 168);
    expect(capture.truncated).toBe(true);
    expect(capture.gpu.some((sample) => sample.frameId === null)).toBe(false);
    expect(extractCapture({ ...source, truncated: true }, 168).truncated).toBe(true);
    expect(() => extractCapture(source, -1)).toThrow();
    expect(() => extractCapture(source, 1)).toThrow();
  });
  it("preserves rejected timestamp pairs and filters counters by the retained CPU time range", () => {
    const source = viewerReferenceFixture();
    const sample = gpuIntervalFixture();
    const pass = sample.passes[0];
    if (!pass) {
      throw new Error("Missing pass");
    }
    const rejected = {
      ...sample,
      frameId: 168,
      passes: sample.passes.slice(1),
      rejectedPasses: [{ ...pass, startNs: "0", endNs: "0", reason: "zero-timestamp" as const }],
      omittedPasses: 1,
      completeness: "incomplete" as const,
      issues: ["zero-timestamp" as const],
      metrics: null,
    };
    const withEvidence = {
      ...source,
      gpu: [rejected],
      counters: [0, 3000, 6000].map((atMs) => ({
        atMs,
        channelId: "physics",
        status: "ready" as const,
        values: { pending: null, objects: 3 },
      })),
    };
    const capture = extractCapture(withEvidence, 168);
    expect(capture.counters.map((sample) => sample.atMs)).toEqual([3000]);
    expect(capture.gpu).toEqual([rejected]);
    expect(capture.gpu[0]).not.toBe(rejected);
    expect(parseRecording(serializeRecording(capture)).ok).toBe(true);
  });
  it("round-trips the entire automatic capture with its exact trigger, omissions and clock domains", () => {
    const source = viewerReferenceFixture();
    const automatic = {
      ...source,
      capture: {
        kind: "automatic" as const,
        triggerFrameId: 168,
        thresholdMs: 40,
        beforeFrames: 167,
        afterFrames: 192,
      },
    };
    const capture = extractCapture(automatic, 168);
    expect(capture).toEqual(automatic);
    expect(capture).not.toBe(automatic);
    expect(parseRecording(serializeRecording(capture)).ok).toBe(true);
    expect(() => extractCapture(automatic, 243)).toThrow();
  });
});
