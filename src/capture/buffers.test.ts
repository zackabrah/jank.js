import { expect, test, vi } from "vitest";
import { gpuFixture } from "../gpu/fixtures.ts";
import { createGpuHistory } from "../gpu/history.ts";
import { gpuCoverage } from "../gpu/model.ts";
import { readBuffers } from "./buffers.ts";
import { createCaptureController } from "./controller.ts";
import { captureFixture } from "./fixtures.ts";
import { createRuleCaptureSource } from "./rule-source.ts";

test("keeps full recording coverage distinct from a shorter rolling buffer without exporting", () => {
  const fixture = captureFixture(300);
  const history = createGpuHistory();
  const source = { ...fixture.source, gpuCoverage: history.coverage };
  const controller = createCaptureController(source);
  source.export = vi.fn(() => {
    throw new Error("Must not export for a display refresh");
  });
  controller.start();
  for (let i = 0; i < 205; i++) {
    fixture.advance(1, 16);
    const id = source.snapshot().frames.at(-1)?.id ?? 0;
    history.record(gpuFixture(id, i === 0 ? "rejected" : "timed"));
  }
  controller.refresh(source.snapshot());
  const buffers = controller.getBuffers();
  expect(buffers).toMatchObject({
    recent: 180,
    capacity: 180,
    recentGpu: { complete: 180, partial: 0, total: 180 },
    recordingGpu: { complete: 204, partial: 1, total: 205 },
    error: "",
  });
  expect(source.export).not.toHaveBeenCalled();
  controller.discard();
  expect(controller.getBuffers().recordingGpu).toBeNull();
  controller.start();
  expect(controller.getBuffers().recordingGpu?.total).toBe(0);
});

test("uses the rule-owned pre-trigger window and delegates manual frame IDs", () => {
  const fixture = captureFixture(12);
  const source = createRuleCaptureSource({
    ...fixture.source,
    gpuCoverage: (ids) =>
      gpuCoverage(
        ids,
        ids.map((id) => gpuFixture(id)),
      ),
  });
  const controller = createCaptureController(source);
  controller.applyRule({
    ...controller.getRuleSettings(),
    beforeSeconds: 2 / 60,
    afterSeconds: 2 / 60,
  });
  controller.toggleAuto();
  fixture.advance(1, 50);
  controller.refresh(source.snapshot());
  expect(controller.getSnapshot().frames).toBe(3);
  expect(controller.getBuffers().recordingGpu).toMatchObject({ total: 3, complete: 3 });
  controller.start();
  fixture.advance(1, 16);
  controller.refresh(source.snapshot());
  expect(controller.getBuffers().recordingGpu).toMatchObject({ total: 1, complete: 1 });
});

test("preserves unknown capacity, missing recording IDs, free-only pools and measured empty frames", () => {
  const { source } = captureFixture();
  delete source.recentFrameCapacity;
  delete source.recordingFrameIds;
  source.gpuPool = () => ({ free: 0, unit: "samples" });
  source.gpuCoverage = (ids) =>
    gpuCoverage(
      ids,
      ids.slice(0, 1).map((id) => ({ ...gpuFixture(id), invocations: [] })),
    );
  expect(readBuffers(source, source.snapshot(), 1)).toMatchObject({
    capacity: null,
    pool: { free: 0, unit: "samples" },
    recordingGpu: null,
    recentGpu: { complete: 1, missing: 2, total: 3 },
    error: "",
  });
  expect(readBuffers(source, source.snapshot(), 0).recordingGpu).toMatchObject({
    total: 0,
    complete: 0,
  });
});

test("contains invalid or failing host metadata without blocking capture", () => {
  const { source, advance } = captureFixture();
  const controller = createCaptureController(source);
  source.gpuPool = () => ({ free: 6, total: 5, unit: "passes" });
  controller.refresh(source.snapshot());
  expect(controller.getBuffers().error).toContain("exceeds");
  source.gpuPool = () => {
    throw new Error("Pool offline");
  };
  controller.refresh(source.snapshot());
  expect(controller.getBuffers().error).toBe("Pool offline");
  controller.start();
  advance();
  controller.stopAndSave();
  expect(controller.getSnapshot().saved).toHaveLength(1);
  delete source.gpuPool;
  source.gpuCoverage = () => ({
    complete: 3,
    partial: 0,
    unknown: 0,
    missing: 0,
    total: 4,
    pending: 0,
  });
  controller.refresh(source.snapshot());
  expect(controller.getBuffers().error).toContain("does not match");
  source.gpuCoverage = (ids) => gpuCoverage(ids, []);
  source.recordingFrameIds = () => [1, 1];
  expect(readBuffers(source, source.snapshot(), 2).error).toContain("Invalid buffer frame IDs");
  source.recordingFrameIds = () => [1];
  expect(readBuffers(source, source.snapshot(), 2).error).toContain("recorded-frame count");
});

test("keeps finalizing coverage attached to the frozen recording while recent frames advance", async () => {
  const { source, advance } = captureFixture(12);
  let finish: () => void = () => {};
  source.finalizeGpu = () =>
    new Promise((resolve) => {
      finish = () => resolve({ version: 1, frames: [] });
    });
  source.gpuCoverage = (ids) =>
    gpuCoverage(
      ids,
      ids.map((id) => gpuFixture(id)),
    );
  const controller = createCaptureController(source);
  controller.start();
  advance(1, 16);
  controller.stopAndSave();
  await Promise.resolve();
  advance(3, 16);
  source.recordingFrameIds = () => {
    throw new Error("Must use the held recording");
  };
  controller.refresh(source.snapshot());
  expect(controller.getBuffers()).toMatchObject({
    recentGpu: { total: 7, complete: 7 },
    recordingGpu: { total: 1, complete: 1 },
    error: "",
  });
  finish();
  await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe("idle"));
});

test("keeps metadata on the same display snapshot between host frames and skips per-frame reads", () => {
  const { source, advance } = captureFixture(12);
  source.gpuCoverage = vi.fn((ids) => gpuCoverage(ids, []));
  const controller = createCaptureController(source);
  controller.start();
  advance();
  controller.refresh(source.snapshot());
  const buffers = controller.getBuffers();
  vi.mocked(source.gpuCoverage).mockClear();
  advance();
  controller.refresh(source.snapshot(), false);
  expect(controller.getBuffers()).toBe(buffers);
  expect(source.gpuCoverage).not.toHaveBeenCalled();
  controller.refresh(source.snapshot());
  expect(controller.getBuffers()).toMatchObject({ recordingGpu: { total: 2 }, error: "" });
});
