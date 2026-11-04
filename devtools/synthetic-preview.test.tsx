// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { expect, test, vi } from "vitest";
import { startSyntheticPreview } from "./synthetic-preview.tsx";

test("pauses the demo clock, resumes on injection, and cleans up the panel and interval", async () => {
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  let stop = () => {};
  const button = (name: string) => {
    const found = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === name,
    );
    if (!found) throw new Error(`Missing ${name}`);
    return found;
  };
  const frame = () =>
    container
      .querySelector("div > div")
      ?.shadowRoot?.querySelector("section")
      ?.getAttribute("data-frame");
  try {
    await act(() => {
      stop = startSyntheticPreview(container);
    });
    const first = frame();
    expect(first).toBe("179");
    await act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(Number(frame())).toBeGreaterThan(Number(first));
    await act(() => button("Pause demo").click());
    const held = frame();
    await act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(frame()).toBe(held);
    await act(() => button("GPU burst · 2s").click());
    await act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(container.textContent).toContain("Synthetic · GPU burst");
    expect(Number(frame())).toBeGreaterThan(Number(held));
    expect(button("Pause demo")).toBeTruthy();
    await act(() => stop());
    expect(container.childNodes).toHaveLength(0);
    expect(document.head.querySelectorAll("[data-panel-properties]")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await act(() => stop());
    container.remove();
    vi.useRealTimers();
  }
});
