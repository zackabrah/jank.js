export interface ViewerSelection {
  selected: number;
  start: number;
  end: number;
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, Math.round(value)));

export function fitSelection(count: number, selected: number): ViewerSelection {
  const end = Math.max(0, count - 1);
  return { selected: clamp(selected, 0, end), start: 0, end };
}

export function selectFrame(state: ViewerSelection, index: number, count: number): ViewerSelection {
  const selected = clamp(index, 0, Math.max(0, count - 1));
  const width = state.end - state.start;
  const start =
    selected < state.start ? selected : selected > state.end ? selected - width : state.start;
  return { selected, start, end: start + width };
}

export function selectRange(
  state: ViewerSelection,
  first: number,
  last: number,
  count: number,
): ViewerSelection {
  const limit = Math.max(0, count - 1);
  const start = clamp(Math.min(first, last), 0, limit);
  const end = clamp(Math.max(first, last), start, limit);
  return { selected: clamp(state.selected, start, end), start, end };
}

export function zoomSelection(
  state: ViewerSelection,
  factor: number,
  count: number,
): ViewerSelection {
  const size = clamp((state.end - state.start + 1) * factor, 1, Math.max(1, count));
  const start = clamp(state.selected - Math.floor(size / 2), 0, Math.max(0, count - size));
  return { selected: state.selected, start, end: start + size - 1 };
}
