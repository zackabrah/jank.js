import { useRef, useState } from "preact/hooks";
import { withUnit } from "../format.ts";
import type { DiagnosticFrame, PerformanceRecording } from "../recording/types.ts";
import { Button } from "../ui/button.tsx";
import { DisclosureSection } from "../ui/disclosure-section.tsx";
import { frameEvidence } from "./inspector-model.ts";

export function FrameEvidence({
  recording,
  frame,
}: {
  recording: PerformanceRecording;
  frame: DiagnosticFrame;
}) {
  const root = useRef<HTMLElement>(null);
  const request = useRef(0);
  const [result, setResult] = useState<{ frame: number; text: string; fallback: boolean } | null>(
    null,
  );
  const gpu = recording.gpuTiming?.frames.find((record) => record.frameId === frame.id);
  const copy = async () => {
    const id = ++request.current;
    const text = JSON.stringify(frameEvidence(recording, frame), null, 2);
    let fallback = false;
    try {
      const clipboard = root.current?.ownerDocument.defaultView?.navigator.clipboard;
      if (!clipboard) throw new Error("Clipboard unavailable");
      await clipboard.writeText(text);
    } catch {
      fallback = true;
    }
    if (id === request.current) setResult({ frame: frame.id, text, fallback });
  };
  return (
    <section ref={root} aria-label="Frame evidence">
      <DisclosureSection title="Evidence" summary="Recorded timestamps and precision">
        <div class="space-y-2 py-2 text-label-12 wrap-anywhere">
          <p>
            CPU recording clock · frame start{" "}
            {withUnit((frame.at - frame.interval).toFixed(3), "ms")} · end{" "}
            {withUnit(frame.at.toFixed(3), "ms")}.
          </p>
          <p>
            CPU resolution:{" "}
            {recording.metadata.environment.cpuTimer.estimatedResolutionMs == null
              ? "unknown"
              : withUnit(recording.metadata.environment.cpuTimer.estimatedResolutionMs, "ms")}
            .
          </p>
          <ul class="m-0 max-h-48 list-none space-y-1 overflow-y-auto p-0">
            {frame.scopes.slice(0, 64).map((scope, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: Immutable frame scopes have no retained IDs.
                key={`${frame.id}:${index}`}
              >
                {scope.system} · {scope.label}: {scope.start} → {withUnit(scope.end, "ms")}
              </li>
            ))}
          </ul>
          {frame.scopes.length > 64 && (
            <p>
              Showing 64 of {frame.scopes.length} scopes; Copy frame JSON includes all retained
              records.
            </p>
          )}
          {gpu ? (
            <>
              <p>
                GPU clock · {gpu.source} · epoch {gpu.epoch} · resolution{" "}
                {gpu.resolutionMs == null ? "unknown" : withUnit(gpu.resolutionMs, "ms")}. Offsets
                are relative to this GPU frame, separate from CPU time. Raw nanoseconds were not
                retained.
              </p>
              <ul class="m-0 max-h-48 list-none space-y-1 overflow-y-auto p-0">
                {gpu.invocations.map((pass) => (
                  <li key={pass.id}>
                    {pass.id} · {pass.label} · {pass.kind}: {pass.startMs ?? "unknown"} →{" "}
                    {pass.endMs == null ? "unknown" : withUnit(pass.endMs, "ms")} · {pass.state}
                    {pass.reason ? ` · ${pass.reason}` : ""}
                  </li>
                ))}
              </ul>
              {gpu.omitted > 0 && <p>{gpu.omitted} additional invocations omitted.</p>}
            </>
          ) : (
            <p>No per-frame GPU timestamp evidence retained.</p>
          )}
        </div>
      </DisclosureSection>
      <div class="mt-2">
        <Button
          compact
          onPress={() => {
            void copy();
          }}
        >
          Copy frame JSON
        </Button>
      </div>
      {result?.frame === frame.id && (
        <>
          <p role="status" class="py-2 text-label-12">
            {result.fallback
              ? "Clipboard unavailable. Select and copy the frame JSON below."
              : `Frame f${frame.id} copied.`}
          </p>
          {result.fallback && (
            <section
              // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the read-only copy fallback.
              tabIndex={0}
              aria-label="Frame JSON to copy"
              class="focus-ring max-h-48 overflow-auto whitespace-pre-wrap font-mono text-label-12 wrap-anywhere"
            >
              <pre class="whitespace-pre-wrap">{result.text}</pre>
            </section>
          )}
        </>
      )}
    </section>
  );
}
