import { expect, test } from "vitest";
import type { FrameSample } from "../core/frames.ts";
import { frameLayout } from "./frame-layout.ts";

const frames: FrameSample[] = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1,
  startedAtMs: index * 20,
  endedAtMs: (index + 1) * 20,
  cpu: { updateMs: null, renderMs: null },
  scopes: [],
  coverage: { status: "complete" },
  overhead: { collectionMs: 0, refreshMs: 0 },
}));

test("layout preserves 3px pitch, newest tied worst, and exactly the visible scope window", () => {
  const model = frameLayout({
    frames,
    events: [],
    budgetMs: 16.7,
    width: 30,
    height: 120,
    labels: true,
  });
  expect(model.visible.map((frame) => frame.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  expect(model.worst?.id).toBe(20);
  expect(model.bars.at(-1)?.x).toBe(model.margin + 28);
  expect(model.bars.at(-1)?.height).toBeLessThan(model.barBottom - 24);
});

test("events belong to measured frames, not gaps; newest colliding marker wins", () => {
  const model = frameLayout({
    frames: [frames[0], frames[2]].filter((frame): frame is FrameSample => !!frame),
    events: [
      { atMs: 10, label: "older", detail: null },
      { atMs: 11, label: "newer", detail: null },
      { atMs: 30, label: "gap", detail: null },
      { atMs: 60, label: "end", detail: null },
    ],
    budgetMs: 16.7,
    width: 300,
    height: 120,
    labels: true,
  });
  expect(model.events.map((event) => event.label)).not.toContain("gap");
  expect(model.events.map((event) => event.label)).not.toContain("older");
  expect(model.latestEvent?.label).toBe("end");
  expect(
    frameLayout({ frames: [], events: [], budgetMs: 16.7, width: 0, height: 0, labels: true })
      .worst,
  ).toBeNull();
});

test("event symbols preserve explicit host icons and recording lifecycle meanings", async () => {
  const { eventSymbol } = await import("./frame-layout.ts");
  expect(eventSymbol("◆ Scene loaded")).toEqual({ glyph: "◆", name: "Scene loaded" });
  expect(eventSymbol("Recording started").glyph).toBe("●");
  expect(eventSymbol("Recording stopped").glyph).toBe("■");
  expect(eventSymbol("Recording complete").glyph).toBe("■");
  expect(eventSymbol("Spike captured").glyph).toBe("▲");
});
