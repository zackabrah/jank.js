import { expect, test } from "vitest";
import { hotspotsFrom, matchesGlob } from "./experiment.ts";

test("matchesGlob follows CDP's URL patterns", () => {
  expect(matchesGlob("http://localhost:1/asset.js", "**/asset.js")).toBe(true);
  expect(matchesGlob("http://localhost:1/asset.js?x", "**/asset.js")).toBe(false);
  expect(matchesGlob("http://a/b.js", "http://?/b.js")).toBe(true);
  expect(matchesGlob("http://a/bxjs", "http://a/b.js")).toBe(false);
});

test("hotspots report self, inclusive and per-file time, without idle or numbered wasm", () => {
  const frame = (functionName: string, url = "") => ({ functionName, url, lineNumber: 9 });
  const report = hotspotsFrom({
    nodes: [
      { id: 1, callFrame: frame("(root)"), children: [2, 5] },
      { id: 2, callFrame: frame("step", "http://x/sim.js?v=1"), children: [3, 4] },
      { id: 3, callFrame: frame("read", "http://x/sim.js") },
      { id: 4, callFrame: frame("wasm-function[7]", "wasm://wasm/abc") },
      { id: 5, callFrame: frame("(idle)") },
    ],
    samples: [3, 3, 4, 5, 2],
    timeDeltas: [1000, 1000, 2000, 90000, 1000],
  });
  expect(report.busyMs).toBe(5);
  expect(report.byFile).toEqual([
    { where: "sim.js", ms: 3, share: 0.6 },
    { where: "WebAssembly", ms: 2, share: 0.4 },
  ]);
  expect(report.self[0]).toEqual({ where: "read sim.js:10", ms: 2, share: 0.4 });
  expect(report.self.map((entry) => entry.where)).toContain("WebAssembly");
  expect(report.inclusive[0]).toEqual({ where: "step sim.js:10", ms: 5, share: 1 });
});
