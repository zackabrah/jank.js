import { describe, expect, it } from "vitest";
import { gpuIntervalFixture } from "../../../../tests/fixtures/gpu-sample.ts";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import { compareFrameWork, frameAtElapsed, workCatalog } from "./frame-comparison.ts";

describe("elapsed A/B frame inspection", () => {
  it("aligns independent origins by containing intervals, never nearest frames across gaps", () => {
    const a = recordingFixture();
    const b = {
      ...a,
      frames: a.frames.map((frame) => ({
        ...frame,
        id: frame.id + 90,
        startedAtMs: frame.startedAtMs + 400,
        endedAtMs: frame.endedAtMs + 400,
      })),
    };
    expect(frameAtElapsed(a, 16)?.id).toBe(2);
    expect(frameAtElapsed(b, 16)?.id).toBe(92);
    const slower = {
      ...b,
      frames: b.frames
        .slice(0, 1)
        .map((frame) => ({ ...frame, endedAtMs: frame.startedAtMs + 32 })),
    };
    expect(frameAtElapsed(slower, 16)?.id).toBe(91);
    expect(frameAtElapsed(a, 32)).toBeNull();
    expect(frameAtElapsed(a, -1)).toBeNull();
    expect(frameAtElapsed(null, 0)).toBeNull();
    expect(frameAtElapsed({ ...a, frames: [] }, 0)).toBeNull();
    const gap = {
      ...a,
      frames: a.frames.map((frame, index) => (index ? { ...frame, startedAtMs: 120 } : frame)),
    };
    expect(frameAtElapsed(gap, 18)).toBeNull();
  });
  it("keeps configured CPU order, unions nested scopes and withholds partial or absent deltas", () => {
    const a = recordingFixture();
    const first = a.frames[0];
    if (!first) {
      throw new Error("Missing frame");
    }
    const b = { ...a, channels: [{ id: "extra", label: "Extra" }, ...a.channels] };
    const frameB = {
      ...first,
      scopes: [...first.scopes, { channelId: "physics", startedAtMs: 101, endedAtMs: 106 }],
    };
    const catalog = workCatalog(a, b);
    const rows = compareFrameWork(
      catalog,
      { recording: a, frame: first },
      { recording: b, frame: frameB },
    );
    expect(rows.map((row) => row.label)).toEqual([
      "Physics · physics",
      "Extra · extra",
      "opaque · pass-sum",
    ]);
    expect(rows[0]).toMatchObject({ a: { durationMs: 4 }, b: { durationMs: 6 }, differenceMs: 2 });
    expect(rows[1]).toMatchObject({ differenceMs: null, a: { durationMs: null } });
    const partial = compareFrameWork(
      catalog,
      { recording: a, frame: first },
      { recording: b, frame: { ...frameB, coverage: { status: "truncated", omittedScopes: 1 } } },
    );
    expect(partial[0]).toMatchObject({
      differenceMs: null,
      b: { durationMs: 6, comparable: false },
    });
    expect(
      compareFrameWork(
        catalog,
        { recording: a, frame: null },
        { recording: null, frame: null },
      ).every((row) => row.differenceMs === null),
    ).toBe(true);
  });
  it("matches GPU IDs, kinds and invocations, preserving rejected and missing evidence", () => {
    const base = recordingFixture();
    const sample = gpuIntervalFixture();
    const pass = sample.passes[0];
    if (!pass) {
      throw new Error("Missing pass");
    }
    const a = { ...base, gpu: [sample] };
    const b = {
      ...base,
      gpu: [
        {
          ...sample,
          passes: sample.passes.slice(1),
          rejectedPasses: [
            { ...pass, startNs: "0", endNs: "0", reason: "zero-timestamp" as const },
          ],
          completeness: "incomplete" as const,
          metrics: null,
        },
      ],
    };
    const catalog = workCatalog(a, b);
    const rows = compareFrameWork(
      catalog,
      { recording: a, frame: a.frames[0] ?? null },
      { recording: b, frame: b.frames[0] ?? null },
    );
    expect(rows[1]).toMatchObject({
      a: { durationMs: 4 },
      b: { durationMs: null, note: "Rejected: zero-timestamp" },
      differenceMs: null,
    });
    expect(rows[3]).toMatchObject({ differenceMs: 0 });
    const missing = compareFrameWork(
      catalog,
      { recording: a, frame: a.frames[1] ?? null },
      { recording: null, frame: null },
    );
    expect(missing[1]?.a.note).toBe("No GPU observation");
    expect(workCatalog(null, null)).toEqual([]);
  });
  it("does not choose between multiple GPU observations or repeated duration labels", () => {
    const base = recordingFixture();
    const sample = base.gpu[0];
    if (!sample || sample.measurement === "intervals") {
      throw new Error("Missing duration sample");
    }
    const duplicate = {
      ...base,
      gpu: [{ ...sample, passes: [...sample.passes, ...sample.passes] }],
    };
    const multiple = { ...base, gpu: [sample, sample] };
    const catalog = workCatalog(duplicate, multiple);
    const rows = compareFrameWork(
      catalog,
      { recording: duplicate, frame: base.frames[0] ?? null },
      { recording: multiple, frame: base.frames[0] ?? null },
    );
    expect(rows[1]).toMatchObject({
      differenceMs: null,
      a: { note: "Ambiguous pass identity" },
      b: { note: "Multiple GPU observations" },
    });
  });
});
