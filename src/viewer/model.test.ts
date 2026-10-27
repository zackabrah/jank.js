import { expect, it } from "vitest";

import { createDiagnostics } from "../core/diagnostics.ts";

import { createRecordingViewModel } from "./model.ts";

it("keeps a valid recording after import errors and exposes independent inspection state", () => {
  const monitor = createDiagnostics(() => 0);

  monitor.frame(10, 10, 1, 2);

  monitor.frame(30, 20, 2, 3);

  const viewer = createRecordingViewModel();

  viewer.load(JSON.stringify(monitor.export()));

  viewer.selectFrame(2);

  expect(() => viewer.load("invalid")).toThrow("valid JSON");

  expect(viewer.snapshot()?.selected?.frame.id).toBe(2);

  viewer.setRange(11, 30);

  expect(viewer.snapshot()?.timeline).toHaveLength(1);

  viewer.step(-1);

  expect(viewer.snapshot()?.selected?.frame.id).toBe(1);

  const state = viewer.snapshot()!;

  state.metadata.jankVersion = "changed";

  expect(viewer.snapshot()?.metadata.jankVersion).toBe("0.1.0");

  expect(() => viewer.selectFrame(999)).toThrow("not in");

  viewer.clear();

  expect(viewer.snapshot()).toBeNull();
});

it("hands views a detached copy of the validated recording", () => {
  const monitor = createDiagnostics(() => 0);

  monitor.frame(10, 10, 1, 2);

  const viewer = createRecordingViewModel();

  expect(viewer.recording()).toBeNull();

  viewer.load(JSON.stringify(monitor.export()));

  const copy = viewer.recording()!;

  copy.frames[0]!.interval = 999;

  expect(viewer.recording()?.frames[0]?.interval).toBe(10);
});
