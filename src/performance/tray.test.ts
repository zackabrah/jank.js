import { afterEach, describe, expect, it, vi } from "vitest";

import { createDiagnostics } from "../core/diagnostics.ts";

import type {
  TemporalDiagnostics,
  TemporalDebugView,
} from "../types/motion-types.ts";

import { createPreparationProfiler } from "../core/preparation.ts";

import { unknownEnvironment } from "../core/environment.ts";

import type {
  DiagnosticFrame,
  DiagnosticScope,
} from "../core/recording-types.ts";

import type { GpuProfile } from "../types/gpu-profile-types.ts";

import {
  GpuProfileHistory,
  copyCullingDiagnostics,
  copyTemporalDiagnostics,
  createPerformanceTray,
  frameStats,
  scopeAverages,
  temporalHistoryStatus,
  gpuTimingStatus,
  visibilityCullingStatus,
} from "./tray.ts";

import {
  axisStep,
  budgetLimit,
  count,
  counter,
  duration,
  observedTick,
  shorten,
  timerHonesty,
  words,
} from "./ui/format.ts";

function sample(frame: number, milliseconds = 4): GpuProfile {
  return {
    available: true,
    enabled: true,
    status: "ready",
    currentFrame: frame + 2,
    sampleFrame: frame,
    sampleAgeFrames: 2,
    gpuMilliseconds: milliseconds,
    passes: [{ label: "Water", milliseconds }],
    droppedFrames: 0,
    truncatedPasses: 0,
    error: null,
  };
}

function disabled(currentFrame: number | null): GpuProfile {
  return {
    ...sample(0),
    enabled: false,
    status: "disabled",
    currentFrame,
    sampleFrame: null,
    sampleAgeFrames: null,
    gpuMilliseconds: null,
    passes: [],
  };
}

