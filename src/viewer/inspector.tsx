import type { ComponentProps } from "preact";
import { useId, useMemo, useRef } from "preact/hooks";
import { formatSeconds, withUnit } from "../format.ts";
import { Button } from "../ui/button.tsx";
import { CaptureContext } from "./capture-context.tsx";
import { FrameDetails } from "./frame-details.tsx";

const tabs = ["Frame", "Recording", "Captures"] as const;
export type InspectorTab = (typeof tabs)[number];

export function Inspector({
  tab,
  onTab,
  name,
  onSelect,
  ...details
}: ComponentProps<typeof FrameDetails> & {
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  name: string;
  onSelect: (index: number) => void;
}) {
  const id = useId();
  const frameTab = useRef<HTMLButtonElement>(null);
  const chooseTab = (next: InspectorTab) => {
    onTab(next);
    const aside = frameTab.current?.closest("aside");
    if (aside) aside.scrollTop = 0;
  };
  const inspect = (index: number) => {
    chooseTab("Frame");
    onSelect(index);
    frameTab.current?.focus();
  };
  const { recording, summary } = details;
  const { metadata, capture } = recording;
  const environment = metadata.environment;
  const completeFrames = useMemo(
    () =>
      recording.frames.filter((frame) => frame.coverage === "complete" && !frame.droppedScopes)
        .length,
    [recording],
  );
  const fields = [
    ["File", name],
    [
      "Application",
      metadata.application
        ? `${metadata.application.name} ${metadata.application.version ?? ""}`
        : "Not supplied",
    ],
    ["Created", metadata.createdAt ?? "Not supplied"],
    ["jank version", metadata.jankVersion ?? "Unknown"],
    [
      "Format",
      `v${recording.version}${metadata.importedFromVersion === null ? "" : ` · imported from v${metadata.importedFromVersion}`}`,
    ],
    ["Frames / capacity", `${recording.frames.length} / ${recording.frameCapacity}`],
    ["Counter snapshots / events", `${recording.samples.length} / ${recording.events.length}`],
    ["CPU coverage", `${completeFrames}/${recording.frames.length} complete frames`],
    [
      "CPU timer",
      `${environment.cpuTimer.source} · ${environment.cpuTimer.estimatedResolutionMs == null ? "resolution unknown" : `${withUnit(environment.cpuTimer.estimatedResolutionMs, "ms")} resolution`}`,
    ],
    [
      "GPU evidence",
      `${recording.gpuTiming?.frames.length ?? 0} linked frame records · separate GPU clock`,
    ],
    ["Platform", environment.platform ?? "Unknown"],
    ["Browser", environment.userAgent ?? "Unknown"],
    ["Logical processors", environment.hardwareConcurrency ?? "Unknown"],
    [
      "Viewport",
      environment.viewport
        ? `${environment.viewport.width} × ${environment.viewport.height} · DPR ${environment.viewport.pixelRatio}`
        : "Unknown",
    ],
    [
      "Cross-origin isolated",
      environment.crossOriginIsolated === null
        ? "Unknown"
        : environment.crossOriginIsolated
          ? "Yes"
          : "No",
    ],
    ["Dev tools", metadata.devTools ? "Enabled" : "Disabled"],
  ];
  return (
    <>
      <div
        role="tablist"
        aria-label="Inspector"
        class="sticky top-0 z-10 flex border-b border-jank-divider bg-jank-surface px-4"
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
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}
      >
        {tabs.map((label) => (
          <button
            key={label}
            ref={label === "Frame" ? frameTab : null}
            id={`${id}-${label}`}
            type="button"
            role="tab"
            aria-selected={tab === label}
            aria-controls={`${id}-panel`}
            tabIndex={tab === label ? 0 : -1}
            onClick={() => chooseTab(label)}
            class="focus-ring border-b-2 border-transparent px-3 py-3 text-label-13 text-jank-text-secondary aria-selected:border-jank-text aria-selected:text-jank-text"
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${tab}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The tab panel needs a keyboard entry point for its static content.
        tabIndex={0}
        class="focus-ring"
      >
        {tab === "Frame" && <FrameDetails {...details} />}
        {tab === "Recording" && (
          <section aria-label="Recording metadata" class="space-y-3 p-4 text-copy-13">
            <h2 class="m-0 text-heading-16">Recording</h2>
            <dl class="divide-y divide-jank-divider">
              {fields.map(([label, value]) => (
                <div key={label} class="py-2">
                  <dt class="text-label-12 text-jank-text-secondary">{label}</dt>
                  <dd class="mt-1 wrap-anywhere">{value}</dd>
                </div>
              ))}
            </dl>
            <p class="text-label-12 text-jank-text-secondary">
              Metadata describes the recording environment, not this browser. No file data is
              uploaded.
            </p>
          </section>
        )}
        {tab === "Captures" && (
          <>
            <section aria-label="Current capture" class="space-y-3 p-4 text-copy-13">
              <h2 class="m-0 text-heading-16">Current capture</h2>
              <p class="capitalize">
                {capture.mode} · {capture.state}
              </p>
              <p class="wrap-anywhere">{name}</p>
              <p class="font-mono text-label-12">
                {recording.frames.length} frames · {formatSeconds(summary.durationMs / 1000, 2)}
              </p>
              <div class="flex flex-wrap gap-2">
                <Button compact onPress={() => inspect(0)}>
                  First frame
                </Button>
                {summary.triggerIndex >= 0 && (
                  <Button compact onPress={() => inspect(summary.triggerIndex)}>
                    Inspect trigger
                  </Button>
                )}
                <Button compact onPress={() => inspect(recording.frames.length - 1)}>
                  Last frame
                </Button>
              </div>
              <p class="text-label-12 text-jank-text-secondary">
                This file contains one capture. Use Open file to inspect another.
              </p>
            </section>
            <CaptureContext recording={recording} summary={summary} />
          </>
        )}
      </div>
    </>
  );
}
