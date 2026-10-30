import { describe, expect, it, vi } from "vitest";
import type { GpuState } from "../core/gpu.ts";
import { createWebGl2GpuSource, type WebGl2TimerContext } from "./webgl2.ts";

interface Query {
  ready: boolean;
  result: unknown;
  deleted: boolean;
}

function contextFixture() {
  const extension = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
  const queries: Query[] = [];
  let active: Query | null = null;
  const state = { lost: false, disjoint: false };
  const gl = {
    QUERY_RESULT: 0x8866,
    QUERY_RESULT_AVAILABLE: 0x8867,
    CURRENT_QUERY: 0x8865,
    getExtension: vi.fn<() => unknown>(() => extension),
    getParameter: () => state.disjoint,
    getQuery: () => active,
    isContextLost: () => state.lost,
    createQuery: vi.fn<() => Query | null>(() => {
      const query = { ready: false, result: 0, deleted: false };
      queries.push(query);
      return query;
    }),
    deleteQuery: vi.fn((query: Query | null) => {
      if (query) {
        expect(query.deleted).toBe(false);
        query.deleted = true;
      }
    }),
    beginQuery: vi.fn((_target: number, query: Query) => {
      expect(active).toBeNull();
      active = query;
    }),
    endQuery: vi.fn(() => {
      expect(active).not.toBeNull();
      active = null;
    }),
    getQueryParameter: (query: Query, parameter: number): unknown => {
      expect(query.deleted).toBe(false);
      return parameter === gl.QUERY_RESULT_AVAILABLE ? query.ready : query.result;
    },
  } satisfies WebGl2TimerContext<Query>;
  return {
    gl,
    state,
    queries,
    active: () => active,
    replaceActive: (query: Query | null) => {
      active = query;
    },
    live: () => queries.filter((query) => !query.deleted),
    finish: (...milliseconds: number[]) => {
      const pending = queries.filter((query) => !query.ready && !query.deleted);
      milliseconds.forEach((value, index) => {
        const query = pending[index];
        if (query) {
          query.ready = true;
          query.result = value * 1e6;
        }
      });
    },
  };
}

