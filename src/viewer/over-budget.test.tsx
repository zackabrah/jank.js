// @vitest-environment jsdom
import { render } from "preact";
import { expect, test } from "vitest";
import { comparisonFixture } from "../compare/fixtures.ts";
import { MetricRow } from "../live/metric-row.tsx";
import { recordingFixture } from "../recording/fixtures.ts";
import { ComparisonFrame } from "./comparison-frame.tsx";
import { comparisonFrames } from "./comparison-frames.ts";
import { comparisonLanes } from "./comparison-lanes.ts";
import { LaneRow } from "./lane-row.tsx";
import { recordingLanes } from "./lanes.ts";

// Issue #6: a value within timer precision of the budget must not read as over it anywhere.
const host = () => document.body.appendChild(document.createElement("div"));

test.each([
  [16.75, false],
  [16.9, true],
])("a %f ms lane against a 16.667 ms budget and 0.1 ms timer: over is %s", (ms, over) => {
  const recording = recordingFixture(3);
  recording.budget.frameMs = 16.667;
  recording.metadata.environment.cpuTimer.estimatedResolutionMs = 0.1;
  const frame = recording.frames[0];
  if (!frame) throw new Error("Missing frame");
  frame.interval = 42;
  frame.at = 42;
  frame.scopes = [{ system: "work", label: "Work", start: 0, end: ms }];
  const model = recordingLanes(recording);
  const lane = model.cpu.find((item) => item.label === "Work");
  if (!lane) throw new Error("Missing lane");
  const target = host();
  render(
    <LaneRow
      lane={lane}
      model={model}
      recording={recording}
      selection={{ start: 0, end: 2, selected: 0 }}
      onSelect={() => {}}
      expand
    />,
    target,
  );
  expect(target.querySelector("[data-lane-value]")?.hasAttribute("data-over")).toBe(over);
});

test.each([
  [16.75, false],
  [16.9, true],
])("a %f ms metric row against the same limit: over is %s", (value, over) => {
  const target = host();
  render(
    <MetricRow
      label="Unattributed"
      duration={{ status: "measured", value }}
      budget={16.667}
      overLimit={16.867}
    />,
    target,
  );
  expect(target.querySelector(".bg-jank-over-band") !== null).toBe(over);
});

test("the paired frame inspector marks frames against its limit, not the bare budget", () => {
  const bundle = comparisonFixture();
  const chart = comparisonFrames(bundle, 1);
  const lanes = comparisonLanes(bundle, 1);
  const over = (overLimit: number) => {
    const target = host();
    render(
      <ComparisonFrame
        lanes={lanes}
        chart={chart}
        at={chart.series[0]?.points[0]?.start ?? 0}
        budgetMs={bundle.budgetMs}
        overLimit={overLimit}
      />,
      target,
    );
    return target.querySelector("[data-comparison-frame-variant] [data-over]") !== null;
  };
  expect(over(0)).toBe(true);
  expect(over(Number.MAX_VALUE)).toBe(false);
});
