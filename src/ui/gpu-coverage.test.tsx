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
