import { useId } from "preact/hooks";
import { formatSeconds, withUnit } from "../format.ts";
import { Button } from "../ui/button.tsx";
import type { CaptureConnection, CaptureState } from "./controller.ts";
import { compileRule, describeRule } from "./rules.ts";

export function AutomaticCaptureCard({
  controller,
  state,
  budget,
  onEditRule,
}: {
  controller: CaptureConnection["controller"];
  state: CaptureState;
  budget: number;
  onEditRule: () => void;
}) {
  const reasonId = useId();
  const automatic = state.automatic;
  const reason = controller.autoUnavailable();
  const active = automatic !== null && automatic.state !== "off";
  let sentence = automatic ? describeRule(automatic.rule) : "";
  if (automatic && !active) {
    try {
      sentence = describeRule(compileRule(controller.getRuleSettings(), budget, automatic.limits));
    } catch {
      sentence =
        "The configured window exceeds this budget's host limits. Edit the rule before arming.";
    }
  }
  const word = automatic
    ? { off: "Off", armed: "Armed", capturing: "Capturing", cooldown: "Cooldown" }[automatic.state]
    : "Unavailable";
  return (
    <section
      aria-label="Auto-capture"
      class="space-y-2 rounded-md border border-jank-divider bg-jank-surface p-3"
    >
      <div class="flex items-center justify-between gap-2">
        <h2 class="m-0 text-heading-14">Auto-capture</h2>
        <span class="flex items-center gap-2 text-label-12 text-jank-capture">
          <span aria-hidden="true">{word}</span>
          <button
            type="button"
            role="switch"
            aria-label="Automatic capture"
            aria-checked={active}
            aria-disabled={!!reason}
            aria-describedby={reason ? reasonId : undefined}
            class="focus-ring flex h-6 w-9 items-center rounded-full border border-jank-control bg-gray-200 px-0.5 aria-checked:justify-end aria-checked:bg-purple-700 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            onClick={controller.toggleAuto}
          >
            <span class="size-4 rounded-full bg-jank-text" />
          </button>
        </span>
      </div>
      {reason && (
        <p id={reasonId} class="text-label-12 text-jank-text-secondary">
          {reason}
        </p>
      )}
      {automatic && (
        <>
          <p class="text-label-12 text-jank-text-secondary">{sentence}</p>
          {automatic.state === "capturing" && automatic.stage === "episode" && (
            <p class="font-mono text-label-12 text-jank-capture">
              Episode {formatSeconds(automatic.episodeMs / 1000, 2)} · waiting for{" "}
              {withUnit(automatic.rule.quietMs / 1000, "s")} quiet
            </p>
          )}
          {automatic.state === "capturing" && automatic.stage === "after" && (
            <div>
              <p class="mb-1 flex justify-between text-label-12 text-jank-capture">
                <span>Collecting after-context</span>
                <span class="font-mono">
                  {automatic.rule.afterFrames - automatic.remainingFrames} /{" "}
                  {automatic.rule.afterFrames} frames
                </span>
              </p>
              <div
                role="progressbar"
                aria-label="Automatic after-context"
                aria-valuemin={0}
                aria-valuemax={automatic.rule.afterFrames}
                aria-valuenow={automatic.rule.afterFrames - automatic.remainingFrames}
                class="h-1.5 overflow-hidden rounded-full bg-jank-track"
              >
                <div
                  class="h-full bg-jank-capture"
                  style={{
                    width: `${(100 * (automatic.rule.afterFrames - automatic.remainingFrames)) / Math.max(1, automatic.rule.afterFrames)}%`,
                  }}
                />
              </div>
            </div>
          )}
          {automatic.state === "cooldown" && (
            <p class="font-mono text-label-12 text-jank-capture">
              Re-arms in {formatSeconds(automatic.cooldownRemainingMs / 1000)}
            </p>
          )}
          {automatic.state === "armed" && (
            <p class="text-label-12 text-jank-capture">
              {automatic.rule.mode === "spike"
                ? "Waiting for a spike"
                : "Waiting for sustained over-budget frames"}
            </p>
          )}
          <span data-rule-edit class="block">
            <Button compact onPress={onEditRule}>
              Edit rule
            </Button>
          </span>
        </>
      )}
    </section>
  );
}
