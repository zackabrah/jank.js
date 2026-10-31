import type { Recording } from "../../packages/jank/src/recordings/recording.ts";
import { recordingFixture } from "./recording.ts";

/** Synthetic scene with the density and spike positions of docs/images/viewer.png in the original checkout. */
export function viewerReferenceFixture(): Recording {
  const base = recordingFixture();
  let elapsedMs = 0;
  const frames = Array.from({ length: 360 }, (_, index) => {
    const id = index + 1;
    const spikes = new Map([
      [243, 66.6],
      [168, 50],
      [336, 50],
    ]);
    const durationMs = spikes.get(id) ?? 16.6;
    const startedAtMs = elapsedMs;
    elapsedMs += durationMs;
    const sceneMs = durationMs > 20 ? durationMs - 2.5 : 1;
    return {
      id,
      startedAtMs,
      endedAtMs: elapsedMs,
      cpu: { updateMs: 2 + sceneMs, renderMs: 0.2 },
      scopes: [
        { channelId: "physics", startedAtMs, endedAtMs: startedAtMs + 1.5 },
        { channelId: "animation", startedAtMs: startedAtMs + 1.5, endedAtMs: startedAtMs + 2 },
        { channelId: "scene", startedAtMs: startedAtMs + 2, endedAtMs: startedAtMs + 2 + sceneMs },
        {
          channelId: "render",
          startedAtMs: startedAtMs + 2 + sceneMs,
          endedAtMs: startedAtMs + 2.2 + sceneMs,
        },
      ],
      coverage: { status: "complete" as const },
      overhead: { collectionMs: 0.01 + (index % 5) / 100, refreshMs: 0 },
    };
  });
  return {
    ...base,
    metadata: { ...base.metadata, application: { name: "Synthetic scene", version: "1.0" } },
    channels: [
      { id: "physics", label: "physics" },
      { id: "animation", label: "animation" },
      { id: "scene", label: "scene update" },
      { id: "render", label: "render submit" },
    ],
    frames,
    events: frames
      .filter((frame) => [168, 224, 243, 300, 336].includes(frame.id))
      .map((frame) => ({
        atMs: frame.startedAtMs,
        label:
          new Map([
            [224, "load"],
            [300, "checkpoint"],
          ]).get(frame.id) ?? "wave 3",
        detail: null,
      })),
    counters: [],
    gpu: frames
      .filter((frame) => frame.id % 10 === 0)
      .map((frame) => ({
        frameId: frame.id,
        rendererFrameId: frame.id,
        measurement: "pass-sum" as const,
        durationMs: 5.5,
        omittedPasses: 0,
        passes: [
          { label: "shadow", durationMs: 1.5 },
          { label: "opaque", durationMs: 3.5 },
          { label: "post", durationMs: 0.5 },
        ],
      })),
  };
}
