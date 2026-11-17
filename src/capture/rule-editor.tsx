import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatMs, withUnit } from "../format.ts";
import type { CaptureRule, RuleSettings } from "../recording/types.ts";
import { Button } from "../ui/button.tsx";
import { Notice } from "../ui/notice.tsx";
import type { AutomaticCapture, CaptureConnection } from "./controller.ts";
import { compileRule } from "./rules.ts";

type Field = Exclude<keyof RuleSettings, "mode" | "keep">;
const fields: Field[] = [
  "thresholdMs",
  "sustainedMs",
  "quietMs",
  "limitMs",
  "beforeSeconds",
  "afterSeconds",
  "cooldownMs",
];
const scale = (field: Field) => (["quietMs", "limitMs", "cooldownMs"].includes(field) ? 1000 : 1);
function secondsLabel(value: number) {
  const seconds = Number(value.toFixed(3));
  return Number.isInteger(seconds) ? seconds.toFixed(1) : seconds.toString();
}

export function RuleEditor({
  controller,
  automatic,
  budget,
  onClose,
}: {
  controller: CaptureConnection["controller"];
  automatic: AutomaticCapture;
  budget: number;
  onClose: () => void;
}) {
  const initial = useRef(controller.getRuleSettings()).current;
  const [mode, setMode] = useState(initial.mode);
  const [keep, setKeep] = useState(initial.keep);
  const initialValues = Object.fromEntries(
    fields.map((field) => [field, String(Number((initial[field] / scale(field)).toPrecision(6)))]),
  );
  const [values, setValues] = useState(() => initialValues);
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    form.current?.querySelector<HTMLInputElement>(`input[name="${id}-mode"]:checked`)?.focus();
  }, [id]);
  const settings: RuleSettings = { ...initial, mode, keep };
  for (const field of fields) {
    if (
      (field === "thresholdMs" && mode !== "spike") ||
      (field === "sustainedMs" && mode === "spike") ||
      ((field === "quietMs" || field === "limitMs") && keep !== "episode")
    )
      continue;
    const text = values[field];
    settings[field] =
      text === initialValues[field]
        ? initial[field]
        : text?.trim()
          ? Number(text) * scale(field)
          : Number.NaN;
  }
  let preview: CaptureRule | undefined;
  let invalid = "";
  try {
    preview = compileRule(settings, budget, automatic.limits);
  } catch (cause) {
    invalid = cause instanceof Error ? cause.message : "Check the rule values.";
  }
  const active = automatic.state !== "off";
  const input = (field: Field, label: string, unit: string, hint?: string) => (
    <div>
      <label class="block text-label-12">
        <span class="mb-1 flex justify-between gap-2">
          <span>{label}</span>
          {hint && <span class="text-jank-text-secondary">{hint}</span>}
        </span>
        <span class="relative block">
          <input
            type="number"
            step="any"
            name={field}
            value={values[field]}
            class="focus-ring h-8 w-full rounded-md border border-jank-control bg-jank-surface pl-2 pr-10 font-mono text-label-13 text-jank-text"
            onInput={(event) => {
              setValues({ ...values, [field]: event.currentTarget.value });
              setError("");
            }}
          />
          <span
            aria-hidden="true"
            class="pointer-events-none absolute inset-y-0 right-2 flex items-center text-jank-text-secondary"
          >
            {unit}
          </span>
          <span class="sr-only">{unit === "s" ? "seconds" : "milliseconds"}</span>
        </span>
      </label>
    </div>
  );
  return (
    <form
      ref={form}
      aria-label="Auto-capture rule"
      noValidate
      class="flex h-172 min-h-0 flex-col text-copy-13"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        try {
          controller.applyRule(settings);
          onClose();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not apply the rule.");
        }
      }}
    >
      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
        <div class="flex items-center justify-between">
          <h2 class="m-0 text-heading-14">Auto-capture rule</h2>
          <span class="text-label-12 text-jank-text-secondary">editing</span>
        </div>
        <Notice tone="pending">
          {active
            ? `Still ${automatic.state} with the active rule: ${automatic.rule.mode === "spike" ? `1 frame > ${withUnit(Number(automatic.rule.thresholdMs.toFixed(3)), "ms")}` : `over budget for ${withUnit(automatic.rule.sustainedMs, "ms")}`}. Changes apply when you re-arm.`
            : "Auto is off. Apply saves the rule without arming it."}
        </Notice>
        {!automatic.limits.episodes && (
          <p class="text-label-12 text-jank-text-secondary">
            This host supports fixed spike windows only.
          </p>
        )}
        <fieldset class="mx-0 min-w-0 p-0">
          <legend class="mb-1 text-label-12">Trigger when</legend>
          <div class="flex rounded-md border border-jank-control p-0.5">
            {(["spike", "sustained", "episode"] as const).map((value) => (
              <label key={value} class="relative flex-1 cursor-pointer">
                <input
                  class="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
                  type="radio"
                  name={`${id}-mode`}
                  value={value}
                  checked={mode === value}
                  disabled={!automatic.limits.episodes && value !== "spike"}
                  onChange={() => {
                    setMode(value);
                    if (value === "episode") setKeep("episode");
                    setError("");
                  }}
                />
                <span class="block rounded-sm py-1.5 text-center text-label-12 peer-checked:bg-gray-200 peer-checked:text-jank-text peer-disabled:opacity-50 peer-focus-visible:outline-2 peer-focus-visible:outline-jank-focus">
                  {{ spike: "Spike", sustained: "Sustained", episode: "Episode" }[value]}
                </span>
              </label>
            ))}
          </div>
          <p class="mt-1 text-label-12 text-jank-text-secondary">
            {mode === "spike"
              ? "A single frame exceeds the threshold."
              : "Every frame stays over budget for a stretch of time."}
          </p>
        </fieldset>
        {mode === "spike"
          ? input("thresholdMs", "Frame threshold", "ms")
          : input("sustainedMs", "Over budget for at least", "ms", `budget ${formatMs(budget)}`)}
        <fieldset class="mx-0 min-w-0 p-0">
          <legend class="mb-1 text-label-12">Keep</legend>
          <div class="flex rounded-md border border-jank-control p-0.5">
            {(["fixed", "episode"] as const).map((value) => (
              <label key={value} class="relative flex-1 cursor-pointer">
                <input
                  class="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
                  type="radio"
                  name={`${id}-keep`}
                  value={value}
                  checked={keep === value}
                  disabled={!automatic.limits.episodes && value === "episode"}
                  onChange={() => {
                    setKeep(value);
                    setError("");
                  }}
                />
                <span class="block rounded-sm py-1.5 text-center text-label-12 peer-checked:bg-gray-200 peer-checked:text-jank-text peer-disabled:opacity-50 peer-focus-visible:outline-2 peer-focus-visible:outline-jank-focus">
                  {value === "fixed" ? "Fixed window" : "Whole episode"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {keep === "episode" && (
          <>
            {input("quietMs", "Quiet recovery", "s")}
            {input("limitMs", "Episode limit", "s")}
            <p class="text-label-12 text-jank-text-secondary">
              Over-budget frames restart quiet recovery. The episode ends at recovery, the time
              limit or capacity.
            </p>
          </>
        )}
        {input("beforeSeconds", "Before trigger", "s")}
        {input("afterSeconds", keep === "episode" ? "After episode" : "After trigger", "s")}
        {input("cooldownMs", "Cooldown", "s", "starts after saving")}
        <figure
          aria-label="Capture window preview"
          class="m-0 flex flex-col gap-1.5 border-t border-jank-divider pt-4"
        >
          <figcaption class="text-label-13 font-medium">Capture window</figcaption>
          {preview ? (
            <>
              <div
                role="img"
                aria-label={`${preview.beforeFrames} frames before, the trigger, ${preview.afterFrames} frames after, then ${preview.cooldownMs / 1000} seconds of cooldown`}
                class="flex h-6 overflow-hidden rounded-md border border-jank-divider font-mono text-[11px]"
              >
                <span
                  class="flex min-w-0 shrink-0 items-center justify-center overflow-hidden whitespace-nowrap bg-gray-200 text-jank-text-secondary"
                  style={{
                    width: `${(69 * preview.beforeFrames) / Math.max(1, preview.beforeFrames + preview.afterFrames)}%`,
                  }}
                  title={`before ${withUnit(secondsLabel(preview.beforeSeconds), "s")}`}
                >
                  before {withUnit(secondsLabel(preview.beforeSeconds), "s")}
                </span>
                <span class="w-0.75 shrink-0 bg-jank-capture" />
                <span
                  class="flex min-w-0 shrink-0 items-center justify-center overflow-hidden whitespace-nowrap bg-purple-200 text-jank-capture"
                  style={{
                    width: `${(69 * preview.afterFrames) / Math.max(1, preview.beforeFrames + preview.afterFrames)}%`,
                  }}
                  title={`after ${withUnit(secondsLabel(preview.afterSeconds), "s")}`}
                >
                  after {withUnit(secondsLabel(preview.afterSeconds), "s")}
                </span>
                <span
                  class="flex min-w-0 flex-1 items-center justify-center overflow-hidden whitespace-nowrap border-l border-dashed border-gray-500 text-jank-text-secondary"
                  title={`cooldown ${withUnit(preview.cooldownMs / 1000, "s")}`}
                >
                  cooldown {withUnit(preview.cooldownMs / 1000, "s")}
                </span>
              </div>
              <p class="text-label-12 text-jank-text-secondary">
                Before and after drawn to scale ({preview.beforeFrames} + {preview.afterFrames}{" "}
                frames at {withUnit(Number((1000 / budget).toFixed(1)), "fps")}); cooldown is not.
                {keep === "episode" &&
                  ` Episode length varies; ${withUnit(preview.limitMs / 1000, "s")} or ${automatic.limits.capacity} frames maximum. Limits can clip after-context.`}
              </p>
            </>
          ) : (
            <p class="text-label-12 text-jank-text-secondary">{invalid}</p>
          )}
        </figure>
      </div>
      <div class="space-y-2 border-t border-jank-divider p-3">
        {error && <Notice tone="error">{error}</Notice>}
        <div class="flex items-center gap-2">
          <Button type="submit" variant="primary">
            {active ? "Apply and re-arm" : "Apply"}
          </Button>
          <Button onPress={onClose}>Cancel</Button>
          <span class="ml-auto text-label-12 text-jank-text-secondary">Esc cancels</span>
        </div>
      </div>
    </form>
  );
}
