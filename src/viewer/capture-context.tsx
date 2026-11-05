import { describeRule } from "../capture/rules.ts";
import { formatSeconds, plural } from "../format.ts";
import type { PerformanceRecording } from "../recording/types.ts";
import type { RecordingInspection } from "./inspection.ts";

export function CaptureContext({
  recording,
  summary,
}: {
  recording: PerformanceRecording;
  summary: RecordingInspection;
}) {
  const context = recording.capture.context;
  const window = summary.window;
  if (!window) return null;
  return (
    <section
      aria-label="Capture window details"
      class="border-t border-jank-divider p-4 text-copy-13"
    >
      <h2 class="m-0 text-heading-14">Capture window</h2>
      <p class="py-2 font-mono text-label-12">
        f{recording.frames[0]?.id} → f{recording.frames.at(-1)?.id}
      </p>
      <p>
        Before context: {window.before ?? "unknown"} of {window.requestedBefore} requested frames
        {window.before !== null && window.before < window.requestedBefore && " · clipped"}.
      </p>
      <p>
        After context: {window.after ?? "unknown"} of {window.requestedAfter} requested frames
        {window.after !== null && window.after < window.requestedAfter && " · clipped"}.
      </p>
      {!context && (
        <p class="py-2 text-label-12 text-jank-text-secondary">
          No episode metadata supplied; onset and recovery phases are unknown.
        </p>
      )}
      {recording.capture.triggerFrame !== null && summary.triggerIndex < 0 && (
        <p>Trigger f{recording.capture.triggerFrame} is outside the retained frames.</p>
      )}
      {context && (
        <section
          aria-label="Automatic capture context"
          class="mt-3 space-y-2 border-t border-jank-divider pt-3 text-copy-13 text-jank-text-secondary"
        >
          <h2 class="m-0 text-heading-14 text-jank-text">
            Auto · {context.rule.mode} ·{" "}
            {context.rule.keep === "episode" ? "whole episode" : "fixed window"}
          </h2>
          <p>{describeRule(context.rule)}</p>
          <p class="font-mono text-label-12">
            Onset f{context.onsetFrame} · trigger f{recording.capture.triggerFrame} · end f
            {context.endFrame} · {context.crossings} qualifying {plural(context.crossings, "frame")}{" "}
            · {formatSeconds((context.endAt - context.onsetAt) / 1000, 2)} to end
          </p>
          <p>
            {
              {
                window: "Fixed window collected",
                recovered: "Quiet recovery reached",
                limit: "Clipped at the episode time limit",
                capacity: "Clipped at recording capacity",
                stopped: "Stopped by the host",
              }[context.reason]
            }
            .
            {recording.frames[0] &&
              context.onsetFrame < recording.frames[0].id &&
              " Onset precedes the retained window."}
          </p>
        </section>
      )}
    </section>
  );
}
