import { useId, useState } from "preact/hooks";
import type { InstrumentationControl, ReadInstrumentation } from "./instrumentation-model.ts";

const controls = [
  ["gpuTiming", "GPU timing"],
  ["traceEvents", "Trace events"],
] as const;

function read(source?: ReadInstrumentation) {
  try {
    return { settings: source?.() ?? {}, error: "" };
  } catch (cause) {
    return {
      settings: {},
      error: cause instanceof Error ? cause.message : "Could not read instrumentation settings.",
    };
  }
}

function unavailable(control: InstrumentationControl | undefined, label: string, error: string) {
  if (error) return error;
  if (!control || typeof control.enabled !== "boolean")
    return `The host has not supplied ${label.toLowerCase()} settings.`;
  return (
    control.unavailableReason ||
    (control.setEnabled ? "" : `The host does not allow changing ${label.toLowerCase()}.`)
  );
}

export function Instrumentation({
  source,
  onError,
}: {
  source: ReadInstrumentation | undefined;
  onError: (message: string) => void;
}) {
  const id = useId();
  const [, refresh] = useState(0);
  const { settings, error } = read(source);
  return (
    <section aria-label="Instrumentation" class="space-y-3 border-t border-jank-divider pt-3">
      <h2 class="text-heading-14">Instrumentation</h2>
      {controls.map(([key, label]) => {
        const control = settings[key];
        const reason = unavailable(control, label, error);
        const known = !error && typeof control?.enabled === "boolean";
        const enabled = known && control?.enabled === true;
        return (
          <div key={key}>
            <div class="flex min-h-8 items-center justify-between gap-3">
              <span id={`${id}-${key}-label`} class="text-label-13">
                {label}
              </span>
              <div class="flex items-center gap-2">
                <span aria-hidden="true" class="text-label-12 text-jank-text-secondary">
                  {known ? (enabled ? "On" : "Off") : "Unavailable"}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-disabled={!!reason}
                  aria-labelledby={`${id}-${key}-label`}
                  aria-describedby={reason ? `${id}-${key}-reason` : `${id}-help`}
                  class="focus-ring inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-jank-control bg-jank-fill p-0.5 aria-checked:border-jank-text aria-checked:bg-jank-text aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  onClick={() => {
                    const latest = read(source);
                    const current = latest.settings[key];
                    const blocked = unavailable(current, label, latest.error);
                    try {
                      if (blocked || !current?.setEnabled) onError(blocked);
                      else {
                        current.setEnabled(!current.enabled);
                        onError("");
                      }
                    } catch (cause) {
                      onError(
                        cause instanceof Error
                          ? cause.message
                          : `Could not change ${label.toLowerCase()}.`,
                      );
                    } finally {
                      refresh((value) => value + 1);
                    }
                  }}
                >
                  <span
                    aria-hidden="true"
                    class={`block size-4 rounded-full ${enabled ? "translate-x-4 bg-jank-surface" : "bg-jank-text-secondary"}`}
                  />
                </button>
              </div>
            </div>
            {reason && (
              <p id={`${id}-${key}-reason`} class="mt-1 text-label-12 text-jank-text-secondary">
                {reason}
              </p>
            )}
          </div>
        );
      })}
      <p class="flex justify-between gap-2 text-label-12 text-jank-text-secondary">
        <span>CPU scopes</span>
        <span>Requested by host</span>
      </p>
      <p id={`${id}-help`} class="text-label-12 text-jank-text-secondary">
        Trace events emit browser performance entries; they do not start a DevTools recording.
        Instrumentation adds overhead. GPU timing changes can reject pending results.
      </p>
    </section>
  );
}
