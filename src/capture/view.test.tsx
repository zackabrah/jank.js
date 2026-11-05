// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { expect, test, vi } from "vitest";
import { mountDiagnosticsPanel } from "../live/diagnostics-adapter.ts";
import { createCaptureController } from "./controller.ts";
import { captureFixture } from "./fixtures.ts";

test("records while frozen, saves at capacity, retains captures across remounts and opens the selected capture", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const { source, advance } = captureFixture();
  const monitor = { ...source, measureRefresh: <T,>(work: () => T) => work() };
  const controller = createCaptureController(monitor);
  const onOpen = vi.fn();
  const mount = () => mountDiagnosticsPanel(container, monitor, undefined, { controller, onOpen });
  let panel = mount();
  panel.refresh(0);
  const root = () => {
    const shadow = container.firstElementChild?.shadowRoot;
    if (!shadow) throw new Error("Missing panel");
    return shadow;
  };
  const button = (name: string) => {
    const found = [...root().querySelectorAll("button")].find(
      (item) => !item.closest("[hidden]") && item.textContent?.includes(name),
    );
    if (!found) throw new Error(`Missing ${name}`);
    return found;
  };
  try {
    await act(() => button("Freeze").click());
    const held = root().querySelector("section")?.getAttribute("data-frame");
    await act(() => button("Rec").click());
    expect(button("Stop and save")).toBeDefined();
    expect(controller.getSnapshot().phase).toBe("recording");
    advance(4);
    await act(() => panel.refresh(250));
    expect(root().querySelector("section")?.getAttribute("data-frame")).toBe(held);
    expect(root().querySelector('[aria-label="Capture C1"]')).not.toBeNull();
    await act(() => button("Open").click());
    expect(onOpen).toHaveBeenCalledWith(controller.getSnapshot().saved[0]);
    panel.destroy();
    panel = mount();
    panel.refresh(500);
    await act(() => button("Capture (1)").click());
    expect(root().querySelector('[aria-label="Capture C1"]')).not.toBeNull();
    const tab = button("Capture (1)");
    await act(() => {
      tab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(root().activeElement?.textContent).toBe("Loading");
    await act(() => {
      button("Loading").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(root().activeElement?.textContent).toBe("Live");
    await act(() => {
      button("Rec").dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    });
    advance(1);
    await act(() => panel.refresh(750));
    await act(() => button("Discard").click());
    expect(controller.getSnapshot().saved).toHaveLength(1);
    expect(root().activeElement).toBe(button("Start recording"));
  } finally {
    panel.destroy();
    container.remove();
  }
});

test("the adapter observes captures between display refreshes without rerendering subscribers", () => {
  const doc = document.implementation.createHTMLDocument("Host");
  const { source, advance } = captureFixture(1);
  const controller = createCaptureController(source);
  const monitor = { ...source, measureRefresh: <T,>(work: () => T) => work() };
  const panel = mountDiagnosticsPanel(doc.body, monitor, undefined, {
    controller,
    onOpen: vi.fn(),
  });
  const changed = vi.fn();
  controller.subscribe(changed);
  try {
    panel.refresh(0);
    controller.toggleAuto();
    changed.mockClear();
    advance(1, 48);
    panel.refresh(48);
    expect(controller.getSnapshot().saved).toHaveLength(1);
    expect(changed).not.toHaveBeenCalled();
    advance(1, 16);
    panel.refresh(64);
    expect(controller.getSnapshot().saved).toHaveLength(1);
    panel.refresh(250);
    expect(changed).toHaveBeenCalledTimes(1);
  } finally {
    panel.destroy();
  }
});

test("warns near recording capacity and says why the recording stopped", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const { source, advance } = captureFixture(10);
  const monitor = { ...source, measureRefresh: <T,>(work: () => T) => work() };
  const controller = createCaptureController(monitor);
  const panel = mountDiagnosticsPanel(container, monitor, undefined, {
    controller,
    onOpen: () => {},
  });
  panel.refresh(0);
  const root = () => {
    const shadow = container.firstElementChild?.shadowRoot;
    if (!shadow) throw new Error("Missing panel");
    return shadow;
  };
  const badges = (mode: string) =>
    root().querySelector(`[data-mode-header="${mode}"] [data-state-badges]`)?.textContent ?? "";
  const button = (name: string) =>
    [...root().querySelectorAll("button")].find(
      (item) => !item.closest("[hidden]") && item.textContent?.includes(name),
    );
  try {
    await act(() => button("Rec")?.click());
    advance(8);
    await act(() => panel.refresh(1000, true));
    expect(badges("full")).not.toContain("left");
    advance(1);
    await act(() => panel.refresh(2000, true));
    expect(badges("full")).toMatch(/1\sf left/);
    expect(badges("line")).toMatch(/1\sf left/);
    advance(1);
    await act(() => panel.refresh(3000, true));
    const notice = root().querySelector('[aria-label="Capture C1 saved"]');
    expect(notice?.textContent).toContain("Capture C1 saved at capacity");
    // A host with no GPU timing has nothing to cover, which is not 0% coverage.
    expect(root().textContent).not.toContain("C1 GPU coverage");
    await act(() => controller.start());
    advance(2);
    await act(() => panel.refresh(4000, true));
    await act(() => controller.stopAndSave());
    const early = root().querySelector('[aria-label="Capture C2 saved"]');
    expect(early?.textContent).toContain("Capture C2 saved");
    expect(early?.textContent).not.toContain("at capacity");
  } finally {
    panel.destroy();
    container.remove();
  }
});
