import type { ScopeStatistics } from "../analysis/statistics.ts";
import type { ProfilerSnapshot } from "../core/snapshot.ts";
import { element, write } from "./dom.ts";
import { type MeterRow, meterRows } from "./meters.ts";

/** Remember timed channels in registration order, including windows with no observation. */
export function createScopeView(root: HTMLElement) {
  const known = new Set<string>();
  return {
    clear: () => known.clear(),
    render(snapshot: ProfilerSnapshot, scopes: ScopeStatistics): void {
      for (const scope of scopes.channels) {
        known.add(scope.channelId);
      }
      const budgetMs = 1000 / snapshot.targetFps;
      const heaviest = scopes.channels.reduce<(typeof scopes.channels)[number] | null>(
        (best, scope) => (!best || scope.averageMs > best.averageMs ? scope : best),
        null,
      );
      const values: MeterRow[] = snapshot.channels
        .filter((channel) => known.has(channel.id))
        .map((channel) => {
          const scope = scopes.channels.find((scope) => scope.channelId === channel.id);
          return {
            label: channel.label,
            durationMs: scope?.averageMs ?? null,
            heavy: channel.id === heaviest?.channelId,
            dim: !scope,
            description: scope
              ? `${channel.label}: ${scope.averageMs.toFixed(2)} ms average over ${scopes.measuredFrames} complete visible frames; ${((scope.averageMs / budgetMs) * 100).toFixed(1)}% of budget. Inclusive timings can overlap.`
              : `${channel.label}: not observed in this visible window.`,
          };
        });
      values.push({
        label: "unattributed",
        durationMs: scopes.unattributedMs,
        dim: true,
        description:
          "Frame interval outside measured scopes, including browser work, scheduling, waiting and idle time; not a CPU execution measurement.",
      });
      meterRows(element(root, '[data-list="scopes"]'), values, budgetMs);
      write(
        root,
        "coverage",
        `${scopes.measuredFrames} complete frames · ${scopes.excludedFrames} excluded in the visible graph. Unattributed includes browser wait and idle time; channel timings may overlap.`,
      );
    },
  };
}
