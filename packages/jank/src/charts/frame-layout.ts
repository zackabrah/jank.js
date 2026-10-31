import type { EventSample, FrameSample } from "../core/frames.ts";

export interface FrameLayoutInput {
  readonly frames: readonly FrameSample[];
  readonly events: readonly EventSample[];
  readonly budgetMs: number;
  readonly width: number;
  readonly height: number;
  readonly labels: boolean;
}
export const framePitchPx = 3;
export function visibleFrames(
  frames: readonly FrameSample[],
  widthPx: number,
): readonly FrameSample[] {
  const count = Math.max(0, Math.floor(widthPx / framePitchPx));
  return count === 0 ? [] : frames.slice(-count);
}

const eventSymbols = ["◆", "◇", "○", "□", "△", "▽", "◊", "∗", "×", "+", "∆", "≡", "●", "■", "▲"];
const lifecycleSymbols = new Map([
  ["Recording started", "●"],
  ["Recording stopped", "■"],
  ["Recording complete", "■"],
  ["Spike captured", "▲"],
]);
export function eventSymbol(label: string): { glyph: string; name: string } {
  const lifecycle = lifecycleSymbols.get(label);
  if (lifecycle) {
    return { glyph: lifecycle, name: label };
  }
  const prefix = eventSymbols.find((symbol) => label.startsWith(`${symbol} `));
  if (prefix) {
    return { glyph: prefix, name: label.slice(prefix.length + 1) };
  }
  let hash = 0x811c9dc5;
  for (const character of label) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }
  return { glyph: eventSymbols[hash % 12] ?? "◆", name: label };
}

/** Geometry and visible-window selection; no DOM, clocks or measurement mutation. */
export function frameLayout(input: FrameLayoutInput) {
  const { width, height, labels, budgetMs } = input;
  const margin = 120;
  const visible = visibleFrames(input.frames, width);
  const drawn = visibleFrames(input.frames, width + margin);
  let worst: FrameSample | null = null;
  for (const frame of visible) {
    if (!worst || duration(frame) >= duration(worst)) {
      worst = frame;
    }
  }
  const barBottom = Math.max(1, height - (labels ? 16 : 0));
  const top = labels ? 24 : 2;
  const tallestMs = Math.max(0, ...drawn.map(duration));
  const maximumMs = Math.max(budgetMs * 3, (tallestMs * barBottom) / Math.max(1, barBottom - top));
  const scale = barBottom / maximumMs;
  const bars = drawn.map((frame, index) => ({
    frame,
    x: width + margin - (drawn.length - index) * framePitchPx + 1,
    height: Math.max(1, Math.round(duration(frame) * scale)),
  }));
  const marks = input.events.flatMap((event) => {
    const bar = bars.find(
      ({ frame }) => event.atMs >= frame.startedAtMs && event.atMs <= frame.endedAtMs,
    );
    return bar
      ? [
          {
            ...event,
            ...eventSymbol(event.label),
            x: Math.min(width + margin - 7, Math.max(0, bar.x - 2)),
          },
        ]
      : [];
  });
  let freeX = Infinity;
  const events = marks
    .toReversed()
    .filter((event) => {
      if (event.x + 8 > freeX) {
        return false;
      }
      freeX = event.x;
      return true;
    })
    .reverse();
  return {
    visible,
    bars,
    worst,
    events,
    margin,
    barBottom,
    maximumMs,
    budgetY: Math.round(barBottom - budgetMs * scale) + 0.5,
    latestEvent: marks.findLast((event) => event.x >= margin) ?? null,
  };
}
function duration(frame: FrameSample): number {
  return frame.endedAtMs - frame.startedAtMs;
}
