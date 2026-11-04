import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatSeconds, withUnit } from "../format.ts";
import { StateBadge } from "../ui/state-badge.tsx";
import type { LiveView } from "./model.ts";

export type PanelMode = "full" | "mini" | "line";

export function captureState(view: LiveView) {
  if (view.recording) return view.capture.mode === "automatic" ? "capturing" : "recording";
  if (view.capture.mode === "automatic" && view.capture.state === "armed") return "armed";
  if (view.capture.mode === "automatic" && view.capture.state === "cooldown") return "cooldown";
  return null;
}

export function StateStrip({
  latest,
  frozen,
  mode,
  recordingSeconds,
  cooldownSeconds,
  loadingCount,
  comparisonProgress,
}: {
  latest: LiveView;
  frozen: boolean;
  mode: PanelMode;
  recordingSeconds?: number | undefined;
  cooldownSeconds?: number | undefined;
  loadingCount?: number | undefined;
  comparisonProgress?: string | undefined;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(0);
  const capture = captureState(latest);
  useLayoutEffect(() => {
    const container = strip.current;
    const content = measure.current;
    if (!container || !content) return;
    const updateFit = () => {
      const fit = [...content.children].findIndex(
        (candidate) => candidate.getBoundingClientRect().width <= container.clientWidth,
      );
      setCompact(fit < 0 ? 2 : fit);
    };
    updateFit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateFit);
    observer.observe(container);
    for (const candidate of content.children) observer.observe(candidate);
    return () => observer.disconnect();
  }, []);
  const badges = (level: number) => (
    <>
      <StateBadge state="live" compact={mode !== "full" || level > 0} />
      {frozen && <StateBadge state="frozen" compact={level > 0} />}
      {capture && (
        <StateBadge
          state={capture}
          compact={level > 1}
          {...(level === 0 &&
          capture === "recording" &&
          mode === "full" &&
          recordingSeconds !== undefined
            ? { detail: formatSeconds(recordingSeconds) }
            : {})}
          {...(level === 0 &&
          capture === "cooldown" &&
          mode === "full" &&
          cooldownSeconds !== undefined
            ? { detail: withUnit(Math.ceil(cooldownSeconds), "s") }
            : {})}
        />
      )}
      {comparisonProgress && (
        <StateBadge
          state="comparing"
          compact={mode !== "full" || level > 0}
          detail={comparisonProgress}
        />
      )}
      {loadingCount !== undefined && (
        <StateBadge
          state="activity"
          compact={mode !== "full" || level > 0}
          {...(level === 0 ? { detail: String(loadingCount) } : {})}
        />
      )}
    </>
  );
  return (
    <div
      ref={strip}
      class={`relative flex min-w-0 items-center ${mode === "line" ? "shrink" : "flex-1"}`}
      data-state-strip
    >
      <span data-state-badges class="absolute flex gap-1">
        {badges(compact)}
      </span>
      <span
        ref={measure}
        aria-hidden="true"
        class="pointer-events-none invisible relative flex w-max shrink-0"
      >
        {[0, 1, 2].map((level) => (
          <span
            key={level}
            class={level === 0 ? "flex gap-1" : "absolute top-0 left-0 flex w-max gap-1"}
          >
            {badges(level)}
          </span>
        ))}
      </span>
    </div>
  );
}
