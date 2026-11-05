// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { expect, test, vi } from "vitest";
import { mountDiagnosticsPanel } from "./diagnostics-adapter.ts";
import { liveFixture } from "./fixtures.ts";
import { mountLivePanel } from "./panel.tsx";

function control(root: ShadowRoot, label: string) {
  const found = [...root.querySelectorAll("button")].find(
    (button) =>
      !button.closest("[hidden]") &&
      (button.getAttribute("aria-label") ?? button.textContent ?? "").includes(label),
  );
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}

function setup() {
  const container = document.createElement("div");
  document.body.append(container);
  let source = liveFixture();
  const changeBudget = vi.fn((milliseconds: number) => {
    source = {
      ...source,
      diagnostics: { ...source.diagnostics, budget: { frameMs: milliseconds } },
    };
    panel.update(source);
  });
  const panel = mountLivePanel(container, { onBudgetChange: changeBudget });
  panel.update(source);
  const root = container.firstElementChild?.shadowRoot;
  if (!root) throw new Error("Missing panel");
  const surface = root.querySelector("section");
  return {
    root,
    surface,
    panel,
    changeBudget,
    close: () => {
      panel.destroy();
      container.remove();
    },
  };
}

const metric = (root: ShadowRoot, label: string) =>
  root.querySelector(`[data-mode-body="full"] [data-metric="${label}"] [data-value]`)?.textContent;
const key = (target: Element, value: string) => {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: value, bubbles: true, composed: true, cancelable: true }),
  );
};