describe("WebGL2 GPU timing", () => {
  it("waits for every pass, publishes each completed frame, and keeps explicit frame links", () => {
    const fixture = contextFixture();
    const samples: GpuState[] = [];
    const gpu = createWebGl2GpuSource(fixture.gl, { onSample: (sample) => samples.push(sample) });
    for (const frameId of [101, 102]) {
      gpu.beginPass("shadow");
      gpu.endPass();
      gpu.beginPass("opaque");
      gpu.endPass();
      gpu.captureFrame(frameId);
    }
    fixture.finish(1.5);
    gpu.captureFrame(103);
    expect(samples).toEqual([]);
    expect(gpu.read()).toEqual({ status: "pending" });
    fixture.finish(2.5, 0, 3);
    gpu.captureFrame(104);
    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({
      status: "ready",
      currentRendererFrameId: 4,
      sample: {
        frameId: 101,
        rendererFrameId: 1,
        measurement: "pass-sum",
        durationMs: 4,
        omittedPasses: 0,
        passes: [
          { label: "shadow", durationMs: 1.5 },
          { label: "opaque", durationMs: 2.5 },
        ],
      },
    });
    expect(samples[1]).toMatchObject({ sample: { frameId: 102, durationMs: 3 } });
    expect(fixture.live()).toHaveLength(0);
    gpu.captureFrame(105);
    expect(gpu.read()).toMatchObject({ currentRendererFrameId: 5, sample: { rendererFrameId: 2 } });
    const detached = gpu.read();
    if (detached.status === "ready") {
      Reflect.set(detached.sample.passes[0] ?? {}, "label", "changed");
    }
    expect(gpu.read()).toMatchObject({
      sample: { passes: [{ label: "shadow" }, { label: "opaque" }] },
    });
    gpu.dispose();
  });

  it("discards even unavailable queries on disjoint events and recovers with fresh measurements", () => {
    const fixture = contextFixture();
    const onSample = vi.fn();
    const gpu = createWebGl2GpuSource(fixture.gl, { onSample });
    gpu.beginPass("old");
    gpu.endPass();
    gpu.captureFrame(1);
    fixture.state.disjoint = true;
    gpu.captureFrame(2);
    expect(onSample).not.toHaveBeenCalled();
    expect(fixture.live()).toHaveLength(0);
    expect(gpu.read().status).toBe("pending");
    fixture.state.disjoint = false;
    gpu.beginPass("fresh");
    gpu.endPass();
    gpu.captureFrame(3);
    fixture.finish(2);
    gpu.captureFrame(4);
    expect(gpu.read()).toMatchObject({
      status: "ready",
      droppedSamples: 1,
      sample: { frameId: 3, durationMs: 2 },
    });
    gpu.dispose();
  });

  it("reports unsupported timing without issuing queries", () => {
    const fixture = contextFixture();
    fixture.gl.getExtension.mockReturnValue(null);
    const gpu = createWebGl2GpuSource(fixture.gl);
    gpu.beginPass("pass");
    gpu.endPass();
    gpu.captureFrame(1);
    gpu.setEnabled(true);
    expect(gpu.read()).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("EXT_disjoint_timer_query_webgl2"),
    });
    expect(fixture.gl.createQuery).not.toHaveBeenCalled();
    gpu.dispose();
    gpu.dispose();
    expect(gpu.read().status).toBe("unsupported");
  });

  it("rejects invalid frame IDs, labels and nested or unfinished passes before changing GL state", () => {
    const fixture = contextFixture();
    const gpu = createWebGl2GpuSource(fixture.gl);
    for (const frameId of [0, -1, 1.5, Infinity]) {
      expect(() => gpu.captureFrame(frameId)).toThrow(RangeError);
    }
    for (const label of ["", " ", "x".repeat(241)]) {
      expect(() => gpu.beginPass(label)).toThrow(RangeError);
    }
    gpu.beginPass("outer");
    expect(() => gpu.beginPass("nested")).toThrow("End");
    expect(() => gpu.captureFrame(1)).toThrow("End");
    expect(fixture.gl.createQuery).toHaveBeenCalledTimes(1);
    gpu.endPass();
    gpu.captureFrame(null);
    fixture.finish(0);
    gpu.captureFrame(2);
    expect(gpu.read()).toMatchObject({ sample: { frameId: null, durationMs: 0 } });
    gpu.dispose();
  });

  it("never ends a foreign query and reports query allocation failures", () => {
    const fixture = contextFixture();
    const gpu = createWebGl2GpuSource(fixture.gl);
    const foreign = { ready: false, result: 0, deleted: false };
    fixture.replaceActive(foreign);
    gpu.beginPass("blocked");
    gpu.endPass();
    expect(gpu.read()).toMatchObject({ status: "error" });
    expect(fixture.gl.endQuery).not.toHaveBeenCalled();
    expect(fixture.gl.createQuery).not.toHaveBeenCalled();
    fixture.replaceActive(null);
    fixture.gl.createQuery.mockReturnValueOnce(null);
    gpu.beginPass("allocation failed");
    expect(gpu.read()).toMatchObject({ status: "error" });
    gpu.dispose();
    expect(foreign.deleted).toBe(false);
  });

  it("cleans up open and queued queries on disable/dispose and ignores late calls", () => {
    const fixture = contextFixture();
    const gpu = createWebGl2GpuSource(fixture.gl, { enabled: false });
    gpu.beginPass("disabled");
    gpu.captureFrame(1);
    expect(gpu.read().status).toBe("disabled");
    expect(fixture.live()).toHaveLength(0);
    gpu.setEnabled(true);
    gpu.beginPass("queued");
    gpu.endPass();
    gpu.captureFrame(2);
    gpu.beginPass("open");
    gpu.setEnabled(false);
    expect(fixture.active()).toBeNull();
    expect(fixture.live()).toHaveLength(0);
    gpu.setEnabled(false);
    gpu.setEnabled(true);
    gpu.beginPass("fresh");
    gpu.endPass();
    gpu.captureFrame(3);
    fixture.finish(1);
    gpu.captureFrame(4);
    expect(gpu.read().status).toBe("ready");
    gpu.beginPass("dispose open");
    gpu.dispose();
    gpu.dispose();
    gpu.setEnabled(true);
    gpu.beginPass("late");
    gpu.endPass();
    gpu.captureFrame(5);
    expect(fixture.live()).toHaveLength(0);
    expect(gpu.read().status).toBe("disabled");
  });

  it("bounds pending queries and marks an incomplete pass sum as unavailable", () => {
    const fixture = contextFixture();
    const gpu = createWebGl2GpuSource(fixture.gl);
    for (let pass = 0; pass < 34; pass += 1) {
      gpu.beginPass(`pass ${pass}`);
      gpu.endPass();
    }
    gpu.captureFrame(1);
    fixture.finish(...Array.from({ length: 32 }, () => 1));
    gpu.captureFrame(2);
    expect(gpu.read()).toMatchObject({ sample: { omittedPasses: 2, durationMs: null } });
    for (let frame = 3; frame < 68; frame += 1) {
      gpu.beginPass("pass");
      gpu.endPass();
      gpu.captureFrame(frame);
    }
    expect(fixture.live()).toHaveLength(64);
    fixture.finish(...Array.from({ length: 64 }, () => 1));
    gpu.captureFrame(68);
    expect(gpu.read()).toMatchObject({ droppedSamples: 1 });
    gpu.dispose();
  });

  it("invalidates queries on context loss and reacquires the extension on restoration", () => {
    const fixture = contextFixture();
    const gpu = createWebGl2GpuSource(fixture.gl);
    gpu.beginPass("lost");
    fixture.state.lost = true;
    fixture.replaceActive(null);
    gpu.captureFrame(1);
    expect(gpu.read()).toMatchObject({
      status: "error",
      message: expect.stringContaining("context lost"),
    });
    expect(fixture.gl.endQuery).not.toHaveBeenCalled();
    expect(fixture.live()).toHaveLength(0);
    fixture.state.lost = false;
    gpu.beginPass("restored");
    gpu.endPass();
    gpu.captureFrame(2);
    expect(fixture.gl.getExtension).toHaveBeenCalledTimes(2);
    fixture.finish(1);
    gpu.captureFrame(3);
    expect(gpu.read()).toMatchObject({ status: "ready", sample: { frameId: 2 } });
    gpu.dispose();
  });

  it.each([NaN, -1, Infinity, "invalid"])("rejects an invalid timer result: %s", (result) => {
    const fixture = contextFixture();
    const gpu = createWebGl2GpuSource(fixture.gl);
    gpu.beginPass("pass");
    gpu.endPass();
    gpu.captureFrame(1);
    const query = fixture.queries[0];
    if (query) {
      query.ready = true;
      query.result = result;
    }
    gpu.captureFrame(2);
    expect(gpu.read().status).toBe("error");
    expect(fixture.live()).toHaveLength(0);
    gpu.dispose();
  });

  it("allows a sample observer to disable timing without publishing the rest of the queue", () => {
    const fixture = contextFixture();
    const onSample = vi.fn(() => gpu.setEnabled(false));
    const gpu = createWebGl2GpuSource(fixture.gl, { onSample });
    for (const frameId of [1, 2]) {
      gpu.beginPass("pass");
      gpu.endPass();
      gpu.captureFrame(frameId);
    }
    fixture.finish(1, 2);
    gpu.captureFrame(3);
    expect(onSample).toHaveBeenCalledTimes(1);
    expect(fixture.live()).toHaveLength(0);
    expect(gpu.read().status).toBe("disabled");
  });
});
