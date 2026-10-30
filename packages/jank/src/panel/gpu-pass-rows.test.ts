import { describe, expect, it } from "vitest";
import { gpuIntervalFixture } from "../../../../tests/fixtures/gpu-sample.ts";
import type { GpuIntervalSample, GpuState } from "../core/gpu.ts";
import { createGpuPassRows } from "./gpu-pass-rows.ts";

function ready(sample: GpuIntervalSample): GpuState {
  return { status: "ready", currentRendererFrameId: 8, droppedSamples: 0, sample };
}

describe("stable GPU pass rows", () => {
  it("pins configured order, retains missing rows and matches repetitions independently of frame-wide invocation", () => {
    const model = createGpuPassRows(["scene", "fft"]);
    const sample = gpuIntervalFixture();
    const initial = model.update(ready(sample)).rows;
    expect(initial.map((row) => [row.id, row.occurrence])).toEqual([
      ["scene", 1],
      ["fft", 1],
      ["fft", 2],
    ]);
    const scene = sample.passes[1];
    if (!scene) {
      throw new Error("Missing fixture scene");
    }
    const missing = model.update(ready({ ...sample, passes: [{ ...scene, invocation: 1 }] })).rows;
    expect(missing.map((row) => row.key)).toEqual(initial.map((row) => row.key));
    expect(missing.map((row) => row.status)).toEqual(["observed", "not-observed", "not-observed"]);
    expect(missing.map((row) => row.durationMs)).toEqual([4, null, null]);
    const restored = model.update(
      ready({
        ...sample,
        passes: sample.passes.map((pass) => ({ ...pass, invocation: pass.invocation + 10 })),
      }),
    ).rows;
    expect(restored.map((row) => row.key)).toEqual(initial.map((row) => row.key));
    expect(restored.map((row) => row.status)).toEqual(["observed", "observed", "observed"]);
  });

  it("retains first-seen order across reordered samples and separates invalid from absent measurements", () => {
    const model = createGpuPassRows();
    const sample = gpuIntervalFixture();
    const initial = model.update(ready(sample)).rows;
    const rejected = sample.passes[0];
    if (!rejected) {
      throw new Error("Missing fixture FFT");
    }
    const result = model.update(
      ready({
        ...sample,
        passes: sample.passes.slice(1).toReversed(),
        rejectedPasses: [{ ...rejected, startNs: "0", endNs: "5", reason: "zero-timestamp" }],
        completeness: "incomplete",
        metrics: null,
      }),
    ).rows;
    expect(result.map((row) => row.key)).toEqual(initial.map((row) => row.key));
    expect(result[0]).toMatchObject({
      status: "rejected",
      reason: "zero-timestamp",
      durationMs: null,
    });
    expect(result[2]).toMatchObject({
      id: "fft",
      occurrence: 2,
      status: "observed",
      durationMs: 2,
    });
    const pending = model.update({ status: "pending" });
    expect(pending.measurement).toBe("intervals");
    expect(
      pending.rows.every((row) => row.status === "unavailable" && row.durationMs === null),
    ).toBe(true);
    expect(model.update({ status: "disabled" }).rows).toHaveLength(3);
    model.clear();
    expect(model.update(null).rows).toEqual([]);
    expect(createGpuPassRows().update(null).rows).toEqual([]);
  });

  it("bounds remembered rows and reports undisplayed current passes without evicting established rows", () => {
    const model = createGpuPassRows();
    const sample = gpuIntervalFixture();
    const pass = sample.passes[0];
    if (!pass) {
      throw new Error("Missing fixture FFT");
    }
    for (let index = 0; index < 256; index += 1) {
      model.update(ready({ ...sample, passes: [{ ...pass, id: String(index) }] }));
    }
    const result = model.update(ready({ ...sample, passes: [{ ...pass, id: "overflow" }] }));
    expect(result.rows).toHaveLength(256);
    expect(result.hiddenPasses).toBe(1);
    expect(result.rows[0]?.id).toBe("0");
    model.clear();
    expect(model.update(ready(sample)).hiddenPasses).toBe(0);
  });

  it("retains duration-source rows by label occurrence and resets when the measurement format changes", () => {
    const model = createGpuPassRows();
    const state: GpuState = {
      status: "ready",
      currentRendererFrameId: 1,
      droppedSamples: 0,
      sample: {
        measurement: "pass-sum",
        frameId: 1,
        rendererFrameId: 1,
        durationMs: 2,
        omittedPasses: 0,
        passes: [
          { label: "draw", durationMs: 1 },
          { label: "draw", durationMs: null },
        ],
      },
    };
    expect(model.update(state).rows.map((row) => row.occurrence)).toEqual([1, 2]);
    expect(
      model
        .update({ ...state, sample: { ...state.sample, passes: [] } })
        .rows.every((row) => row.status === "not-observed"),
    ).toBe(true);
    expect(model.update(ready(gpuIntervalFixture())).rows).toHaveLength(3);
  });

  it("rejects invalid order definitions", () => {
    expect(() => createGpuPassRows(["same", "same"])).toThrow();
    expect(() => createGpuPassRows([""])).toThrow();
    expect(() =>
      createGpuPassRows(Array.from({ length: 257 }, (_, index) => String(index))),
    ).toThrow();
  });
});
