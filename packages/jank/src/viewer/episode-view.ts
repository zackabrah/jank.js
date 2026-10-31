import type { Recording } from "../recordings/recording.ts";
import { element } from "./dom.ts";

export function renderEpisode(root: HTMLElement, recording: Recording | null): void {
  const capture = recording?.capture;
  const episode = capture?.kind === "automatic" ? capture.episode : undefined;
  element<HTMLElement>(root, "[data-episode-controls]").hidden = !episode;
  const button = element<HTMLButtonElement>(
    root,
    '[data-capture-action="export"]:not([data-capture-frame])',
  );
  button.textContent = episode ? "EXPORT EPISODE" : "EXPORT CAPTURE";
  button.setAttribute(
    "aria-label",
    episode ? "Export selected episode" : "Export selected capture",
  );
  const select = element<HTMLSelectElement>(root, "[data-episode-trigger]");
  select.replaceChildren();
  if (!episode || !recording) {
    return;
  }
  const window = episode.timeWindow;
  element<HTMLElement>(root, "[data-episode-summary]").textContent =
    `Slowdown episode · ${episode.triggerFrameIds.length} triggers · ${episode.stopReason}. Requested ${(window.beforeMs / 1000).toFixed(2)} s before, at least ${(window.afterMs / 1000).toFixed(2)} s after first trigger, ${(window.recoveryMs / 1000).toFixed(2)} s quiet recovery. Limit ${(window.maxDurationMs / 1000).toFixed(2)} s after first trigger / 6,000 frames. Cooldown ${(episode.cooldownMs / 1000).toFixed(2)} s. ${recording.truncated ? "Truncated: context, measurements or an episode limit prevented completeness." : "Retained episode context complete; GPU coverage is reported separately."} Export includes every retained frame and trigger.`;
  const placeholder = root.ownerDocument.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose trigger…";
  select.append(placeholder);
  const frames = new Map(recording.frames.map((frame) => [frame.id, frame]));
  for (const id of episode.triggerFrameIds) {
    const frame = frames.get(id);
    if (!frame) {
      continue;
    }
    const option = root.ownerDocument.createElement("option");
    option.value = String(id);
    option.textContent = `#${id} · ${(frame.endedAtMs - frame.startedAtMs).toFixed(2)} ms`;
    select.append(option);
  }
}