describe("optional GPU performance view", () => {
  it("distinguishes unsupported, off, pending, ready and failed timing", () => {
    const profile = sample(2);

    expect(gpuTimingStatus(undefined)).toContain("waiting for the renderer");
    expect(gpuTimingStatus({ ...profile, status: "unsupported" })).toContain(
      "unsupported ·",
    );
    expect(gpuTimingStatus({ ...profile, status: "disabled" })).toContain(
      "off ·",
    );
    expect(gpuTimingStatus({ ...profile, status: "pending" })).toContain(
      "pending ·",
    );
    expect(gpuTimingStatus(profile)).toContain("ready ·");
    expect(
      gpuTimingStatus({
        ...profile,
        status: "error",
        error: "Readback failed",
      }),
    ).toBe("error · Readback failed");
  });

  it("records renderer frames once despite repeated refreshes and bounds recent samples", () => {
    const history = new GpuProfileHistory(2, 3);

    history.observe(sample(1), false);
    history.observe(sample(1), false);
    history.observe(sample(2), false);
    history.observe(sample(3), false);

    expect(history.export(sample(3))).toMatchObject({
      history: "recent",
      sampleCount: 2,
      sampleCapacity: 2,
      samples: [{ sampleFrame: 2 }, { sampleFrame: 3 }],
    });
  });

  it("exports a bounded recording with frame tags and an explicit discard count", () => {
    const history = new GpuProfileHistory(2, 3);

    history.start(disabled(0));

    for (let frame = 1; frame <= 5; frame++) {
      history.observe(sample(frame), true);
      history.observe(sample(frame), true);
    }

    history.observe(sample(6), false);

    expect(history.export(sample(6))).toMatchObject({
      history: "recording",
      sampleCapacity: 3,
      sampleCount: 3,
      discardedRecordedSamples: 2,
      samples: [{ sampleFrame: 3 }, { sampleFrame: 4 }, { sampleFrame: 5 }],
      latest: { sampleFrame: 6 },
    });
  });

  it("excludes pre-recording samples that complete late and resets the next recording", () => {
    const history = new GpuProfileHistory();

    history.observe(sample(10), false);

    // Sample 10 is two frames old, so renderer frames through 12 precede Record.
    history.start({ ...sample(10), currentFrame: null });
    history.observe(sample(11), true);
    history.observe(sample(12), true);

    expect(history.export(sample(12)).samples).toEqual([]);

    history.observe(sample(13), true);

    expect(
      history.export(sample(13)).samples.map((entry) => entry.sampleFrame),
    ).toEqual([13]);

    history.start(sample(13));
    history.observe(sample(16), true);

    expect(
      history.export(sample(16)).samples.map((entry) => entry.sampleFrame),
    ).toEqual([16]);
  });

  it("establishes a pending recording boundary before the first GPU readback", () => {
    const history = new GpuProfileHistory();

    history.start({ ...disabled(15), enabled: true, status: "pending" });
    history.observe(
      { ...sample(10), currentFrame: 16, sampleAgeFrames: 6 },
      true,
    );

    expect(history.export(undefined).samples).toEqual([]);

    history.observe(
      { ...sample(16), currentFrame: 17, sampleAgeFrames: 1 },
      true,
    );

    expect(
      history.export(undefined).samples.map((entry) => entry.sampleFrame),
    ).toEqual([16]);
  });

  it("keeps the Record boundary when profiling begins later and old completions arrive", () => {
    const history = new GpuProfileHistory();

    history.start(disabled(15));
    history.observe(
      { ...disabled(17), enabled: true, status: "pending" },
      true,
    );
    history.observe(
      { ...sample(14), currentFrame: 18, sampleAgeFrames: 4 },
      true,
    );

    expect(history.export(undefined).samples).toEqual([]);

    history.observe(
      { ...sample(16), currentFrame: 19, sampleAgeFrames: 3 },
      true,
    );

    expect(
      history.export(undefined).samples.map((entry) => entry.sampleFrame),
    ).toEqual([16]);
  });

  it("waits conservatively for a renderer frame when Record starts before the provider is available", () => {
    const unavailable: GpuProfile = {
      ...disabled(null),
      status: "error",
      error: "Provider unavailable",
    };

    for (const initial of [undefined, unavailable]) {
      const history = new GpuProfileHistory();

      history.start(initial);
      history.observe(unavailable, true);

      // The first known current frame is 16; its sample from frame 10 is older.
      history.observe(
        { ...sample(10), currentFrame: 16, sampleAgeFrames: 6 },
        true,
      );
      history.observe(sample(16), true);

      expect(history.export(undefined).samples).toEqual([]);

      history.observe(sample(17), true);

      expect(
        history.export(undefined).samples.map((entry) => entry.sampleFrame),
      ).toEqual([17]);
    }
  });

  it("copies provider and export values, preserving zero versus unavailable timings", () => {
    const history = new GpuProfileHistory();

    const zero = sample(1, 0);

    history.start(disabled(0));
    history.observe(zero, true);

    zero.gpuMilliseconds = 200;
    zero.passes = [{ label: "Changed", milliseconds: 200 }];

    const unavailable = {
      ...sample(2),
      gpuMilliseconds: null,
      truncatedPasses: 1,
      passes: [{ label: "Water", milliseconds: null }],
    };

    history.observe(unavailable, true);

    const exported = history.export(unavailable);

    expect(exported.samples[0]).toMatchObject({
      gpuMilliseconds: 0,
      passes: [{ label: "Water", milliseconds: 0 }],
    });
    expect(exported.samples[1]).toMatchObject({
      gpuMilliseconds: null,
      passes: [{ label: "Water", milliseconds: null }],
    });

    exported.samples[0]!.gpuMilliseconds = 999;

    expect(history.export(unavailable).samples[0]?.gpuMilliseconds).toBe(0);
  });

  it("ignores pending or failed results and clears without reviving an old sample", () => {
    const history = new GpuProfileHistory();

    history.start(disabled(0));
    history.observe({ ...sample(1), status: "pending" }, true);
    history.observe({ ...sample(1), status: "error" }, true);
    history.observe(sample(2), true);
    history.clear(sample(2));
    history.observe(sample(2), false);

    expect(history.export(sample(2)).samples).toEqual([]);

    history.observe(sample(3), false);

    expect(history.export(sample(3))).toMatchObject({
      history: "recent",
      samples: [{ sampleFrame: 3 }],
    });
  });
});

