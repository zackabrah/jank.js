// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { expect, test, vi } from "vitest";
import { createCaptureController } from "../capture/controller.ts";
import { captureFixture } from "../capture/fixtures.ts";
import { createComparisonController } from "../compare/controller.ts";
import { gpuFixture } from "../gpu/fixtures.ts";
import { gpuFrameToLive } from "../gpu/model.ts";
import { loadingFixture } from "../loading/fixtures.ts";
import { adaptGpu, mountDiagnosticsPanel } from "./diagnostics-adapter.ts";
import { liveFixture } from "./fixtures.ts";
import { mountLivePanel } from "./panel.tsx";

function gpuSample(id: number, labels: string[], computeIndex = -1) {
  const frame = gpuFixture(id);
  frame.invocations = labels.map((label, index) => ({
    id: String(index),
    label,
    kind: index === computeIndex ? "compute" : "render",
    state: "timed",
    milliseconds: index + 1,
    startMs: null,
    endMs: null,
    reason: null,
  }));
  return frame;
}

// A half-rate submission must leave its slot intact, even when the other pass IDs shift.
test("keeps intermittent GPU rows in place until their last sighting expires", async () => {
  const doc = document.implementation.createHTMLDocument("Host");
  const panel = mountLivePanel(doc.body);
  const now = vi.spyOn(performance, "now");
  const root = doc.body.firstElementChild?.shadowRoot;
  const passRows = () =>
    Array.from(
      root?.querySelectorAll('[title="A"], [title="B"], [title="C"]') ?? [],
      (node) => node.parentElement,
    );
  const press = async (label: string) => {
    const button = Array.from(root?.querySelectorAll("button") ?? []).find((node) =>
      node.textContent?.endsWith(label),
    );
    if (!button) throw new Error(`Missing ${label} button`);
    await act(() => button.click());
  };
  const update = (id: number, at: number, labels: string[]) => {
    now.mockReturnValue(at);
    panel.update({ ...liveFixture(true), gpu: gpuFrameToLive(gpuSample(id, labels), id) });
  };
  try {
    update(1, 16, ["A", "B", "C"]);
    const initial = passRows();
    expect(initial).toHaveLength(3);
    update(2, 32, ["A", "C"]);
    expect(passRows()[1]).toBe(initial[1]);
    expect(passRows()[2]).toBe(initial[2]);
    expect(passRows()[1]?.textContent).toContain("not in this frame");
    expect(passRows()[1]?.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(passRows()[2]?.lastElementChild?.textContent).toBe("2.0");
    update(3, 48, ["A", "B", "C"]);
    expect(passRows()[1]).toBe(initial[1]);
    expect(passRows()[1]?.textContent).not.toContain("not in this frame");
    update(4, 3047, ["C", "A"]);
    expect(passRows()[2]).toBe(initial[2]);
    await press("Freeze");
    update(5, 3048, ["C", "A"]);
    expect(passRows()[1]).toBe(initial[1]);
    await press("Resume");
    expect(passRows()).toHaveLength(2);
    expect(passRows()[0]).toBe(initial[0]);
    expect(passRows()[1]).toBe(initial[2]);
  } finally {
    panel.destroy();
    now.mockRestore();
  }
});

// Same-label passes match by kind and occurrence, and a new GPU epoch drops old rows.
test("keeps repeated GPU labels distinct and clears rows when the timing session restarts", () => {
  const doc = document.implementation.createHTMLDocument("Host");
  const panel = mountLivePanel(doc.body);
  const root = doc.body.firstElementChild?.shadowRoot;
  const bloomRows = () =>
    Array.from(root?.querySelectorAll('[title="Bloom"]') ?? [], (node) => node.parentElement);
  const update = (frame: ReturnType<typeof gpuSample>) =>
    panel.update({ ...liveFixture(true), gpu: gpuFrameToLive(frame, frame.frameId) });
  try {
    update(gpuSample(1, ["Bloom", "Bloom", "Bloom"], 2));
    const initial = bloomRows();
    expect(new Set(initial).size).toBe(3);

    const second = gpuSample(2, ["Bloom", "Bloom"], 0);
    second.inventory = "unknown";
    update(second);
    expect(bloomRows()[0]).toBe(initial[0]);
    expect(bloomRows()[1]).toBe(initial[1]);
    expect(bloomRows()[1]?.textContent).toContain("not listed");
    expect(bloomRows()[2]).toBe(initial[2]);
    expect(bloomRows()[2]?.lastElementChild?.textContent).toBe("1.0");

    const restarted = gpuSample(3, []);
    restarted.epoch = 1;
    update(restarted);
    expect(bloomRows()).toHaveLength(0);
  } finally {
    panel.destroy();
  }
});

test("keeps GPU completeness and busy time unknown when the legacy source cannot prove them", () => {
  const gpu = adaptGpu({
    status: "ready",
    sampleFrame: 4,
    sampleAgeFrames: 2,
    gpuMilliseconds: 8,
    passes: [{ label: "Pass", milliseconds: null }],
    droppedFrames: 0,
  });
  expect(gpu.completeness).toBe("unknown");
  expect(gpu.expected).toBeNull();
  expect(gpu.timed).toBeNull();
  expect(gpu.busy.status).toBe("unknown");
  expect(gpu.span).toEqual({ status: "measured", value: 8 });
  expect(gpu.passes[0]?.duration.status).toBe("unknown");
  const pending = adaptGpu({
    status: "pending",
    sampleFrame: 4,
    sampleAgeFrames: 3,
    gpuMilliseconds: 8,
    passes: [{ label: "Pass", milliseconds: 8 }],
    droppedFrames: 0,
  });
  expect(pending.span.status).toBe("unknown");
  expect(pending.passes[0]?.duration.status).toBe("pending");
});

test("fills only the excess above budget, with finite geometry for zero intervals", () => {
  const doc = document.implementation.createHTMLDocument("Host");
  const panel = mountLivePanel(doc.body);
  try {
    const source = liveFixture(true);
    source.diagnostics.budget.frameMs = 10;
    source.diagnostics.frames = [0, 10, 20].map((interval, id) => ({
      id,
      at: id * 20,
      interval,
      coverage: "complete",
      scopes: [],
      overhead: { collectionMs: 0, refreshMs: 0 },
    }));
    panel.update(source);
    const root = doc.body.firstElementChild?.shadowRoot;
    const excess = root?.querySelector('[data-chart="over"]')?.getAttribute("d");
    expect(excess?.match(/M/g)).toHaveLength(1);
    expect(excess).toContain(",48.00V0.00");
    expect(excess).toMatch(/V48.00Z$/);
    expect(root?.querySelector('[data-chart="line"]')?.getAttribute("d")).not.toMatch(
      /NaN|Infinity/,
    );
  } finally {
    panel.destroy();
  }
});

test("throttles synchronous host refreshes, retries failures and leaves host lifetime alone", () => {
  const doc = document.implementation.createHTMLDocument("Host");
  const monitor = {
    snapshot: vi.fn(() => liveFixture().diagnostics),
    measureRefresh: <T,>(work: () => T): T => work(),
    dispose: vi.fn(),
  };
  vi.spyOn(monitor, "measureRefresh");
  const panel = mountDiagnosticsPanel(doc.body, monitor);
  try {
    panel.refresh(0);
    panel.refresh(249);
    panel.refresh(250);
    expect(monitor.snapshot).toHaveBeenCalledTimes(2);
    expect(monitor.measureRefresh).toHaveBeenCalledTimes(2);
    monitor.snapshot.mockImplementationOnce(() => {
      throw new Error("Source failed");
    });
    expect(() => panel.refresh(500)).toThrow("Source failed");
    panel.refresh(500);
    panel.refresh(1);
    expect(monitor.snapshot).toHaveBeenCalledTimes(5);
    expect(() => panel.refresh(NaN)).toThrow(RangeError);
  } finally {
    panel.destroy();
    panel.destroy();
  }
  panel.refresh(1000);
  expect(monitor.dispose).not.toHaveBeenCalled();
  expect(doc.body.children).toHaveLength(0);
  expect(doc.head.querySelectorAll("[data-panel-properties]")).toHaveLength(0);
});

test("reads loading at the shared refresh cadence and preserves the display on reader failure", () => {
  const container = document.createElement("div");
  const loading = vi.fn(() => loadingFixture("ready"));
  const monitor = {
    snapshot: () => liveFixture().diagnostics,
    measureRefresh: <T,>(work: () => T) => work(),
  };
  const measureRefresh = vi.spyOn(monitor, "measureRefresh");
  const panel = mountDiagnosticsPanel(container, monitor, undefined, undefined, undefined, loading);
  try {
    panel.refresh(0);
    panel.refresh(249);
    expect(loading).toHaveBeenCalledOnce();
    const summary = () =>
      container.firstElementChild?.shadowRoot?.querySelector('[aria-label="Loading summary"]')
        ?.textContent;
    expect(summary()).toContain("296\u00a0ms");
    loading.mockImplementationOnce(() => {
      throw new Error("Loading reader failed");
    });
    expect(() => panel.refresh(250)).toThrow("Loading reader failed");
    expect(summary()).toContain("296\u00a0ms");
    panel.refresh(250);
    expect(loading).toHaveBeenCalledTimes(3);
    expect(measureRefresh).toHaveBeenCalledTimes(3);
    panel.destroy();
    panel.refresh(500);
    expect(loading).toHaveBeenCalledTimes(3);
  } finally {
    panel.destroy();
  }
});

test("preserves disclosures, clears stale values and rejects bad snapshots without replacing the view", async () => {
  const doc = document.implementation.createHTMLDocument("Host");
  const panel = mountLivePanel(doc.body);
  try {
    panel.update(liveFixture());
    const root = doc.body.firstElementChild?.shadowRoot;
    const cpu = root?.querySelector<HTMLButtonElement>("button[aria-expanded][aria-controls]");
    if (!root || !cpu) throw new Error("Missing CPU disclosure");
    await act(() => cpu.click());
    panel.update(liveFixture(false, true));
    expect(cpu.getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector('[data-state="not-observed"]')).not.toBeNull();
    const line = root.querySelector('[data-chart="line"]')?.getAttribute("d");
    expect(line).not.toMatch(/NaN|Infinity/);
    const invalid = liveFixture();
    invalid.diagnostics.budget.frameMs = 0;
    expect(() => panel.update(invalid)).toThrow(RangeError);
    expect(root.querySelector('[data-chart="line"]')?.getAttribute("d")).toBe(line);
    panel.update(liveFixture(true));
    expect(root.querySelector('[data-chart="line"]')?.getAttribute("d")).toBe("");
    expect(root.querySelector('[data-chart="over"]')?.getAttribute("d")).toBe("");
    expect(root.querySelector("section")?.textContent).toContain(
      "Connect a renderer timing source",
    );
  } finally {
    panel.destroy();
  }
});

test("rejects a comparison wired to a different recorder before mounting", () => {
  const capture = createCaptureController(captureFixture().source);
  const comparison = createComparisonController({
    capture,
    change: "workload",
    activate: () => {},
    restore: () => {},
    variants: {
      A: { label: "A", settings: { workload: "A" } },
      B: { label: "B", settings: { workload: "B" } },
    },
  });
  const container = document.createElement("div");
  expect(() => mountLivePanel(container, { comparison })).toThrow(/same capture controller/);
  expect(() =>
    mountLivePanel(container, {
      comparison,
      capture: { controller: createCaptureController(captureFixture().source), onOpen: () => {} },
    }),
  ).toThrow(/same capture controller/);
  expect(container.childElementCount).toBe(0);
  const panel = mountLivePanel(container, {
    comparison,
    capture: { controller: capture, onOpen: () => {} },
  });
  panel.destroy();
  comparison.destroy();
});
