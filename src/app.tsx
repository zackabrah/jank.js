import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { SavedCapture } from "./capture/controller.ts";
import { liveFixture } from "./live/fixtures.ts";
import { mountLivePanel } from "./live/panel.tsx";
import { Notice } from "./ui/notice.tsx";

export function App() {
  const [scenario, setScenario] = useState(
    import.meta.env.DEV
      ? new URLSearchParams(location.search).has("demo")
        ? "demo"
        : "live"
      : "sample",
  );
  const [error, setError] = useState("");
  const hudRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = hudRef.current;
    if (!container) throw new Error("Missing LIVE preview mount");
    let cancelled = false;
    let destroy = () => {};
    let closeViewer = () => {};
    let viewerRequest = 0;
    const onOpen = async (capture: SavedCapture) => {
      const request = ++viewerRequest;
      const { openRecordingViewer } = await import("./viewer/mount.tsx");
      if (cancelled || request !== viewerRequest) return;
      closeViewer();
      closeViewer = openRecordingViewer(container.ownerDocument, capture);
    };
    setError("");
    if (import.meta.env.DEV && scenario === "demo") {
      void import("../devtools/synthetic-preview.tsx")
        .then(({ startSyntheticPreview }) => {
          if (!cancelled) destroy = startSyntheticPreview(container);
        })
        .catch((cause: unknown) => {
          if (!cancelled)
            setError(cause instanceof Error ? cause.message : "Could not load the demo");
        });
    } else if (import.meta.env.DEV && scenario === "live") {
      void import("../devtools/live-preview.ts")
        .then(({ startLivePreview }) => {
          if (cancelled) return;
          return startLivePreview(
            container,
            (message) => {
              if (!cancelled) setError(message);
            },
            onOpen,
          );
        })
        .then((cleanup) => {
          if (!cleanup) return;
          if (cancelled) cleanup();
          else destroy = cleanup;
        })
        .catch((cause: unknown) => {
          if (!cancelled)
            setError(cause instanceof Error ? cause.message : "Could not load the collector");
        });
    } else {
      const snapshot = liveFixture(scenario === "empty", scenario === "missing");
      const panel = mountLivePanel(container, {
        onBudgetChange: (milliseconds) => {
          snapshot.diagnostics.budget.frameMs = milliseconds;
          panel.update(snapshot);
        },
      });
      panel.update(snapshot);
      destroy = panel.destroy;
    }
    return () => {
      cancelled = true;
      closeViewer();
      destroy();
    };
  }, [scenario]);

  return (
    <main class="mx-auto max-w-3xl px-6 py-12">
      <header>
        <p class="text-label-13 text-jank-text-secondary">JANK / COMPONENT 06B</p>
        <h1 class="my-3 text-heading-24">Live performance panel</h1>
        <Notice>
          {scenario === "live"
            ? "Real frame and CPU measurements from a small browser simulation, using the local jank.js collector. GPU timing is not connected."
            : import.meta.env.DEV && scenario === "demo"
              ? "Synthetic demonstration: all timings are simulated, not measurements of your device."
              : "Reference samples for design review. These are not live measurements."}
        </Notice>
      </header>
      {import.meta.env.DEV && (
        <p class="mt-4 text-label-13">
          <a href="./checks/three.html" class="focus-ring underline">
            Open the Three.js CPU / GPU playground
          </a>
        </p>
      )}
      <label for="scenario" class="mt-6 mb-2 block text-label-13">
        Preview source
      </label>
      <select
        id="scenario"
        value={scenario}
        onChange={(event) => setScenario(event.currentTarget.value)}
        class="focus-ring h-8 rounded-md border border-jank-control bg-jank-fill px-2 font-sans text-label-13 text-jank-text hover:bg-jank-fill-hover"
      >
        {import.meta.env.DEV && <option value="live">Live browser simulation</option>}
        {import.meta.env.DEV && <option value="demo">Demo: simulated CPU + GPU</option>}
        <option value="sample">Reference: CPU + GPU</option>
        <option value="missing">Reference: compute not observed</option>
        <option value="empty">Reference: waiting for data</option>
      </select>
      {error && (
        <div class="mt-4">
          <Notice tone="error">
            Preview unavailable: {error}. Select another preview source to continue.
          </Notice>
        </div>
      )}
      <div ref={hudRef} id="hud" class="my-6" />
      <p class="max-w-xl text-copy-13 text-jank-text-secondary">
        The host owns collection. The panel refreshes at most four times per second. Open the
        measurement help for timing definitions and overhead limits. While a panel control has
        focus, M cycles layouts and F freezes or resumes the display. In the live simulation, R
        starts or saves a manual recording and A toggles automatic capture.{" "}
        <a href="./viewer.html" class="focus-ring underline">
          Open the recording viewer
        </a>{" "}
        to inspect a local JSON file.
      </p>
    </main>
  );
}