describe("optional visibility performance view", () => {
  it("distinguishes missing diagnostics from enabled and disabled culling", () => {
    const profile = {
      enabled: true,
      debugBounds: false,
      main: { tested: 3, visible: 2, culled: 1 },
      shadow: { tested: 0, visible: 0, culled: 0 },
      reflection: { tested: 0, visible: 0, culled: 0 },
      bounds: [],
      boundsOmitted: 0,
      viewProjection: null,
    };

    expect(visibilityCullingStatus(undefined)).toBe("waiting for the renderer");
    expect(visibilityCullingStatus(profile)).toContain("on ·");
    expect(visibilityCullingStatus({ ...profile, enabled: false })).toContain(
      "off ·",
    );
  });

  it("copies counters, bounds and projection for a stable frozen/exported view", () => {
    const profile = {
      enabled: true,
      debugBounds: true,
      main: { tested: 3, visible: 2, culled: 1 },
      shadow: { tested: 0, visible: 0, culled: 0 },
      reflection: { tested: 0, visible: 0, culled: 0 },
      bounds: [
        {
          label: "Reed batch",
          min: [1, 2, 3] as [number, number, number],
          max: [4, 5, 6] as [number, number, number],
          culled: false,
        },
      ],
      boundsOmitted: 2,
      viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    };

    const copy = copyCullingDiagnostics(profile);

    profile.main.culled = 3;
    profile.shadow.tested = 8;
    profile.reflection.visible = 7;
    profile.bounds[0]!.label = "Changed";
    profile.bounds[0]!.min[0] = 10;
    profile.bounds[0]!.max[2] = 99;
    profile.viewProjection[0] = 22;

    expect(copy).toMatchObject({
      main: { tested: 3, visible: 2, culled: 1 },
      shadow: { tested: 0, visible: 0, culled: 0 },
      reflection: { tested: 0, visible: 0, culled: 0 },
      bounds: [{ label: "Reed batch", min: [1, 2, 3], max: [4, 5, 6] }],
      boundsOmitted: 2,
    });
    expect(copy.viewProjection?.[0]).toBe(1);
    expect(
      copyCullingDiagnostics({ ...profile, viewProjection: null })
        .viewProjection,
    ).toBeNull();
  });
});

/** Minimal host DOM: exercise actual tray listeners without adding a browser runtime. */
class TrayElement {
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly selectors = new Map<string, TrayElement>();
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  readonly classList = {
    add: vi.fn<(name: string) => void>(),
    remove: vi.fn<(name: string) => void>(),
  };
  readonly style: Record<string, string> = {};
  innerHTML = "";
  textContent = "";
  value = "";
  hidden = false;
  disabled = false;
  href = "";
  download = "";
  removed = false;
  child: TrayElement | undefined;
  children: TrayElement[] = [];
  get valueAsNumber() {
    return this.value === "" ? Number.NaN : Number(this.value);
  }
  replaceChildren(...children: TrayElement[]) {
    this.children = children;
  }
  append(value: TrayElement) {
    this.child = value;
    this.children.push(value);
  }
  querySelector(selector: string) {
    let result = this.selectors.get(selector);

    if (!result) {
      result = new TrayElement();

      this.selectors.set(selector, result);
    }

    return result;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  getContext() {
    return null;
  }
  focus() {}
  select() {}
  remove() {
    this.removed = true;
  }
  addEventListener(
    name: string,
    listener: (event: Event) => void,
    options?: AddEventListenerOptions,
  ) {
    let listeners = this.listeners.get(name);

    if (!listeners) {
      listeners = new Set();

      this.listeners.set(name, listeners);
    }

    listeners.add(listener);

    options?.signal?.addEventListener(
      "abort",
      () => listeners.delete(listener),
      { once: true },
    );
  }
  trigger(name: string, init: Record<string, unknown> = {}) {
    for (const listener of this.listeners.get(name) ?? [])
      listener(Object.assign(new Event(name), init));
  }
  click() {
    this.trigger("click");
  }
}

function trayDom() {
  // Event-triggered refreshes use the same synthetic epoch as refresh(0/1000).
  vi.spyOn(performance, "now").mockReturnValue(0);

  for (const name of [
    "HTMLButtonElement",
    "HTMLDivElement",
    "HTMLElement",
    "HTMLSpanElement",
    "HTMLCanvasElement",
    "HTMLParagraphElement",
    "HTMLPreElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "HTMLTableSectionElement",
    "HTMLTableRowElement",
  ])
    vi.stubGlobal(name, TrayElement);

  vi.stubGlobal("document", { createElement: () => new TrayElement() });

  const values = new Map<string, string>();

  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  });

  const shell = new TrayElement();

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This fixture supplies only the tray's borrowed DOM surface.
  const host = shell as unknown as HTMLElement;

  return { shell, host, stored: values };
}

