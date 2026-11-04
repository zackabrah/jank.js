// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import { createDiagnostics } from "./core/diagnostics.ts";
import { createPerformancePanel } from "./panel-api.ts";
import type { GpuProfile } from "./types/gpu-profile-types.ts";

afterEach(() => {
  document.body.replaceChildren();
});

function frame(monitor: ReturnType<typeof createDiagnostics>, at: number) {
  monitor.beginFrame(at);
  monitor.endFrame(1, 1);
}

/** The Capture tab's switch for one instrumentation control. */
async function instrumentationSwitch(
  panel: ReturnType<typeof createPerformancePanel>,
  name: string,
) {
  panel.refresh(performance.now(), true);
  const root = document.body.lastElementChild?.firstElementChild?.shadowRoot;
  await act(() => {
    root?.querySelector<HTMLButtonElement>('[role="tab"][id$="-capture-tab"]')?.click();
  });
  return root?.querySelector<HTMLButtonElement>(
    `[role="switch"][aria-labelledby$="-${name}-label"]`,
  );
}

test("collects CPU scopes only while mounted, so the Live tab's rows have data", () => {
  const monitor = createDiagnostics();
  expect(monitor.detailed).toBe(false);
  const panel = createPerformancePanel({ shell: document.body, monitor });
  expect(monitor.detailed).toBe(true);
  panel.destroy();
  expect(monitor.detailed).toBe(false);
});

test("a frame() timestamp from before the monitor existed does not throw into the host's loop", () => {
  const monitor = createDiagnostics();
  const panel = createPerformancePanel({ shell: document.body, monitor });
  const at = performance.now();
  monitor.frame(at - 5, 16, 1, 1);
  expect(() => panel.refresh(at, true)).not.toThrow();
  panel.destroy();
});

test("floats over the page by default and leaves nothing behind when destroyed", () => {
  const monitor = createDiagnostics();
  const panel = createPerformancePanel({ shell: document.body, monitor });
  const host = document.body.lastElementChild as HTMLElement;
  expect(host.style.position).toBe("fixed");
  expect(host.style.top).toBe("20px");
  expect(host.style.right).toBe("20px");
  panel.refresh(performance.now(), true);
  const root = host.firstElementChild?.shadowRoot;
  expect(root?.querySelector('[aria-label="Live performance panel"]')).toBeTruthy();
  panel.destroy();
  panel.destroy();
  expect(document.body.children).toHaveLength(0);
  monitor.dispose();
});

test("honours a corner, renders inline on request and keeps the monitor running", () => {
  const monitor = createDiagnostics();
  const left = createPerformancePanel({ shell: document.body, monitor, corner: "bottom-left" });
  const host = document.body.lastElementChild as HTMLElement;
  expect(host.style.bottom).toBe("20px");
  expect(host.style.left).toBe("20px");
  left.destroy();
  const inline = createPerformancePanel({ shell: document.body, monitor, corner: "none" });
  expect((document.body.lastElementChild as HTMLElement).style.position).toBe("");
  inline.destroy();
  frame(monitor, 16);
  frame(monitor, 32);
  expect(monitor.snapshot().frames).toHaveLength(1);
  monitor.dispose();
});

test("advances a comparison from refresh and only offers Compare when one is supplied", () => {
  const monitor = createDiagnostics();
  const plain = createPerformancePanel({ shell: document.body, monitor });
  expect(plain.comparison).toBeUndefined();
  plain.destroy();
  const activate = vi.fn();
  const restore = vi.fn();
  const panel = createPerformancePanel({
    shell: document.body,
    monitor,
    comparison: {
      change: "objects",
      variants: {
        A: { label: "Few", settings: { objects: 1 } },
        B: { label: "Many", settings: { objects: 2 } },
      },
      activate,
      restore,
    },
  });
  // The collector's clock is performance.now(), so frames must be on it to be accepted.
  let at = performance.now();
  const step = () => {
    at += 16;
    frame(monitor, at);
    panel.refresh(at);
  };
  step();
  step();
  panel.comparison?.start({ warmupMs: 0, measureMs: 100, pairs: 1 });
  expect(activate).toHaveBeenCalledWith("A");
  expect(panel.comparison?.getSnapshot().phase).toBe("measure");
  for (let i = 0; i < 4; i++) step();
  expect(panel.comparison?.getSnapshot().elapsedMs).toBeGreaterThan(0);
  panel.destroy();
  expect(restore).toHaveBeenCalledOnce();
  monitor.dispose();
});

test("supplies the Trace events control without the host wiring it", async () => {
  const monitor = createDiagnostics();
  const setDevToolsEnabled = vi.spyOn(monitor, "setDevToolsEnabled");
  const panel = createPerformancePanel({ shell: document.body, monitor });
  const trace = await instrumentationSwitch(panel, "traceEvents");
  expect(trace).toBeDefined();
  await act(() => trace?.click());
  expect(setDevToolsEnabled).toHaveBeenCalledWith(true);
  panel.destroy();
  monitor.dispose();
});

test("accepts the source the renderer adapters return, and records its readings", async () => {
  const monitor = createDiagnostics();
  const observeGpu = vi.spyOn(monitor, "observeGpu");
  const profile = {
    status: "ready",
    sampleFrame: 1,
    sampleAgeFrames: 0,
    gpuMilliseconds: 4,
    passes: [{ label: "Scene", milliseconds: 4 }],
    droppedFrames: 0,
  } as unknown as GpuProfile;
  const setEnabled = vi.fn();
  const panel = createPerformancePanel({
    shell: document.body,
    monitor,
    gpu: { read: () => profile, setEnabled },
  });
  let at = performance.now();
  for (let i = 0; i < 3; i++) {
    at += 16;
    frame(monitor, at);
  }
  panel.refresh(at, true);
  expect(observeGpu).toHaveBeenCalledWith(profile);
  const timing = await instrumentationSwitch(panel, "gpuTiming");
  expect(timing).toBeDefined();
  await act(() => timing?.click());
  expect(setEnabled).toHaveBeenCalledWith(false);
  panel.destroy();
  monitor.dispose();
});
