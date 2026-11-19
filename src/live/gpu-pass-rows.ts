import type { Measurement } from "../measurement.ts";
import type { LiveGpu, LiveView } from "./model.ts";

const keepPassMs = 3_000;
type Pass = LiveGpu["passes"][number];
type PassRow = Pass & { durationLabel?: string };

export type LivePanelView = LiveView & { gpuPasses: PassRow[] };

export function createGpuPassRows() {
  const recent = new Map<string, { pass: Pass; seenAt: number }>();
  let session: string | undefined;
  let lastFrame: number | null = null;

  return (gpu: LiveGpu | null): PassRow[] => {
    const evidence = gpu?.evidence;
    const nextSession = evidence && `${evidence.source}:${evidence.epoch}`;
    if (
      !gpu ||
      nextSession !== session ||
      (gpu.sampleFrame !== null && lastFrame !== null && gpu.sampleFrame < lastFrame)
    )
      recent.clear();
    session = nextSession;
    lastFrame = gpu?.sampleFrame ?? null;
    if (!gpu) return [];

    const at = performance.now();
    for (const [id, entry] of recent) if (at - entry.seenAt >= keepPassMs) recent.delete(id);

    const occurrences = new Map<string, number>();
    const current = new Set<string>();
    for (const pass of gpu.passes) {
      const key = JSON.stringify([pass.kind, pass.label]);
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      const id = JSON.stringify([pass.kind, pass.label, occurrence]);
      current.add(id);
      recent.set(id, { pass: { ...pass, id }, seenAt: at });
    }

    const knownInventory = evidence
      ? evidence.inventory === "complete" && evidence.omitted === 0
      : gpu.completeness === "complete";
    const duration: Measurement = knownInventory
      ? { status: "not-observed", reason: "This pass was not submitted in the sampled frame" }
      : { status: "unknown", reason: "The sampled frame did not supply the full pass inventory" };
    return Array.from(recent, ([id, { pass }]) =>
      current.has(id)
        ? pass
        : { ...pass, duration, durationLabel: knownInventory ? "not in this frame" : "not listed" },
    );
  };
}
