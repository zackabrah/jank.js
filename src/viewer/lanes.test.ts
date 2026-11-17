import { expect, test } from "vitest";
import { gpuFixture } from "../gpu/fixtures.ts";
import { recordingFixture } from "../recording/fixtures.ts";
import { laneGeometry, laneValue, recordingLanes } from "./lanes.ts";

test("CPU lanes merge repeated overlapping scopes and context subtracts their union only with complete coverage", () => {
  const recording = recordingFixture(3);
  const first = recording.frames[0];
  const second = recording.frames[1];
  if (!first || !second) throw new Error("Missing fixture");
  first.scopes = [
    { system: "work", label: "Update", start: 0, end: 8 },
    { system: "work", label: "Update", start: 4, end: 12 },
    { system: "child", label: "Update", start: 3, end: 5 },
  ];
  second.coverage = "truncated";
  second.droppedScopes = 3;
  const model = recordingLanes(recording);
  const [work, child] = model.cpu;
  const [unattributed, profiler] = model.context;
  if (!work || !child || !unattributed || !profiler) throw new Error("Missing lanes");
  expect(work.values.get(0)?.value).toBe(12);
  expect(child.values.get(0)?.value).toBe(2);
  expect(unattributed.values.get(0)?.value).toBe(4);
  expect(unattributed.values.get(1)?.value).toBeNull();
  expect(laneValue(work, 1, recording, model.gpuFrames).status).toBe("unknown");
  expect(laneValue(work, 2, recording, model.gpuFrames).value).toBe(0);
  first.overhead = { collectionMs: Number.MAX_VALUE, refreshMs: Number.MAX_VALUE };
  expect(recordingLanes(recording).context[1]?.values.get(0)?.value).toBeNull();
  recording.metadata.importedFromVersion = 1;
  expect(recordingLanes(recording).context[1]?.values.get(0)?.value).toBeNull();
});

test("GPU lanes use explicit frame links and distinguish missing, zero, rejection, pending and absent invocations", () => {
  const recording = recordingFixture(6);
  recording.frames.forEach((frame, index) => {
    frame.id = 100 + index * 2;
  });
  const zero = gpuFixture(100);
  const repeated = zero.invocations[0];
  if (!repeated) throw new Error("Missing invocation");
  zero.invocations.push({ ...repeated, id: "second", milliseconds: 4, startMs: 0, endMs: 4 });
  const unknown = gpuFixture(108);
  unknown.inventory = "unknown";
  unknown.invocations = [];
  const empty = gpuFixture(110);
  empty.invocations = [];
  recording.gpuTiming = {
    version: 1,
    frames: [zero, gpuFixture(104, "rejected"), gpuFixture(106, "pending"), unknown, empty],
  };
  const model = recordingLanes(recording);
  const [lane, other] = model.gpu;
  if (!lane || !other) throw new Error("Missing GPU lanes");
  const values = recording.frames.map((_, index) =>
    laneValue(lane, index, recording, model.gpuFrames),
  );
  expect(values.map((cell) => cell.status)).toEqual([
    "measured",
    "missing",
    "rejected",
    "pending",
    "unknown",
    "absent",
  ]);
  expect(values[0]?.value).toBe(0);
  expect(values[2]?.reason).toBe("GPU counter reset");
  expect(other.label).toBe("Scene ×2");
  expect(other.values.get(0)?.value).toBe(4);
  const geometry = laneGeometry(values, model.gpuCeiling);
  expect(geometry.zero).not.toBe("");
  expect(geometry.bars).toBe("");
  expect(geometry.missing).not.toBe("");
  expect(geometry.rejected).not.toBe("");
  expect(geometry.pending).not.toBe("");
  expect(geometry.unknown).not.toBe("");
});

test("events keep shared interval boundary rules and quiet lanes do not hide a spike", () => {
  const recording = recordingFixture(3);
  recording.events = [
    { at: 16, label: "Boundary", detail: "belongs to the second frame" },
    { at: -1, label: "Before", detail: "unmatched" },
  ];
  const model = recordingLanes(recording);
  expect(model.events.map((event) => event.frameIndex)).toEqual([-1, 1]);
  const cell = (value: number) => ({ value, status: "measured" as const, reason: "Test" });
  expect(laneGeometry([cell(0.2), cell(0.3)], 70).quiet).toBe(true);
  expect(laneGeometry([cell(0.2), cell(40)], 70).quiet).toBe(false);
  expect(laneGeometry([{ value: null, status: "unknown", reason: "Not measured" }], 70).quiet).toBe(
    false,
  );
});
