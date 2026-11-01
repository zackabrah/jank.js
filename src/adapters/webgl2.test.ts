import { describe, expect, it, vi } from "vitest";

import { createWebGl2GpuSource } from "./webgl2.ts";

import type { GpuProfile } from "../types/gpu-profile-types.ts";

interface FakeQuery {
  available: boolean;
  nanoseconds: number;
  deleted: boolean;
}

/** A WebGL2 context that keeps timer queries in memory and lets a test finish them. */
function glFixture({ extension = true } = {}) {
  const timer = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };

  const created: FakeQuery[] = [];

  let active: FakeQuery | null = null,
    disjoint = false,
    lost = false;

  const gl = {
    QUERY_RESULT: 0x8866,
    QUERY_RESULT_AVAILABLE: 0x8867,
    getExtension: (name: string) =>
      extension && name === "EXT_disjoint_timer_query_webgl2" ? timer : null,
    getParameter: (name: number) =>
      name === timer.GPU_DISJOINT_EXT ? disjoint : null,
    isContextLost: () => lost,
    createQuery: vi.fn<() => FakeQuery>(() => {
      const query = { available: false, nanoseconds: 0, deleted: false };

      created.push(query);

      return query;
    }),
    deleteQuery: (query: FakeQuery | null) => {
      if (query) query.deleted = true;
    },
    beginQuery: (_target: number, query: FakeQuery) => {
      // Real WebGL2 raises INVALID_OPERATION for a second active timer query.
      if (active) throw new Error("INVALID_OPERATION");

      active = query;
    },
    endQuery: () => {
      active = null;
    },
    getQueryParameter: (query: FakeQuery, name: number) =>
      name === gl.QUERY_RESULT_AVAILABLE ? query.available : query.nanoseconds,
  };

  return {
    gl,
    /** Makes the oldest unfinished queries available with these GPU times in milliseconds. */
    finish(...ms: number[]) {
      const pending = created.filter(
        (query) => !query.available && !query.deleted,
      );

      for (const [i, value] of ms.entries()) {
        pending[i]!.available = true;
        pending[i]!.nanoseconds = value * 1e6;
      }
    },
    setDisjoint: (value: boolean) => {
      disjoint = value;
    },
    setLost: (value: boolean) => {
      lost = value;
    },
    live: () => created.filter((query) => !query.deleted).length,
    isActive: () => active !== null,
  };
}

