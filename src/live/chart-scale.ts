import { useRef } from "preact/hooks";
import type { LiveView } from "./model.ts";

export function useChartScale(view: LiveView) {
  const minimum = Math.max(
    view.budget <= Number.MAX_VALUE / 2 ? view.budget * 2 : view.budget,
    ...view.frames.map((frame) => frame.interval),
  );
  const magnitude = 10 ** Math.floor(Math.log10(minimum));
  const ceiling =
    [1, 2, 5, 10]
      .map((step) => step * magnitude)
      .find((step) => Number.isFinite(step) && step >= minimum) ?? minimum;
  const at = view.frames.at(-1)?.at ?? 0;
  const id = view.frames.at(-1)?.id ?? -1;
  const state = useRef({ ceiling, budget: view.budget, at, id, lowerSince: null as number | null });
  const previous = state.current;
  if (
    !view.frames.length ||
    view.budget !== previous.budget ||
    at < previous.at ||
    id < previous.id ||
    ceiling >= previous.ceiling
  ) {
    state.current = { ceiling, budget: view.budget, at, id, lowerSince: null };
  } else {
    // Use frame time so hovering, wall-clock waits and Freeze cannot shrink the scale.
    previous.lowerSince ??= at;
    if (at - previous.lowerSince >= 2000) {
      previous.ceiling = ceiling;
      previous.lowerSince = null;
    }
    previous.at = at;
    previous.id = id;
  }
  return state.current.ceiling;
}
