import type { TemporalSource, VisibilitySnapshot, VisibilitySource } from "../sources.ts";
import { element, rows, write } from "./dom.ts";

interface Sources {
  readonly visibility?: VisibilitySource | undefined;
  readonly temporal?: TemporalSource | undefined;
}
function read<T>(source: { read(): T | null } | undefined): {
  value: T | null;
  error: string | null;
} {
  try {
    return { value: source ? structuredClone(source.read()) : null, error: null };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : "Host diagnostics unavailable",
    };
  }
}
function readState(sources: Sources) {
  return { visibility: read(sources.visibility), temporal: read(sources.temporal) };
}

export function createIntegrationView(root: HTMLElement, sources: Sources, changed: () => void) {
  let frozen: ReturnType<typeof readState> | null = null;
  let state = readState(sources);
  const viewOrder: string[] = [];
  const instanceOrder: string[] = [];
  for (const name of ["visibility", "instances", "temporal"]) {
    const section = element<HTMLElement>(root, `[data-section="${name}"]`);
    section.hidden = !(name === "temporal" ? sources.temporal : sources.visibility);
    if (section.hidden) {
      section.removeAttribute("open");
    }
  }
  function render(): void {
    state = frozen ?? readState(sources);
    renderVisibility(root, state.visibility, viewOrder);
    renderInstances(root, state.visibility.value?.instances ?? null, instanceOrder);
    renderTemporal(root, state.temporal);
    updateControls(root, state, {
      frozen: frozen !== null,
      instances: Boolean(sources.visibility?.setInstancesEnabled),
    });
  }
  function change(event: Event): void {
    if (frozen) {
      return;
    }
    const target = integrationTarget(root, event);
    if (!target) {
      return;
    }
    try {
      applyControl(target, sources, readState(sources));
      render();
      changed();
    } catch (error) {
      const name =
        target.dataset.integration === "temporal" || target.dataset.integration === "debug"
          ? "temporal-status"
          : "visibility-status";
      write(root, name, error instanceof Error ? error.message : "Host control failed");
    }
  }
  root.addEventListener("click", change);
  root.addEventListener("change", change);
  return {
    render,
    freeze: (enabled: boolean) => {
      frozen = enabled ? readState(sources) : null;
    },
    dispose: () => {
      root.removeEventListener("click", change);
      root.removeEventListener("change", change);
    },
  };
}

function control(root: HTMLElement, name: string, pressed: boolean, disabled: boolean): void {
  const button = element<HTMLButtonElement>(root, `[data-integration="${name}"]`);
  button.disabled = disabled;
  button.setAttribute("aria-pressed", String(pressed));
  button.textContent = pressed ? "ON" : "OFF";
}
function updateControls(
  root: HTMLElement,
  state: ReturnType<typeof readState>,
  options: { frozen: boolean; instances: boolean },
): void {
  const visible = state.visibility.value;
  const temporal = state.temporal.value;
  control(root, "visibility", visible?.enabled ?? false, options.frozen || !visible);
  control(root, "bounds", visible?.debugBounds ?? false, options.frozen || !visible);
  control(
    root,
    "instances",
    visible?.instances?.enabled ?? false,
    options.frozen || !visible?.instances || !options.instances,
  );
  control(root, "temporal", temporal?.objectMotion ?? false, options.frozen || !temporal);
  const select = element<HTMLSelectElement>(root, '[data-integration="debug"]');
  select.disabled = options.frozen || !temporal;
  select.value = temporal?.debugView ?? "none";
}
function applyControl(
  target: HTMLElement,
  sources: Sources,
  state: ReturnType<typeof readState>,
): void {
  const visible = state.visibility.value;
  const temporal = state.temporal.value;
  switch (target.dataset.integration) {
    case "visibility":
      if (visible) {
        sources.visibility?.setEnabled(!visible.enabled);
      }
      break;
    case "bounds":
      if (visible) {
        sources.visibility?.setDebugBounds(!visible.debugBounds);
      }
      break;
    case "instances":
      if (visible?.instances) {
        sources.visibility?.setInstancesEnabled?.(!visible.instances.enabled);
      }
      break;
    case "temporal":
      if (temporal) {
        sources.temporal?.setEnabled(!temporal.objectMotion);
      }
      break;
    case "debug": {
      const value = element<HTMLSelectElement>(target.parentElement ?? target, "select").value;
      if (temporal && (value === "none" || value === "motion" || value === "history")) {
        sources.temporal?.setDebugView(value);
      }
      break;
    }
  }
}
function count(value: number | null): string {
  return value !== null && Number.isFinite(value) && value >= 0 ? String(value) : "unknown";
}
function orderedRows(
  order: string[],
  values: readonly (readonly [string, string])[],
): readonly (readonly [string, string])[] {
  for (const [name] of values) {
    if (!order.includes(name) && order.length < 32) {
      order.push(name);
    }
  }
  const current = new Map(values);
  return order.map((name) => [name, current.get(name) ?? "Not observed"]);
}
function renderVisibility(
  root: HTMLElement,
  state: ReturnType<typeof readState>["visibility"],
  order: string[],
): void {
  const value = state.value;
  write(
    root,
    "visibility-status",
    state.error ??
      (value
        ? "Host visibility decisions · tested / visible / culled"
        : "Visibility diagnostics unavailable"),
  );
  rows(
    element(root, '[data-list="visibility"]'),
    orderedRows(
      order,
      value?.views.map((view) => [
        view.name,
        `${count(view.tested)} / ${count(view.visible)} / ${count(view.culled)}`,
      ]) ?? [],
    ),
  );
  write(
    root,
    "visibility-distance",
    value?.distance
      ? `Distance range ${count(value.distance.range)} · ${count(value.distance.culled)} culled`
      : "No distance diagnostics",
  );
}
function renderInstances(
  root: HTMLElement,
  value: VisibilitySnapshot["instances"],
  order: string[],
): void {
  write(
    root,
    "instances-status",
    value
      ? `${count(value.hierarchies)} hierarchies · ${count(value.nodes)} nodes · ${count(value.prepared)} prepared · ${count(value.cacheHits)} cache hits`
      : "Instance diagnostics unavailable",
  );
  rows(
    element(root, '[data-list="instances"]'),
    orderedRows(
      order,
      value?.views.map((view) => [
        view.name,
        `${count(view.candidates)} candidates · ${count(view.visible)} visible · ${count(view.culled)} culled · ${count(view.rejectedLeaves)} rejected leaves · ${count(view.sampleAgeFrames)} frames old`,
      ]) ?? [],
    ),
  );
}
function renderTemporal(root: HTMLElement, state: ReturnType<typeof readState>["temporal"]): void {
  const value = state.value;
  write(
    root,
    "temporal-status",
    state.error ??
      (value ? "Host-owned object history and debug view" : "Temporal diagnostics unavailable"),
  );
  rows(
    element(root, '[data-list="temporal"]'),
    value
      ? [
          ["eligible batches", count(value.eligibleBatches)],
          ["rigid batches", count(value.rigidBatches)],
          ["rejected batches", count(value.rejectedBatches)],
        ]
      : [],
  );
}

function integrationTarget(root: HTMLElement, event: Event): HTMLElement | null {
  if (!(event.target instanceof HTMLElement)) {
    return null;
  }
  const target = event.target.closest<HTMLElement>("[data-integration]");
  if (!target || !root.contains(target)) {
    return null;
  }
  const expected = target.tagName === "SELECT" ? "change" : "click";
  return event.type === expected ? target : null;
}
