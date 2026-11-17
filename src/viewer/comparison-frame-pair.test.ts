import { expect, test } from "vitest";
import { comparisonFixture } from "../compare/fixtures.ts";
import type { ComparisonBundle } from "../compare/model.ts";
import { comparisonFramePair } from "./comparison-frame-pair.ts";
import { comparisonFrames } from "./comparison-frames.ts";
import { comparisonLanes } from "./comparison-lanes.ts";

function pairAt(bundle: ComparisonBundle, at: number, pair = 1) {
  return comparisonFramePair(comparisonLanes(bundle, pair), comparisonFrames(bundle, pair), at);
}
const row = (pair: ReturnType<typeof pairAt>, label: string) =>
  pair.rows.find((entry) => entry.lane.label === label);

test("pairs frames by elapsed time, not by ID, ordinal or trial clock", () => {
  // Mixed pair 1: A frames last 20ms and B frames 22ms, each from its own measurement start.
  const bundle = comparisonFixture("mixed");
  const pair = pairAt(bundle, 450);
  expect(pair.a.frame?.index).toBe(22);
  expect(pair.b.frame?.index).toBe(20);
  expect(pair.a.frame?.id).not.toBe(pair.b.frame?.id);
  expect(pair.delta).toBe(2);
  expect(pair.a.reason).toBeNull();
});

test("lists the largest difference first and hides what neither frame recorded", () => {
  const pair = pairAt(comparisonFixture("mixed"), 450);
  const physics = row(pair, "physics");
  expect(physics).toMatchObject({ delta: 2, a: { value: 2 }, b: { value: 4 } });
  const scene = row(pair, "scene update");
  expect(scene?.delta).toBe(0);
  const labels = pair.rows.filter((entry) => entry.lane.group === "cpu").map((e) => e.lane.label);
  expect(labels.indexOf("physics")).toBeLessThan(labels.indexOf("scene update"));

  const bundle = comparisonFixture("mixed");
  for (const trial of bundle.trials)
    for (const frame of trial.recording.frames)
      frame.scopes = frame.scopes.filter((scope) => scope.label !== "physics" || frame.id !== 21);
  const without = pairAt(bundle, 410);
  expect(without.a.frame?.id).toBe(21);
  expect(without.b.frame?.id).not.toBe(21);
  // A's scope is known zero in that complete frame, but B still has it, so the row stays.
  expect(row(without, "physics")).toMatchObject({ a: { value: 0, status: "measured" } });
});

test("a known zero counts, while partial and missing values never become a difference", () => {
  const bundle = comparisonFixture("mixed");
  const a = bundle.trials.find((trial) => trial.pair === 1 && trial.variant === "A");
  const frame = a?.recording.frames[22];
  if (!frame) throw new Error("Missing frame");
  frame.coverage = "truncated";
  const partial = row(pairAt(bundle, 450), "physics");
  expect(partial?.a).toMatchObject({ value: 2, status: "partial" });
  expect(partial?.delta).toBeNull();

  const same = pairAt(comparisonFixture("same"), 450);
  expect(same.delta).toBe(0);
  expect(row(same, "physics")?.delta).toBe(0);

  const gap = comparisonFixture("gpu-gap");
  const missing = pairAt(gap, 450).rows.filter(
    (entry) =>
      entry.lane.group === "gpu" && (entry.a.status === "missing" || entry.b.status === "missing"),
  );
  for (const entry of missing) expect(entry.delta).toBeNull();
});

test("an incomplete pair or unrecorded time reports its reason instead of a value", () => {
  const stopped = comparisonFixture("stopped");
  stopped.trials = stopped.trials.filter((trial) => !(trial.pair === 1 && trial.variant === "B"));
  const incomplete = pairAt(stopped, 450);
  expect(incomplete.a.frame).not.toBeNull();
  expect(incomplete.b.frame).toBeNull();
  expect(incomplete.b.reason).toBe("Trial 1B was not completed.");
  expect(incomplete.delta).toBeNull();
  expect(row(incomplete, "physics")).toMatchObject({
    b: { value: null, status: "missing", reason: "Trial 1B was not completed." },
    delta: null,
  });

  const gaps = comparisonFixture("low-window");
  const chart = comparisonFrames(gaps, 1);
  const first = chart.series[0]?.points[0];
  const second = chart.series[0]?.points[1];
  if (!first || !second || second.start <= first.end) throw new Error("Expected a recorded gap");
  const gap = pairAt(gaps, (first.end + second.start) / 2);
  expect(gap.a.frame).toBeNull();
  expect(gap.a.reason).toBe("No recorded frame at this time.");
});

test("counter differences keep sample age and unrepresentable differences stay unavailable", () => {
  const withCounter = (a: number, b: number) => {
    const bundle = comparisonFixture("mixed");
    for (const trial of bundle.trials)
      trial.recording.samples = [
        {
          // Each trial's own clock: its measurement starts here, so samples precede every frame.
          at: trial.measurementStartMs,
          systems: [
            {
              id: "simulation",
              label: "Simulation",
              cpu: 0,
              peak: 0,
              values: { bodies: trial.variant === "A" ? a : b },
            },
          ],
        },
      ];
    return pairAt(bundle, 450).rows.find((entry) => entry.lane.group === "counter");
  };
  const counter = withCounter(64, 128);
  expect(counter).toMatchObject({ a: { value: 64 }, b: { value: 128 }, delta: 64 });
  expect(counter?.a.age).toBeGreaterThan(0);
  expect(withCounter(-Number.MAX_VALUE, Number.MAX_VALUE)).toMatchObject({
    a: { value: -Number.MAX_VALUE },
    b: { value: Number.MAX_VALUE },
    delta: null,
  });
});
