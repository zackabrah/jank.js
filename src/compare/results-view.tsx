import { useRef } from "preact/hooks";
import { formatNumber, withUnit } from "../format.ts";
import { Button } from "../ui/button.tsx";
import { DisclosureSection } from "../ui/disclosure-section.tsx";
import type { ComparisonResults, MetricResult, Verdict } from "./results.ts";

/** Two decimals below 100, whole numbers from 100; tiny nonzero values keep two significant digits. */
export function resultValue(number: number | null, signed = false) {
  if (number === null) return "—";
  const magnitude = Math.abs(number);
  const digits =
    magnitude > 0 && magnitude < 0.005
      ? magnitude.toPrecision(2)
      : magnitude >= 100
        ? Math.round(magnitude).toString()
        : magnitude.toFixed(2);
  return `${number < 0 ? "−" : signed && number > 0 ? "+" : ""}${digits}`;
}
/** "over" values are shares of frames; their differences are percentage points. */
function measured(metric: MetricResult, number: number | null, signed = false) {
  if (number === null) return "—";
  if (metric.unit === "pts")
    return signed ? resultValue(number, true) : `${formatNumber(number, 0)}%`;
  return resultValue(number, signed);
}
const percent = (share: number) => `${formatNumber(share * 100)}%`;

function VerdictBadge({ verdict, unavailable }: { verdict: Verdict; unavailable: boolean }) {
  const directional = verdict === "B faster" || verdict === "B slower";
  return (
    <span
      class={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-label-12 ${directional ? "border-blue-700 bg-gray-100 text-blue-900" : verdict === "No observed difference" ? "border-jank-control text-jank-text" : "border-dashed border-jank-control text-jank-text-secondary"}`}
    >
      {unavailable ? "not recorded" : verdict}
    </span>
  );
}
export function Variant({ name }: { name: "A" | "B" }) {
  return (
    <strong
      class={`inline-flex size-4.5 shrink-0 items-center justify-center rounded-full font-sans text-label-12 font-semibold text-jank-surface ${name === "A" ? "bg-jank-series-a" : "bg-jank-series-b"}`}
    >
      {name}
    </strong>
  );
}
function PairedRange({ metric, scale }: { metric: MetricResult; scale: number }) {
  if (!metric.range || metric.delta === null) return null;
  const x = (number: number) => 50 + (44 * number) / Math.max(scale, 1e-12);
  return (
    <svg aria-hidden="true" viewBox="0 0 100 14" class="h-3.5 w-full text-jank-series-b">
      {/* A faint track reads as an axis; the dashed tick is zero difference. */}
      <path d="M6 7H94" stroke="var(--jank-divider)" stroke-width="1" />
      <path d="M50 0V14" stroke="var(--jank-text-secondary)" stroke-dasharray="2 2" />
      <path
        d={`M${x(metric.range[0])} 7H${x(metric.range[1])}`}
        stroke="currentColor"
        stroke-width="2"
      />
      <circle cx={x(metric.delta)} cy="7" r="3" fill="currentColor" />
    </svg>
  );
}
function RangeText({ metric }: { metric: MetricResult }) {
  return (
    <>
      {resultValue(metric.range?.[0] ?? null, true)} to{" "}
      {resultValue(metric.range?.[1] ?? null, true)}
    </>
  );
}

interface ResultsProps {
  model: ComparisonResults;
  onViewTrial: (index: number) => void;
}

function rangeScale(model: ComparisonResults, unit: MetricResult["unit"]) {
  return Math.max(
    0,
    ...model.results
      .filter((metric) => metric.unit === unit)
      .flatMap((metric) => (metric.range ? metric.range.map(Math.abs) : [])),
  );
}

/**
 * The panel's results, answer first: verdict cards carry every statistic, then the method,
 * per-scope changes and the trial list. The viewer composes the same parts in its own layout.
 */
export function ComparisonResultsView({
  model,
  running,
}: {
  model: ComparisonResults;
  running: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const viewTrial = (index: number) => {
    // Trials may sit in a closed disclosure; open it before moving there.
    root.current
      ?.querySelector<HTMLButtonElement>('[data-trials-disclosure] button[aria-expanded="false"]')
      ?.click();
    requestAnimationFrame(() => {
      const row = root.current?.querySelector<HTMLElement>(`[data-comparison-trial="${index}"]`);
      const scroll = root.current?.closest<HTMLElement>("[data-compare-scroll]");
      if (!row || !scroll) return;
      scroll.scrollTop += row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 8;
      row.focus({ preventScroll: true });
    });
  };
  return (
    <div ref={root} class="space-y-4">
      {!running && (
        <>
          <ComparisonVerdicts model={model} onViewTrial={viewTrial} details />
          <ComparisonMethod model={model} />
          <ComparisonScopes model={model} onViewTrial={viewTrial} />
        </>
      )}
      <ComparisonTrials model={model} running={running} collapsible={!running} />
    </div>
  );
}

export function ComparisonVerdicts({
  model,
  onViewTrial: viewTrial,
  class: className = "space-y-2",
  details = false,
}: ResultsProps & {
  class?: string;
  /** Adds p95 and over-budget rows to each card, replacing a separate results table. */
  details?: boolean;
}) {
  const scale = rangeScale(model, "ms");
  const cards = (["CPU", "GPU", "Frame"] as const).flatMap((channel) => {
    const metrics = model.results.filter((metric) => metric.id.startsWith(`${channel}-`));
    const headline = metrics.find((metric) => metric.id.endsWith("-median"));
    return headline ? [{ channel, headline, others: metrics.filter((m) => m !== headline) }] : [];
  });
  const measuredAny = model.results.some((metric) => metric.range !== null);
  const cardsSection = (
    <section aria-label="Comparison verdicts" class={className}>
      {cards.map(({ channel, headline, others }) => (
        <article
          key={headline.id}
          aria-label={`${channel} verdict`}
          class="overflow-hidden rounded-md border border-jank-divider"
        >
          <div class="flex items-center justify-between gap-2 px-3 pt-3">
            <h3 class="m-0 text-label-13 font-medium">{headline.label}</h3>
            <VerdictBadge verdict={headline.verdict} unavailable={!!headline.unavailable} />
          </div>
          {headline.unavailable ? (
            <p class="px-3 pt-1 pb-3 text-label-12 text-jank-text-secondary">
              {headline.unavailable}
            </p>
          ) : headline.failure ? (
            <div class="space-y-2 px-3 pt-1 pb-3">
              <p class="text-label-12 text-jank-text-secondary">{headline.failure.reason}</p>
              <Button compact onPress={() => viewTrial(headline.failure?.trial ?? 0)}>
                View trial
              </Button>
            </div>
          ) : (
            <>
              <div class="space-y-1.5 px-3 pt-2 pb-3">
                <p class="flex gap-4 font-mono text-label-13">
                  {(["A", "B"] as const).map((key) => (
                    <span key={key} class="flex items-center gap-1.5">
                      <Variant name={key} />
                      {withUnit(resultValue(key === "A" ? headline.a : headline.b), "ms")}
                    </span>
                  ))}
                </p>
                <PairedRange metric={headline} scale={scale} />
                <p class="text-label-12 text-jank-text-secondary">
                  B − A {withUnit(resultValue(headline.delta, true), "ms")} · range{" "}
                  {resultValue(headline.range?.[0] ?? null, true)} to{" "}
                  {withUnit(resultValue(headline.range?.[1] ?? null, true), "ms")}
                </p>
                {channel === "CPU" && model.opposingScopes && (
                  <p class="text-label-12 text-jank-text-secondary">
                    Scopes moved in opposite directions. See the per-scope changes below; totals can
                    hide these shifts.
                  </p>
                )}
              </div>
              {details && others.length > 0 && (
                <table class="w-full border-collapse border-t border-jank-divider text-right font-mono text-label-12 tabular-nums">
                  <caption class="sr-only">{channel} p95 and over-budget results</caption>
                  <thead class="font-sans text-jank-text-secondary">
                    <tr>
                      <th scope="col" class="py-1.5 pl-3 text-left font-normal">
                        <span class="sr-only">Statistic</span>
                      </th>
                      {["A", "B", "B − A", "Range"].map((name) => (
                        <th
                          key={name}
                          scope="col"
                          class="px-1 py-1.5 font-normal whitespace-nowrap last:pr-3"
                        >
                          {name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {others.map((metric) => (
                      <tr key={metric.id} class="border-t border-jank-divider">
                        <th
                          scope="row"
                          class="py-1.5 pl-3 text-left font-sans font-normal text-jank-text-secondary"
                        >
                          {metric.label.split(" ")[1]}
                        </th>
                        <td class="px-1 py-1.5">{measured(metric, metric.a)}</td>
                        <td class="px-1 py-1.5">{measured(metric, metric.b)}</td>
                        <td class="px-1 py-1.5">{measured(metric, metric.delta, true)}</td>
                        <td class="py-1.5 pr-3 pl-1 whitespace-nowrap">
                          <RangeText metric={metric} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </article>
      ))}
    </section>
  );
  if (!details) return cardsSection;
  return (
    <div class="space-y-2">
      {cardsSection}
      {measuredAny && (
        <p class="text-label-12 text-jank-text-secondary">
          Times in ms. Over is the share of frames over budget; its differences are percentage
          points.
          {scale > 0 && ` Range marks share one scale: ±${withUnit(resultValue(scale), "ms")}.`}
        </p>
      )}
    </div>
  );
}

/** Every statistic in one table, for layouts wide enough to read it (the comparison viewer). */
function ComparisonMetricTable({ model, onViewTrial: viewTrial }: ResultsProps) {
  return (
    <section aria-label="Comparison metric results" class="space-y-2">
      <h3 class="m-0 text-heading-14">Results</h3>
      <table class="w-full table-fixed border-collapse text-right text-label-12">
        <colgroup>
          <col class="w-[24%]" />
          <col class="w-[14%]" />
          <col class="w-[14%]" />
          <col class="w-[14%]" />
          <col class="w-[34%]" />
        </colgroup>
        <thead class="bg-gray-100 text-jank-text-secondary">
          <tr>
            <th scope="col" class="py-2 pl-1 text-left font-medium">
              Metric
            </th>
            {["A", "B", "B − A", "Paired range"].map((name) => (
              <th key={name} scope="col" class="px-1 py-2 font-medium">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.results.map((metric) => (
            <tr key={metric.id} class="border-b border-jank-divider align-top">
              <th scope="row" class="py-2 pl-1 text-left font-normal">
                {metric.label}
              </th>
              {metric.unavailable ? (
                <td colSpan={4} class="px-1 py-2 text-left text-jank-text-secondary">
                  {metric.unavailable}
                </td>
              ) : metric.failure ? (
                <td colSpan={4} class="px-1 py-2 text-left text-jank-text-secondary">
                  <strong class="font-medium">Unknown. </strong>
                  {metric.failure.reason}
                  <div class="pt-1">
                    <Button compact onPress={() => viewTrial(metric.failure?.trial ?? 0)}>
                      View trial
                    </Button>
                  </div>
                </td>
              ) : (
                <>
                  {[metric.a, metric.b, metric.delta].map((number, index) => (
                    <td
                      key={["a", "b", "delta"][index]}
                      class="px-1 py-2 font-mono tabular-nums wrap-anywhere"
                    >
                      {measured(metric, number, index === 2)}
                    </td>
                  ))}
                  <td class="px-1 py-2 font-mono tabular-nums">
                    <span class="whitespace-nowrap">
                      <RangeText metric={metric} />
                    </span>
                    <PairedRange metric={metric} scale={rangeScale(model, metric.unit)} />
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p class="text-label-12 text-jank-text-secondary">
        Times in ms. Over is the share of frames over budget; its differences and ranges are
        percentage points. Range marks share ±{withUnit(resultValue(rangeScale(model, "ms")), "ms")}{" "}
        or ±{withUnit(resultValue(rangeScale(model, "pts")), "pts")} scales.
      </p>
    </section>
  );
}

function ComparisonScopes({ model, onViewTrial: viewTrial }: ResultsProps) {
  return (
    <section aria-label="Largest per-scope changes" class="space-y-2">
      <div class="flex items-center justify-between gap-2">
        <h3 class="m-0 text-heading-14">Largest per-scope changes</h3>
        <span class="text-label-12 text-jank-text-secondary">heuristic</span>
      </div>
      {model.scopeFailure ? (
        <>
          <p class="text-label-12 text-jank-text-secondary">Unknown. {model.scopeFailure.reason}</p>
          <Button compact onPress={() => viewTrial(model.scopeFailure?.trial ?? 0)}>
            View trial
          </Button>
        </>
      ) : model.scopes.length ? (
        <>
          <table class="w-full table-fixed border-collapse text-right text-label-12">
            <colgroup>
              <col class="w-[40%]" />
              <col class="w-1/5" />
              <col class="w-1/5" />
              <col class="w-1/5" />
            </colgroup>
            <thead class="text-jank-text-secondary">
              <tr class="border-b border-jank-divider">
                <th scope="col" class="py-1.5 pl-1 text-left font-normal">
                  Scope median
                </th>
                {["A", "B", "B − A"].map((name) => (
                  <th key={name} scope="col" class="px-1 py-1.5 font-normal">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.scopes.map((scope) => (
                <tr key={scope.id} class="border-b border-jank-divider align-top">
                  <th scope="row" class="py-1.5 pl-1 text-left font-normal wrap-anywhere">
                    {scope.label}
                    <span class="block text-jank-text-secondary">{scope.system}</span>
                  </th>
                  <td class="px-1 py-1.5 font-mono tabular-nums">{resultValue(scope.a)}</td>
                  <td class="px-1 py-1.5 font-mono tabular-nums">{resultValue(scope.b)}</td>
                  <td class="px-1 py-1.5 font-mono tabular-nums">
                    {resultValue(scope.delta, true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="text-label-12 text-jank-text-secondary">
            {model.scopeCount > model.scopes.length
              ? `Showing ${model.scopes.length} of ${model.scopeCount} changed scopes. `
              : ""}
            Signed median paired changes, in ms. Scope lanes can overlap; their medians do not add
            up to CPU or frame time. Settings differences do not establish causes.
          </p>
        </>
      ) : (
        <p class="text-label-12 text-jank-text-secondary">
          No per-scope median change observed in these trials.
        </p>
      )}
    </section>
  );
}

function ComparisonMethod({ model }: { model: ComparisonResults }) {
  return (
    <section aria-label="Comparison method">
      <p class="pb-2 text-label-12 text-jank-text-secondary">
        Quick estimate, not a significance test.
      </p>
      <DisclosureSection title="Method" summary="How results are calculated">
        <div class="space-y-2 py-2 text-label-12 text-jank-text-secondary">
          <p>
            A/B values are medians of per-trial values, with equal weight per trial. B − A is the
            median of within-pair differences. The paired range is their observed minimum and
            maximum, not a confidence interval. A single pair has a single-point range.
          </p>
          <p>
            A range including zero is inconclusive. Exactly zero to zero means no difference was
            observed in these trials; it does not establish equal performance. Signs use unrounded
            values. A short run can miss changes.
          </p>
          <p>
            Every planned trial needs ≥{model.policy.minSamples} valid samples, ≥
            {model.policy.minCoverage * 100}% metric coverage and ≥{model.policy.minCoverage * 100}%
            of its measurement window. Missing trials or failed requirements make that metric
            Unknown.
          </p>
          <p>
            CPU is the union of recorded scopes in complete frames, not total main-thread busy time.
            GPU is the sum of timed invocations with a complete inventory, not device utilization or
            busy time. Absent, partial or legacy GPU evidence is excluded, never zero-filled.
          </p>
          <p>
            Median averages the middle two samples; p95 uses the nearest rank. Frame over-budget
            uses the larger of {withUnit(1, "ms")} or 5% tolerance (
            {withUnit(resultValue(model.frameTolerance), "ms")} here). CPU over-budget uses the
            budget directly. Warm-up is excluded. Missing data may bias observed results even when
            coverage passes.
          </p>
        </div>
      </DisclosureSection>
    </section>
  );
}

/** The viewer's Results tab: the full table, per-scope changes and the method. */
export function ComparisonMetrics({ model, onViewTrial }: ResultsProps) {
  return (
    <div class="space-y-3">
      <ComparisonMetricTable model={model} onViewTrial={onViewTrial} />
      <ComparisonScopes model={model} onViewTrial={onViewTrial} />
      <ComparisonMethod model={model} />
    </div>
  );
}

export function ComparisonTrials({
  model,
  running = false,
  collapsible = false,
}: {
  model: ComparisonResults;
  running?: boolean;
  /** Folds a passing list behind a disclosure; it opens by itself when a recorded trial fails. */
  collapsible?: boolean;
}) {
  const recorded = model.trials.filter((trial) => trial.recorded).length;
  const failing = model.trials.filter(
    (trial) => trial.recorded && Object.values(trial.metrics).some((metric) => metric.failure),
  ).length;
  const summary =
    recorded < model.trials.length
      ? `${recorded} of ${model.trials.length} recorded`
      : failing
        ? `${failing} of ${model.trials.length} ${failing === 1 ? "fails" : "fail"} a requirement`
        : `${recorded} of ${model.trials.length} meet requirements`;
  const list = (
    <>
      <p class="text-label-12 text-jank-text-secondary">
        Each metric needs {model.policy.minSamples} samples · {model.policy.minCoverage * 100}%
        coverage · {model.policy.minCoverage * 100}% window.
      </p>
      <ul class="m-0 list-none divide-y divide-jank-divider p-0">
        {model.trials.map((trial) => {
          const failures = [
            ...new Set(
              Object.values(trial.metrics).flatMap((metric) =>
                metric.failure ? [metric.failure.reason] : [],
              ),
            ),
          ];
          const failed = failures.length > 0 && trial.recorded;
          return (
            <li
              key={trial.name}
              data-comparison-trial={trial.index}
              tabIndex={-1}
              aria-label={`Trial ${trial.name}`}
              class={`focus-ring space-y-1 px-1 py-2 focus:bg-gray-100 ${failed ? "rounded-sm border-l-2 border-red-700 bg-red-100 pl-2" : ""}`}
            >
              <div class="flex justify-between gap-2 font-mono text-label-12">
                <strong>{trial.name}</strong>
                <span class={trial.recorded ? "" : "text-jank-text-secondary"}>
                  {trial.recorded
                    ? `${trial.frames} frames · ${percent(trial.windowCoverage)} window`
                    : running
                      ? "Awaiting trial"
                      : "Not completed"}
                </span>
              </div>
              {trial.recorded && (
                <div class="grid grid-cols-3 gap-2 text-label-12">
                  {(["CPU", "GPU", "Frame"] as const).map((channel) => {
                    const metric = trial.metrics[channel];
                    return (
                      <span
                        key={channel}
                        class={metric.failure ? "text-jank-error" : "text-jank-text-secondary"}
                      >
                        <span class={metric.failure ? "" : "text-jank-text"}>{channel}</span>
                        {metric.recorded ? (metric.failure ? " ✕" : " ✓") : ""}
                        {metric.recorded ? (
                          <>
                            <span class="block">{metric.samples} samples</span>
                            <span class="block">{percent(metric.coverage)} coverage</span>
                          </>
                        ) : (
                          <span class="block">not recorded</span>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
              {/* Not-completed trials are explained once by the run status, not in red per row. */}
              {trial.recorded &&
                failures.map((reason) => (
                  <p key={reason} class="text-label-12 text-jank-error">
                    {reason}
                  </p>
                ))}
            </li>
          );
        })}
      </ul>
    </>
  );
  return (
    <section aria-label="Comparison trial requirements" class="space-y-2">
      {collapsible ? (
        <div data-trials-disclosure>
          <DisclosureSection
            key={failing > 0 ? "failing" : "passing"}
            title="Trials"
            summary={summary}
            defaultOpen={failing > 0}
          >
            <div class="space-y-2 pb-2">{list}</div>
          </DisclosureSection>
        </div>
      ) : (
        <>
          <h3 class="m-0 text-heading-14">
            {running ? `Trials so far · ${recorded} / ${model.trials.length}` : "Trials"}
          </h3>
          {list}
        </>
      )}
    </section>
  );
}
