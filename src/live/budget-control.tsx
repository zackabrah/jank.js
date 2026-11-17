import { useEffect, useId, useRef, useState } from "preact/hooks";
import { formatMs, withUnit } from "../format.ts";
import { Button } from "../ui/button.tsx";
import { validateSelectedBudget } from "./model.ts";

export function BudgetControl({
  budget,
  onChange,
}: {
  budget: number;
  onChange?: ((milliseconds: number) => void) | undefined;
}) {
  const id = useId();
  const select = useRef<HTMLSelectElement>(null);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(String(Number(budget.toFixed(3))));
  useEffect(() => setDraft(String(Number(budget.toFixed(3)))), [budget]);
  const [error, setError] = useState("");
  const preset = [30, 60, 120].find((fps) => Math.abs(1000 / fps - budget) < 0.000001);
  const close = () => {
    setError("");
    setCustom(false);
    select.current?.focus();
  };
  const apply = (milliseconds: number) => {
    try {
      validateSelectedBudget(milliseconds);
      onChange?.(milliseconds);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the frame budget.");
    }
  };
  if (!onChange)
    return (
      <span class="ml-auto inline-flex h-8 items-center whitespace-nowrap font-mono text-label-12 text-jank-text-secondary">
        {formatMs(budget)} budget
      </span>
    );
  return (
    <div class="min-w-0 flex-1">
      <div class="relative">
        <select
          ref={select}
          aria-label="Frame budget"
          value={custom ? "custom" : (preset ?? "current")}
          class="focus-ring h-8 w-full appearance-none rounded-md border border-jank-control bg-jank-fill px-2 font-mono text-label-12 text-transparent"
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === "custom") {
              setDraft(String(Number(budget.toFixed(3))));
              setCustom(true);
              setError("");
            } else if (value === "current") close();
            else apply(1000 / Number(value));
          }}
        >
          {[30, 60, 120].map((fps) => (
            <option key={fps} value={fps} class="bg-jank-fill text-jank-text">
              {formatMs(1000 / fps)} · {withUnit(fps, "FPS")}
            </option>
          ))}
          {preset === undefined && (
            <option value="current" class="bg-jank-fill text-jank-text">
              {formatMs(budget)} · Custom
            </option>
          )}
          <option value="custom" class="bg-jank-fill text-jank-text">
            Custom ms…
          </option>
        </select>
        <span
          aria-hidden="true"
          class="pointer-events-none absolute inset-y-0 right-6 left-2 flex items-center overflow-hidden whitespace-nowrap font-mono text-label-12 text-jank-text"
        >
          {custom ? "Custom ms…" : formatMs(budget)}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          class="pointer-events-none absolute top-2 right-1 size-4 text-jank-text-secondary"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </div>
      {custom && (
        <form
          class="mt-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            apply(Number(draft));
          }}
        >
          <label for={id} class="mb-1 block text-label-12">
            Custom budget (ms)
          </label>
          <div class="flex gap-1">
            <input
              id={id}
              type="number"
              min="1"
              max="1000"
              step="any"
              required
              value={draft}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-error` : undefined}
              class="focus-ring h-8 min-w-0 flex-1 rounded-md border border-jank-control bg-jank-fill px-2 font-mono text-label-13 text-jank-text"
              onInput={(event) => setDraft(event.currentTarget.value)}
            />
            <Button onPress={() => apply(Number(draft))}>Apply</Button>
            <Button onPress={close}>Cancel</Button>
          </div>
        </form>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" class="mt-2 text-copy-13 text-jank-error">
          {error}
        </p>
      )}
    </div>
  );
}
