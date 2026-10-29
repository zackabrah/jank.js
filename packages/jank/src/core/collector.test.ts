import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createFrameCollector } from "./collector.ts";

function setup(maxScopesPerFrame = 128) {
  let timeMs = 100;
  const collector = createFrameCollector({ now: () => timeMs, maxScopesPerFrame });
  const channel = collector.createChannel({ id: "physics", label: "Physics" });
  const advanceTo = (value: number) => {
    timeMs = value;
  };
  return { collector, channel, advanceTo };
}

describe("frame boundaries", () => {
  it("skips an initial callback boundary from before collector creation", () => {
    const { collector, channel, advanceTo } = setup();
    collector.requestScopes();
    expect(collector.beginFrame(99)).toBe(-1);
    channel.end(channel.begin());
    expect(collector.snapshot().frames).toEqual([]);
    advanceTo(116);
    collector.beginFrame(116);
    advanceTo(132);
    collector.beginFrame(132);
    expect(collector.snapshot().frames[0]?.startedAtMs).toBe(16);
    expect(collector.snapshot().frames).toHaveLength(1);
  });

  it("exposes only sealed intervals, with times relative to creation", () => {
    const { collector, advanceTo } = setup();
    const frameId = collector.beginFrame(100);
    collector.endFrame({ updateMs: 2, renderMs: 3 });
    expect(collector.snapshot().frames).toEqual([]);
    advanceTo(116);
    collector.beginFrame(116);
    expect(collector.snapshot().frames).toEqual([
      {
        id: frameId,
        startedAtMs: 0,
        endedAtMs: 16,
        cpu: { updateMs: 2, renderMs: 3 },
        scopes: [],
        coverage: { status: "not-collected" },
        overhead: { collectionMs: 0, refreshMs: 0 },
      },
    ]);
  });

  it("represents missing CPU measurements as unknown", () => {
    const { collector, advanceTo } = setup();
    collector.beginFrame(100);
    advanceTo(116);
    collector.beginFrame(116);
    expect(collector.snapshot().frames[0]?.cpu).toEqual({ updateMs: null, renderMs: null });
  });

  it("combines repeated coarse timestamps without inventing zero-length frames", () => {
    const { collector, advanceTo } = setup();
    const frameId = collector.beginFrame(100);
    collector.endFrame({ updateMs: 1, renderMs: 2 });
    expect(collector.beginFrame(100)).toBe(frameId);
    collector.endFrame({ updateMs: 3, renderMs: 4 });
    advanceTo(116);
    collector.beginFrame(116);
    expect(collector.snapshot().frames).toHaveLength(1);
    expect(collector.snapshot().frames[0]?.cpu).toEqual({ updateMs: 4, renderMs: 6 });
  });

  it("rejects invalid boundaries and CPU totals without changing recorded work", () => {
    const { collector, advanceTo } = setup();
    collector.beginFrame(100);
    collector.endFrame({ updateMs: 1, renderMs: 2 });
    for (const atMs of [99, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => collector.beginFrame(atMs)).toThrow(RangeError);
    }
    for (const durationMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => collector.endFrame({ updateMs: durationMs, renderMs: 3 })).toThrow(RangeError);
    }
    advanceTo(116);
    collector.beginFrame(116);
    expect(collector.snapshot().frames[0]?.cpu).toEqual({ updateMs: 1, renderMs: 2 });
  });

  it("rejects overflowing accumulated CPU totals atomically", () => {
    const { collector, advanceTo } = setup();
    collector.beginFrame(100);
    collector.endFrame({ updateMs: Number.MAX_VALUE, renderMs: 2 });
    expect(() => collector.endFrame({ updateMs: Number.MAX_VALUE, renderMs: 3 })).toThrow(
      RangeError,
    );
    advanceTo(116);
    collector.beginFrame(116);
    expect(collector.snapshot().frames[0]?.cpu).toEqual({
      updateMs: Number.MAX_VALUE,
      renderMs: 2,
    });
  });

  it("keeps the latest 600 sealed frames in order after wrapping several times", () => {
    const { collector, advanceTo } = setup();
    for (let index = 0; index <= 1805; index += 1) {
      advanceTo(100 + index * 16);
      collector.beginFrame(100 + index * 16);
    }
    const frames = collector.snapshot().frames;
    expect(frames).toHaveLength(600);
    expect(frames[0]?.startedAtMs).toBe(1205 * 16);
    expect(frames.at(-1)?.endedAtMs).toBe(1805 * 16);
    expect(new Set(frames.map((frame) => frame.id)).size).toBe(600);
  });
});

