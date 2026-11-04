// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { expect, test } from "vitest";
import { liveFixture } from "../live/fixtures.ts";
import { mountLivePanel } from "../live/panel.tsx";
import { loadingFixture } from "./fixtures.ts";

test("rejects bad loading updates before replacing the panel and freezes an owned display snapshot", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const panel = mountLivePanel(container);
  const live = liveFixture();
  const loading = loadingFixture("loading");
  panel.update({ ...live, loading });
  const root = container.firstElementChild?.shadowRoot;
  if (!root) throw new Error("Missing panel");
  const tab = root.querySelector<HTMLButtonElement>('[id$="-loading-tab"]');
  const freeze = [...root.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Freeze"),
  );
  if (!tab || !freeze) throw new Error("Missing controls");
  const summary = () => root.querySelector('[aria-label="Loading summary"]')?.textContent;
  try {
    await act(() => tab.click());
    expect(summary()).toContain("280\u00a0ms");
    await act(() => freeze.click());
    const bad = loadingFixture("ready");
    const badCurrent = bad.current;
    if (!badCurrent) throw new Error("Missing fixture");
    expect(() =>
      panel.update({ ...live, loading: { ...bad, current: { ...badCurrent, pending: -1 } } }),
    ).toThrow(RangeError);
    await act(() => panel.update({ ...live, loading: loadingFixture("failed") }));
    expect(summary()).toContain("280\u00a0ms");
    expect(root.querySelector('[data-mode-header="full"] [aria-label="Loading"]')).toBeNull();
    expect(tab.getAttribute("aria-label")).toBe("Loading, last session failed");
    expect(root.querySelector('[aria-label="Loading session in progress"]')).not.toBeNull();
    await act(() => freeze.click());
    expect(root.querySelector('[aria-label="Loading session failed"]')).not.toBeNull();
  } finally {
    panel.destroy();
    container.remove();
  }
});

test("keeps a selected historical session during updates and falls back to latest after eviction", async () => {
  const container = document.createElement("div");
  const panel = mountLivePanel(container);
  const live = liveFixture();
  const loading = loadingFixture("loading");
  const current = loading.current;
  if (!current) throw new Error("Missing fixture");
  panel.update({ ...live, loading });
  const root = container.firstElementChild?.shadowRoot;
  if (!root) throw new Error("Missing panel");
  const select = root.querySelector<HTMLSelectElement>('[id$="-loading"] select');
  if (!select) throw new Error("Missing session picker");
  const summary = () => root.querySelector('[aria-label="Loading summary"]')?.textContent;
  try {
    await act(() => {
      select.value = "1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(() =>
      panel.update({ ...live, loading: { ...loading, current: { ...current, elapsedMs: 500 } } }),
    );
    expect(summary()).toContain("412\u00a0ms");
    const history = Array.from({ length: 8 }, (_, index) => ({
      ...current,
      id: index + 2,
      status: "ready" as const,
    }));
    await act(() =>
      panel.update({
        ...live,
        loading: { history, current: { ...current, id: 10, elapsedMs: 600 } },
      }),
    );
    expect(select.value).toBe("");
    expect(summary()).toContain("600\u00a0ms");
  } finally {
    panel.destroy();
  }
});

test("bounds dense waterfall marks while retaining complete totals", () => {
  const container = document.createElement("div");
  const panel = mountLivePanel(container);
  const current = loadingFixture("ready").current;
  if (!current) throw new Error("Missing fixture");
  try {
    panel.update({
      ...liveFixture(),
      loading: {
        history: [],
        current: {
          ...current,
          elapsedMs: 600,
          stages: [
            {
              stage: "many tasks",
              count: 300,
              errors: 0,
              cancelled: 0,
              operations: Array.from({ length: 300 }, (_, index) => ({
                id: String(index),
                startMs: index * 2,
                endMs: index * 2 + 1,
                status: "ready" as const,
              })),
            },
          ],
        },
      },
    });
    const root = container.firstElementChild?.shadowRoot;
    expect(root?.querySelectorAll("[data-loading-ended]")).toHaveLength(128);
    expect(root?.querySelector('[aria-label="Stages waterfall"]')?.textContent).toContain(
      "300\u00a0ms active wall · 300 ops · 300\u00a0ms op time",
    );
    expect(root?.querySelector('[aria-label="Stages waterfall"]')?.textContent).toContain(
      "totals include all observations",
    );
  } finally {
    panel.destroy();
  }
});
