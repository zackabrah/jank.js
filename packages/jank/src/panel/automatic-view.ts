import type { Profiler } from "../profiler.ts";
import { readCaptureOptions } from "./capture-view.ts";
import { element } from "./dom.ts";

export function createAutomaticView(root: HTMLElement, profiler: Profiler) {
  const preset = element<HTMLSelectElement>(root, "[data-trigger-preset]");
  const threshold = element<HTMLInputElement>(root, '[data-input="thresholdMs"]');
  let latestId: number | undefined;
  function resolvePreset(targetFps: number): void {
    if (preset.value !== "custom") {
      threshold.value = String((Number(preset.value) * 1000) / targetFps);
    }
  }
  function render(targetFps = profiler.snapshot().targetFps): void {
    resolvePreset(targetFps);
    const episodeMode =
      element<HTMLSelectElement>(root, "[data-capture-window]").value === "episode";
    for (const node of root.querySelectorAll<HTMLElement>("[data-time-window]")) {
      node.hidden = !episodeMode;
    }
    for (const node of root.querySelectorAll<HTMLElement>("[data-frame-window]")) {
      node.hidden = episodeMode;
    }
    threshold.readOnly = preset.value !== "custom";
    const state = profiler.capture.getState();
    const armed =
      state.status === "armed" ||
      state.status === "cooldown" ||
      (state.status === "collecting" && state.rearm);
    const toggle = element<HTMLButtonElement>(root, '[data-action="auto-toggle"]');
    toggle.setAttribute("aria-pressed", String(armed));
    toggle.disabled = state.status === "manual";
    const active = profiler.capture.getOptions().thresholdMs;
    const labels = {
      idle: "Disarmed",
      manual: "Manual recording",
      armed: "Armed",
      collecting: "Collecting context",
      cooldown: "Cooldown",
    };
    const suffix =
      state.status === "collecting" && !state.rearm ? " · will disarm after context" : "";
    setText(
      "[data-automatic-status]",
      `${labels[state.status]} · >${active.toFixed(2)} ms${suffix}${state.status === "collecting" && state.episode ? ` · ${state.episode.triggerCount} triggers · ${(state.episode.remainingMs / 1000).toFixed(2)} s to recovery/limit` : ""}`,
    );
    setText(
      "[data-trigger-rule]",
      `Next ARM: >${Number(threshold.value).toFixed(2)} ms · ${(1000 / targetFps).toFixed(2)} ms frame budget. Active rule: >${active.toFixed(2)} ms.`,
    );
    latestId = profiler.capture.list().findLast((capture) => capture.kind === "automatic")?.id;
    element<HTMLElement>(root, "[data-automatic-saved]").hidden = latestId === undefined;
    setText(
      "[data-automatic-notice]",
      latestId === undefined ? "" : `Capture saved · #${latestId} · in memory until exported`,
    );
  }
  function setText(selector: string, text: string): void {
    const node = element(root, selector);
    if (node.textContent !== text) {
      node.textContent = text;
    }
  }
  function arm(): void {
    resolvePreset(profiler.snapshot().targetFps);
    profiler.capture.arm(readCaptureOptions(root));
  }
  return {
    render,
    arm,
    latest: () => latestId,
    toggle(): void {
      const state = profiler.capture.getState();
      if (
        state.status === "armed" ||
        state.status === "cooldown" ||
        (state.status === "collecting" && state.rearm)
      ) {
        profiler.capture.disarm();
      } else {
        arm();
      }
    },
    change(event: Event): void {
      if (event.target === threshold) {
        preset.value = "custom";
      }
      render();
    },
  };
}
