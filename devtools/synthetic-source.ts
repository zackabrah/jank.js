import { type GpuFrame, gpuFrameToLive } from "../src/gpu/model.ts";
import { type LiveSnapshot, validateSelectedBudget } from "../src/live/model.ts";
import type { DiagnosticEvent } from "../src/recording/types.ts";

type Phase = "Smooth" | "CPU spike" | "CPU burst" | "GPU burst" | "Recovery";

/** Deterministic reference data, never connected to a real collector or GPU. */
export function createSyntheticSource() {
  let at = 0;
  let elapsed = 0;
  let credit = 0;
  let id = 0;
  let budget = 1000 / 60;
  let phase: Phase = "Smooth";
  let override: { phase: Phase; until: number } | null = null;
  let spike = false;
  const frames: LiveSnapshot["diagnostics"]["frames"][number][] = [];
  const gpu: GpuFrame[] = [];
  const events: DiagnosticEvent[] = [];

  function nextPhase(): Phase {
    if (spike) return "CPU spike";
    if (override && elapsed < override.until) return override.phase;
    const cycle = elapsed % 16000;
    if (cycle < 3000) return "Smooth";
    if (cycle < 3080) return "CPU spike";
    if (cycle >= 6000 && cycle < 8000) return "GPU burst";
    if (cycle >= 11000 && cycle < 13000) return "CPU burst";
    return "Recovery";
  }

  function sample(next: Phase) {
    const wave = (Math.sin(id * 0.17) + 1) / 2;
    const interval =
      next === "CPU spike"
        ? 80
        : next === "CPU burst"
          ? 36 + wave * 5
          : next === "GPU burst"
            ? 32 + wave * 6
            : 16.4 + wave * 0.5;
    return { interval, wave };
  }

  function append(next: Phase, interval: number, wave: number) {
    if (next !== phase) {
      events.push({ at, label: next, detail: "Simulated phase change; no real workload." });
      if (events.length > 200) events.shift();
    }
    phase = next;
    const simulation = next === "CPU spike" ? 70 : next === "CPU burst" ? 24 + wave * 5 : 2 + wave;
    const submission = next === "GPU burst" ? 5 : 1.5 + wave;
    const from = at;
    at += interval;
    frames.push({
      id,
      at,
      interval,
      coverage: "complete",
      scopes: [
        {
          system: "simulation",
          label: "Simulation",
          start: from + 0.1,
          end: from + 0.1 + simulation,
        },
        {
          system: "render",
          label: "Render submission",
          start: from + 0.2 + simulation,
          end: from + 0.2 + simulation + submission,
        },
      ],
      overhead: { collectionMs: 0.02, refreshMs: id % 15 === 0 ? 0.3 : 0 },
    });
    if (frames.length > 180) frames.shift();
    let gpuAt = 0;
    gpu.push({
      frameId: id,
      source: "host",
      clock: "gpu",
      epoch: 0,
      resolutionMs: null,
      inventory: "complete",
      omitted: 0,
      invocations: (
        [
          ["scene", "Scene rendering", "render", next === "GPU burst" ? 20 + wave * 3 : 2.5 + wave],
          ["compute", "Particles compute", "compute", next === "GPU burst" ? 7 : 0.8 + wave * 0.4],
          ["post", "Post processing", "render", next === "GPU burst" ? 2 : 0.5],
        ] as const
      ).map(([passId, label, kind, milliseconds]) => {
        const startMs = gpuAt;
        gpuAt += milliseconds;
        return {
          id: passId,
          label,
          kind,
          milliseconds,
          startMs,
          endMs: gpuAt,
          state: "timed",
          reason: null,
        };
      }),
    });
    if (gpu.length > 3) gpu.shift();
    id++;
  }

  // Populate a useful starting window without waiting three seconds for the demo to warm up.
  for (let index = 0; index < 180; index++) {
    const { interval, wave } = sample("Smooth");
    append("Smooth", interval, wave);
  }

  function snapshot(): LiveSnapshot {
    const evidence = gpu[0];
    return {
      diagnostics: {
        frames: [...frames],
        events: [...events],
        budget: { frameMs: budget },
        recording: false,
        capture: { mode: "recent", state: "idle" },
        systems: [
          {
            id: "simulation",
            label: "Simulation",
            values: { entities: phase === "CPU burst" ? 4096 : 256, phase },
          },
          {
            id: "render",
            label: "Render submission",
            values: { drawCalls: phase === "GPU burst" ? 900 : 128 },
          },
        ],
      },
      gpu: evidence ? gpuFrameToLive(evidence, id - 1) : null,
    };
  }

  return {
    snapshot,
    get phase() {
      return phase;
    },
    advance(milliseconds: number) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 1000)
        throw new RangeError("Demo advances must be between 0 and 1000 ms.");
      credit += milliseconds;
      for (;;) {
        const next = nextPhase();
        const { interval, wave } = sample(next);
        if (interval > credit) break;
        append(next, interval, wave);
        credit -= interval;
        elapsed += interval;
        if (spike) spike = false;
      }
      return snapshot();
    },
    inject(kind: "CPU spike" | "CPU burst" | "GPU burst") {
      if (kind === "CPU spike") spike = true;
      else override = { phase: kind, until: elapsed + 2000 };
    },
    setBudget(milliseconds: number) {
      validateSelectedBudget(milliseconds);
      budget = milliseconds;
    },
  };
}