const text = (root: TrayElement, key: string) =>
  root.querySelector(`[data-k="${key}"]`).textContent;

function diagnosticFrame(
  id: number,
  at: number,
  interval: number,
  scopes: DiagnosticScope[] = [],
  coverage: DiagnosticFrame["coverage"] = "complete",
): DiagnosticFrame {
  return {
    id,
    at,
    interval,
    update: 0,
    render: 0,
    scopes,
    coverage,
    droppedScopes: 0,
    overhead: { collectionMs: 0, refreshMs: 0 },
  };
}

const temporalProfile = (): TemporalDiagnostics => ({
  objectMotion: true,
  debugView: "none",
  eligibleBatches: 7,
  rigidBatches: 5,
  rejectedBatches: 2,
});

afterEach(() => vi.unstubAllGlobals());

describe("readout rules", () => {
  it("reads the tiles from the history with the core's p95 and a timer-aware budget", () => {
    let at = 0;

    const frames = Array.from({ length: 70 }, (_, i) => {
      const steady = i % 2 ? 16.7 : 16.8;

      const interval = i === 40 ? 40 : steady;

      at += interval;

      return diagnosticFrame(i + 1, at, interval);
    });

    const stats = frameStats(frames, 1000 / 60, 0.1)!;

    expect(stats).toMatchObject({ worst: 40, worstFrame: 41, missed: 1 });
    expect(stats.limitMs).toBeCloseTo(1000 / 60 + 0.2);
    expect(stats.fps).toBe(
      frames.filter((entry) => entry.at > at - 1000).length,
    );
    expect(stats.p95).toBe(16.8);

    // Under a second of history, the panel says nothing about frames per second.
    expect(frameStats(frames.slice(0, 20), 1000 / 60, 0.1)?.fps).toBeNull();
    expect(frameStats([], 1000 / 60, 0.1)).toBeNull();

    // With no core estimate the tick is the smallest step between distinct intervals.
    expect(frameStats(frames, 1000 / 60, null)?.limitMs).toBeCloseTo(
      1000 / 60 + 0.2,
    );

    // Without a timer estimate the budget is the line itself.
    expect(budgetLimit(16, null)).toBe(16);
  });

  it("averages exact scopes per frame, counting nested scopes once and skipping unscoped frames", () => {
    const averages = scopeAverages([
      diagnosticFrame(1, 10, 10, [
        { system: "physics", label: "physics", start: 0, end: 4 },
        { system: "physics", label: "physics", start: 1, end: 2 },
        { system: "render", label: "render submit", start: 5, end: 7 },
      ]),
      diagnosticFrame(2, 20, 10, [], "unavailable"),
    ]);

    expect(averages.measured).toBe(1);
    expect(averages.systems.get("physics")?.ms).toBe(4);
    expect(averages.systems.get("render")).toEqual({
      label: "render submit",
      ms: 2,
    });
    expect(averages.unattributed).toBe(4);

    // A cache keyed by frame ID gives the same answer and drops frames that left the view.
    const cache = new Map();

    const frames = Array.from({ length: 6 }, (_, i) =>
      diagnosticFrame(i + 1, (i + 1) * 10, 10, [
        { system: "physics", label: "physics", start: i * 10, end: i * 10 + 3 },
      ]),
    );

    expect(scopeAverages(frames, cache).systems.get("physics")?.ms).toBe(3);
    expect(cache.size).toBe(6);
    expect(scopeAverages(frames.slice(4), cache).unattributed).toBe(7);
    expect([...cache.keys()]).toEqual([5, 6]);
  });

  it("formats readouts without rounding values away or splitting words", () => {
    expect(count(2388)).toBe("2,388");
    expect(counter(1_920_000)).toBe("1.92M");
    expect(counter(null)).toBe("unknown");
    expect(counter(0.125)).toBe("0.13");
    expect(words("drawCalls")).toBe("draw calls");
    expect(words("cache_hits")).toBe("cache hits");
    expect(duration(0.1)).toBe("100 µs");
    expect(shorten("load chunk 14", 10)).toBe("load chunk");
    expect(shorten("checkpoint", 4)).toBe("");
    expect(observedTick([16.6, 16.600000001, 16.7, 16.8])).toBeCloseTo(0.1);
    expect(observedTick([16, 40])).toBe(1);
    expect(observedTick([16])).toBeNull();
    expect(axisStep(6.1)).toBe(2.5);
    expect(axisStep(609)).toBe(250);
    expect(
      timerHonesty({
        ...unknownEnvironment(),
        crossOriginIsolated: false,
        cpuTimer: {
          source: "performance.now",
          estimatedResolutionMs: 0.1,
          method: "minimum-observed-positive-delta",
          reads: 256,
        },
      }),
    ).toEqual({
      cpu: "not isolated · cpu timer ~100 µs est.",
      gpu: "gpu timer unknown",
    });
  });
});

