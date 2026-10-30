import type { FrameSample, ScopeCoverage, ScopeSample } from "../core/frames.ts";
import type { Recording } from "../recordings/recording.ts";
import { channelScopeDurations, intervalUnion, summarizeFrames } from "./statistics.ts";

export interface FrameSummary {
  readonly frameId: number;
  readonly intervalMs: number;
  readonly budgetMs: number;
  /** Budget plus two timer ticks, shared with live frame statistics. */
  readonly limitMs: number;
  /** Recorded resolution, otherwise an interval-step estimate; never clock calibration. */
  readonly estimatedTickMs: number | null;
  readonly overBudget: boolean;
  readonly coverage: ScopeCoverage;
  /** Union of observed scope intervals; nested scopes are never added twice. */
  readonly attributedMs: number | null;
  /** Includes waiting; with truncated coverage it also includes omitted scopes. */
  readonly unattributedMs: number | null;
  readonly scopes: readonly ScopeSample[];
  /** A relative scope-time heuristic on complete frames, not evidence of causation. */
  readonly likelyCause: { readonly channelId: string; readonly aboveMedianMs: number } | null;
}

/** Accepts validated recordings. A deterministic, detached result with no DOM or clock reads. */
export type InspectFrame = (recording: Recording, frameId: number) => FrameSummary | null;

export const inspectFrame: InspectFrame = (recording, frameId) => {
  const statistics = summarizeFrames(
    recording.frames,
    recording.targetFps,
    recording.metadata.environment.timer.estimatedResolutionMs ?? undefined,
  );
  const frame = recording.frames.find((candidate) => candidate.id === frameId);
  if (!statistics || !frame) {
    return null;
  }
  const intervalMs = frame.endedAtMs - frame.startedAtMs;
  const attributedMs =
    frame.coverage.status === "not-collected" ? null : intervalUnion(frame.scopes);
  return {
    frameId,
    intervalMs,
    budgetMs: statistics.budgetMs,
    limitMs: statistics.limitMs,
    estimatedTickMs: statistics.estimatedTickMs,
    overBudget: intervalMs > statistics.limitMs,
    coverage: { ...frame.coverage },
    attributedMs,
    unattributedMs: attributedMs === null ? null : Math.max(0, intervalMs - attributedMs),
    scopes: frame.scopes.map((scope) => ({ ...scope })),
    likelyCause: likelyCause(recording, frame),
  };
};

function likelyCause(recording: Recording, frame: FrameSample): FrameSummary["likelyCause"] {
  if (frame.coverage.status !== "complete") {
    return null;
  }
  const selected = channelScopeDurations(frame.scopes);
  const complete = recording.frames
    .filter((candidate) => candidate.coverage.status === "complete")
    .map((candidate) => channelScopeDurations(candidate.scopes));
  let best: FrameSummary["likelyCause"] = null;
  // Preserve the reference's 0.05ms noise floor and registration-order tie breaking.
  for (const { id: channelId } of recording.channels) {
    const durationMs = selected.get(channelId);
    if (durationMs === undefined) {
      continue;
    }
    const durations = complete
      .map((channels) => channels.get(channelId) ?? 0)
      .sort((left, right) => left - right);
    // Upper median, including the selected frame and measured absence in complete frames.
    const medianMs = durations[Math.floor(durations.length / 2)] ?? 0;
    const aboveMedianMs = durationMs - medianMs;
    if (aboveMedianMs > 0.05 && (best === null || aboveMedianMs > best.aboveMedianMs)) {
      best = { channelId, aboveMedianMs };
    }
  }
  return best;
}
