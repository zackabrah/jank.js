import type { LoadingSnapshot, LoadingStage } from "../loading/loading.ts";
import { copyLoading } from "../loading/run.ts";
import type { LoadingSource } from "../sources.ts";
import { element, rows, write } from "./dom.ts";

interface LoadingViewSnapshot {
  current: LoadingSnapshot | null;
  history: readonly LoadingSnapshot[];
  cold: LoadingSnapshot | null;
}

/** The panel borrows the source; freezing copies display data without stopping loading work. */
export function createLoadingView(root: HTMLElement, source?: LoadingSource) {
  let frozen: LoadingViewSnapshot | null = null;
  function read(): LoadingViewSnapshot {
    const current = source?.snapshot() ?? null;
    const history = source?.history() ?? [];
    const cold =
      source?.baseline?.() ??
      history.find(
        (run) =>
          run.kind === "fresh-context" && run.status === "ready" && run.pendingOperations === 0,
      ) ??
      null;
    return {
      current: current ? copyLoading(current) : null,
      history: history.map(copyLoading),
      cold: cold ? copyLoading(cold) : null,
    };
  }
  return {
    freeze: (enabled: boolean) => {
      frozen = enabled ? read() : null;
    },
    render: () => {
      const state = frozen ?? read();
      renderSummary(root, state, Boolean(source));
      renderStages(root, state);
      renderCache(root, state.current?.stages ?? []);
      const sessions = [...state.history];
      if (state.current && !sessions.some((run) => run.id === state.current?.id)) {
        sessions.push(state.current);
      }
      rows(
        element(root, '[data-list="loading-sessions"]'),
        sessions.map((run) => [
          `#${run.id} ${run.label}`,
          `${time(run.elapsedMs)} · ${run.kind} · ${run.status}${run.pendingOperations ? ` · ${pendingLabel(run)}` : ""}`,
        ]),
      );
    },
  };
}

function time(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(1)} ms`;
}

function renderSummary(root: HTMLElement, state: LoadingViewSnapshot, connected: boolean): void {
  const current = state.current;
  write(root, "loading-total", current ? time(current.elapsedMs) : "–");
  write(root, "loading-cold", state.cold ? time(state.cold.elapsedMs) : "–");
  const hits = current?.stages.reduce((sum, stage) => sum + stage.cache.hits, 0) ?? 0;
  const misses = current?.stages.reduce((sum, stage) => sum + stage.cache.misses, 0) ?? 0;
  write(
    root,
    "loading-cache-rate",
    hits + misses ? `${Math.round((100 * hits) / (hits + misses))}%` : "–",
  );
  let message = connected ? "No loading run recorded." : "No loading source connected.";
  if (current) {
    message = `${current.label} · ${current.kind} · ${current.status} · ${pendingLabel(current)}`;
  }
  write(root, "loading-state", message);
}

function renderStages(root: HTMLElement, state: LoadingViewSnapshot): void {
  const stages = state.current?.stages ?? [];
  const cold = new Map((state.cold?.stages ?? []).map((stage) => [stage.name, stage.busyMs]));
  const maximumMs = Math.max(1, ...stages.map((stage) => stage.busyMs), ...cold.values());
  write(root, "loading-axis", `0–${time(maximumMs)}`);
  const container = element<HTMLElement>(root, '[data-list="loading"]');
  while (container.children.length > stages.length) {
    container.lastElementChild?.remove();
  }
  stages.forEach((stage, index) => {
    let row = container.children[index];
    if (!row) {
      row = root.ownerDocument.createElement("div");
      row.className = "jank-loading-stage";
      row.innerHTML =
        '<div class="jank-row"><span data-stage-name></span><span data-stage-time></span></div><div class="jank-loading-bars" aria-hidden="true"><i data-loading-cold-bar></i><i data-loading-current-bar></i></div><p class="jank-note" data-stage-detail></p>';
      container.append(row);
    }
    element(row, "[data-stage-name]").textContent = stage.name;
    element(row, "[data-stage-time]").textContent = `${time(stage.busyMs)} elapsed union`;
    const coldMs = cold.get(stage.name);
    element(row, "[data-stage-detail]").textContent =
      `${stage.totalMs.toFixed(1)} ms combined · ${stage.operationCount} ops · ${stage.failedCount} failed · ${stage.cancelledCount} cancelled${coldMs === undefined ? "" : ` · cold ${time(coldMs)}`}`;
    element<HTMLElement>(row, "[data-loading-current-bar]").style.width =
      `${(100 * stage.busyMs) / maximumMs}%`;
    element<HTMLElement>(row, "[data-loading-cold-bar]").style.width =
      `${(100 * (coldMs ?? 0)) / maximumMs}%`;
  });
}

function renderCache(root: HTMLElement, stages: readonly LoadingStage[]): void {
  rows(
    element(root, '[data-list="loading-cache"]'),
    stages.map((stage) => [
      stage.name,
      `${stage.cache.hits} hit · ${stage.cache.misses} miss · ${stage.cache.inFlight} shared in-flight · ${stage.receivedBytes} bytes`,
    ]),
  );
}

function pendingLabel(run: LoadingSnapshot): string {
  const cutoff = run.status !== "loading" && run.pendingOperations > 0 ? " at cutoff" : "";
  return `${run.pendingOperations} pending${cutoff}`;
}