describe("panel sizes", () => {
  it("grows and shrinks one step at a time and remembers only sizes the user picks", () => {
    const { shell, host, stored } = trayDom();

    const monitor = createDiagnostics();

    const expanded = vi.spyOn(monitor, "setExpanded");

    let tray = createPerformanceTray({ shell: host, monitor, mode: "mini" });

    const root = shell.child!;

    expect(root.dataset["mode"]).toBe("mini");
    expect(root.dataset["corner"]).toBe("top-right");
    expect(stored.size).toBe(0);

    root.querySelector('[data-action="mini-shrink"]').click();

    expect(root.dataset["mode"]).toBe("line");
    expect(expanded).toHaveBeenLastCalledWith(false);

    root.querySelector('[data-action="line-grow"]').click();

    expect(root.dataset["mode"]).toBe("full");
    expect(expanded).toHaveBeenLastCalledWith(true);

    root.querySelector('[data-action="full-shrink"]').click();

    expect(root.dataset["mode"]).toBe("mini");

    tray.dispose();

    tray = createPerformanceTray({
      shell: host,
      monitor,
      mode: "full",
      corner: "bottom-left",
    });

    expect(shell.child!.dataset["mode"]).toBe("mini");
    expect(shell.child!.dataset["corner"]).toBe("bottom-left");

    tray.dispose();

    monitor.dispose();
  });

  it("reads a summary aloud only when asked", () => {
    const { shell, host } = trayDom();

    let time = 0;

    const monitor = createDiagnostics({ now: () => time });

    const tray = createPerformanceTray({ shell: host, monitor, mode: "full" });

    const root = shell.child!;

    for (let i = 0; i < 80; i++) monitor.beginFrame((time += 16));

    tray.refresh(1000);

    expect(text(root, "summary")).toBe("");

    root.querySelector('[data-action="summary"]').click();

    expect(text(root, "summary")).toContain("63 fps, 16.0 ms average");
    expect(text(root, "fps")).toBe("63");
    expect(text(root, "honest-cpu")).toBe(
      "isolation unknown · cpu timer unknown",
    );

    tray.dispose();

    monitor.dispose();
  });
});

