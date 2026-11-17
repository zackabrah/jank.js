// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { expect, test, vi } from "vitest";
import { createCaptureController } from "../capture/controller.ts";
import { captureFixture } from "../capture/fixtures.ts";
import { mountLivePanel } from "../live/panel.tsx";
import { createComparisonController } from "./controller.ts";

function button(root: ShadowRoot, label: string) {
  const found = [...root.querySelectorAll("button")].find((node) =>
    (node.getAttribute("aria-label") ?? node.textContent).includes(label),
  );
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}

function setup(activate = () => {}) {
  const fixture = captureFixture(6000);
  const capture = createCaptureController(fixture.source);
  const comparison = createComparisonController({
    capture,
    activate,
    restore: () => {},
    change: "workload",
    variants: {
      A: { label: "Baseline", settings: { workload: "old" } },
      B: { label: "Candidate", settings: { workload: "new" } },
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const panel = mountLivePanel(container, {
    comparison,
    capture: { controller: capture, onOpen: () => {} },
  });
  const refresh = () => {
    capture.refresh(fixture.source.snapshot());
    panel.update({ diagnostics: fixture.source.snapshot(), gpu: null });
  };
  refresh();
  const root = container.firstElementChild?.shadowRoot;
  if (!root) throw new Error("Missing panel");
  return {
    ...fixture,
    root,
    capture,
    comparison,
    refresh,
    close() {
      comparison.destroy();
      panel.destroy();
      container.remove();
    },
  };
}

test("a stale blocked Run button cannot replace unexported trials when the host becomes idle", async () => {
  const f = setup();
  try {
    await act(() => button(f.root, "Compare").click());
    await act(() => f.comparison.start({ warmupMs: 0, measureMs: 100, pairs: 1 }));
    for (let i = 0; i < 10 && f.comparison.getSnapshot().phase !== "idle"; i++)
      await act(async () => {
        f.advance(1, 100);
        f.comparison.advance();
        await Promise.resolve();
      });
    const retained = f.comparison.getSnapshot().bundle;
    expect(retained.status).toBe("complete");
    expect(retained.trials).toHaveLength(2);
    await act(() => {
      f.source.startRecording();
      f.refresh();
    });
    const run = button(f.root, "Run again");
    expect(run.getAttribute("aria-disabled")).toBe("true");
    await act(() => {
      // Host state changes between display refreshes; the button still has its old handler.
      f.source.stopRecording();
      run.click();
    });
    expect(f.comparison.getSnapshot().bundle).toBe(retained);
    expect(f.comparison.getSnapshot().phase).toBe("idle");
    expect(f.root.activeElement).toBe(f.root.querySelector("[data-compare-reason]"));

    await act(f.refresh);
    await act(() => button(f.root, "Run again").click());
    expect(f.comparison.getSnapshot().bundle).toBe(retained);
    expect(f.root.querySelector("[data-replace-actions]")).not.toBeNull();
    await act(() => button(f.root, "Replace and run").click());
    expect(f.comparison.getSnapshot().phase).not.toBe("idle");
    expect(f.comparison.getSnapshot().bundle.trials).toHaveLength(0);
  } finally {
    f.close();
  }
});

test("a new immediate failure is visible even when the same message was dismissed", async () => {
  const activate = vi.fn(() => {
    throw new Error("Could not activate variant");
  });
  const f = setup(activate);
  const notice = () => f.root.querySelector('[data-panel-notice] [role="alert"]');
  try {
    await act(() => button(f.root, "Compare").click());
    await act(() => button(f.root, "Run comparison").click());
    expect(notice()?.textContent).toContain("Could not activate variant");
    await act(() => button(f.root, "Dismiss notice").click());
    expect(notice()).toBeNull();
    await act(() => button(f.root, "Run comparison").click());
    expect(activate).toHaveBeenCalledTimes(2);
    expect(notice()?.textContent).toContain("Could not activate variant");
  } finally {
    f.close();
  }
});
