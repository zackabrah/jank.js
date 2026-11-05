import { withUnit } from "../format.ts";
import type { DiagnosticEvent } from "../recording/types.ts";

/** Event timestamps use the same collector clock as frame interval endings. */
export function readEvents(
  source: readonly DiagnosticEvent[] | undefined,
  frames: readonly { id: number; at: number; interval: number }[],
) {
  if (source === undefined) return null;
  if (!Array.isArray(source)) throw new RangeError("Live events must be an array.");
  const occurrences = new Map<string, number>();
  return source
    .slice(-200)
    .map((event: DiagnosticEvent) => {
      if (
        !event ||
        !Number.isFinite(event.at) ||
        typeof event.label !== "string" ||
        event.label.length > 240 ||
        typeof event.detail !== "string" ||
        event.detail.length > 2000
      )
        throw new RangeError(
          "Live events need a finite timestamp and bounded label/detail strings.",
        );
      const identity = JSON.stringify([event.at, event.label, event.detail]);
      const occurrence = (occurrences.get(identity) ?? 0) + 1;
      occurrences.set(identity, occurrence);
      // A boundary event belongs to the next interval; gaps and unsealed frames stay unassigned.
      const frameIndex = frames.findIndex((frame) => {
        const rounding = Number.EPSILON * Math.max(1, Math.abs(frame.at), frame.interval) * 4;
        return (
          frame.interval > 0 &&
          event.at >= frame.at - frame.interval - rounding &&
          event.at < frame.at
        );
      });
      const latest = frames.at(-1);
      return {
        at: event.at,
        label: event.label,
        detail: event.detail,
        id: `${identity}:${occurrence}`,
        frameIndex,
        frameId: frames[frameIndex]?.id ?? null,
        age: latest && event.at <= latest.at ? (latest.at - event.at) / 1000 : null,
      };
    })
    .toSorted((a, b) => a.at - b.at);
}

export type LiveEvent = NonNullable<ReturnType<typeof readEvents>>[number];

export function eventPosition(event: LiveEvent) {
  return `${withUnit((event.at / 1000).toFixed(3), "s")} · ${event.frameId === null ? "no matching frame" : `f${event.frameId}`}`;
}