describe("budget and capture controls", () => {
  it("sets the budget from presets or a typed target and refuses values outside 1 to 1000", () => {
    const { shell, host } = trayDom();

    const monitor = createDiagnostics();

    const tray = createPerformanceTray({ shell: host, monitor, mode: "full" });

    const root = shell.child!;

    root.querySelector('[data-fps="30"]').click();

    expect(monitor.snapshot().budget.targetFps).toBe(30);
    expect(text(root, "budget")).toBe("33.3");

    const input = root.querySelector('input[aria-label="Target FPS"]');

    root.querySelector('[data-action="custom-fps"]').click();

    expect(input.value).toBe("30");

    input.value = "2000";
    input.trigger("keydown", { key: "Enter" });

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(monitor.snapshot().budget.targetFps).toBe(30);

    input.value = "45";
    input.trigger("keydown", { key: "Enter" });

    expect(monitor.snapshot().budget.targetFps).toBe(45);
    expect(input.hidden).toBe(true);

    tray.dispose();

    monitor.dispose();
  });

  it("edits the capture window in place: Enter commits, Escape reverts, invalid stays open", () => {
    const { shell, host } = trayDom();

    const monitor = createDiagnostics();

    const tray = createPerformanceTray({
      shell: host,
      monitor,
      capture: { beforeFrames: 2, afterFrames: 2, cooldownMs: 0 },
    });

    const root = shell.child!;

    root.querySelector('[data-action="auto"]').click();

    expect(monitor.snapshot().capture).toMatchObject({
      state: "armed",
      beforeFrames: 2,
    });

    const threshold = root.querySelector('[data-input="threshold"]');

    root.querySelector('[data-edit="threshold"]').click();

    expect(threshold.value).toBe("33.33");

    threshold.value = "50";
    threshold.trigger("keydown", { key: "Enter" });

    expect(monitor.snapshot().capture.thresholdMs).toBe(50);

    const before = root.querySelector('[data-input="before"]');

    root.querySelector('[data-edit="before"]').click();

    before.value = "700";
    before.trigger("keydown", { key: "Enter" });

    expect(before.getAttribute("aria-invalid")).toBe("true");

    before.trigger("keydown", { key: "Escape" });

    expect(before.hidden).toBe(true);
    expect(monitor.snapshot().capture.beforeFrames).toBe(2);

    root.querySelector('[data-action="auto"]').click();

    expect(monitor.snapshot().capture.state).toBe("idle");

    tray.dispose();

    monitor.dispose();
  });

  it("keeps each completed automatic capture with the event nearest its trigger", () => {
    const { shell, host } = trayDom();

    let time = 0;

    const monitor = createDiagnostics({ now: () => time });

    const tray = createPerformanceTray({
      shell: host,
      monitor,
      mode: "full",
      capture: {
        thresholdMs: 30,
        beforeFrames: 2,
        afterFrames: 2,
        cooldownMs: 0,
      },
    });

    const root = shell.child!;

    root.querySelector('[data-tab="capture"]').click();
    root.querySelector('[data-action="auto"]').click();

    const step = (ms: number) => {
      monitor.beginFrame((time += ms));

      tray.refresh(time);
    };

    for (let i = 0; i < 5; i++) step(16);

    monitor.event("spawn ×184");

    step(40);

    for (let i = 0; i < 4; i++) step(16);

    tray.refresh(time + 1000);

    expect(text(root, "captured-meta")).toMatch(/^1 \/ 10 · \d+\.\d MB$/);

    const rows = root.querySelector('[data-k="captures"]').children;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector(".jank-near").textContent).toBe("spawn ×184");
    expect(rows[0]!.querySelector(".jank-ms").textContent).toBe("40.0 ms");
    expect(rows[0]!.querySelector(".jank-ms").dataset["tone"]).toBe("miss");

    tray.dispose();

    monitor.dispose();
  });

  it("reports its own cost and lowers its redraw rate when refresh gets expensive", () => {
    const { shell, host } = trayDom();

    let time = 0;

    const monitor = createDiagnostics({ now: () => time });

    const tray = createPerformanceTray({ shell: host, monitor, mode: "full" });

    const root = shell.child!;

    for (let i = 0; i < 10; i++) {
      monitor.beginFrame((time += 16));
      monitor.recordOverhead("refresh", 1);
    }

    tray.refresh(1000);

    expect(text(root, "oh-refresh")).toBe("1.00");
    expect(text(root, "oh-note")).toContain("redraw lowered to 4 per s");

    tray.dispose();

    monitor.dispose();
  });
});

