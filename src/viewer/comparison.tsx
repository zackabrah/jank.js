import { useId, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  type ComparisonBundle,
  comparisonSchedule,
  settingDifferences,
  type VariantKey,
} from "../compare/model.ts";
import { comparisonResults } from "../compare/results.ts";
import {
  ComparisonMetrics,
  ComparisonTrials,
  ComparisonVerdicts,
} from "../compare/results-view.tsx";
import { ComparisonSettings } from "../compare/settings.tsx";
import { formatMs, formatSeconds, plural } from "../format.ts";
import { Button } from "../ui/button.tsx";
import { Notice } from "../ui/notice.tsx";
import { ComparisonFrame } from "./comparison-frame.tsx";
import { comparisonFrames } from "./comparison-frames.ts";
import { comparisonLanes } from "./comparison-lanes.ts";
import { type ComparisonSelection, fitComparisonRange } from "./comparison-range.ts";
import { ComparisonTimeline } from "./comparison-timeline.tsx";

const tabs = ["Results", "Trials", "Settings", "Frame"] as const;
type Tab = (typeof tabs)[number];

export function ComparisonViewer({ bundle }: { bundle: ComparisonBundle }) {
  const model = useMemo(() => comparisonResults(bundle), [bundle]);
  const differences = settingDifferences(bundle.variants, bundle.change);
  const failedTrials = model.trials.filter((trial) =>
    Object.values(trial.metrics).some((metric) => metric.failure),
  ).length;
  const schedule = comparisonSchedule(bundle.plan.pairs);
  const [selection, setSelection] = useState<{ tab: Tab; trial: number | null } | null>(null);
  const tab = selection?.tab ?? "Results";
  const [pair, setPair] = useState(1);
  const chart = useMemo(() => comparisonFrames(bundle, pair), [bundle, pair]);
  const lanes = useMemo(() => comparisonLanes(bundle, pair), [bundle, pair]);
  // Null is the pair's default: the whole run with the cursor at its start.
  const [cursor, setCursor] = useState<ComparisonSelection | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const range = cursor ?? fitComparisonRange(chart.duration);
  const [visible, setVisible] = useState<Record<VariantKey, boolean>>({ A: true, B: true });
  const [warning, setWarning] = useState(true);
  const root = useRef<HTMLElement>(null);
  const id = useId();
  const choosePair = (next: number) => {
    if (next === pair) return;
    setPair(next);
    setCursor(null);
    setHover(null);
  };
  const chooseTab = (next: Tab) => {
    setSelection({ tab: next, trial: null });
    const button = root.current?.querySelector<HTMLButtonElement>(`[data-compare-tab="${next}"]`);
    button?.focus({ preventScroll: true });
  };
  const viewTrial = (index: number) => {
    const trial = model.trials[index];
    if (trial) choosePair(trial.pair);
    setSelection({ tab: "Trials", trial: index });
  };
  useLayoutEffect(() => {
    const scroll = root.current;
    if (!scroll || !selection) return;
    const target =
      selection.trial === null
        ? scroll.querySelector<HTMLElement>('[role="tablist"]')
        : scroll.querySelector<HTMLElement>(`[data-comparison-trial="${selection.trial}"]`);
    // Scroll only this pane; document scrolling would move the viewer footer.
    if (target) {
      scroll.scrollTop +=
        target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 8;
      if (selection.trial !== null) target.focus({ preventScroll: true });
    }
  }, [selection]);

  return (
    <>
      <div data-comparison-view="" class="flex min-h-0 flex-1 flex-col">
        <section
          aria-label="Comparison summary"
          class="max-h-[45%] shrink-0 space-y-4 overflow-y-auto overscroll-contain p-6"
        >
          {differences.length > 0 && warning && (
            <Notice tone="warning" onDismiss={() => setWarning(false)}>
              <div class="flex items-start justify-between gap-4">
                <p class="wrap-anywhere">
                  {differences.length} other {plural(differences.length, "setting")} differ
                  {differences.length === 1 ? "s" : ""} between A and B: {differences.join(", ")}.
                  Differences cannot be attributed to one change.
                </p>
                <Button compact onPress={() => chooseTab("Settings")}>
                  Show settings
                </Button>
              </div>
            </Notice>
          )}
          {bundle.status !== "complete" && (
            <Notice tone="warning">
              Comparison {bundle.status}. {bundle.reason} {bundle.trials.length} of{" "}
              {schedule.length} trials retained. Missing trials remain Unknown.
            </Notice>
          )}
          <p class="font-mono text-label-12 text-jank-text-secondary">
            {bundle.plan.pairs} {plural(bundle.plan.pairs, "pair")} ·{" "}
            {schedule.map((trial) => trial.variant).join(" ")} ·{" "}
            {formatSeconds(bundle.plan.warmupMs / 1000)} warm-up ·{" "}
            {formatSeconds(bundle.plan.measureMs / 1000)} measure · {formatMs(bundle.budgetMs)}{" "}
            budget · results across all pairs
          </p>
          <ComparisonVerdicts
            model={model}
            onViewTrial={viewTrial}
            class="grid grid-cols-3 gap-3"
          />
        </section>
        <div class="flex shrink-0 flex-wrap items-center gap-3 border-y border-jank-divider px-6 py-2">
          <fieldset class="m-0 min-w-0 p-0">
            <legend class="sr-only">Comparison pair</legend>
            <div class="flex flex-wrap gap-1 rounded-md border border-jank-control p-0.5">
              {Array.from({ length: bundle.plan.pairs }, (_, index) => index + 1).map((number) => (
                <label key={number} class="relative cursor-pointer">
                  <input
                    type="radio"
                    name={`${id}-pair`}
                    value={number}
                    checked={pair === number}
                    onChange={() => choosePair(number)}
                    class="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
                  />
                  <span class="block rounded-sm px-3 py-1 text-label-12 text-jank-text-secondary peer-checked:bg-gray-200 peer-checked:text-jank-text peer-focus-visible:outline-2 peer-focus-visible:outline-jank-focus">
                    Pair {number} · {number % 2 ? "A then B" : "B then A"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset class="m-0 flex min-w-0 items-center gap-2 p-0">
            <legend class="sr-only">Visible comparison series</legend>
            {(["A", "B"] as const).map((key) => (
              <Button
                key={key}
                pressed={visible[key]}
                onPress={() => setVisible({ ...visible, [key]: !visible[key] })}
              >
                <span
                  aria-hidden="true"
                  class={key === "A" ? "text-jank-series-a" : "text-jank-series-b-text"}
                >
                  {key === "A" ? "● ━" : "■ ┄"}
                </span>
                variant {key}
              </Button>
            ))}
          </fieldset>
          <span class="text-label-12 text-jank-text-secondary">Aligned from measure start</span>
        </div>
        <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(23rem,30%)]">
          <div
            data-comparison-graph-pane=""
            class="relative min-h-0 overflow-y-auto overscroll-contain"
          >
            <ComparisonTimeline
              key={pair}
              bundle={bundle}
              chart={chart}
              lanes={lanes}
              selection={range}
              onSelection={setCursor}
              hover={hover}
              onHover={setHover}
              visible={visible}
            />
          </div>
          <aside
            ref={root}
            aria-label="Comparison inspector"
            class="relative min-h-0 overflow-y-auto overscroll-contain border-l border-jank-divider px-4"
          >
            <div
              role="tablist"
              aria-label="Comparison inspector"
              class="flex border-b border-jank-divider"
              onKeyDown={(event) => {
                const index = tabs.indexOf(tab);
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : -1;
                if (next < 0) return;
                event.preventDefault();
                event.stopPropagation();
                const target = tabs[next];
                if (target) chooseTab(target);
              }}
            >
              {tabs.map((label) => (
                <button
                  key={label}
                  id={`${id}-${label}`}
                  data-compare-tab={label}
                  type="button"
                  role="tab"
                  aria-label={
                    label === "Settings" && differences.length > 0
                      ? `Settings, ${differences.length} other ${plural(differences.length, "difference")}`
                      : label === "Trials" && failedTrials > 0
                        ? `Trials, ${failedTrials} ${plural(failedTrials, "trial")} with failed requirements`
                        : label
                  }
                  aria-selected={tab === label}
                  aria-controls={`${id}-panel`}
                  tabIndex={tab === label ? 0 : -1}
                  onClick={() => chooseTab(label)}
                  class="focus-ring flex items-center gap-2 border-b-2 border-transparent px-3 py-3 text-label-13 text-jank-text-secondary aria-selected:border-jank-text aria-selected:text-jank-text"
                >
                  {label}
                  {label === "Settings" && differences.length > 0 && (
                    <span
                      class="rounded-full bg-amber-100 px-1.5 text-label-12 text-amber-1000"
                      aria-hidden="true"
                    >
                      ≠ {differences.length}
                    </span>
                  )}
                  {label === "Trials" && failedTrials > 0 && (
                    <span
                      class="rounded-full bg-red-100 px-1.5 text-label-12 text-jank-error"
                      aria-hidden="true"
                    >
                      {failedTrials}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div
              id={`${id}-panel`}
              role="tabpanel"
              aria-labelledby={`${id}-${tab}`}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: The tab panel needs a keyboard entry point for static content.
              tabIndex={0}
              class="focus-ring py-4"
            >
              {tab === "Results" && <ComparisonMetrics model={model} onViewTrial={viewTrial} />}
              {tab === "Trials" && <ComparisonTrials model={model} />}
              {tab === "Frame" && (
                <ComparisonFrame
                  lanes={lanes}
                  chart={chart}
                  at={hover ?? range.at}
                  budgetMs={bundle.budgetMs}
                  overLimit={bundle.budgetMs + model.frameTolerance}
                />
              )}
              {tab === "Settings" && (
                <section aria-label="Comparison settings" class="space-y-3 text-copy-13">
                  <h2 class="m-0 text-heading-16">Settings</h2>
                  <p class="wrap-anywhere">
                    Change under test: <strong>{bundle.change}</strong>
                  </p>
                  <dl class="grid grid-cols-2 gap-3">
                    {(["A", "B"] as const).map((key) => (
                      <div key={key} class="min-w-0">
                        <dt class="text-label-12 text-jank-text-secondary">Variant {key}</dt>
                        <dd class="wrap-anywhere">{bundle.variants[key].label}</dd>
                      </div>
                    ))}
                  </dl>
                  <ComparisonSettings bundle={bundle} />
                  <p class="text-label-12 text-jank-text-secondary wrap-anywhere">
                    ≠ marks settings that differ besides {bundle.change}. These host-reported
                    settings describe the saved run, not this browser. Differences do not establish
                    causes.
                  </p>
                </section>
              )}
            </div>
          </aside>
        </div>
      </div>
      <footer class="flex shrink-0 justify-between gap-2 border-t border-jank-divider px-6 py-1 text-label-12 text-jank-text-secondary">
        <p>
          Local file, nothing uploaded · showing pair {pair} · {bundle.trials.length} of{" "}
          {schedule.length} trials retained
        </p>
        <p>Quick estimate, not a significance test.</p>
      </footer>
    </>
  );
}