describe("scope ownership and clipping", () => {
  it("allows a rounded scope clock to lag a frame timestamp without fabricating duration", () => {
    const { collector, channel, advanceTo } = setup();
    collector.requestScopes();
    collector.beginFrame(100.5);
    const token = channel.begin();
    advanceTo(102);
    channel.end(token);
    advanceTo(116);
    collector.beginFrame(116.5);
    const empty = channel.begin();
    channel.end(empty);
    advanceTo(132);
    collector.beginFrame(132.5);
    expect(collector.snapshot().frames.map((frame) => frame.scopes)).toEqual([
      [{ channelId: "physics", startedAtMs: 0.5, endedAtMs: 2 }],
      [],
    ]);
  });

  it("records nested scopes as inclusive intervals without flattening overlap", () => {
    const { collector, channel, advanceTo } = setup();
    collector.requestScopes();
    collector.beginFrame(100);
    advanceTo(102);
    const outer = channel.begin();
    advanceTo(104);
    const inner = channel.begin();
    advanceTo(106);
    channel.end(inner);
    advanceTo(108);
    channel.end(outer);
    advanceTo(116);
    collector.beginFrame(116);
    expect(collector.snapshot().frames[0]?.scopes).toEqual([
      { channelId: "physics", startedAtMs: 2, endedAtMs: 8 },
      { channelId: "physics", startedAtMs: 4, endedAtMs: 6 },
    ]);
  });

  it("clips an open scope into every intersecting frame", () => {
    const { collector, channel, advanceTo } = setup();
    collector.requestScopes();
    collector.beginFrame(100);
    advanceTo(110);
    const token = channel.begin();
    advanceTo(116);
    collector.beginFrame(116);
    advanceTo(120);
    channel.end(token);
    advanceTo(132);
    collector.beginFrame(132);
    expect(collector.snapshot().frames.map((frame) => frame.scopes)).toEqual([
      [{ channelId: "physics", startedAtMs: 10, endedAtMs: 16 }],
      [{ channelId: "physics", startedAtMs: 16, endedAtMs: 20 }],
    ]);
  });

  it("retains a completed scope's tail when a callback timestamp arrives late", () => {
    const { collector, channel, advanceTo } = setup();
    collector.requestScopes();
    collector.beginFrame(100);
    advanceTo(110);
    const token = channel.begin();
    advanceTo(120);
    channel.end(token);
    collector.beginFrame(116);
    advanceTo(132);
    collector.beginFrame(132);
    expect(collector.snapshot().frames.map((frame) => frame.scopes)).toEqual([
      [{ channelId: "physics", startedAtMs: 10, endedAtMs: 16 }],
      [{ channelId: "physics", startedAtMs: 16, endedAtMs: 20 }],
    ]);
  });

  it("makes demand changes effective at the next frame boundary", () => {
    const { collector, channel, advanceTo } = setup();
    collector.beginFrame(100);
    const releaseFirst = collector.requestScopes();
    const releaseSecond = collector.requestScopes();
    channel.end(channel.begin());
    releaseFirst();
    releaseFirst();
    advanceTo(116);
    collector.beginFrame(116);
    advanceTo(118);
    const token = channel.begin();
    releaseSecond();
    advanceTo(120);
    channel.end(token);
    advanceTo(132);
    collector.beginFrame(132);
    advanceTo(148);
    collector.beginFrame(148);
    expect(collector.snapshot().frames.map((frame) => frame.coverage.status)).toEqual([
      "not-collected",
      "complete",
      "not-collected",
    ]);
    expect(collector.snapshot().frames[1]?.scopes).toHaveLength(1);
  });

  it("bounds completed and open scopes together and reports omitted work", () => {
    const { collector, channel, advanceTo } = setup(2);
    collector.requestScopes();
    collector.beginFrame(100);
    advanceTo(101);
    const first = channel.begin();
    advanceTo(102);
    channel.end(first);
    const second = channel.begin();
    const omitted = channel.begin();
    advanceTo(104);
    channel.end(omitted);
    channel.end(second);
    advanceTo(116);
    collector.beginFrame(116);
    expect(collector.snapshot().frames[0]?.coverage).toEqual({
      status: "truncated",
      omittedScopes: 1,
    });
    expect(collector.snapshot().frames[0]?.scopes).toHaveLength(2);
    advanceTo(118);
    const next = channel.begin();
    advanceTo(120);
    channel.end(next);
    advanceTo(132);
    collector.beginFrame(132);
    expect(collector.snapshot().frames[1]?.coverage).toEqual({ status: "complete" });
  });

  it("does not let another channel or a repeated end consume a scope", () => {
    const { collector, channel, advanceTo } = setup();
    const other = collector.createChannel({ id: "render", label: "Render" });
    collector.requestScopes();
    collector.beginFrame(100);
    advanceTo(102);
    const token = channel.begin();
    other.end(token);
    advanceTo(108);
    channel.end(token);
    channel.end(token);
    advanceTo(116);
    collector.beginFrame(116);
    expect(collector.snapshot().frames[0]?.scopes).toEqual([
      { channelId: "physics", startedAtMs: 2, endedAtMs: 8 },
    ]);
  });

  it("invalidates a disposed channel's open work without losing historical labels", () => {
    const { collector, channel, advanceTo } = setup();
    collector.requestScopes();
    collector.beginFrame(100);
    advanceTo(102);
    const token = channel.begin();
    advanceTo(104);
    channel.end(token);
    channel.begin();
    channel.dispose();
    channel.dispose();
    advanceTo(116);
    channel.end(token);
    collector.beginFrame(116);
    const snapshot = collector.snapshot();
    expect(snapshot.channels).toEqual([{ id: "physics", label: "Physics" }]);
    expect(snapshot.frames[0]?.scopes).toHaveLength(1);
    expect(snapshot.frames[0]?.coverage).toEqual({ status: "truncated", omittedScopes: 1 });
    expect(() => collector.createChannel({ id: "physics", label: "Different" })).toThrow(
      /channel/i,
    );
  });

  it("rejects invalid clocks without consuming a live scope", () => {
    const { collector, channel, advanceTo } = setup();
    collector.requestScopes();
    collector.beginFrame(100);
    advanceTo(105);
    const token = channel.begin();
    advanceTo(104);
    expect(() => channel.end(token)).toThrow(RangeError);
    advanceTo(Number.NaN);
    expect(() => channel.end(token)).toThrow(RangeError);
    advanceTo(108);
    channel.end(token);
    advanceTo(116);
    collector.beginFrame(116);
    expect(collector.snapshot().frames[0]?.scopes[0]?.endedAtMs).toBe(8);
  });
});