describe("optional temporal performance view", () => {
  it("distinguishes missing, rigid and camera-only history and copies diagnostic snapshots", () => {
    const profile = temporalProfile();

    expect(temporalHistoryStatus(undefined)).toContain("waiting");
    expect(temporalHistoryStatus(profile)).toContain("previous transforms");
    expect(
      temporalHistoryStatus({ ...profile, objectMotion: false }),
    ).toContain("camera motion only");

    const copy = copyTemporalDiagnostics(profile);

    Object.assign(profile, { rigidBatches: 99, debugView: "motion" });

    expect(copy).toEqual(temporalProfile());
  });

  it("retains typed defaults before initialization, validates selections and releases controls on disposal", () => {
    const { shell, host } = trayDom();

    const source = {
      read: vi.fn<() => TemporalDiagnostics | undefined>(() => undefined),
      setEnabled: vi.fn<(enabled: boolean) => void>(),
      setDebugView: vi.fn<(view: TemporalDebugView) => void>(),
    };

    const tray = createPerformanceTray({
      shell: host,
      monitor: createDiagnostics(),
      temporal: source,
      mode: "full",
    });

    const root = shell.child!;

    const toggle = root.querySelector('[data-action="temporal"]');

    const debug = root.querySelector(
      'select[aria-label="Temporal debug view"]',
    );

    tray.refresh(0);

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(debug.value).toBe("none");
    expect(root.innerHTML).toContain('value="motion">motion vectors');
    expect(root.innerHTML).toContain('value="history">history validity');

    toggle.click();

    debug.value = "motion";
    debug.trigger("change");

    expect(source.setEnabled).toHaveBeenCalledExactlyOnceWith(false);
    expect(source.setDebugView).toHaveBeenCalledExactlyOnceWith("motion");

    debug.value = "invalid";
    debug.trigger("change");

    expect(source.setDebugView).toHaveBeenCalledTimes(1);

    source.read.mockImplementation(() => {
      throw new Error("renderer preparing");
    });

    tray.refresh(1000);

    expect(debug.value).toBe("motion");
    expect(text(root, "temporal-status")).toContain("waiting");

    tray.dispose();

    toggle.click();

    debug.value = "history";
    debug.trigger("change");

    expect(source.setEnabled).toHaveBeenCalledTimes(1);
    expect(source.setDebugView).toHaveBeenCalledTimes(1);
    expect(root.removed).toBe(true);
  });

  it("freezes copied counters while controls follow live renderer state and exports current diagnostics", async () => {
    const { shell, host } = trayDom();

    let profile = temporalProfile();

    const tray = createPerformanceTray({
      shell: host,
      monitor: createDiagnostics(),
      mode: "full",
      temporal: {
        read: () => profile,
        setEnabled: (enabled) => {
          profile = { ...profile, objectMotion: enabled };
        },
        setDebugView: (debugView) => {
          profile = { ...profile, debugView };
        },
      },
    });

    const root = shell.child!;

    tray.refresh(0);

    root.querySelector('[data-action="freeze"]').click();

    profile = {
      ...profile,
      objectMotion: false,
      debugView: "history",
      rigidBatches: 3,
      rejectedBatches: 4,
    };

    tray.refresh(1000);

    expect(text(root, "temporal-counts")).toContain("rigid history 5");
    expect(text(root, "state")).toBe("FROZEN");
    expect(
      root
        .querySelector('[data-action="temporal"]')
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      root.querySelector('select[aria-label="Temporal debug view"]').value,
    ).toBe("history");

    let exported: Blob | undefined;

    vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
      if (!(value instanceof Blob))
        throw new Error("Expected exported diagnostics");

      exported = value;

      return "blob:temporal-test";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    root.querySelector('[data-action="export"]').click();

    expect(JSON.parse(await exported!.text())).toMatchObject({
      temporal: {
        objectMotion: false,
        debugView: "history",
        latest: { rigidBatches: 3, rejectedBatches: 4 },
      },
    });

    root.querySelector('[data-action="freeze"]').click();

    expect(text(root, "temporal-counts")).toContain("rigid history 3");

    tray.dispose();
  });

  it("keeps the temporal section hidden when the host provides no temporal controls", () => {
    const { shell, host } = trayDom();

    const tray = createPerformanceTray({
      shell: host,
      monitor: createDiagnostics(),
    });

    expect(shell.child!.innerHTML).toContain(
      'class="jank-sec jank-temporal" hidden',
    );

    tray.dispose();
  });
});

