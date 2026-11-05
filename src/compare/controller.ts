import type { CaptureConnection } from "../capture/controller.ts";
import { parseRecording } from "../recording/format.ts";
import {
  type ComparisonBundle,
  type ComparisonPlan,
  type ComparisonVariant,
  comparisonSchedule,
  defaultComparisonPlan,
  MAX_REASON_LENGTH,
  parseComparison,
  type VariantKey,
  validatePlan,
} from "./model.ts";

export interface ComparisonState {
  phase: "idle" | "warmup" | "measure" | "drain";
  trial: number;
  elapsedMs: number;
  frames: number;
  bundle: ComparisonBundle;
  error: string;
}
export interface ComparisonHost {
  capture: CaptureConnection["controller"];
  variants: Record<VariantKey, ComparisonVariant>;
  change: string;
  /** Synchronous workload switch. Capture previous settings before starting the run. */
  activate(variant: VariantKey): void;
  restore(): void;
}

/** Host calls advance after every sealed frame, even with a frozen or unmounted UI. */
export function createComparisonController(host: ComparisonHost) {
  let lease: ReturnType<ComparisonHost["capture"]["reserveComparison"]> | null = null;
  let abort: AbortController | null = null;
  let startedAt = 0;
  let lastAt = 0;
  let measurementStartMs = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let state: ComparisonState = {
    phase: "idle",
    trial: 0,
    elapsedMs: 0,
    frames: 0,
    error: "",
    bundle: parseComparison(
      JSON.stringify({
        format: "jank.js-comparison",
        version: 1,
        status: "stopped",
        reason: "",
        plan: defaultComparisonPlan,
        variants: host.variants,
        change: host.change,
        budgetMs: 1000 / 60,
        policy: { minSamples: 20, minCoverage: 0.8 },
        trials: [],
      }),
    ),
  };
  const listeners = new Set<() => void>();
  let notify = true;
  const publish = (patch: Partial<ComparisonState>) => {
    state = { ...state, ...patch };
    if (notify) for (const listener of listeners) listener();
  };
  const message = (error: unknown) =>
    error instanceof Error ? error.message : "Comparison failed.";
  const finish = (
    status: ComparisonBundle["status"],
    reason = "",
    stopTrial = status !== "interrupted",
  ) => {
    const owned = lease;
    if (!owned) return;
    lease = null;
    abort?.abort();
    abort = null;
    clearTimeout(timeout);
    try {
      // An interruption may belong to an external recorder; do not stop that work.
      if (stopTrial && state.phase === "measure") owned.source.stopRecording();
    } catch (error) {
      status = "failed";
      reason = message(error);
    }
    try {
      host.restore();
    } catch (error) {
      status = "failed";
      reason = `Could not restore host settings: ${message(error)}`;
    }
    try {
      owned.release();
    } catch (error) {
      status = "failed";
      reason = message(error);
    }
    // Driver messages can be long; an oversized reason would make the kept trials unimportable.
    reason = reason.slice(0, MAX_REASON_LENGTH);
    publish({
      phase: "idle",
      bundle: { ...state.bundle, status, reason },
      error: status === "failed" || status === "interrupted" ? reason : "",
    });
  };
  const beginMeasurement = () => {
    if (!lease) return;
    measurementStartMs = lastAt;
    const owned = lease;
    // A host can throw after starting; cleanup must still own that recorder.
    state = { ...state, phase: "measure", elapsedMs: 0, frames: 0 };
    owned.source.startRecording();
    const snapshot = owned.source.snapshot();
    if (!snapshot.recording || snapshot.recordedFrames !== 0 || snapshot.capture.mode !== "manual")
      throw new Error("The host did not start a fresh trial recording.");
    publish({});
  };
  const beginTrial = () => {
    const next = comparisonSchedule(state.bundle.plan.pairs)[state.bundle.trials.length];
    if (!lease || !next) return;
    host.activate(next.variant);
    const snapshot = lease.source.snapshot();
    if (
      snapshot.recording ||
      snapshot.capture.state !== "idle" ||
      snapshot.budget.frameMs !== state.bundle.budgetMs
    )
      throw new Error("Variant activation changed capture state or the frame budget.");
    startedAt = snapshot.frames.at(-1)?.at ?? 0;
    lastAt = startedAt;
    publish({ phase: "warmup", trial: state.bundle.trials.length + 1, elapsedMs: 0, frames: 0 });
    if (state.bundle.plan.warmupMs === 0) beginMeasurement();
  };
  const drain = () => {
    const owned = lease;
    if (!owned) return;
    owned.source.stopRecording();
    const recording = parseRecording(JSON.stringify(owned.source.export()));
    if (recording.frames.length !== state.frames)
      throw new Error("The trial buffer changed before export.");
    const measurementEndMs = lastAt;
    const token = new AbortController();
    abort = token;
    publish({ phase: "drain", elapsedMs: 0 });
    timeout = setTimeout(() => {
      if (lease === owned && abort === token)
        finish("failed", "GPU finalization did not finish; completed trials were kept.");
    }, 1000);
    void Promise.resolve()
      .then(() =>
        token.signal.aborted
          ? undefined
          : owned.source.finalizeGpu?.(structuredClone(recording), token.signal),
      )
      .then((gpuTiming) => {
        if (lease !== owned || abort !== token || token.signal.aborted) return;
        controller.advance(false);
        if (lease !== owned) return;
        clearTimeout(timeout);
        if (owned.source.finalizeGpu && !gpuTiming)
          throw new Error("The host returned no GPU finalization result.");
        const next = comparisonSchedule(state.bundle.plan.pairs)[state.bundle.trials.length];
        if (!next) throw new Error("Unexpected comparison trial.");
        const bundle = parseComparison(
          JSON.stringify({
            ...state.bundle,
            trials: [
              ...state.bundle.trials,
              {
                ...next,
                measurementStartMs,
                measurementEndMs,
                recording: gpuTiming ? { ...recording, gpuTiming } : recording,
              },
            ],
          }),
        );
        publish({ bundle });
        if (bundle.trials.length === bundle.plan.pairs * 2) finish("complete");
        else beginTrial();
      })
      .catch((error: unknown) => {
        if (lease === owned && !token.signal.aborted) finish("failed", message(error));
      });
  };
  const controller = {
    capture: host.capture,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    unavailable: () => host.capture.comparisonUnavailable(),
    start(plan: ComparisonPlan) {
      if (lease) return;
      try {
        const checked = validatePlan(plan);
        const owned = host.capture.reserveComparison();
        lease = owned;
        const initial = owned.source.snapshot();
        if (!initial.frames.length)
          throw new Error("Wait for the first completed host frame before comparing.");
        const budgetMs = initial.budget.frameMs;
        publish({
          bundle: parseComparison(
            JSON.stringify({
              ...state.bundle,
              plan: checked,
              budgetMs,
              status: "stopped",
              reason: "",
              trials: [],
            }),
          ),
          error: "",
        });
        beginTrial();
      } catch (error) {
        if (lease) finish("failed", message(error));
        else publish({ error: message(error) });
      }
    },
    advance(render = true) {
      if (!lease) {
        if (render) for (const listener of listeners) listener();
        return;
      }
      notify = false;
      try {
        const snapshot = lease.source.snapshot(false);
        const at = snapshot.frames.at(-1)?.at ?? 0;
        const expectedRecording = state.phase === "measure";
        const capacityStop =
          expectedRecording && snapshot.recordedFrames === host.capture.getSnapshot().capacity;
        const captureChanged =
          !Number.isSafeInteger(snapshot.recordedFrames) ||
          snapshot.recordedFrames < 0 ||
          snapshot.recordedFrames > host.capture.getSnapshot().capacity ||
          !Number.isFinite(at) ||
          at < lastAt ||
          (snapshot.recording !== expectedRecording && !capacityStop) ||
          (expectedRecording &&
            (snapshot.capture.mode !== "manual" || snapshot.recordedFrames < state.frames)) ||
          (!expectedRecording && snapshot.capture.state !== "idle") ||
          (state.phase === "drain" && snapshot.recordedFrames !== state.frames);
        if (captureChanged || snapshot.budget.frameMs !== state.bundle.budgetMs) {
          finish(
            "interrupted",
            "Comparison cancelled: capture state or budget changed outside the panel.",
            !captureChanged,
          );
          return;
        }
        lastAt = at;
        if (state.phase === "warmup") {
          publish({ elapsedMs: at - startedAt });
          if (state.elapsedMs >= state.bundle.plan.warmupMs) beginMeasurement();
        } else if (state.phase === "measure") {
          publish({ elapsedMs: at - measurementStartMs, frames: snapshot.recordedFrames });
          if (state.elapsedMs >= state.bundle.plan.measureMs) drain();
          else if (capacityStop)
            finish(
              "failed",
              "Trial reached recording capacity before the measurement window finished.",
            );
        }
      } catch (error) {
        finish("failed", message(error));
      } finally {
        notify = true;
        if (render) for (const listener of listeners) listener();
      }
    },
    /** The host itself failed: keep finished trials and record why the run ended. */
    fail: (reason: string) => finish("failed", reason),
    stop: () =>
      finish(
        "stopped",
        `Stopped after ${state.bundle.trials.length} of ${state.bundle.plan.pairs * 2} trials.`,
      ),
    destroy: () => {
      finish("stopped", "Comparison host disposed.");
      listeners.clear();
    },
  };
  return controller;
}
export type ComparisonController = ReturnType<typeof createComparisonController>;
