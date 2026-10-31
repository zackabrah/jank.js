import {
  type FrameStatistics,
  type ScopeStatistics,
  summarizeFrames,
  summarizeScopes,
} from "../analysis/statistics.ts";
import { visibleFrames } from "../charts/frame-layout.ts";
import { createLiveChart } from "../charts/live-chart.ts";
import type { ProfilerSnapshot } from "../core/snapshot.ts";
import { renderCounters } from "./counter-view.ts";
import { element, milliseconds, rows, write } from "./dom.ts";
import type { PanelMode } from "./panel.ts";
import { createScopeView } from "./scope-view.ts";

export function createLiveView(root: HTMLElement) {
  const scopeView = createScopeView(root);
  const charts = {
    full: createLiveChart(element(root, '[data-live-chart="full"]'), true),
    mini: createLiveChart(element(root, '[data-live-chart="mini"]'), false),
  };
  return {
    clear: () => {
      scopeView.clear();
      charts.full.stop();
      charts.mini.stop();
    },
    stop: () => {
      charts.full.stop();
      charts.mini.stop();
    },
    dispose: () => {
      charts.full.dispose();
      charts.mini.dispose();
    },
    render(snapshot: ProfilerSnapshot, mode: PanelMode, animate: boolean): void {
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
      charts[mode].render(
        {
          frames: snapshot.frames,
          events: snapshot.events,
          budgetMs: 1000 / snapshot.targetFps,
          limitMs: stats?.limitMs ?? 1000 / snapshot.targetFps,
        },
        animate,
      );
      const scopes = summarizeScopes(
        visibleFrames(
          snapshot.frames,
          element<HTMLElement>(root, `[data-live-chart="${mode}"]`).clientWidth,
        ),
      );
      if (mode === "mini") {
        renderMini(root, snapshot, stats, scopes);
        return;
      }
      renderFpsRange(root, stats);
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
      scopeView.render(snapshot, scopes);
      renderCounters(root, snapshot);
      rows(
        element(root, '[data-list="events"]'),
        snapshot.events
          .slice(-5)
          .map((event) => [event.label, `${milliseconds(event.atMs, 0)} ms`]),
      );
    },
  };
}

function renderMini(
  root: HTMLElement,
  snapshot: ProfilerSnapshot,
  stats: FrameStatistics | null,
  scopes: ScopeStatistics,
): void {
  write(root, "mini-worst", `${milliseconds(stats?.worstMs)} at ${stats?.worstFrameId ?? "–"}`);
  element<HTMLElement>(root, '[data-value="mini-worst"]').dataset.warning = String(
    !!stats && stats.worstMs > stats.limitMs,
  );
  const top = scopes.channels.toSorted((a, b) => b.averageMs - a.averageMs)[0];
  const channel = snapshot.channels.find((channel) => channel.id === top?.channelId);
  write(
    root,
    "mini-channel",
    top
      ? `top ${channel?.label ?? top.channelId} ${milliseconds(top.averageMs)}`
      : "Scopes unavailable",
  );
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

function renderFpsRange(root: HTMLElement, stats: FrameStatistics | null): void {
  const range = element<HTMLElement>(root, "[data-fps-range]");
  range.hidden = stats?.fps === null || !stats?.fpsRange;
  if (!stats?.fpsRange || stats.fps === null) {
    return;
  }
  const { low, high } = stats.fpsRange;
  write(root, "fps-high", String(high));
  write(root, "fps-low", String(low));
  range.setAttribute("aria-label", `Current ${stats.fps} FPS; range ${low} to ${high} FPS`);
  const fraction = high === low ? 0.5 : Math.max(0, Math.min(1, (high - stats.fps) / (high - low)));
  element<HTMLElement>(root, "[data-fps-mark]").style.top = `${fraction * 100}%`;
}
