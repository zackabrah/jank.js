// @vitest-environment jsdom
import { render } from "preact";
import { expect, test } from "vitest";
import { recordingFixture } from "../recording/fixtures.ts";
import { inspectRecording } from "./inspection.ts";
import { RecordingSummary } from "./summary.tsx";

// What: the GPU coverage tile reads Unknown when no frame declared an inventory, and a share when
// one did.
// Why: issue #8. A tile reading 0.0% beside valid timings looks like a failure.
test.each([
  ["unknown", "Unknown"],
  ["complete", "100.0%"],
] as const)("a recording whose frames declare %s inventory reads %s", (inventory, expected) => {
  const recording = recordingFixture(3);
  recording.gpuTiming = {
    version: 1,
    frames: recording.frames.map((frame) => ({
      frameId: frame.id,
      source: "webgl2",
      clock: "gpu",
      epoch: 0,
      resolutionMs: null,
      inventory,
      omitted: 0,
      invocations: [],
    })),
  };
  const root = document.createElement("div");
  render(
    <RecordingSummary
      recording={recording}
      summary={inspectRecording(recording)}
      onInspect={() => {}}
    />,
    root,
  );
  const tile = [...root.querySelectorAll("dt")].find((term) => term.textContent === "GPU coverage");
  // The value alone: the popover beside it always names the Unknown inventory row.
  expect(tile?.nextElementSibling?.querySelector("span")?.textContent).toBe(expected);
  render(null, root);
});
