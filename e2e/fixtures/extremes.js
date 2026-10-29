// A bare host for e2e/extremes.spec.ts: one monitor on a scripted clock and a mounted panel,
// fed whatever extreme frames, events and counters the test generates.
import { createDiagnostics, createPerformanceTray } from "./index.js";

let now = 0,
  values = {};

const monitor = createDiagnostics({
  now: () => now,
  application: { name: "jank.js extremes", version: "0.1.0" },
});

const engine = monitor.register("engine", "engine", () => values);

const tray = createPerformanceTray({
  shell: document.body,
  monitor,
  mode: "full",
});

window.extremes = {
  /** Plays these frames, with their events and the given counters, then redraws the panel. */
  feed({ frames, events, counters }) {
    values = counters;

    for (const [i, frame] of frames.entries()) {
      monitor.beginFrame(now);

      const work = Math.min(frame.work, frame.interval);

      const token = engine.begin();

      now += work;

      engine.end(token);

      for (const event of events)
        if (event.frame === i) monitor.event(event.label, event.detail);

      monitor.endFrame(work, 0);

      now += frame.interval - work;
    }

    monitor.beginFrame(now);

    tray.refresh(now);
  },
  /** Redraws after a tab or size change. */
  redraw() {
    now += 1000;

    tray.refresh(now);
  },
};
