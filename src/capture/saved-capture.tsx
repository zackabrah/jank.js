import { useMemo } from "preact/hooks";
import { formatMs, withUnit } from "../format.ts";
import { summarizeRecording } from "../recording/summary.ts";
import { Button, IconButton } from "../ui/button.tsx";
import type { SavedCapture } from "./controller.ts";

export function CaptureSummary({
  capture,
  notice = false,
}: {
  capture: SavedCapture;
  notice?: boolean;
}) {
  const summary = useMemo(() => summarizeRecording(capture.recording), [capture]);
  const automatic = capture.recording.capture.mode === "automatic";
  const highlight = automatic ? capture.recording.frames[summary.triggerIndex] : summary.worst;
  const seconds = Math.max(0, Math.floor((Date.now() - capture.savedAt) / 1000));
  const age =
    seconds < 60
      ? `${withUnit(seconds, "s")} ago`
      : `${withUnit(Math.floor(seconds / 60), "min")} ago`;
  const metadata = `${age} · ${withUnit(capture.recording.frames.length, "f")} · GPU ${summary.gpuLabel}`;
  return (
    <span class="block min-w-0 flex-1">
      <span class="block truncate text-label-12">
        {notice
          ? `Capture C${capture.id} saved`
          : automatic
            ? `Auto · ${capture.recording.capture.context?.rule.mode ?? "spike"} `
            : "Manual · worst "}
        {!notice && (
          <span
            data-over={highlight && highlight.interval > summary.overLimit ? "" : undefined}
            class="font-mono data-over:text-jank-over"
          >
            {highlight ? formatMs(highlight.interval) : "unknown"}
          </span>
        )}
      </span>
      <span
        class="block truncate font-mono text-label-12 text-jank-text-secondary"
        title={metadata}
      >
        {notice
          ? highlight
            ? `${automatic ? "trigger" : "worst"} ${formatMs(highlight.interval)} · f${highlight.id}`
            : "No completed frames"
          : metadata}
      </span>
    </span>
  );
}

export function CaptureActions({
  capture,
  onOpen,
  onExport,
  primary = false,
}: {
  capture: SavedCapture;
  onOpen: (capture: SavedCapture) => void;
  onExport: (capture: SavedCapture) => void;
  primary?: boolean;
}) {
  return (
    <>
      <Button compact variant={primary ? "primary" : "secondary"} onPress={() => onOpen(capture)}>
        Open
      </Button>
      <IconButton compact label={`Export capture C${capture.id}`} onPress={() => onExport(capture)}>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          class="size-4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M8 2v8m-3-3 3 3 3-3M3 11v3h10v-3" />
        </svg>
      </IconButton>
    </>
  );
}
