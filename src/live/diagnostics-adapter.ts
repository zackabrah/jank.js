import type { CaptureConnection } from "../capture/controller.ts";
import type { ReadInstrumentation } from "../capture/instrumentation-model.ts";
import type { ComparisonController } from "../compare/controller.ts";
import type { LoadingSnapshot } from "../loading/model.ts";
import type { DiagnosticsSnapshot, LiveGpu } from "./model.ts";
import { measured, unknown } from "./model.ts";
import { mountLivePanel } from "./panel.tsx";

export interface DiagnosticsSource {
  snapshot(includeSystems?: boolean): DiagnosticsSnapshot;
  measureRefresh<T>(work: () => T): T;
  setTargetFps?(fps: number): void;
}

/** Matches jank.js GpuProfile without importing its implementation. */
export interface LegacyGpuProfile {
  status: LiveGpu["status"];
  sampleFrame: number | null;
  sampleAgeFrames: number | null;
  gpuMilliseconds: number | null;
  passes: readonly { label: string; milliseconds: number | null }[];
  droppedFrames: number;
}

export function adaptGpu(profile: LegacyGpuProfile): LiveGpu {
  return {
    status: profile.status,
    completeness: "unknown",
    expected: null,
    timed: null,
    sampleFrame: profile.sampleFrame,
    ageFrames: profile.sampleAgeFrames,
    dropped: profile.droppedFrames,
    timedWork:
      profile.status === "ready" && profile.passes.some((pass) => pass.milliseconds !== null)
        ? measured(profile.passes.reduce((sum, pass) => sum + (pass.milliseconds ?? 0), 0))
        : unknown("No valid GPU pass durations supplied"),
    busy: unknown("This source supplies a first-to-last span, not GPU busy time"),
    span:
      profile.status === "ready" && profile.gpuMilliseconds !== null
        ? measured(profile.gpuMilliseconds)
        : unknown("No current GPU span supplied"),
    passes: profile.passes.map((pass, index) => ({
      id: `${index}:${pass.label}`,
      label: pass.label,
      kind: "unknown",
      duration:
        profile.status !== "ready"
          ? { status: profile.status, reason: `GPU timing source is ${profile.status}` }
          : pass.milliseconds === null
            ? unknown("The source did not supply a timing for this pass")
            : measured(pass.milliseconds),
    })),
  };
}

/** The host calls refresh from its loop; the adapter owns only its view. */
export function mountDiagnosticsPanel(
  container: HTMLElement,
  monitor: DiagnosticsSource,
  gpu?: () => LiveGpu | null,
  capture?: CaptureConnection,
  instrumentation?: ReadInstrumentation,
  loading?: () => LoadingSnapshot | null,
  comparison?: ComparisonController,
) {
  const renderSnapshot = () =>
    monitor.measureRefresh(() => {
      comparison?.advance();
      const diagnostics = monitor.snapshot();
      capture?.controller.refresh(diagnostics);
      panel.update({ diagnostics, gpu: gpu?.() ?? null, loading: loading?.() ?? null });
    });
  const panel = mountLivePanel(container, {
    instrumentation,
    ...(comparison ? { comparison } : {}),
    ...(capture ? { capture } : {}),
    ...(monitor.setTargetFps
      ? {
          onBudgetChange: (milliseconds: number) => {
            monitor.setTargetFps?.(1000 / milliseconds);
            renderSnapshot();
          },
        }
      : {}),
  });
  let lastRefresh = -Infinity;
  let destroyed = false;
  return {
    refresh(at: number, force = false) {
      if (destroyed) return;
      if (!Number.isFinite(at) || at < 0)
        throw new RangeError("Refresh timestamp must be finite and non-negative");
      if (!force && at >= lastRefresh && at - lastRefresh < 250) {
        const automatic = capture?.controller.getSnapshot().automatic;
        // shortcut: legacy hosts need per-frame snapshots; use capture events when a host supplies them.
        if (automatic && automatic.state !== "off")
          monitor.measureRefresh(() => capture?.controller.refresh(monitor.snapshot(false), false));
        return;
      }
      renderSnapshot();
      lastRefresh = at;
    },
    destroy() {
      destroyed = true;
      panel.destroy();
    },
  };
}
