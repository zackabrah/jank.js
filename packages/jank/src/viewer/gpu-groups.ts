import type { WorkIdentity } from "../analysis/frame-comparison.ts";

/** Stable pass ID + type, never label equality or timing rank. Non-interval rows stay separate. */
export function gpuGroups<T extends WorkIdentity>(rows: readonly T[]) {
  const groups = new Map<string, { key: string; label: string; rows: T[] }>();
  for (const row of rows) {
    const key = row.gpuGroup?.key ?? JSON.stringify([row.kind, row.key]);
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
    } else {
      groups.set(key, { key, label: row.gpuGroup?.label ?? row.displayLabel, rows: [row] });
    }
  }
  return [...groups.values()];
}
export function openGpuGroups(container: HTMLElement): Set<string> {
  return new Set(
    [...container.querySelectorAll<HTMLDetailsElement>("details[data-gpu-group][open]")].map(
      (node) => node.dataset.gpuGroup ?? "",
    ),
  );
}
export function createGpuGroup(
  container: HTMLElement,
  group: { key: string; label: string; rows: readonly unknown[] },
  open: ReadonlySet<string>,
): HTMLDetailsElement {
  const details = container.ownerDocument.createElement("details");
  details.className = "jank-viewer-gpu-group";
  details.dataset.gpuGroup = group.key;
  details.open = open.has(group.key);
  const summary = container.ownerDocument.createElement("summary");
  summary.textContent = `${group.label} · ${group.rows.length} invocation rows`;
  details.append(summary);
  container.append(details);
  return details;
}
