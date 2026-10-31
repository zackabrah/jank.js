import type { ComparedWork } from "../analysis/frame-comparison.ts";
import { element, renderTable } from "./dom.ts";
import { createGpuGroup, gpuGroups, openGpuGroups } from "./gpu-groups.ts";

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
    const open = openGpuGroups(container);
    container.replaceChildren();
    if (kind === "gpu") {
      renderGpuGroups(container, selected, comparison, open);
    } else {
      renderCompactTable(container, selected, comparison, "CPU selected work");
    }
    if (!selected.length) {
      container.textContent = "No identities recorded · timing unknown";
    }
  }
}
function renderGpuGroups(
  container: HTMLElement,
  selected: readonly ComparedWork[],
  comparison: boolean,
  open: ReadonlySet<string>,
): void {
  for (const group of gpuGroups(selected)) {
    const target =
      group.rows.length > 1
        ? createGpuGroup(container, group, open)
        : container.ownerDocument.createElement("div");
    if (target instanceof HTMLDetailsElement) {
      const note = container.ownerDocument.createElement("span");
      note.className = "jank-viewer-group-measurement";
      note.textContent =
        observedSum(group.rows, "a") + (comparison ? ` / B ${observedSum(group.rows, "b")}` : "");
      note.title =
        "Sum of observed invocation durations only; overlapping intervals can be counted more than once. Not GPU busy time or a complete frame total.";
      target.querySelector("summary")?.append(note);
    } else {
      container.append(target);
    }
    renderCompactTable(target, group.rows, comparison, `${group.label} selected work`);
  }
}
function observedSum(rows: readonly ComparedWork[], side: "a" | "b"): string {
  const values = rows.flatMap((row) =>
    row[side].durationMs === null ? [] : [row[side].durationMs],
  );
  const sum = values.reduce((sum, value) => sum + value, 0);
  const text =
    values.length && Number.isFinite(sum) ? `${sum.toFixed(2)} ms observed sum` : "Unknown";
  return `${text} · ${values.length}/${rows.length} rows observed`;
}
function renderCompactTable(
  container: HTMLElement,
  selected: readonly ComparedWork[],
  comparison: boolean,
  caption: string,
): void {
  const table = container.ownerDocument.createElement("div");
  renderTable(
    table,
    caption,
    comparison ? ["Work", "A", "B", "B − A"] : ["Work", "ms"],
    selected.map((row) => {
      const values = [row.displayLabel, duration(row.a.durationMs)];
      if (comparison) {
        values.push(duration(row.b.durationMs), difference(row.differenceMs));
      }
      return values;
    }),
  );
  if (comparison) {
    const headers = table.querySelectorAll("th");
    headers[1]?.classList.add("jank-series-a");
    headers[2]?.classList.add("jank-series-b");
  }
  annotateMeasurements(table, selected, comparison);
  container.append(table);
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
