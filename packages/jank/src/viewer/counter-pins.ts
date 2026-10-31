import type { CounterTimeline } from "../analysis/counter-timeline.ts";
import { element } from "./dom.ts";

/** Document-local presentation preferences; recorded observations remain untouched. */
export function createCounterPins(root: HTMLElement) {
  const pinned = new Set<string>();
  let catalog = "";
  function configure(model: CounterTimeline): void {
    const keys = model.lanes.map((lane) =>
      JSON.stringify([lane.identity.channelId, lane.identity.name]),
    );
    const signature = JSON.stringify(keys);
    if (catalog === signature) {
      return;
    }
    catalog = signature;
    const options = element<HTMLElement>(root, "[data-counter-pin-options]");
    options.replaceChildren();
    for (const [index, lane] of model.lanes.entries()) {
      const key = keys[index];
      if (key === undefined) {
        continue;
      }
      const label = root.ownerDocument.createElement("label");
      const input = root.ownerDocument.createElement("input");
      input.type = "checkbox";
      input.dataset.pinCounter = key;
      input.checked = pinned.has(key);
      input.setAttribute("aria-label", `Pin ${lane.identity.channelId} / ${lane.identity.name}`);
      label.append(input, `${lane.identity.channelId} / ${lane.identity.name}`);
      options.append(label);
    }
    if (!keys.length) {
      options.textContent = "No numeric counters recorded.";
    }
  }
  function placeLanes(container: HTMLElement): void {
    const rows = [...container.querySelectorAll<HTMLElement>('[data-lane-kind="counter"]')].filter(
      (row) => pinned.has(row.dataset.counterKey ?? ""),
    );
    if (!rows.length) {
      return;
    }
    const section = root.ownerDocument.createElement("section");
    section.dataset.pinnedCounterLanes = "";
    section.setAttribute("aria-label", "Pinned counter timelines");
    const heading = root.ownerDocument.createElement("div");
    heading.className = "jank-viewer-lane-group";
    heading.textContent = "PINNED COUNTERS · raw sample points";
    section.append(heading, ...rows);
    container.prepend(section);
    const headingNode = container.querySelector<HTMLElement>("[data-counter-lane-heading]");
    if (headingNode) {
      headingNode.hidden =
        container.querySelectorAll('[data-lane-kind="counter"]').length === rows.length;
    }
  }
  function updateReadout(): void {
    const source = element<HTMLElement>(root, "[data-counter-inspector]");
    const target = element<HTMLElement>(root, "[data-pinned-counter-readout]");
    const rows = [...source.querySelectorAll<HTMLTableRowElement>("tbody tr")].filter((row) =>
      pinned.has(row.dataset.counterKey ?? ""),
    );
    target.hidden = rows.length === 0;
    target.replaceChildren();
    if (!rows.length) {
      return;
    }
    const heading = root.ownerDocument.createElement("h3");
    heading.textContent = "PINNED COUNTERS";
    const table = root.ownerDocument.createElement("table");
    table.createCaption().textContent = `Pinned ${element<HTMLElement>(root, "[data-counter-time]").textContent} · last observations`;
    const header = source.querySelector("thead");
    if (header) {
      table.append(header.cloneNode(true));
    }
    const body = table.createTBody();
    for (const row of rows) {
      body.append(row.cloneNode(true));
    }
    target.append(heading, table);
  }
  return {
    configure,
    placeLanes,
    updateReadout,
    change(input: HTMLInputElement): void {
      const key = input.dataset.pinCounter;
      if (!key) {
        return;
      }
      if (input.checked) {
        pinned.add(key);
      } else {
        pinned.delete(key);
      }
    },
    clear(): void {
      pinned.clear();
      catalog = "";
      const target = element<HTMLElement>(root, "[data-pinned-counter-readout]");
      target.hidden = true;
      target.replaceChildren();
    },
  };
}