describe("loading preparation view", () => {
  it("shows elapsed scopes and retains the frozen comparison while the next load finishes", () => {
    const { shell, host } = trayDom();

    let time = 0;

    const profile = createPreparationProfiler({ now: () => time });

    profile.start({ label: "Island startup", kind: "fresh-context" });

    const end = profile.begin("fetch");

    time = 20;

    end();

    profile.finish("ready");

    const tray = createPerformanceTray({
      shell: host,
      monitor: createDiagnostics(),
      preparation: {
        read: () => profile.snapshot(),
        history: () => profile.history(),
      },
    });

    const root = shell.child!;

    root.querySelector('[data-action="line-grow"]').click();
    root.querySelector('[data-tab="loading"]').click();

    tray.refresh(0);

    expect(text(root, "total")).toBe("20.0");
    expect(text(root, "unit")).toBe("MS");
    expect(text(root, "loading-status")).toContain("Island startup");

    root.querySelector('[data-action="freeze"]').click();

    profile.start({ label: "Island restart", kind: "repeat-session" });

    time = 25;

    profile.finish("ready");

    tray.refresh(1000);

    expect(text(root, "loading-status")).toContain("Island startup");

    root.querySelector('[data-action="freeze"]').click();

    tray.refresh(2000);

    expect(text(root, "total")).toBe("5.0");
    expect(text(root, "cold")).toBe("20.0");

    const sessions = root.querySelector('[data-k="sessions"]').children;

    expect(
      sessions.map((row) => row.querySelector(".jank-k").textContent),
    ).toEqual(["#1 cold", "#2 now"]);
    expect(text(root, "loading-status")).toContain("stages overlap");

    tray.dispose();
  });
});

it("rejects duplicate mounts and makes disposal and late refresh harmless", () => {
  const { shell, host } = trayDom();

  const monitor = createDiagnostics();

  const read = vi.fn<() => GpuProfile>(() => sample(1));

  const tray = createPerformanceTray({
    shell: host,
    monitor,
    gpu: { read, setEnabled: () => {} },
  });

  expect(() => createPerformanceTray({ shell: host, monitor })).toThrow(
    "already mounted",
  );

  tray.refresh(0);

  const calls = read.mock.calls.length;

  tray.dispose();
  tray.dispose();
  tray.refresh(1000);

  expect(read).toHaveBeenCalledTimes(calls);
  expect(shell.child!.removed).toBe(true);

  const replacement = createPerformanceTray({ shell: host, monitor });

  replacement.refresh(2000);
  replacement.dispose();

  monitor.dispose();
});
