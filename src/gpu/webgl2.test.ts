import { expect, test, vi } from "vitest";
import { type GpuFrame, gpuFrameCoverage } from "./model.ts";
import { createWebGl2GpuSource } from "./webgl2.ts";

function fixture() {
  let available = false,
    disjoint = false,
    lost = false,
    result = 1e6;
  const frames = new Map<number, GpuFrame>();
  const gl = {
    QUERY_RESULT: 1,
    QUERY_RESULT_AVAILABLE: 2,
    getExtension: vi.fn(() => ({ TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 })),
    getParameter: () => {
      const value = disjoint;
      disjoint = false;
      return value;
    },
    isContextLost: () => lost,
    createQuery: vi.fn<() => object | null>(() => ({})),
    deleteQuery: vi.fn(),
    beginQuery: vi.fn(),
    endQuery: vi.fn(),
    getQueryParameter: (_query: object, name: number) => (name === 2 ? available : result),
  };
  const source = createWebGl2GpuSource(gl, (frame) => frames.set(frame.frameId, frame));
  const draw = (id: number) => {
    source.beginPass("Scene");
    source.endPass();
    source.captureFrame(id, "complete");
  };
  return {
    gl,
    source,
    frames,
    draw,
    ready: (value = 1e6) => {
      available = true;
      result = value;
    },
    disjoint: () => {
      disjoint = true;
    },
    lose: (value: boolean) => {
      lost = value;
    },
  };
}

test("one disjoint check rejects ALL outstanding frames, including unavailable queries", () => {
  const f = fixture();
  f.draw(1);
  f.draw(2);
  f.disjoint();
  f.source.poll();
  expect([...f.frames.values()].map((frame) => frame.invocations[0]?.state)).toEqual([
    "rejected",
    "rejected",
  ]);
  f.ready();
  f.source.poll();
  expect(f.gl.deleteQuery).toHaveBeenCalledTimes(2);
  f.draw(3);
  expect(f.frames.get(3)?.invocations[0]?.milliseconds).toBe(1);
  f.source.dispose();
});

test("counts failed allocation and bounded omissions; zero is valid and non-finite results are rejected", () => {
  const f = fixture();
  f.gl.createQuery.mockReturnValueOnce(null);
  f.draw(1);
  const first = f.frames.get(1);
  if (!first) throw new Error("Missing frame");
  expect(gpuFrameCoverage(first)).toMatchObject({
    expected: 1,
    timed: 0,
    omitted: 1,
    completeness: "partial",
  });
  f.ready(0);
  f.draw(2);
  expect(f.frames.get(2)?.invocations[0]?.milliseconds).toBe(0);
  f.ready(NaN);
  f.draw(3);
  expect(f.frames.get(3)?.invocations[0]?.state).toBe("rejected");
  for (let i = 0; i < 35; i++) {
    f.source.beginPass("Pass");
    f.source.endPass();
  }
  f.source.captureFrame(4, "complete");
  expect(f.frames.get(4)?.invocations.filter((p) => p.state === "omitted")).toHaveLength(3);
  f.source.dispose();
});

test("rejects nesting, queue overflow and context loss, then reacquires the extension", () => {
  const f = fixture();
  f.source.beginPass("Scene");
  expect(() => f.source.beginPass("Nested")).toThrow("cannot nest");
  expect(() => f.source.captureFrame(1)).toThrow("End");
  f.source.endPass();
  f.source.captureFrame(1);
  for (let i = 2; i <= 65; i++) f.draw(i);
  expect(f.frames.get(1)?.invocations[0]?.reason).toContain("capacity");
  f.lose(true);
  f.source.poll();
  expect(f.frames.get(65)?.invocations[0]?.reason).toContain("lost");
  f.lose(false);
  f.source.poll();
  expect(f.gl.getExtension).toHaveBeenCalledTimes(2);
  f.source.dispose();
  f.source.dispose();
});
