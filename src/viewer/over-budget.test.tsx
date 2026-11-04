// @vitest-environment jsdom
import { render } from "preact";
import { expect, test } from "vitest";
import { analyzeRecording } from "../agent/analyze.ts";
import { comparisonFixture } from "../compare/fixtures.ts";
import { frameChartGeometry } from "../frame-chart-geometry.ts";
import { MetricRow } from "../live/metric-row.tsx";
import { recordingFixture } from "../recording/fixtures.ts";
import { frameOverLimit, summarizeRecording } from "../recording/summary.ts";
import { ComparisonFrame } from "./comparison-frame.tsx";
import { comparisonFrames } from "./comparison-frames.ts";
import { comparisonLanes } from "./comparison-lanes.ts";
import { LaneRow } from "./lane-row.tsx";
import { recordingLanes } from "./lanes.ts";

// Issue #6: a value within timer precision of the budget must not read as over it anywhere.
const host = () => document.body.appendChild(document.createElement("div"));

test.each([
  [16.75, false],
  [17.7, true],
])("a %f ms lane against a 16.667 ms budget: over is %s", (ms, over) => {
  const recording = recordingFixture(3);
  recording.budget.frameMs = 16.667;
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

// What: the case #6 was filed on. Frames of 16.70 to 16.80 ms against 16.667 ms, with a 0.1 ms timer.
// Why: the summary read 0 over while the bars were orange, so a smooth run looked janky.
test("a steady 60 fps recording has no over-budget frames and no over-budget bars", () => {
  const recording = recordingFixture(6);
  recording.budget.frameMs = 16.667;
  recording.metadata.environment.cpuTimer.estimatedResolutionMs = 0.1;
  recording.frames.forEach((frame, index) => {
    frame.interval = 16.7 + (index % 3) * 0.05;
  });
  const chart = () => {
    const summary = summarizeRecording(recording);
    const { frames, budget } = recording;
    return { summary, over: frameChartGeometry(frames, budget.frameMs, summary.overLimit, 6).over };
  };
  expect(chart().summary.overCount).toBe(0);
  expect(chart().over).toBe("");
  const slow = recording.frames[2];
  if (!slow) throw new Error("Missing frame");
  slow.interval = 20;
  expect(chart().summary.overCount).toBe(1);
  expect(chart().over).not.toBe("");
});

// What: normal jitter around the budget isn't over budget, in the viewer or in jank analyze.
// Why: #14. The same recording read 27% in the viewer and 0.5% in the report.
test("the viewer and jank analyze count the same frames as over budget", () => {
  const recording = recordingFixture(600);
  recording.budget.frameMs = 1000 / 60;
  recording.metadata.environment.cpuTimer.estimatedResolutionMs = 0.1;
  recording.frames.forEach((frame, index) => {
    frame.interval = 1000 / 60 + (index % 2 ? 0.35 : -0.35);
  });
  const slow = recording.frames[300];
  if (!slow) throw new Error("Missing frame");
  slow.interval = 80;
  const summary = summarizeRecording(recording);
  expect(summary.overCount).toBe(1);
  expect(analyzeRecording(recording).summary.overBudget).toMatchObject({
    frames: 1,
    limitMs: 17.67,
  });
  expect(summary.overLimit).toBeCloseTo(frameOverLimit(recording));
});

// What: an imported timer resolution has no say in what counts as over budget.
// Why: #16. A value of 1e308 made the limit Infinity, so a file could hide all of its jank.
test("a corrupt timer resolution can't switch off over-budget marking", () => {
  const recording = recordingFixture(3);
  recording.metadata.environment.cpuTimer.estimatedResolutionMs = 1e308;
  const summary = summarizeRecording(recording);
  expect(Number.isFinite(summary.overLimit)).toBe(true);
  expect(summary.overCount).toBe(1);
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
