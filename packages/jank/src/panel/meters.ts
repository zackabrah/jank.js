import { milliseconds } from "./dom.ts";

export function createMeter(document: Document): HTMLElement {
  const meter = document.createElement("i");
  meter.className = "jank-meter";
  meter.setAttribute("aria-hidden", "true");
  const fill = document.createElement("i");
  fill.className = "jank-meter-fill";
  meter.append(fill);
  return meter;
}

/** A missing measurement has no fill; a measured zero remains an observed zero. */
export function updateMeter(meter: HTMLElement, durationMs: number | null, budgetMs: number): void {
  const fill = meter.firstElementChild;
  if (!(fill instanceof HTMLElement)) {
    return;
  }
  fill.hidden = durationMs === null;
  fill.style.width =
    durationMs === null ? "" : `${Math.max(0, Math.min(100, (durationMs / budgetMs) * 100))}%`;
}

export interface MeterRow {
  readonly label: string;
  readonly durationMs: number | null;
  readonly heavy?: boolean;
  readonly dim?: boolean;
  readonly description: string;
}
export function meterRows(root: HTMLElement, values: readonly MeterRow[], budgetMs: number): void {
  while (root.children.length > values.length) {
    root.lastElementChild?.remove();
  }
  values.forEach((value, index) => {
    let row = root.children[index];
    if (!row) {
      row = root.ownerDocument.createElement("div");
      row.className = "jank-row jank-meter-row";
      row.append(
        root.ownerDocument.createElement("span"),
        createMeter(root.ownerDocument),
        root.ownerDocument.createElement("span"),
      );
      root.append(row);
    }
    const [label, meter, number] = row.children;
    if (label && label.textContent !== value.label) {
      label.textContent = value.label;
    }
    if (number && number.textContent !== milliseconds(value.durationMs, 2)) {
      number.textContent = milliseconds(value.durationMs, 2);
    }
    if (meter instanceof HTMLElement) {
      updateMeter(meter, value.durationMs, budgetMs);
    }
    row.setAttribute("data-heavy", String(value.heavy === true));
    row.setAttribute("data-dim", String(value.dim === true));
    row.setAttribute("title", value.description);
  });
}