describe("WebGL2 GPU source", () => {
  // What: two named passes drawn in one frame come back as one sample, with each pass's GPU
  // time and a link to the diagnostics frame that drew them, once the GPU has finished.
  // Why: timer results arrive frames later. Without the link, the panel and recordings would
  // pin GPU time on whatever frame happened to be current when the results came back.
  it("reports each pass of a frame, linked to the frame that drew it", () => {
    const fixture = glFixture();

    const samples: GpuProfile[] = [];

    const gpu = createWebGl2GpuSource(fixture.gl, {
      onSample: (profile) => samples.push(profile),
    });

    gpu.beginPass("shadow");
    gpu.endPass();
    gpu.beginPass("opaque");
    gpu.endPass();
    gpu.captureFrame(7);

    expect(gpu.read().status).toBe("pending");
    expect(samples).toEqual([]);

    fixture.finish(1.5, 4.25);

    gpu.captureFrame(8);

    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      status: "ready",
      diagnosticFrame: 7,
      sampleFrame: 1,
      gpuMilliseconds: null,
      passes: [
        { label: "shadow", milliseconds: 1.5 },
        { label: "opaque", milliseconds: 4.25 },
      ],
    });
    expect(gpu.read().sampleAgeFrames).toBe(1);
    expect(fixture.live()).toBe(0);
  });

  // What: a frame is reported only when every one of its passes has a result, and frames are
  // reported oldest first.
  // Why: a half-finished frame would under-report GPU time, and out-of-order samples would
  // make the panel's GPU history jump backwards.
  it("waits for a whole frame and keeps frames in order", () => {
    const fixture = glFixture();

    const frames: (number | null | undefined)[] = [];

    const gpu = createWebGl2GpuSource(fixture.gl, {
      onSample: (profile) => frames.push(profile.diagnosticFrame),
    });

    for (const id of [1, 2]) {
      gpu.beginPass("a");
      gpu.endPass();
      gpu.beginPass("b");
      gpu.endPass();
      gpu.captureFrame(id);
    }

    fixture.finish(1);

    gpu.captureFrame(3);

    expect(frames).toEqual([]);

    fixture.finish(1, 1, 1);

    gpu.captureFrame(4);

    expect(frames).toEqual([1, 2]);
  });

  // What: results read while the GPU reports a disjoint event are thrown away and counted.
  // Why: a disjoint event, such as a power-state change, makes the timer meaningless. Showing
  // those numbers would report GPU time the GPU never spent.
  it("drops results that a disjoint event made meaningless", () => {
    const fixture = glFixture();

    const onSample = vi.fn<(profile: GpuProfile) => void>();

    const gpu = createWebGl2GpuSource(fixture.gl, { onSample });

    gpu.beginPass("opaque");
    gpu.endPass();
    gpu.captureFrame(1);

    fixture.finish(3);
    fixture.setDisjoint(true);

    gpu.captureFrame(2);

    expect(onSample).not.toHaveBeenCalled();
    expect(gpu.read()).toMatchObject({ status: "pending", droppedFrames: 1 });
  });

  // What: without the timer extension the source says unsupported and touches nothing.
  // Why: Firefox and some other browsers don't expose GPU timers. The project rule is to say
  // so rather than estimate GPU time from CPU timing, and a host's calls must stay harmless.
  it("says unsupported and does nothing when the browser has no GPU timers", () => {
    const fixture = glFixture({ extension: false });

    const gpu = createWebGl2GpuSource(fixture.gl);

    gpu.beginPass("opaque");
    gpu.endPass();
    gpu.captureFrame(1);
    gpu.setEnabled(true);

    expect(gpu.read()).toMatchObject({
      available: false,
      enabled: false,
      status: "unsupported",
    });
    expect(fixture.gl.createQuery).not.toHaveBeenCalled();
  });

  // What: overlapping passes, capturing a frame with a pass still open, and invalid frame IDs
  // are rejected with an error that names the problem.
  // Why: WebGL2 allows one timer query at a time. Letting a second one start would raise a
  // GL error inside the host's renderer, far from the mistake.
  it("rejects nested passes, open passes at the frame boundary and bad frame IDs", () => {
    const fixture = glFixture();

    const gpu = createWebGl2GpuSource(fixture.gl);

    gpu.beginPass("shadow");

    expect(() => gpu.beginPass("opaque")).toThrow(
      'End the "shadow" pass before beginning "opaque"',
    );
    expect(() => gpu.captureFrame(1)).toThrow("before capturing the frame");

    gpu.endPass();

    expect(() => gpu.captureFrame(0)).toThrow(RangeError);
    expect(() => gpu.captureFrame(1.5)).toThrow(RangeError);
  });

  // What: switching timing off ends any open query and deletes every unread one, and it
  // starts again cleanly when switched back on.
  // Why: the panel's GPU toggle can flip mid-frame. Leaving a query active would break the
  // host's next query, and leaked queries are GPU objects that are never freed.
  it("discards queries when switched off and resumes when switched on", () => {
    const fixture = glFixture();

    const gpu = createWebGl2GpuSource(fixture.gl);

    gpu.beginPass("opaque");
    gpu.endPass();
    gpu.captureFrame(1);
    gpu.beginPass("post");
    gpu.setEnabled(false);

    expect(fixture.isActive()).toBe(false);
    expect(fixture.live()).toBe(0);
    expect(gpu.read()).toMatchObject({ enabled: false, status: "disabled" });

    gpu.beginPass("ignored");
    gpu.captureFrame(2);

    expect(fixture.live()).toBe(0);

    gpu.setEnabled(true);
    gpu.beginPass("opaque");
    gpu.endPass();
    gpu.captureFrame(3);

    fixture.finish(2);

    gpu.captureFrame(4);

    expect(gpu.read()).toMatchObject({ status: "ready", diagnosticFrame: 3 });
  });

  // What: dispose deletes the adapter's queries, can be called twice, and later calls do
  // nothing.
  // Why: hosts tear the panel down before the renderer. The adapter must free only its own
  // queries and never fail on a late frame from the host's loop.
  it("disposes once, frees its queries and ignores later calls", () => {
    const fixture = glFixture();

    const gpu = createWebGl2GpuSource(fixture.gl);

    gpu.beginPass("opaque");
    gpu.endPass();
    gpu.captureFrame(1);
    gpu.dispose();
    gpu.dispose();
    gpu.beginPass("late");
    gpu.captureFrame(2);

    expect(fixture.live()).toBe(0);
    expect(gpu.read()).toMatchObject({ enabled: false, status: "disabled" });
  });

  // What: past 32 passes a frame's extra passes are counted as omitted, and past 64 waiting
  // frames the oldest is dropped and counted.
  // Why: a host that times too many passes, or a GPU that stops returning results, must not
  // grow the adapter's memory without bound. The counts make the loss visible.
  it("bounds passes per frame and frames waiting for results", () => {
    const fixture = glFixture();

    const gpu = createWebGl2GpuSource(fixture.gl);

    for (let pass = 0; pass < 34; pass++) {
      gpu.beginPass(`pass ${pass}`);
      gpu.endPass();
    }

    gpu.captureFrame(1);

    fixture.finish(...Array.from({ length: 32 }, () => 0.1));

    gpu.captureFrame(2);

    expect(gpu.read()).toMatchObject({ truncatedPasses: 2 });
    expect(gpu.read().passes).toHaveLength(32);

    for (let id = 3; id < 3 + 65; id++) {
      gpu.beginPass("opaque");
      gpu.endPass();
      gpu.captureFrame(id);
    }

    expect(gpu.read().droppedFrames).toBe(1);
    expect(fixture.live()).toBe(64);
  });

  // What: when the context is lost the source reports an error and forgets its queries, then
  // recovers on the first frame after the context comes back.
  // Why: a lost context invalidates every query. Reading them would return garbage, and the
  // panel should show why GPU timing stopped rather than a stale value.
  it("reports a lost context and recovers when it is restored", () => {
    const fixture = glFixture();

    const gpu = createWebGl2GpuSource(fixture.gl);

    gpu.beginPass("opaque");
    gpu.endPass();

    fixture.setLost(true);

    gpu.captureFrame(1);

    expect(gpu.read()).toMatchObject({
      status: "error",
      error: "WebGL context lost",
    });

    fixture.setLost(false);

    gpu.beginPass("opaque");
    gpu.endPass();
    gpu.captureFrame(2);

    expect(gpu.read()).toMatchObject({ status: "pending", error: null });
  });
});
