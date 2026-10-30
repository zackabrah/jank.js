import { summarizeFrames, summarizeScopes } from "../analysis/statistics.ts";
import { drawFrameChart } from "../charts/frame-chart.ts";
import type { ProfilerSnapshot } from "../core/snapshot.ts";
import { element, milliseconds, rows, write } from "./dom.ts";
import type { PanelMode } from "./panel.ts";

export function renderLive(root: HTMLElement, snapshot: ProfilerSnapshot, mode: PanelMode): void {
  const stats = summarizeFrames(snapshot.frames, snapshot.targetFps);
  const prefix = mode === "full" ? "" : `${mode}-`;
  write(root, `${prefix}fps`, stats?.fps?.toString() ?? "–");
  const limitMs = stats?.limitMs ?? Infinity;
  renderDuration(root, `${prefix}average`, stats?.averageMs, limitMs);
  if (mode === "line") {
    renderDuration(root, "line-worst", stats?.worstMs, limitMs);
    return;
  }
  renderDuration(root, `${prefix}p95`, stats?.p95Ms, limitMs);
  drawFrameChart(element(root, `[data-chart="${mode}"]`), {
    frames: snapshot.frames,
    budgetMs: 1000 / snapshot.targetFps,
    limitMs: stats?.limitMs ?? 1000 / snapshot.targetFps,
  });
  const scopes = summarizeScopes(snapshot.frames);
  if (mode === "mini") {
    write(root, "mini-worst", `▲ ${milliseconds(stats?.worstMs)} @ ${stats?.worstFrameId ?? "–"}`);
    const top = scopes.channels.toSorted((a, b) => b.averageMs - a.averageMs)[0];
    const channel = snapshot.channels.find((channel) => channel.id === top?.channelId);
    write(
      root,
      "mini-channel",
      top
        ? `${channel?.label ?? top.channelId} ${milliseconds(top.averageMs)}`
        : "Scopes unavailable",
    );
    return;
  }
  renderDuration(root, "worst", stats?.worstMs, limitMs);
  write(root, "frame", stats?.worstFrameId.toString() ?? "–");
  write(root, "missed", stats?.missedFrames.toString() ?? "–");
  write(
    root,
    "range",
    stats?.fpsRange
      ? `FPS ${stats.fpsRange.low}–${stats.fpsRange.high}`
      : "FPS needs a full second",
  );
  write(
    root,
    "budget",
    `${snapshot.targetFps} FPS · ${milliseconds(1000 / snapshot.targetFps)} MS`,
  );
  rows(element(root, '[data-list="scopes"]'), [
    ...snapshot.channels.flatMap((channel): [string, string][] => {
      const scope = scopes.channels.find((scope) => scope.channelId === channel.id);
      return scope ? [[channel.label, milliseconds(scope.averageMs, 2)]] : [];
    }),
    ["unattributed", milliseconds(scopes.unattributedMs, 2)],
  ]);
  write(
    root,
    "coverage",
    `${scopes.measuredFrames} complete frames · ${scopes.excludedFrames} excluded. Unattributed includes browser wait and idle time; channel timings may overlap.`,
  );
  renderCounters(root, snapshot);
  rows(
    element(root, '[data-list="events"]'),
    snapshot.events.slice(-5).map((event) => [event.label, `${milliseconds(event.atMs, 0)} ms`]),
  );
}

function renderCounters(root: HTMLElement, snapshot: ProfilerSnapshot): void {
  const values: [string, string][] = [];
  for (const sample of snapshot.counters) {
    const channel =
      snapshot.channels.find((channel) => channel.id === sample.channelId)?.label ??
      sample.channelId;
    if (sample.status === "error") {
      values.push([channel, `Error: ${sample.message}`]);
    } else {
      for (const [name, value] of Object.entries(sample.values)) {
        values.push([`${channel} / ${name}`, value === null ? "–" : String(value)]);
      }
    }
  }
  rows(element(root, '[data-list="counters"]'), values.slice(0, 12));
}

export function renderOverhead(root: HTMLElement, snapshot: ProfilerSnapshot): void {
  const { collection, refresh } = snapshot.overhead;
  write(
    root,
    "collection-cost",
    `${milliseconds(collection.averageMs, 3)} / ${milliseconds(collection.peakMs, 3)}`,
  );
  write(
    root,
    "refresh-cost",
    `${milliseconds(refresh.averageMs, 3)} / ${milliseconds(refresh.peakMs, 3)}`,
  );
  write(root, "precision", "Timer precision not calibrated; values are estimates.");
}

function renderDuration(
  root: HTMLElement,
  name: string,
  durationMs: number | null | undefined,
  limitMs: number,
): void {
  write(root, name, milliseconds(durationMs));
  element<HTMLElement>(root, `[data-value="${name}"]`).dataset.warning = String(
    (durationMs ?? 0) > limitMs,
  );
}
