// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, test, vi } from "vitest";
import { EventRail } from "./event-rail.tsx";
import { liveFixture } from "./fixtures.ts";
import { readLive } from "./model.ts";
import { mountLivePanel } from "./panel.tsx";

test("event rail groups markers by real frame and inspects collocated events with a single keyboard stop", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const source = liveFixture(true);
  source.diagnostics.frames = [10, 20, 30].map((at, index) => ({
    id: index + 1,
    at,
    interval: 10,
    scopes: [],
    coverage: "complete",
    overhead: { collectionMs: 0, refreshMs: 0 },
  }));
  source.diagnostics.events = [
    { at: -10, label: "Before", detail: "" },
    { at: 0, label: "First", detail: "Start" },
    { at: 11, label: "Second", detail: "Shared frame" },
    { at: 12, label: "Third", detail: "Other detail" },
    { at: 32, label: "Unsealed", detail: "" },
  ];
  const draw = (compact = false) =>
    act(() => render(<EventRail view={readLive(source)} compact={compact} />, container));
  try {
    await draw();
    const rail = container.querySelector<SVGSVGElement>('svg[role="slider"]');
    if (!rail) throw new Error("Missing event rail");
    const readout = () => container.querySelector("[data-event-readout]");
    expect(readout()).toBeNull();
    expect(container.querySelectorAll("[tabindex]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-event-frame]")).toHaveLength(2);
    expect(
      container.querySelector('[data-event-frame="2"]')?.getAttribute("data-event-count"),
    ).toBe("2");
    expect(container.querySelector('[data-event-frame="1"]')?.getAttribute("d")).toContain(
      `M${(177.5 * 300) / 180},`,
    );
    const key = async (value: string) =>
      act(() => {
        rail.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true }));
      });
    await act(() => rail.focus());
    expect(readout()?.textContent).toContain("Third");
    await key("Home");
    expect(readout()?.textContent).toContain("First");
    expect(rail.getAttribute("aria-valuetext")).toContain("First · 0.000\u00a0s · f1 · Start");
    await key("ArrowRight");
    expect(rail.getAttribute("aria-valuetext")).toContain("Second · 0.011\u00a0s · f2");
    source.diagnostics.frames = source.diagnostics.frames.slice(1);
    await draw();
    expect(rail.getAttribute("aria-valuenow")).toBe("0");
    expect(rail.getAttribute("aria-valuetext")).toContain("Second");
    await key("ArrowRight");
    expect(rail.getAttribute("aria-valuetext")).toContain("Third");
    await key("ArrowRight");
    expect(rail.getAttribute("aria-valuenow")).toBe("1");
    const bounds = vi
      .spyOn(rail, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(10, 0, 600, 16));
    await act(() => {
      rail.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 10 + (178.5 / 180) * 600, bubbles: true }),
      );
    });
    expect(rail.getAttribute("aria-valuetext")).toContain("Second");
    bounds.mockRestore();
    source.diagnostics.frames = [];
    await draw();
    expect(document.activeElement).toBe(rail);
    expect(rail.getAttribute("aria-disabled")).toBe("true");
    await key("ArrowLeft");
    expect(rail.getAttribute("aria-valuetext")).toBe("No events in displayed frames");
    await act(() => rail.blur());
    expect(readout()).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    const fixture = readLive(liveFixture());
    await act(() => render(<EventRail view={fixture} compact />, container));
    expect(container.querySelector('[role="slider"]')).toBeNull();
    expect(readout()).toBeNull();
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      "Events in displayed frames: 3",
    );
  } finally {
    render(null, container);
    container.remove();
  }
});

test("Freeze owns the event list, ages and rail; resumes host changes and renders text safely", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const source = liveFixture();
  const panel = mountLivePanel(container);
  panel.update(source);
  const root = container.firstElementChild?.shadowRoot;
  if (!root) throw new Error("Missing panel");
  const button = (name: string) => {
    const control = [...root.querySelectorAll("button")].find((item) =>
      item.textContent?.includes(name),
    );
    if (!control) throw new Error(`Missing ${name}`);
    return control;
  };
  try {
    await act(() => button("Events").click());
    expect(root.querySelector("[data-live-events]")?.textContent).toContain(
      "Spawned 128 reference entities.",
    );
    await act(() => button("Freeze").click());
    const held = root.querySelector("[data-live-events]")?.textContent;
    const markers = root.querySelector("[data-event-rail]")?.innerHTML;
    source.diagnostics.events = [
      { at: 6000, label: "<img onerror=alert(1)>", detail: "<script>new event</script>" },
    ];
    source.diagnostics.frames = source.diagnostics.frames.map((frame) => ({
      ...frame,
      id: frame.id + 300,
      at: frame.at + 6000,
    }));
    await act(() => panel.update(source));
    expect(root.querySelector("[data-live-events]")?.textContent).toBe(held);
    expect(root.querySelector("[data-event-rail]")?.innerHTML).toBe(markers);
    await act(() => button("Freeze").click());
    expect(root.querySelector("[data-live-events]")?.textContent).toContain(
      "<script>new event</script>",
    );
    expect(root.querySelector("[data-live-events] img, [data-live-events] script")).toBeNull();
    const before = root.querySelector("[data-live-events]")?.textContent;
    source.diagnostics.events = [{ at: NaN, label: "Invalid", detail: "" }];
    expect(() => panel.update(source)).toThrow(RangeError);
    expect(root.querySelector("[data-live-events]")?.textContent).toBe(before);
    delete source.diagnostics.events;
    await act(() => panel.update(source));
    expect(root.querySelector("[data-live-events]")?.textContent).toContain(
      "host has not supplied events",
    );
    source.diagnostics.events = [];
    await act(() => panel.update(source));
    expect(root.querySelector("[data-live-events]")?.textContent).toBe("No events reported.");
  } finally {
    panel.destroy();
    container.remove();
  }
});
