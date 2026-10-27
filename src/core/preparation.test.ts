import { describe, expect, it } from "vitest";

import { createPreparationProfiler } from "./preparation.ts";

describe("application-defined preparation stages", () => {
  it("retains custom stages, declared ordering and overlapping elapsed work", () => {
    let now = 0;

    const profiler = createPreparationProfiler({
      now: () => now,
      stages: ["audio", "sprites"],
    });

    profiler.start({ label: "Custom app", kind: "fresh-context" });

    const endSprite = profiler.begin("sprites");

    const endAudio = profiler.begin("audio");

    now = 5;

    const endSecondAudio = profiler.begin("audio");

    now = 10;

    endAudio();

    endSprite();

    now = 15;

    endSecondAudio();

    profiler.measure("custom-shaders", () => {
      now = 20;
    });

    profiler.finish("ready");

    expect(profiler.snapshot()?.stages.map((s) => s.stage)).toEqual([
      "audio",
      "sprites",
      "custom-shaders",
    ]);

    expect(profiler.snapshot()?.stages[0]).toMatchObject({
      totalMs: 20,
      busyMs: 15,
      count: 2,
    });

    expect(profiler.snapshot()?.elapsedMs).toBe(20);
  });

  it("seals replaced sessions so late completions cannot contaminate new measurements", async () => {
    let now = 0;

    const profiler = createPreparationProfiler({ now: () => now });

    profiler.start({ label: "Old", kind: "fresh-context" });

    let resolve: (() => void) | undefined;

    const pending = profiler.measure(
      "download",
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );

    now = 10;

    profiler.start({ label: "New", kind: "repeat-session" });

    now = 20;

    resolve?.();

    await pending;

    expect(profiler.snapshot()?.stages).toEqual([]);

    expect(profiler.history()[0]).toMatchObject({
      status: "cancelled",
      elapsedMs: 10,
      pending: 1,
    });

    expect(() => profiler.begin(" ")).toThrow("must have a name");
  });
});
