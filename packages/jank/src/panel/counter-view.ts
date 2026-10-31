import type { CounterValue } from "../core/frames.ts";
import type { ProfilerSnapshot } from "../core/snapshot.ts";
import { element, rows, write } from "./dom.ts";

function counterText(value: CounterValue): string {
  if (value === null) {
    return "–";
  }
  if (typeof value !== "number") {
    return String(value);
  }
  if (Math.abs(value) >= 1000000) {
    return `${(value / 1000000).toFixed(2).replace(/\.?0+$/, "")}M`;
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function readableName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}
export function renderCounters(root: HTMLElement, snapshot: ProfilerSnapshot): void {
  const values: { label: string; text: string; title: string; error: boolean }[] = [];
  const sources = new Set<string>();
  for (const sample of snapshot.counters) {
    const channel =
      snapshot.channels.find((channel) => channel.id === sample.channelId)?.label ??
      sample.channelId;
    sources.add(channel);
    if (sample.status === "error") {
      values.push({
        label: channel,
        text: `Error: ${sample.message}`,
        title: sample.message,
        error: true,
      });
      continue;
    }
    for (const [name, value] of Object.entries(sample.values)) {
      values.push({
        label: readableName(name),
        text: counterText(value),
        title: `${channel} / ${name}: ${value === null ? "unknown" : String(value)}`,
        error: false,
      });
    }
  }
  const list = element<HTMLElement>(root, '[data-list="counters"]');
  const displayed = values.slice(0, 12);
  rows(
    list,
    displayed.map((value) => [value.label, value.text]),
  );
  displayed.forEach((value, index) => {
    const row = list.children[index];
    row?.setAttribute("title", value.title);
    row?.setAttribute("aria-label", value.title);
    row?.setAttribute("data-error", String(value.error));
  });
  write(root, "counter-sources", [...sources].join(" · "));
  const note =
    values.length > displayed.length
      ? `${values.length - displayed.length} more in the export`
      : "No counters registered.";
  write(root, "counter-note", note);
  element<HTMLElement>(root, '[data-value="counter-note"]').hidden =
    values.length > 0 && values.length === displayed.length;
}
