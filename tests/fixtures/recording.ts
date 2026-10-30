import type { Recording } from "../../packages/jank/src/recordings/recording.ts";

export function recordingFixture(): Recording {
  return {
    format: "jank.js-recording",
    schemaVersion: 5,
    clock: { unit: "milliseconds", origin: "profiler-start" },
    metadata: {
      createdAt: "2026-10-30T00:00:00.000Z",
      toolVersion: "0.2.1",
      application: { name: "Test host", version: null },
      environment: {
        userAgent: null,
        platform: null,
        hardwareConcurrency: null,
        crossOriginIsolated: null,
        viewport: null,
        timer: { source: "custom", estimatedResolutionMs: null },
      },
    },
    targetFps: 60,
    capture: { kind: "recent" },
    truncated: false,
    channels: [{ id: "physics", label: "Physics" }],
    frames: [1, 2].map((id) => ({
      id,
      startedAtMs: 100 + (id - 1) * 16,
      endedAtMs: 100 + id * 16,
      cpu: { updateMs: null, renderMs: 2 },
      scopes: [
        { channelId: "physics", startedAtMs: 100 + (id - 1) * 16, endedAtMs: 104 + (id - 1) * 16 },
      ],
      coverage: { status: "complete" },
      overhead: { collectionMs: 0.01, refreshMs: 0 },
    })),
    counters: [
      {
        atMs: 110,
        status: "ready",
        channelId: "physics",
        values: { bodies: 3, mode: "active", ready: true, pending: null },
      },
    ],
    events: [{ atMs: 120, label: "Loaded", detail: null }],
    gpu: [
      {
        frameId: 1,
        rendererFrameId: 8,
        measurement: "pass-sum",
        durationMs: 2,
        passes: [{ label: "opaque", durationMs: 2 }],
        omittedPasses: 0,
      },
    ],
  };
}