async function selectBudget(root: ShadowRoot, value: string) {
  const select = root.querySelector<HTMLSelectElement>('select[aria-label="Frame budget"]');
  if (!select) throw new Error("Missing budget select");
  await act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

test("switches modes without losing disclosure state, and moves focus to visible controls", async () => {
  const { root, surface, close } = setup();
  try {
    const cpu = control(root, "CPU scopes");
    await act(() => cpu.click());
    const p95 = metric(root, "p95 frame");
    await act(() => control(root, "Mini view").click());
    expect(surface?.getAttribute("data-mode")).toBe("mini");
    expect(root.activeElement).toBe(control(root, "Expand"));
    expect(
      root.querySelector('[data-mode-body="mini"] [data-metric="p95"] dd')?.textContent,
    ).toContain(p95?.replace("\u00a0ms", "") ?? "");
    await act(() => control(root, "Line view").click());
    expect(surface?.getAttribute("data-mode")).toBe("line");
    expect(root.activeElement).toBe(control(root, "Expand"));
    expect(root.querySelector('[data-mode-header="line"] [data-metric="fps"]')).not.toBeNull();
    await act(() => control(root, "Expand").click());
    expect(surface?.getAttribute("data-mode")).toBe("full");
    expect(cpu.getAttribute("aria-expanded")).toBe("false");
    expect(metric(root, "p95 frame")).toBe(p95);
  } finally {
    close();
  }
});

test("freezes an owned copy while host frames and recording state advance, then resumes the latest data", async () => {
  const { root, surface, panel, close } = setup();
  try {
    const original = liveFixture();
    panel.update(original);
    const p95 = metric(root, "p95 frame");
    await act(() => control(root, "Freeze").click());
    const chart = root
      .querySelector('[data-mode-body="full"] [data-chart="line"]')
      ?.getAttribute("d");
    const last = original.diagnostics.frames.at(-1);
    if (last) last.interval = 123;
    const next = liveFixture();
    next.diagnostics.frames = next.diagnostics.frames.map((frame) => ({
      ...frame,
      id: frame.id + 200,
      interval: 40,
      at: frame.at + 8000,
    }));
    next.diagnostics.recording = true;
    next.diagnostics.capture.mode = "manual";
    await act(() => panel.update(next));
    expect(metric(root, "p95 frame")).toBe(p95);
    expect(
      root.querySelector('[data-mode-body="full"] [data-chart="line"]')?.getAttribute("d"),
    ).toBe(chart);
    expect(surface?.getAttribute("data-frame")).toBe("1246");
    expect(
      root.querySelector('[aria-label="Display frozen; collection continues"]')?.textContent,
    ).toContain("+200 since");
    expect(root.querySelector('[data-mode-header="full"] [aria-label="Recording"]')).not.toBeNull();
    await act(() => control(root, "Line view").click());
    expect(root.querySelector('[data-mode-header="line"] [data-metric="% over"]')).toBeNull();
    expect(root.querySelector('[data-mode-header="line"] [data-metric="p95"]')).not.toBeNull();
    await act(() => control(root, "Expand").click());
    await act(() => control(root, "Resume").click());
    expect(root.activeElement).toBe(control(root, "Freeze"));
    expect(metric(root, "p95 frame")).toContain("40.0");
    expect(surface?.getAttribute("data-frame")).toBe("1446");
  } finally {
    close();
  }
});

test("rejudges frozen frames against new budgets and validates custom input without invoking the host", async () => {
  const { root, surface, changeBudget, close } = setup();
  try {
    await act(() => control(root, "Freeze").click());
    await selectBudget(root, "30");
    expect(changeBudget).toHaveBeenLastCalledWith(1000 / 30);
    expect(metric(root, "Over budget")).toBe("0%");
    expect(surface?.hasAttribute("data-frozen")).toBe(true);
    expect(surface?.getAttribute("data-frame")).toBe("1246");
    await selectBudget(root, "custom");
    const input = root.querySelector("input");
    if (!input) throw new Error("Missing custom budget");
    for (const value of ["", "0", "-3", "1001"]) {
      await act(() => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(() => control(root, "Apply").click());
      expect(root.querySelector('[role="alert"]')?.textContent).toContain("between 1 and 1000");
    }
    expect(changeBudget).toHaveBeenCalledTimes(1);
    await act(() => {
      input.value = "20";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => {
      input.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(changeBudget).toHaveBeenLastCalledWith(20);
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(metric(root, "Over budget")).toBe("1%");
  } finally {
    close();
  }
});

test("custom budgets close on Apply and Cancel, and reopen with the applied value", async () => {
  const { root, changeBudget, close } = setup();
  try {
    const select = root.querySelector("select");
    await selectBudget(root, "custom");
    const input = root.querySelector("input");
    if (!input) throw new Error("Missing custom budget");
    await act(() => {
      input.value = "20";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => control(root, "Apply").click());
    expect(changeBudget).toHaveBeenCalledExactlyOnceWith(20);
    expect(root.querySelector("input")).toBeNull();
    expect(select?.selectedOptions[0]?.textContent).toContain("20.0\u00a0ms · Custom");
    expect(root.activeElement).toBe(select);

    await selectBudget(root, "custom");
    const draft = root.querySelector("input");
    expect(draft?.value).toBe("20");
    if (!draft) throw new Error("Missing reopened budget");
    await act(() => {
      draft.value = "0";
      draft.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => control(root, "Apply").click());
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(root.querySelector("input")).toBe(draft);
    await act(() => control(root, "Cancel").click());
    expect(changeBudget).toHaveBeenCalledExactlyOnceWith(20);
    expect(root.querySelector("input")).toBeNull();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(select?.selectedOptions[0]?.textContent).toContain("20.0\u00a0ms · Custom");
    expect(root.activeElement).toBe(select);
    await selectBudget(root, "custom");
    expect(root.querySelector("input")?.value).toBe("20");
  } finally {
    close();
  }
});

test("shortcuts stay inside the panel, ignore form entry, and can freeze before the first sample", async () => {
  const { root, surface, panel, close } = setup();
  try {
    if (!surface) throw new Error("Missing surface");
    await act(() => key(document.body, "m"));
    expect(surface.getAttribute("data-mode")).toBe("full");
    await selectBudget(root, "custom");
    const input = root.querySelector("input");
    if (!input) throw new Error("Missing input");
    await act(() => key(input, "m"));
    expect(surface.getAttribute("data-mode")).toBe("full");
    await act(() => key(control(root, "Freeze"), "m"));
    expect(surface.getAttribute("data-mode")).toBe("mini");
    panel.update(liveFixture(true));
    await act(() => key(control(root, "Expand"), "f"));
    expect(surface.hasAttribute("data-frozen")).toBe(true);
    await act(() => panel.update(liveFixture()));
    expect(surface.getAttribute("data-frame")).toBe("unknown");
    await act(() => key(control(root, "Expand"), "f"));
    expect(surface.getAttribute("data-frame")).toBe("1246");
  } finally {
    close();
  }
});

test("budget changes reach the collector and refresh immediately; legacy sources remain read-only", async () => {
  const container = document.createElement("div");
  let source = liveFixture().diagnostics;
  const monitor = {
    snapshot: () => source,
    measureRefresh: <T,>(work: () => T) => work(),
    setTargetFps: vi.fn((fps: number) => {
      source = { ...source, budget: { frameMs: 1000 / fps } };
    }),
  };
  const panel = mountDiagnosticsPanel(container, monitor);
  try {
    panel.refresh(0);
    const root = container.firstElementChild?.shadowRoot;
    if (!root) throw new Error("Missing panel");
    await selectBudget(root, "120");
    expect(monitor.setTargetFps.mock.calls[0]?.[0]).toBeCloseTo(120);
    expect(metric(root, "Over budget")).toBe("100%");
    monitor.setTargetFps.mockImplementationOnce(() => {
      throw new Error("Host rejected budget");
    });
    await selectBudget(root, "60");
    expect(root.querySelector('[role="alert"]')?.textContent).toBe("Host rejected budget");
    expect(metric(root, "Over budget")).toBe("100%");
  } finally {
    panel.destroy();
  }
  const readonly = mountDiagnosticsPanel(container, {
    snapshot: () => source,
    measureRefresh: (work) => work(),
  });
  try {
    readonly.refresh(0);
    expect(
      container.firstElementChild?.shadowRoot?.querySelector('select[aria-label="Frame budget"]'),
    ).toBeNull();
  } finally {
    readonly.destroy();
  }
});