describe("lifecycle and detached snapshots", () => {
  it("keeps the clock monotonic across clear and rejects impossible late scope endings", () => {
    const { collector, channel, advanceTo } = setup();
    collector.requestScopes();
    collector.beginFrame(100);
    advanceTo(102);
    const token = channel.begin();
    advanceTo(116);
    collector.beginFrame(116);
    advanceTo(110);
    expect(() => channel.end(token)).toThrow(RangeError);
    advanceTo(120);
    channel.end(token);
    collector.clear();
    expect(() => collector.beginFrame(100)).toThrow(RangeError);
  });

  it("bounds channel metadata and reuses disposed identities only with the same meaning", () => {
    const { collector, channel } = setup();
    channel.dispose();
    const replacement = collector.createChannel({ id: "physics", label: "Physics" });
    channel.dispose();
    expect(() => collector.createChannel({ id: "physics", label: "Physics" })).toThrow(/channel/i);
    for (let index = 1; index < 64; index += 1) {
      collector.createChannel({ id: `channel-${index}`, label: `Channel ${index}` });
    }
    expect(() => collector.createChannel({ id: "overflow", label: "Overflow" })).toThrow(
      RangeError,
    );
    replacement.dispose();
    collector.clear();
    expect(() => collector.createChannel({ id: "physics", label: "New meaning" })).not.toThrow();
    expect(collector.snapshot().channels).toHaveLength(64);
  });

  it("validates labels and copies caller-owned channel metadata", () => {
    const { collector } = setup();
    const description = { id: "render", label: "Render" };
    collector.createChannel(description);
    description.label = "Changed later";
    expect(collector.snapshot().channels[1]?.label).toBe("Render");
    expect(() => collector.createChannel({ id: "x".repeat(241), label: "Long" })).toThrow(
      /channel/i,
    );
    expect(() => collector.createChannel({ id: "empty", label: " " })).toThrow(/channel/i);
    expect(() => collector.createChannel({ id: "long", label: "x".repeat(241) })).toThrow(
      /channel/i,
    );
  });

  it("clears pending work while preserving origin, channels, demand and monotonic IDs", () => {
    const { collector, channel, advanceTo } = setup();
    collector.requestScopes();
    const oldId = collector.beginFrame(100);
    advanceTo(102);
    const stale = channel.begin();
    collector.clear();
    advanceTo(120);
    expect(collector.beginFrame(120)).toBeGreaterThan(oldId);
    channel.end(stale);
    advanceTo(122);
    const fresh = channel.begin();
    advanceTo(124);
    channel.end(fresh);
    advanceTo(136);
    collector.beginFrame(136);
    expect(collector.snapshot().frames).toHaveLength(1);
    expect(collector.snapshot().frames[0]?.scopes).toEqual([
      { channelId: "physics", startedAtMs: 22, endedAtMs: 24 },
    ]);
  });

  it("keeps snapshots detached in both directions, including nested values", () => {
    const { collector, channel, advanceTo } = setup();
    collector.requestScopes();
    collector.beginFrame(100);
    advanceTo(102);
    const token = channel.begin();
    advanceTo(104);
    channel.end(token);
    advanceTo(116);
    collector.beginFrame(116);
    const snapshot = collector.snapshot();
    const frame = snapshot.frames[0];
    expect(frame).toBeDefined();
    if (!frame) {
      throw new Error("Expected sealed frame");
    }
    Reflect.set(frame.cpu, "updateMs", 999);
    Reflect.set(frame.scopes[0] ?? {}, "endedAtMs", 999);
    Reflect.set(snapshot.channels[0] ?? {}, "label", "Changed");
    const unchanged = collector.snapshot();
    expect(unchanged.frames[0]?.cpu.updateMs).toBeNull();
    expect(unchanged.frames[0]?.scopes[0]?.endedAtMs).toBe(4);
    expect(unchanged.channels[0]?.label).toBe("Physics");
    collector.clear();
    expect(unchanged.frames).toHaveLength(1);
  });

  it("disposes idempotently and makes late host calls harmless", () => {
    const { collector, channel } = setup();
    const release = collector.requestScopes();
    collector.beginFrame(100);
    const token = channel.begin();
    collector.dispose();
    collector.dispose();
    channel.end(token);
    channel.end(channel.begin());
    channel.dispose();
    collector.endFrame({ updateMs: 1, renderMs: 2 });
    expect(collector.beginFrame(116)).toBe(-1);
    release();
    collector.clear();
    expect(collector.snapshot().frames).toEqual([]);
    expect(collector.snapshot().channels).toEqual([]);
    expect(() => collector.createChannel({ id: "late", label: "Late" })).toThrow(/disposed/i);
  });

  it("validates configuration and channel identity at the boundary", () => {
    for (const maxScopesPerFrame of [0, -1, 1.5, 1025, Number.NaN]) {
      expect(() => createFrameCollector({ now: () => 0, maxScopesPerFrame })).toThrow(RangeError);
    }
    for (const targetFps of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createFrameCollector({ now: () => 0, targetFps })).toThrow(RangeError);
    }
    expect(() => createFrameCollector({ now: () => Number.NaN })).toThrow(RangeError);
    const { collector } = setup();
    expect(() => collector.createChannel({ id: "physics", label: "Other" })).toThrow(/channel/i);
    expect(() => collector.createChannel({ id: "", label: "Empty" })).toThrow(/channel/i);
    collector.setTargetFps(120);
    expect(() => collector.setTargetFps(0)).toThrow(RangeError);
    expect(collector.snapshot().targetFps).toBe(120);
  });
});

