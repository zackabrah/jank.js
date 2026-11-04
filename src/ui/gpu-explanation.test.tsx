// @vitest-environment jsdom
import { render } from "preact";
import { expect, test } from "vitest";
import { gpuFixture } from "../gpu/fixtures.ts";
import { GpuExplanation } from "./gpu-explanation.tsx";

test("explains zero, empty, unknown inventory and mixed missing results without inferring counts", () => {
  const root = document.createElement("div");
  const frame = gpuFixture();
  try {
    render(<GpuExplanation frame={frame} />, root);
    expect(root.textContent).toContain("Host-declared invocations: 1 · valid timings: 1");
    expect(root.textContent).toContain("A timed 0\u00a0ms result is valid");
    render(<GpuExplanation frame={{ ...frame, invocations: [] }} />, root);
    expect(root.textContent).toContain("Complete empty frame");
    render(<GpuExplanation frame={{ ...frame, inventory: "unknown" }} />, root);
    expect(root.textContent).toContain("cannot establish complete coverage");
    const mixed = {
      ...frame,
      omitted: 2,
      invocations: [
        ...frame.invocations,
        ...gpuFixture(1, "pending").invocations.map((pass) => ({
          ...pass,
          id: "pending",
          kind: "compute" as const,
        })),
        ...gpuFixture(1, "rejected").invocations.map((pass) => ({
          ...pass,
          id: "rejected",
          label: "<img src=x>",
        })),
        ...gpuFixture(1, "omitted").invocations.map((pass) => ({
          ...pass,
          id: "omitted",
          kind: "compute" as const,
        })),
      ],
    };
    render(<GpuExplanation frame={mixed} />, root);
    expect(root.textContent).toContain("Host-declared invocations: 6 · valid timings: 1");
    expect(root.textContent).toContain("1 pending · 1 rejected · 3 omitted");
    expect(root.textContent).toContain("Render1/2 timedCompute0/2 timed");
    expect(root.textContent).toContain("2 additional invocations omitted beyond record capacity");
    expect(root.textContent).toContain("Awaiting GPU readback");
    expect(root.textContent).toContain("GPU counter reset");
    expect(root.textContent).toContain("GPU pool full");
    expect(root.querySelector("img")).toBeNull();
  } finally {
    render(null, root);
  }
});
