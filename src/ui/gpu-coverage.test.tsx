// @vitest-environment jsdom
import { render } from "preact";
import { expect, test } from "vitest";
import { gpuCoverage } from "../gpu/model.ts";
import { GpuCoverageBar } from "./gpu-coverage.tsx";

test("never rounds incomplete coverage up to 100% and distinguishes an empty window", () => {
  const root = document.createElement("div");
  const empty = gpuCoverage([], []);
  render(
    <GpuCoverageBar coverage={{ ...empty, total: 6000, complete: 5999, partial: 1 }} compact />,
    root,
  );
  expect(root.textContent).toContain("99.9% complete");
  expect(root.textContent).toContain("5,999 / 6,000 complete frames");
  render(<GpuCoverageBar coverage={empty} />, root);
  expect(root.textContent).toContain("No frames yet");
  expect(root.textContent).not.toContain("100.0%");
  render(null, root);
});

const none = gpuCoverage([], []);

// What: the bar says unknown when no frame declared an inventory, in both of its sizes.
// Why: issue #8. "0.0% complete" above valid timings reads as a failure; the host made no claim.
test.each([false, true])("no declared inventory reads unknown (compact %s)", (compact) => {
  const root = document.createElement("div");
  render(
    <GpuCoverageBar coverage={{ ...none, unknown: 600, total: 600 }} compact={compact} />,
    root,
  );
  expect(root.textContent).toContain("Unknown inventory");
  expect(root.textContent).not.toMatch(/0\.0%|0 \/ 600/);
});

// What: a declared inventory and lost records still report their share.
// Why: only the case with no claim changes; a real gap must keep reading as one.
test.each([
  [{ complete: 1, unknown: 1, total: 2 }, "50.0% complete"],
  [{ missing: 4, total: 4 }, "0.0% complete"],
])("%j keeps its share", (counts, expected) => {
  const root = document.createElement("div");
  render(<GpuCoverageBar coverage={{ ...none, ...counts }} />, root);
  expect(root.textContent).toContain(expected);
});