describe("overhead accounting", () => {
  it("accounts for collection separately from refresh and preserves callback results", () => {
    let timeMs = 100;
    let costMs = 0;
    const collector = createFrameCollector({ now: () => timeMs, costNow: () => costMs++ });
    collector.beginFrame(100);
    const result = collector.measureRefresh(() => {
      collector.endFrame({ updateMs: 2, renderMs: 3 });
      costMs += 5;
      return "rendered";
    });
    expect(result).toBe("rendered");
    timeMs = 116;
    collector.beginFrame(116);
    const frame = collector.snapshot().frames[0];
    expect(frame?.overhead).toEqual({ collectionMs: 2, refreshMs: 7 });
    expect(collector.snapshot().overhead.collection).toEqual({
      latestMs: 2,
      averageMs: 2,
      peakMs: 2,
    });
  });

  it("counts an outer refresh once even when nested refresh throws", () => {
    let timeMs = 100;
    let costMs = 0;
    const collector = createFrameCollector({ now: () => timeMs, costNow: () => costMs });
    collector.beginFrame(100);
    const failure = new Error("render failed");
    expect(() =>
      collector.measureRefresh(() => {
        costMs += 2;
        collector.measureRefresh(() => {
          costMs += 3;
          throw failure;
        });
      }),
    ).toThrow(failure);
    timeMs = 116;
    collector.beginFrame(116);
    expect(collector.snapshot().frames[0]?.overhead.refreshMs).toBe(5);
  });

  it("does not charge an old refresh to a replacement frame after clear", () => {
    let timeMs = 100;
    let costMs = 0;
    const collector = createFrameCollector({ now: () => timeMs, costNow: () => costMs });
    collector.beginFrame(100);
    collector.measureRefresh(() => {
      costMs += 5;
      collector.clear();
      timeMs = 120;
      collector.beginFrame(120);
      costMs += 5;
    });
    timeMs = 136;
    collector.beginFrame(136);
    expect(collector.snapshot().frames[0]?.overhead.refreshMs).toBe(0);
  });
});

