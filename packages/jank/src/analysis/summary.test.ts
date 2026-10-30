import { describe, expect, it } from "vitest";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import type { FrameSample, ScopeCoverage } from "../core/frames.ts";
import type { Recording } from "../recordings/recording.ts";
import { summarizeFrames } from "./statistics.ts";
import { inspectFrame } from "./summary.ts";

function frame(
  id: number,
  durations: readonly [string, number][],
  coverage: ScopeCoverage = { status: "complete" },
): FrameSample {
  const startedAtMs = id * 100;
  return {
    id,
    startedAtMs,
    endedAtMs: startedAtMs + 40,
    cpu: { updateMs: null, renderMs: null },
    coverage,
    scopes: durations.map(([channelId, durationMs]) => ({
      channelId,
      startedAtMs,
      endedAtMs: startedAtMs + durationMs,
    })),
    overhead: { collectionMs: 0, refreshMs: 0 },
  };
}

function recording(frames: readonly FrameSample[]): Recording {
  return {
    ...recordingFixture(),
    channels: [
      { id: "physics", label: "Physics" },
      { id: "render", label: "Render" },
      { id: "counters", label: "Counters only" },
    ],
    frames,
    counters: [],
    events: [],
    gpu: [],
  };
}

describe("frame inspection", () => {
  it("selects stable frame IDs, returning null for absent frames and empty recordings", () => {
    const source = recording([frame(12, []), frame(48, [])]);
    expect(inspectFrame(source, 48)?.frameId).toBe(48);
    expect(inspectFrame(source, 1)).toBeNull();
    expect(inspectFrame(recording([]), 1)).toBeNull();
  });

  it("unions crossing and nested scopes without adding host CPU or tool overhead", () => {
    const selected: FrameSample = {
      ...frame(12, []),
      cpu: { updateMs: 30, renderMs: 20 },
      overhead: { collectionMs: 1, refreshMs: 2 },
      scopes: [
        { channelId: "physics", startedAtMs: 1203, endedAtMs: 1209 },
        { channelId: "render", startedAtMs: 1200, endedAtMs: 1205 },
        { channelId: "physics", startedAtMs: 1204, endedAtMs: 1206 },
        { channelId: "physics", startedAtMs: 1210, endedAtMs: 1212 },
      ],
    };
    const source = recording([selected]);
    const before = structuredClone(source);
    const result = inspectFrame(source, 12);
    expect(result).toMatchObject({
      frameId: 12,
      intervalMs: 40,
      budgetMs: 1000 / 60,
      overBudget: true,
      coverage: { status: "complete" },
      attributedMs: 11,
      unattributedMs: 29,
      scopes: selected.scopes,
      likelyCause: null,
    });
    expect(source).toEqual(before);
    expect(result?.scopes).not.toBe(selected.scopes);
    expect(result?.scopes[0]).not.toBe(selected.scopes[0]);
    expect(result?.coverage).not.toBe(selected.coverage);
  });

  it("distinguishes measured zero, missing scopes and partial attribution", () => {
    const source = recording([
      frame(1, []),
      frame(2, [], { status: "not-collected" }),
      frame(3, [["physics", 20]], { status: "truncated", omittedScopes: 4 }),
    ]);
    expect(inspectFrame(source, 1)).toMatchObject({ attributedMs: 0, unattributedMs: 40 });
    expect(inspectFrame(source, 2)).toMatchObject({
      coverage: { status: "not-collected" },
      attributedMs: null,
      unattributedMs: null,
      likelyCause: null,
    });
    expect(inspectFrame(source, 3)).toMatchObject({
      coverage: { status: "truncated", omittedScopes: 4 },
      attributedMs: 20,
      unattributedMs: 20,
      likelyCause: null,
    });
  });

  it("uses the same inferred or recorded timer tolerance as recording statistics", () => {
    const base = recordingFixture();
    const frames = [16, 17, 18, 19].map((durationMs, index) => ({
      ...frame(index + 1, []),
      endedAtMs: (index + 1) * 100 + durationMs,
    }));
    for (const estimatedResolutionMs of [null, 0, 0.5, 1]) {
      const source: Recording = {
        ...recording(frames),
        metadata: {
          ...base.metadata,
          environment: {
            ...base.metadata.environment,
            timer: { source: "custom", estimatedResolutionMs },
          },
        },
      };
      const statistics = summarizeFrames(frames, 60, estimatedResolutionMs ?? undefined);
      const summaries = frames.map((sample) => inspectFrame(source, sample.id));
      expect(summaries.filter((summary) => summary?.overBudget).length).toBe(
        statistics?.missedFrames,
      );
      expect(summaries[0]).toMatchObject({
        budgetMs: 1000 / 60,
        limitMs: statistics?.limitMs,
        estimatedTickMs: statistics?.estimatedTickMs,
      });
    }
    const exactBudget = { ...recording(frames), targetFps: 50 };
    expect(inspectFrame(exactBudget, 4)?.overBudget).toBe(false);
    expect(inspectFrame(recording([frame(1, [])]), 1)?.estimatedTickMs).toBeNull();
  });

  it("ranks the rise over each channel's own median, unioning same-channel scopes", () => {
    const baseline: readonly [string, number][] = [
      ["physics", 2],
      ["render", 20],
    ];
    const source = recording([
      frame(1, baseline),
      frame(2, baseline),
      frame(3, [
        ["physics", 12],
        ["physics", 5],
        ["render", 24],
      ]),
    ]);
    expect(inspectFrame(source, 3)?.likelyCause).toEqual({
      channelId: "physics",
      aboveMedianMs: 10,
    });
    expect(inspectFrame(source, 1)?.likelyCause).toBeNull();
  });

  it("uses upper medians including measured absence, but excludes incomplete frames", () => {
    const source = recording([
      frame(1, [["physics", 2]]),
      frame(2, [["physics", 6]]),
      frame(3, [], { status: "not-collected" }),
      frame(4, [], { status: "truncated", omittedScopes: 1 }),
      frame(5, [], { status: "not-collected" }),
    ]);
    expect(inspectFrame(source, 2)?.likelyCause).toBeNull();
    const withMeasuredAbsence = { ...source, frames: [...source.frames, frame(6, [])] };
    expect(inspectFrame(withMeasuredAbsence, 2)?.likelyCause).toEqual({
      channelId: "physics",
      aboveMedianMs: 4,
    });
  });

  it("ignores rises of at most 0.05ms and breaks ties in channel registration order", () => {
    const noise = recording([
      {
        ...frame(1, []),
        startedAtMs: 0,
        endedAtMs: 40,
        scopes: [{ channelId: "physics", startedAtMs: 0, endedAtMs: 0.05 }],
      },
      frame(2, []),
      frame(3, []),
    ]);
    expect(inspectFrame(noise, 1)?.likelyCause).toBeNull();
    const tied = recording([
      frame(1, []),
      frame(2, []),
      frame(3, [
        ["render", 3],
        ["physics", 3],
      ]),
    ]);
    expect(inspectFrame(tied, 3)?.likelyCause).toEqual({
      channelId: "physics",
      aboveMedianMs: 3,
    });
  });
});
