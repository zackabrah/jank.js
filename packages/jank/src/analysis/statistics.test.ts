import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { FrameSample } from "../core/frames.ts";
import { intervalUnion, summarizeFrames, summarizeScopes } from "./statistics.ts";

function frames(intervals: readonly number[]): FrameSample[] {
  let boundaryMs = 0;
  return intervals.map((durationMs, index) => {
    const startedAtMs = boundaryMs;
    boundaryMs += durationMs;
    return {
      id: index + 1,
      startedAtMs,
      endedAtMs: boundaryMs,
      cpu: { updateMs: null, renderMs: null },
      scopes: [],
      coverage: { status: "complete" },
      overhead: { collectionMs: 0, refreshMs: 0 },
    };
  });
}

describe("frame statistics", () => {
  it("keeps unavailable rates explicit until a complete second exists", () => {
    expect(summarizeFrames([], 60)).toBeNull();
    expect(summarizeFrames(frames([20, 20]), 60)).toMatchObject({ fps: null, fpsRange: null });
    expect(summarizeFrames(frames(Array.from({ length: 50 }, () => 20)), 60)).toMatchObject({
      fps: 50,
      fpsRange: { low: 50, high: 50 },
      averageMs: 20,
      p95Ms: 20,
      worstMs: 20,
    });
  });

  it("uses observed endings for FPS and keeps averages, percentile and worst identity separate", () => {
    const history = frames([...Array.from({ length: 50 }, () => 20), 500]);
    const result = summarizeFrames(history, 60, 0);
    expect(result).toMatchObject({
      fps: 26,
      fpsRange: { low: 26, high: 50 },
      p95Ms: 20,
      worstMs: 500,
      worstFrameId: 51,
      missedFrames: 51,
    });
    expect(result?.averageMs).toBeCloseTo(1500 / 51);
    expect(history.at(-1)?.endedAtMs).toBe(1500);
  });

  it("does not interpret gaps in retained data as a fully observed second", () => {
    const history = frames(Array.from({ length: 60 }, () => 20));
    const sample = history[55];
    if (!sample) {
      throw new Error("Missing fixture frame");
    }
    history[55] = { ...sample, startedAtMs: sample.startedAtMs + 1 };
    expect(summarizeFrames(history, 60)?.fps).toBeNull();
  });

  it("uses two timer ticks for budget classification and labels an inferred tick explicitly", () => {
    const history = frames([16.6, 16.600000001, 16.7, 16.8, 30]);
    const inferred = summarizeFrames(history, 60);
    expect(inferred?.estimatedTickMs).toBeCloseTo(0.1);
    expect(inferred?.missedFrames).toBe(1);
    expect(summarizeFrames(history, 60, 0)?.missedFrames).toBe(3);
    expect(summarizeFrames(frames([16, 40]), 60)?.estimatedTickMs).toBe(1);
  });
});

describe("scope statistics", () => {
  it("unions nested and crossing intervals without changing their order", () => {
    const scopes = [
      { startedAtMs: 3, endedAtMs: 9 },
      { startedAtMs: 0, endedAtMs: 5 },
      { startedAtMs: 1, endedAtMs: 2 },
      { startedAtMs: 10, endedAtMs: 12 },
    ];
    expect(intervalUnion(scopes)).toBe(11);
    expect(scopes[0]?.startedAtMs).toBe(3);
    expect(intervalUnion([])).toBe(0);
  });

  it("averages only complete frames, unions each channel and keeps unattributed time honest", () => {
    const [first, second, third] = frames([20, 20, 20]);
    if (!first || !second || !third) {
      throw new Error("Missing fixture frames");
    }
    const history: FrameSample[] = [
      {
        ...first,
        scopes: [
          { channelId: "physics", startedAtMs: 0, endedAtMs: 8 },
          { channelId: "physics", startedAtMs: 2, endedAtMs: 5 },
          { channelId: "render", startedAtMs: 4, endedAtMs: 12 },
        ],
      },
      second,
      { ...third, coverage: { status: "truncated", omittedScopes: 1 } },
    ];
    expect(summarizeScopes(history)).toEqual({
      measuredFrames: 2,
      excludedFrames: 1,
      channels: [
        { channelId: "physics", averageMs: 4 },
        { channelId: "render", averageMs: 4 },
      ],
      unattributedMs: 14,
    });
    expect(summarizeScopes([{ ...first, coverage: { status: "not-collected" } }])).toEqual({
      measuredFrames: 0,
      excludedFrames: 1,
      channels: [],
      unattributedMs: null,
    });
  });

  it("never attributes more union time than a frame contains", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 })), {
          maxLength: 30,
        }),
        (pairs) => {
          const scopes = pairs.map(([first, second]) => ({
            startedAtMs: Math.min(first, second),
            endedAtMs: Math.max(first, second),
          }));
          expect(intervalUnion(scopes)).toBeLessThanOrEqual(100);
          expect(intervalUnion(scopes)).toBeGreaterThanOrEqual(0);
        },
      ),
      { seed: 601, numRuns: 100 },
    );
  });
});