it("preserves total scope duration across generated late callback boundaries", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 63 }),
      fc.integer({ min: 1, max: 100 }),
      (start, duration) => {
        const { collector, channel, advanceTo } = setup();
        collector.requestScopes();
        collector.beginFrame(100);
        advanceTo(100 + start);
        const token = channel.begin();
        advanceTo(100 + start + duration);
        channel.end(token);
        for (let boundary = 16; boundary <= 176; boundary += 16) {
          advanceTo(100 + Math.max(start + duration, boundary));
          collector.beginFrame(100 + boundary);
        }
        let collectedMs = 0;
        for (const frame of collector.snapshot().frames) {
          for (const scope of frame.scopes) {
            expect(scope.startedAtMs).toBeGreaterThanOrEqual(frame.startedAtMs);
            expect(scope.endedAtMs).toBeLessThanOrEqual(frame.endedAtMs);
            collectedMs += scope.endedAtMs - scope.startedAtMs;
          }
        }
        expect(collectedMs).toBe(duration);
      },
    ),
    { seed: 20261031, numRuns: 100 },
  );
});

it("preserves contiguous, bounded intervals for generated host timings", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 1, maxLength: 800 }),
      (deltas) => {
        const { collector, advanceTo } = setup();
        let timeMs = 100;
        collector.beginFrame(timeMs);
        const expected: { startedAtMs: number; endedAtMs: number }[] = [];
        for (const delta of deltas) {
          const previous = timeMs;
          timeMs += delta;
          advanceTo(timeMs);
          collector.beginFrame(timeMs);
          if (delta > 0) {
            expected.push({ startedAtMs: previous - 100, endedAtMs: timeMs - 100 });
          }
        }
        expect(
          collector
            .snapshot()
            .frames.map(({ startedAtMs, endedAtMs }) => ({ startedAtMs, endedAtMs })),
        ).toEqual(expected.slice(-600));
      },
    ),
    { seed: 20261030, numRuns: 100 },
  );
});
