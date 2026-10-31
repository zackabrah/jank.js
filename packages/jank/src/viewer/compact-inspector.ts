import type { ComparedWork } from "../analysis/frame-comparison.ts";
import { element, renderTable } from "./dom.ts";

/** A compact summary of the same measurements used by the diagnostic tables. */
export function renderCompactWork(
  root: HTMLElement,
  rows: readonly ComparedWork[],
  comparison: boolean,
): void {
  for (const kind of ["cpu", "gpu"] as const) {
    const container = element<HTMLElement>(root, `[data-inspector-${kind}]`);
    const selected = rows.filter(
      (row) => row.kind === kind || (kind === "cpu" && row.kind === "frame"),
    );
    container.className = "jank-viewer-compact";
    container.dataset.comparison = String(comparison);
    renderTable(
      container,
      `${kind.toUpperCase()} selected work`,
      comparison ? ["Work", "A", "B", "B − A"] : ["Work", "ms"],
      selected.map((row) => {
        const values = [row.displayLabel, duration(row.a.durationMs)];
        if (comparison) {
          values.push(duration(row.b.durationMs), difference(row.differenceMs));
        }
        return values;
      }),
    );
    const headers = container.querySelectorAll("th");
    if (comparison) {
      headers[1]?.classList.add("jank-series-a");
      headers[2]?.classList.add("jank-series-b");
    }
    annotateMeasurements(container, selected, comparison);
    if (!selected.length) {
      container.textContent = "No identities recorded · timing unknown";
    }
  }
}
function duration(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function difference(value: number | null): string {
  return value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function annotateMeasurements(
  container: HTMLElement,
  selected: readonly ComparedWork[],
  comparison: boolean,
): void {
  for (const [index, row] of selected.entries()) {
    const tableRow = container.querySelectorAll("tbody tr")[index];
    const cells = tableRow?.querySelectorAll("td");
    tableRow?.setAttribute("data-work-kind", row.kind);
    tableRow?.setAttribute("data-work-key", row.key);
    if (cells?.[0]) {
      cells[0].title = row.label;
      if (!comparison) {
        const label = container.ownerDocument.createElement("span");
        label.className = "jank-viewer-work-label";
        label.textContent = row.displayLabel;
        cells[0].replaceChildren(label);
      }
    }
    if (cells?.[1]) {
      cells[1].title = row.a.note;
    }
    if (comparison && cells?.[2]) {
      cells[2].title = row.b.note;
    }
  }
}
