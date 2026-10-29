import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import { parseRecording, serializeRecording } from "./codec.ts";

function changedJson(path: string, replacement: unknown): string {
  const value: unknown = JSON.parse(JSON.stringify(recordingFixture()));
  const keys = path.split(".");
  const last = keys.pop();
  let parent = value;
  for (const key of keys) {
    if (typeof parent !== "object" || parent === null) {
      throw new Error("Invalid fixture path");
    }
    parent = Reflect.get(parent, key);
  }
  if (typeof parent !== "object" || parent === null || last === undefined) {
    throw new Error("Invalid fixture path");
  }
  Object.defineProperty(parent, last, {
    value: replacement,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return JSON.stringify(value);
}

describe("recording files", () => {
  it("round-trips every recorded measurement without changing the source", () => {
    const recording = recordingFixture();
    const before = structuredClone(recording);
    const result = parseRecording(serializeRecording(recording));
    expect(result).toEqual({ ok: true, recording });
    expect(recording).toEqual(before);
  });

  it("accepts empty captures and explicit unknown values", () => {
    const recording = {
      ...recordingFixture(),
      frames: [],
      channels: [],
      counters: [],
      events: [],
      gpu: [],
      metadata: { ...recordingFixture().metadata, application: null },
      capture: { kind: "manual" as const },
    };
    expect(parseRecording(serializeRecording(recording))).toEqual({ ok: true, recording });
  });

  it("accepts automatic capture metadata and explicit unavailable GPU passes", () => {
    const original = recordingFixture();
    const recording = {
      ...original,
      capture: {
        kind: "automatic" as const,
        triggerFrameId: 2,
        thresholdMs: 10,
        beforeFrames: 1,
        afterFrames: 0,
      },
      gpu: [
        {
          frameId: null,
          rendererFrameId: 8,
          measurement: "elapsed-span" as const,
          durationMs: null,
          passes: [{ label: "pending", durationMs: null }],
          omittedPasses: 1,
        },
      ],
    };
    expect(parseRecording(serializeRecording(recording))).toEqual({ ok: true, recording });
  });

  it("copies validated data and strips unknown fields including prototype-like keys", () => {
    const json = changedJson("counters.0.values.__proto__", "counter text");
    const result = parseRecording(json);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.problem.message);
    }
    expect(Object.hasOwn(result.recording.counters[0]?.values ?? {}, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(result.recording.counters[0]?.values)).toBe(Object.prototype);
    const extra = parseRecording(changedJson("unexpected", { ignored: true }));
    expect(extra).toEqual({ ok: true, recording: recordingFixture() });
  });

  it("returns useful version and syntax problems instead of throwing", () => {
    expect(parseRecording("{")).toMatchObject({
      ok: false,
      problem: { code: "invalid-json", path: "$" },
    });
    expect(parseRecording(changedJson("schemaVersion", 2))).toMatchObject({
      ok: false,
      problem: { code: "unsupported-version", path: "$.schemaVersion" },
    });
    expect(parseRecording("null")).toMatchObject({
      ok: false,
      problem: { code: "invalid-data", path: "$" },
    });
  });

  it("validates complete automatic windows and accepts honestly truncated ones", () => {
    const source = recordingFixture();
    const capture = {
      kind: "automatic" as const,
      triggerFrameId: 2,
      thresholdMs: 10,
      beforeFrames: 2,
      afterFrames: 1,
    };
    expect(() => serializeRecording({ ...source, capture })).toThrow(/capture.beforeFrames/);
    expect(parseRecording(serializeRecording({ ...source, capture, truncated: true })).ok).toBe(
      true,
    );
    expect(() =>
      serializeRecording({ ...source, capture: { ...capture, beforeFrames: 0 }, truncated: true }),
    ).toThrow(/capture.beforeFrames/);
    expect(() =>
      serializeRecording({ ...source, capture: { ...capture, thresholdMs: 20 }, truncated: true }),
    ).toThrow(/capture.thresholdMs/);
  });

  it("round-trips environment details, signed counters and truncated coverage", () => {
    const source = recordingFixture();
    const recording = {
      ...source,
      frames: source.frames.map((frame) => ({
        ...frame,
        coverage: { status: "truncated" as const, omittedScopes: 2 },
      })),
      metadata: {
        ...source.metadata,
        application: { name: "Host", version: "1" },
        environment: {
          userAgent: "test browser",
          platform: "test platform",
          hardwareConcurrency: 4,
          crossOriginIsolated: false,
          viewport: { widthPx: 800, heightPx: 600, pixelRatio: 2 },
          timer: { source: "performance.now" as const, estimatedResolutionMs: 0.1 },
        },
      },
      counters: [{ atMs: 110, channelId: "physics", values: { offset: -5 } }],
      events: [{ atMs: 120, label: "日本語 😀", detail: "Received asset" }],
    };
    expect(parseRecording(serializeRecording(recording))).toEqual({ ok: true, recording });
  });

  it("checks encoded bytes before parsing, including multibyte text", () => {
    for (const json of [
      " ".repeat(32 * 1024 * 1024 + 1),
      `"${"é".repeat(16 * 1024 * 1024)}"`,
      `"${"😀".repeat(8 * 1024 * 1024)}"`,
    ]) {
      expect(parseRecording(json)).toMatchObject({ ok: false, problem: { code: "too-large" } });
    }
  });

  it("rejects non-finite export values before JSON can turn them into null", () => {
    const source = recordingFixture();
    const invalid = {
      ...source,
      frames: source.frames.map((frame) => ({
        ...frame,
        cpu: { ...frame.cpu, updateMs: Number.NaN },
      })),
    };
    expect(() => serializeRecording(invalid)).toThrow(/frames\[0\].cpu.updateMs/);
    expect(source.frames[0]?.cpu.updateMs).toBeNull();
  });
});

const invalidCases: [string, unknown, string][] = [
  ["frames", [], "$.counters[0].atMs"],
  [
    "counters.0.values",
    Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`value${index}`, index])),
    "$.counters[0].values",
  ],
  ["format", "other", "$.format"],
  ["targetFps", 0, "$.targetFps"],
  ["clock.origin", "unix", "$.clock.origin"],
  ["truncated", 1, "$.truncated"],
  ["metadata.createdAt", "yesterday", "$.metadata.createdAt"],
  ["metadata.application.name", "", "$.metadata.application.name"],
  ["metadata.environment.hardwareConcurrency", -1, "$.metadata.environment.hardwareConcurrency"],
  ["metadata.environment.timer.source", "Date.now", "$.metadata.environment.timer.source"],
  [
    "metadata.environment.viewport",
    { widthPx: 1, heightPx: 1, pixelRatio: 0 },
    "$.metadata.environment.viewport.pixelRatio",
  ],
  ["channels.0.id", "", "$.channels[0].id"],
  [
    "channels",
    [
      { id: "physics", label: "One" },
      { id: "physics", label: "Two" },
    ],
    "$.channels[1].id",
  ],
  ["frames.0.id", 1.5, "$.frames[0].id"],
  ["frames.1.id", 1, "$.frames[1].id"],
  ["frames.1.startedAtMs", 115, "$.frames[1].startedAtMs"],
  ["frames.0.endedAtMs", 100, "$.frames[0].endedAtMs"],
  ["frames.0.cpu.renderMs", -1, "$.frames[0].cpu.renderMs"],
  ["frames.0.scopes.0.channelId", "missing", "$.frames[0].scopes[0].channelId"],
  ["frames.0.scopes.0.startedAtMs", 99, "$.frames[0].scopes[0].startedAtMs"],
  ["frames.0.scopes.0.endedAtMs", 117, "$.frames[0].scopes[0].endedAtMs"],
  ["frames.0.coverage", { status: "not-collected" }, "$.frames[0].scopes"],
  [
    "frames.0.coverage",
    { status: "truncated", omittedScopes: 0 },
    "$.frames[0].coverage.omittedScopes",
  ],
  ["frames.0.overhead.collectionMs", null, "$.frames[0].overhead.collectionMs"],
  ["counters.0.channelId", "missing", "$.counters[0].channelId"],
  ["counters.0.atMs", 99, "$.counters[0].atMs"],
  ["counters.0.values.bodies", [], "$.counters[0].values.bodies"],
  ["events.0.atMs", 133, "$.events[0].atMs"],
  ["events.0.label", "x".repeat(241), "$.events[0].label"],
  ["gpu.0.frameId", 3, "$.gpu[0].frameId"],
  ["gpu.0.rendererFrameId", -1, "$.gpu[0].rendererFrameId"],
  ["gpu.0.measurement", "cpu", "$.gpu[0].measurement"],
  ["gpu.0.passes.0.durationMs", -1, "$.gpu[0].passes[0].durationMs"],
  [
    "capture",
    { kind: "automatic", triggerFrameId: 3, thresholdMs: 10, beforeFrames: 1, afterFrames: 0 },
    "$.capture.triggerFrameId",
  ],
];

it.each(invalidCases)(
  "rejects invalid %s with its field path",
  (path, replacement, problemPath) => {
    expect(parseRecording(changedJson(path, replacement))).toMatchObject({
      ok: false,
      problem: { code: "invalid-data", path: problemPath },
    });
  },
);

it("rejects oversized collections at their owning field", () => {
  for (const [path, count, item] of [
    ["frames", 6001, {}],
    ["channels", 65, {}],
    ["events", 201, {}],
    ["counters", 1201, {}],
    ["gpu", 6001, {}],
    ["frames.0.scopes", 1025, {}],
    ["gpu.0.passes", 257, {}],
  ] as const) {
    expect(
      parseRecording(
        changedJson(
          path,
          Array.from({ length: count }, () => item),
        ),
      ),
    ).toMatchObject({ ok: false, problem: { code: "invalid-data" } });
  }
});

it("never throws on generated JSON and normalizes accepted files consistently", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (value) => {
      const result = parseRecording(JSON.stringify(value));
      if (result.ok) {
        expect(parseRecording(serializeRecording(result.recording))).toEqual(result);
      } else {
        expect(result.problem.path.startsWith("$")).toBe(true);
      }
    }),
    { seed: 20261030, numRuns: 200 },
  );
});
