import { useId, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { comparisonCaptureReason } from "../capture/controller.ts";
import { formatMs, formatNumber, formatSeconds, NBSP, plural, withUnit } from "../format.ts";
import { downloadJson } from "../recording/download.ts";
import { Button } from "../ui/button.tsx";
import { DisclosureSection } from "../ui/disclosure-section.tsx";
import { Notice } from "../ui/notice.tsx";
import type { ComparisonController, ComparisonState } from "./controller.ts";
import {
  type ComparisonBundle,
  type ComparisonPlan,
  comparisonSchedule,
  serializeComparison,
  settingDifferences,
} from "./model.ts";
import { comparisonResults } from "./results.ts";
import { ComparisonResultsView } from "./results-view.tsx";
import { ComparisonSettings } from "./settings.tsx";

const planFields = [
  { key: "warmupMs", label: "Warm-up per trial", min: 0, max: 10, step: 0.1, scale: 1000 },
  { key: "measureMs", label: "Measure per trial", min: 0.1, max: 30, step: 0.1, scale: 1000 },
  { key: "pairs", label: "Pairs", min: 1, max: 5, step: 1, scale: 1 },
] as const;

/** Per-field limits, matching validatePlan, so each field explains itself as it is typed. */
function fieldError(field: (typeof planFields)[number], plan: ComparisonPlan) {
  const value = plan[field.key] / field.scale;
  const valid =
    field.key === "pairs"
      ? Number.isSafeInteger(value) && value >= field.min && value <= field.max
      : Number.isFinite(value) && value >= field.min && value <= field.max;
  if (valid) return "";
  return field.key === "pairs"
    ? `${field.label}: ${field.min} to ${field.max} whole pairs.`
    : `${field.label}: ${field.min} to ${withUnit(field.max, "s")}.`;
}

const finishedVerb: Record<ComparisonBundle["status"], string> = {
  complete: "Finished",
  stopped: "Stopped",
  interrupted: "Cancelled",
  failed: "Failed",
};

export function CompareTab({
  controller,
  state,
  budget,
  loading,
}: {
  controller: ComparisonController;
  state: ComparisonState;
  budget: number;
  loading: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [plan, setPlan] = useState(state.bundle.plan);
  const [exportError, setExportError] = useState("");
  const [exportedBundle, setExportedBundle] = useState<ComparisonBundle | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const running = state.phase !== "idle";
  const { bundle } = state;
  const results = useMemo(() => comparisonResults(bundle), [bundle]);
  const errors = Object.fromEntries(
    planFields.map((field) => [field.key, fieldError(field, plan)]),
  ) as Record<keyof ComparisonPlan, string>;
  // An invalid field keeps the schedule and estimate on its last valid value, never the defaults.
  const lastValid = useRef(state.bundle.plan);
  for (const { key } of planFields)
    if (!errors[key]) lastValid.current = { ...lastValid.current, [key]: plan[key] };
  const invalidField = planFields.find(({ key }) => errors[key]);
  const currentPlan = running ? bundle.plan : lastValid.current;
  const schedule = comparisonSchedule(currentPlan.pairs);
  const differences = settingDifferences(bundle.variants, bundle.change);
  const reason = controller.unavailable();
  const trialDuration = currentPlan.warmupMs + currentPlan.measureMs + 500;
  const phaseProgress =
    state.phase === "warmup"
      ? Math.min(state.elapsedMs, currentPlan.warmupMs)
      : state.phase === "measure"
        ? currentPlan.warmupMs + Math.min(state.elapsedMs, currentPlan.measureMs)
        : currentPlan.warmupMs + currentPlan.measureMs;
  const progress = bundle.trials.length + (running ? phaseProgress / trialDuration : 0);
  const remainingSeconds = Math.max(0, ((schedule.length - progress) * trialDuration) / 1000);
  const phaseLabel =
    state.phase === "warmup" ? "warm-up" : state.phase === "measure" ? "measuring" : "GPU drain";
  const phaseTotal =
    state.phase === "warmup"
      ? currentPlan.warmupMs
      : state.phase === "measure"
        ? currentPlan.measureMs
        : null;
  const runningVariant = schedule[state.trial - 1]?.variant ?? "";
  const samePlan =
    currentPlan.pairs === bundle.plan.pairs &&
    currentPlan.warmupMs === bundle.plan.warmupMs &&
    currentPlan.measureMs === bundle.plan.measureMs;
  const narrowCells = schedule.length > 6;
  const unexported = !running && bundle.trials.length > 0 && exportedBundle !== bundle;
  const blockedReason = invalidField ? errors[invalidField.key] : reason;
  const blockedReasonId = invalidField ? `${id}-${invalidField.key}-error` : `${id}-reason`;
  const exportBundle = () => {
    try {
      if (root.current)
        downloadJson(root.current.ownerDocument, serializeComparison(bundle), "jank-comparison");
      setExportedBundle(bundle);
      setExportError("");
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed.");
    }
  };
  const run = () => {
    // Results live in memory only; never replace unexported trials without saying so.
    if (unexported && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    setConfirmReplace(false);
    controller.start(plan);
  };
  const cancelReplace = () => {
    setConfirmReplace(false);
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLButtonElement>("[data-compare-run] button")?.focus(),
    );
  };
  useLayoutEffect(() => {
    if (confirmReplace)
      root.current?.querySelector<HTMLButtonElement>("[data-replace-actions] button")?.focus();
  }, [confirmReplace]);
  useLayoutEffect(() => {
    if (running) setConfirmReplace(false);
  }, [running]);
  // While running, the trial card leads; once idle, results lead and the plan follows.
  const planSection = (
    <section
      aria-label="Comparison plan"
      class="flex flex-col gap-2 border-t border-jank-divider pt-3"
    >
      <h2 class="text-heading-14 mb-0">
        {running ? `Trial ${state.trial} of ${schedule.length}` : "Plan"}
      </h2>
      {!running && (
        <fieldset class="m-0 grid min-w-0 gap-1 p-0">
          {planFields.map(({ key, label, min, max, step, scale }) => (
            <label
              key={key}
              class="flex items-center justify-between gap-3 text-label-13 text-jank-text-secondary"
            >
              <span>{label}</span>
              <span class="flex items-center gap-1 font-mono text-jank-text">
                <input
                  type="number"
                  aria-label={key === "pairs" ? label : `${label} (seconds)`}
                  aria-invalid={errors[key] ? true : undefined}
                  aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
                  min={min}
                  max={max}
                  step={step}
                  defaultValue={
                    Number.isFinite(plan[key])
                      ? (plan[key] / scale).toFixed(key === "pairs" ? 0 : 1)
                      : ""
                  }
                  class="focus-ring h-6 w-14 rounded-md border border-jank-control bg-jank-surface px-1.5 text-right font-mono text-label-13 hover:border-jank-text-secondary aria-invalid:border-red-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  onInput={(event) =>
                    setPlan({ ...plan, [key]: event.currentTarget.valueAsNumber * scale })
                  }
                />
                <span aria-hidden="true" class="w-9 whitespace-nowrap">
                  {key === "pairs" ? "× AB" : "s"}
                </span>
              </span>
            </label>
          ))}
          {planFields.map(
            ({ key }) =>
              errors[key] && (
                <p key={key} id={`${id}-${key}-error`} class="text-label-12 text-jank-error">
                  {errors[key]}
                </p>
              ),
          )}
        </fieldset>
      )}
      <ol aria-label="Trial schedule" class="m-0 flex list-none gap-1 p-0">
        {schedule.map(({ pair, variant }, index) => {
          // Completion marks belong to the run they came from, not to an edited plan.
          const done = index < bundle.trials.length && (running || samePlan);
          return (
            <li
              key={`${pair}${variant}`}
              aria-label={`Pair ${pair}, ${variant}${done ? ", complete" : ""}`}
              class={`flex h-6 min-w-0 flex-1 overflow-hidden rounded-md border bg-jank-track ${running && state.trial === index + 1 ? "border-jank-text" : "border-jank-divider"}`}
            >
              <span
                aria-hidden="true"
                style={{
                  flex: currentPlan.warmupMs,
                  backgroundImage:
                    "repeating-linear-gradient(135deg, transparent 0px, transparent 2px, var(--ds-gray-600) 2px, var(--ds-gray-600) 3px)",
                }}
              />
              <span
                aria-hidden="true"
                class={`flex min-w-0 items-center justify-center overflow-hidden whitespace-nowrap text-label-12 font-medium text-jank-surface ${variant === "A" ? "bg-jank-series-a" : "bg-jank-series-b"}`}
                style={{ flex: currentPlan.measureMs }}
              >
                {done ? (narrowCells ? "✓" : `${variant}${NBSP}✓`) : variant}
              </span>
              <span aria-hidden="true" style={{ flex: 500 }} />
            </li>
          );
        })}
      </ol>
      <div class="flex items-center justify-between gap-2 text-label-12 text-jank-text-secondary">
        <span>
          <span aria-hidden="true">▨</span> warm-up · <span aria-hidden="true">■</span> measure ·{" "}
          <span aria-hidden="true">▭</span> GPU drain
        </span>
        <span
          class="shrink-0 font-mono"
          title={`Includes a ${withUnit(0.5, "s")} GPU drain allowance per trial; frame-boundary delays may extend the run.`}
        >
          ≈{NBSP}
          {running
            ? `${withUnit(Math.ceil(remainingSeconds), "s")} left`
            : withUnit(Number(((trialDuration * schedule.length) / 1000).toFixed(1)), "s")}
        </span>
      </div>
      {running ? (
        <>
          <div
            role="progressbar"
            aria-label="Comparison progress"
            aria-valuemin={0}
            aria-valuemax={schedule.length}
            aria-valuenow={progress}
            aria-valuetext={`Trial ${state.trial} of ${schedule.length}, ${phaseLabel} ${runningVariant}${state.phase === "measure" ? `, ${state.frames} ${plural(state.frames, "frame")}` : ""}`}
            class="space-y-2"
          >
            <p class="font-mono text-label-12">
              <span>
                {runningVariant} · {phaseLabel}
                {phaseTotal !== null &&
                  ` · ${formatNumber(Math.min(state.elapsedMs, phaseTotal) / 1000)} of ${formatSeconds(phaseTotal / 1000)}`}
                {state.phase === "measure" && ` · ${state.frames} ${plural(state.frames, "frame")}`}
              </span>
            </p>
            <div class="h-1.5 overflow-hidden rounded bg-jank-track">
              <div
                class="h-full bg-jank-series-a"
                style={{ width: `${(100 * progress) / schedule.length}%` }}
              />
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Button onPress={controller.stop}>■ Stop comparison</Button>
            <span class="text-label-12 text-jank-text-secondary">Keeps finished trials.</span>
          </div>
          <p class="flex gap-1.5 text-copy-13 text-jank-text-secondary">
            <span aria-hidden="true" class="font-mono">
              ⊘
            </span>
            <span>
              Rec and Auto locked until the run ends
              <span class="sr-only">. {comparisonCaptureReason}</span>
            </span>
          </p>
          {loading && <Notice>A load is in progress. These trials include load work.</Notice>}
        </>
      ) : (
        <>
          {confirmReplace ? (
            <fieldset
              class="m-0 min-w-0 space-y-2 rounded-md border border-amber-400 bg-amber-100 p-2 text-copy-13 text-amber-1000"
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                cancelReplace();
              }}
            >
              <legend class="sr-only">Replace unexported trials</legend>
              <p>
                Running again replaces {bundle.trials.length} unexported{" "}
                {plural(bundle.trials.length, "trial")}. They live in memory only.
              </p>
              <div data-replace-actions class="flex flex-wrap gap-2">
                <Button compact onPress={cancelReplace}>
                  Cancel
                </Button>
                <Button compact onPress={exportBundle}>
                  Export {plural(bundle.trials.length, "trial")}
                </Button>
                <Button compact variant="primary" onPress={run}>
                  Replace and run
                </Button>
              </div>
            </fieldset>
          ) : (
            <div data-compare-run>
              <Button
                variant="primary"
                fullWidth
                onPress={run}
                unavailable={
                  blockedReason
                    ? {
                        reason: blockedReason,
                        reasonId: blockedReasonId,
                        onExplain: invalidField
                          ? () =>
                              root.current
                                ?.querySelector<HTMLInputElement>("input[aria-invalid]")
                                ?.focus()
                          : () =>
                              root.current
                                ?.querySelector<HTMLElement>("[data-compare-reason]")
                                ?.focus(),
                      }
                    : undefined
                }
              >
                <span aria-hidden="true" class="mr-1">
                  ▶
                </span>
                {bundle.trials.length ? "Run again" : "Run comparison"}
              </Button>
            </div>
          )}
          {reason && !invalidField && (
            <p
              id={`${id}-reason`}
              data-compare-reason
              tabIndex={-1}
              class="focus-ring text-label-12 text-jank-text-secondary"
            >
              {reason}
            </p>
          )}
        </>
      )}
      {!running && (
        <p class="text-copy-13 text-jank-text-secondary">
          Uses the {formatMs(budget)} budget. Keep input and camera still while it runs.
        </p>
      )}
    </section>
  );
  return (
    <div
      ref={root}
      data-compare-scroll
      class="relative h-full space-y-3 overflow-y-auto overscroll-contain p-3 text-copy-13"
    >
      <section aria-label="Comparison variants" class="mb-0 space-y-2">
        <h2 class="text-heading-14">
          Variants <span class="text-label-12 text-jank-text-secondary">· reported by host</span>
        </h2>
        {(["A", "B"] as const).map((key) => (
          <p key={key} class="flex items-center gap-2 text-jank-text">
            <strong
              class={`inline-flex size-4.5 shrink-0 items-center justify-center rounded-full text-label-12 font-semibold text-jank-surface ${key === "A" ? "bg-jank-series-a" : "bg-jank-series-b"}`}
            >
              {key}
            </strong>
            <svg
              aria-hidden="true"
              viewBox="0 0 22 10"
              fill="none"
              class={`h-2.5 w-5.5 shrink-0 ${key === "A" ? "text-jank-series-a" : "text-jank-series-b"}`}
            >
              <path
                d="M1 5H21"
                stroke="currentColor"
                stroke-width="2"
                stroke-dasharray={key === "B" ? "4 3" : undefined}
              />
              {key === "A" ? (
                <circle cx="11" cy="5" r="3" fill="currentColor" />
              ) : (
                <rect x="8" y="2" width="6" height="6" fill="currentColor" />
              )}
            </svg>
            <span class="min-w-0 wrap-anywhere">{bundle.variants[key].label}</span>
          </p>
        ))}
        <p class="text-label-12 text-jank-text-secondary">Change under test: {bundle.change}</p>
        {!!differences.length && (
          <Notice tone="warning">
            {differences.length} other{" "}
            {differences.length === 1 ? "setting differs" : "settings differ"}:{" "}
            {differences.join(", ")}. Differences cannot be attributed to one change.
          </Notice>
        )}
        <DisclosureSection
          title="Host settings"
          summary={`${differences.length} other ${differences.length === 1 ? "difference" : "differences"}`}
        >
          <ComparisonSettings bundle={bundle} />
        </DisclosureSection>
      </section>
      {running && planSection}
      {(running || bundle.trials.length > 0) && (
        <section
          aria-label="Finished comparison trials"
          class="space-y-3 border-t border-jank-divider pt-3"
        >
          {!running && (
            <>
              {/* The answer leads: status and the one way to keep it, then the verdicts. */}
              <div class="flex items-center justify-between gap-2">
                <h2 class="text-heading-14">
                  {bundle.status === "complete" ? "Complete" : "Incomplete"} ·{" "}
                  {bundle.trials.length} / {bundle.plan.pairs * 2}
                </h2>
                <Button compact onPress={exportBundle}>
                  Export {bundle.trials.length} {plural(bundle.trials.length, "trial")}
                </Button>
              </div>
              {bundle.status !== "complete" && (
                <p>
                  {finishedVerb[bundle.status]} after {bundle.trials.length} of{" "}
                  {bundle.plan.pairs * 2} trials. Unfinished pairs cannot support paired results.
                </p>
              )}
              {exportError && <Notice tone="error">{exportError}</Notice>}
            </>
          )}
          <ComparisonResultsView model={results} running={running} />
        </section>
      )}
      {!running && planSection}
      {/* A cancelled or failed run is reported in the panel's notice slot; other errors stay by Run. */}
      {state.error && state.error !== bundle.reason && <Notice tone="error">{state.error}</Notice>}
      {!running && !bundle.trials.length && !state.error && bundle.reason && (
        <Notice>{bundle.reason}</Notice>
      )}
    </div>
  );
}
