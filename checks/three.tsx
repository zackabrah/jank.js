import { formatMs, plural, withUnit } from "../src/format.ts";
import "./three.css";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ThreeBackend } from "../devtools/three-renderer.ts";
import { type SceneStats, startThreeScene } from "../devtools/three-scene.ts";
import {
  comparisonCandidates,
  type StressSettings,
  stressPresets,
} from "../devtools/three-variants.ts";
import { Button } from "../src/ui/button.tsx";
import { Notice } from "../src/ui/notice.tsx";

const query = new URLSearchParams(location.search);
const backend: ThreeBackend = query.get("backend") === "webgpu" ? "webgpu" : "webgl2";
const compareWith =
  comparisonCandidates.find((name) => name === query.get("compare")) ?? "CPU stress";
const backendName = backend === "webgpu" ? "WebGPU" : "WebGL2";

function Playground() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const host = useRef<Awaited<ReturnType<typeof startThreeScene>> | null>(null);
  const [settings, setSettings] = useState<StressSettings>({ ...stressPresets.Baseline });
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [instancesVisible, setInstancesVisible] = useState(true);
  const [supported, setSupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  useEffect(() => {
    if (!canvas.current || !hud.current) return;
    const abort = new AbortController();
    let closeViewer = () => {};
    void startThreeScene(
      canvas.current,
      hud.current,
      backend,
      abort.signal,
      (value) => {
        if (!abort.signal.aborted) setStats(value);
      },
      (message) => {
        if (!abort.signal.aborted) setError(message);
      },
      async (capture) => {
        const { openRecordingViewer } = await import("../src/viewer/mount.tsx");
        if (abort.signal.aborted) return;
        closeViewer();
        closeViewer = openRecordingViewer(document, capture);
      },
      compareWith,
    )
      .then((scene) => {
        if (abort.signal.aborted) {
          scene.stop();
          return;
        }
        host.current = scene;
        scene.comparison.subscribe(() =>
          setComparing(scene.comparison.getSnapshot().phase !== "idle"),
        );
        setSupported(scene.supported);
        setReady(true);
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Could not start the scene.");
      });
    return () => {
      abort.abort();
      closeViewer();
      host.current = null;
    };
  }, []);
  const apply = (next: StressSettings) => {
    try {
      host.current?.setSettings(next);
      setSettings(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid workload settings.");
    }
  };
  const prepare = async (missing: boolean) => {
    const owner = host.current;
    if (!owner || loading) return;
    setLoading(true);
    setLoadingMessage("");
    try {
      const message = await owner.loadExample(missing);
      if (host.current === owner) setLoadingMessage(message);
    } catch (cause) {
      if (host.current === owner)
        setLoadingMessage(cause instanceof Error ? cause.message : "Could not prepare assets");
    } finally {
      if (host.current === owner) setLoading(false);
    }
  };
  return (
    <main class="p-6">
      <header class="mb-5 flex items-start justify-between gap-4">
        <div>
          <p class="text-label-12 text-jank-text-secondary">JANK / DEVELOPMENT PLAYGROUND</p>
          <h1 class="mt-2 text-heading-24">Three.js · CPU + GPU</h1>
          <p class="mt-2 text-copy-13 text-jank-text-secondary">
            A moving field of instanced shapes. Real probes, deliberately synthetic load.
          </p>
        </div>
        <nav aria-label="Renderer backends" class="space-y-2 text-right text-label-13">
          <p>
            Current backend: <strong>{backendName}</strong>
          </p>
          <p class="flex justify-end gap-4">
            <a
              class="focus-ring underline"
              href="./three.html?backend=webgl2"
              target="_blank"
              rel="noopener"
            >
              Open WebGL2 ↗
            </a>
            <a
              class="focus-ring underline"
              href="./three.html?backend=webgpu"
              target="_blank"
              rel="noopener"
            >
              Open WebGPU ↗
            </a>
          </p>
          <p class="text-label-12 text-jank-text-secondary">
            New tabs preserve this session and its captures.
          </p>
        </nav>
      </header>
      {error && (
        <div key="error" class="mb-4">
          <Notice tone="error">
            <span class="whitespace-pre-wrap wrap-anywhere">{error}</span>
          </Notice>
        </div>
      )}
      <div key="playground" class="playground">
        <section aria-label="Scene and stress controls" class="min-w-0 space-y-4">
          <div class="scene-viewport relative rounded-lg border border-jank-divider">
            <canvas ref={canvas} aria-label={`${backendName} animated instanced scene`} />
            {(!ready || error) && (
              <p role="status" class="absolute top-4 left-4 text-label-13">
                {error
                  ? ready
                    ? "Scene stopped"
                    : `${backendName} unavailable`
                  : `Starting ${backendName}…`}
              </p>
            )}
            <p class="absolute bottom-3 left-3 rounded-md bg-jank-page px-2 py-1 font-mono text-label-12">
              {comparing
                ? "A/B COMPARISON RUNNING"
                : paused
                  ? "WORKLOAD PAUSED"
                  : `${settings.instances} configured ${plural(settings.instances, "instance")} · ${settings.passes} scene ${plural(settings.passes, "pass", "passes")}`}{" "}
              · {stats ? `${stats.width} × ${stats.height}` : "—"}
            </p>
          </div>
          <fieldset
            disabled={!ready || !!error || comparing}
            class="space-y-4 rounded-lg border border-jank-divider bg-jank-surface p-4 disabled:opacity-50"
          >
            <legend class="px-1 text-heading-14">Stress controls</legend>
            {comparing && (
              <p class="text-label-12 text-jank-text-secondary">
                Locked while the comparison switches workloads. Your settings return when it ends.
              </p>
            )}
            <div class="flex flex-wrap gap-2">
              {Object.entries(stressPresets).map(([label, preset]) => (
                <Button
                  key={label}
                  onPress={() => {
                    apply(preset);
                    host.current?.setPaused(false);
                    host.current?.setInstancesVisible(true);
                    setPaused(false);
                    setInstancesVisible(true);
                  }}
                >
                  {label}
                </Button>
              ))}
              <Button
                onPress={() => {
                  host.current?.setPaused(!paused);
                  setPaused(!paused);
                }}
              >
                {paused ? "Resume workload" : "Pause workload"}
              </Button>
              <Button
                onPress={() => {
                  host.current?.setPaused(false);
                  setPaused(false);
                  host.current?.injectSpike();
                }}
              >
                Inject 80 ms CPU spike
              </Button>
            </div>
            <div class="stress-controls">
              {(
                [
                  ["cpuMs", "Extra CPU work", 0, 24, 1, "ms / frame"],
                  ["instances", "Configured instances", 1, 2048, 1, "instance"],
                  ["passes", "GPU scene repeats", 1, 8, 1, "pass"],
                  ["resolution", "Render resolution", 0.5, 2, 0.25, "× CSS pixels"],
                ] as const
              ).map(([key, label, min, max, step, unit]) => (
                <label key={key} class="space-y-2 text-label-13">
                  <span class="flex justify-between gap-2">
                    <span>{label}</span>
                    <span class="font-mono text-label-12 text-jank-text-secondary">
                      {withUnit(
                        settings[key],
                        unit === "pass"
                          ? `${plural(settings[key], "pass", "passes")} / frame`
                          : unit === "instance"
                            ? plural(settings[key], "instance")
                            : unit,
                      )}
                    </span>
                  </span>
                  <input
                    class="focus-ring w-full accent-jank-text"
                    type="range"
                    aria-label={label}
                    min={min}
                    max={max}
                    step={step}
                    value={settings[key]}
                    onInput={(event) =>
                      apply({ ...settings, [key]: event.currentTarget.valueAsNumber })
                    }
                  />
                </label>
              ))}
            </div>
            <label class="flex items-center gap-2 text-label-13">
              <input
                type="checkbox"
                checked={instancesVisible}
                onChange={(event) => {
                  const visible = event.currentTarget.checked;
                  host.current?.setInstancesVisible(visible);
                  setInstancesVisible(visible);
                }}
              />
              Show instanced mesh
            </label>
            <p class="text-label-12 text-jank-text-secondary">
              LIVE counters separate configured, active and submitted instances. Submissions include
              scene repeats; pixel visibility after clipping or occlusion is unavailable.
            </p>
            <label class="flex items-center gap-2 text-label-13">
              <input
                type="checkbox"
                checked={stats?.gpuEnabled ?? true}
                disabled={!supported}
                onChange={(event) => {
                  const enabled = event.currentTarget.checked;
                  try {
                    host.current?.setGpuEnabled(enabled);
                    setStats((current) =>
                      current ? { ...current, gpuEnabled: enabled } : current,
                    );
                  } catch (cause) {
                    setError(
                      cause instanceof Error ? cause.message : "Could not change GPU timing.",
                    );
                  }
                }}
              />
              GPU timing probes
            </label>
            <p role="status" class="text-label-12 text-jank-text-secondary">
              {stats?.gpuStatus ?? "Waiting for renderer initialization"}
            </p>
            <div class="flex flex-wrap gap-2">
              <Button onPress={() => host.current?.injectError("shader")}>
                Trigger shader error
              </Button>
              {backend === "webgpu" && (
                <Button onPress={() => host.current?.injectError("validation")}>
                  Trigger validation error
                </Button>
              )}
            </div>
            <p class="text-label-12 text-jank-text-secondary">
              Fault checks deliberately stop this scene and save an active recording. Reload to
              continue; saved captures stay available until then.
            </p>
          </fieldset>
          <section
            aria-label="A/B comparison"
            class="space-y-2 rounded-lg border border-jank-divider bg-jank-surface p-4"
          >
            <h2 class="text-heading-14">A/B comparison</h2>
            <p class="text-label-12 text-jank-text-secondary">
              Run it from the panel's Compare tab: A is Baseline and B is {compareWith}. Trials
              switch the real workload, resuming a paused scene and showing a hidden mesh, then
              restore your settings. Presets that change several settings report the others as
              confounds.
            </p>
            <nav aria-label="Comparison presets" class="flex flex-wrap gap-4 text-label-13">
              {comparisonCandidates.map((name) => (
                <a
                  key={name}
                  class="focus-ring underline"
                  href={`./three.html?backend=${backend}&compare=${encodeURIComponent(name)}`}
                  target="_blank"
                  rel="noopener"
                  aria-current={name === compareWith ? "page" : undefined}
                >
                  Baseline vs {name} ↗
                </a>
              ))}
            </nav>
          </section>
          <fieldset
            disabled={!ready || !!error}
            class="space-y-3 rounded-lg border border-jank-divider bg-jank-surface p-4 disabled:opacity-50"
          >
            <legend class="px-1 text-heading-14">Loading checks</legend>
            <p class="text-label-12 text-jank-text-secondary">
              Load two real assets in parallel and prepare a cyan object before adding it to the
              scene. Uses the current renderer: this is not a cold-context benchmark. Capture and
              Freeze remain independent.
            </p>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={loading}
                class="focus-ring rounded-md border border-jank-control px-3 py-2 text-label-13 disabled:opacity-50"
                onClick={() => void prepare(false)}
              >
                Load + compile
              </button>
              <button
                type="button"
                disabled={loading}
                class="focus-ring rounded-md border border-jank-control px-3 py-2 text-label-13 disabled:opacity-50"
                onClick={() => void prepare(true)}
              >
                Load missing asset
              </button>
              <button
                type="button"
                disabled={!loading}
                class="focus-ring rounded-md border border-jank-control px-3 py-2 text-label-13 disabled:opacity-50"
                onClick={() => host.current?.cancelLoading()}
              >
                Cancel loading
              </button>
            </div>
            <p
              role="status"
              aria-label="Asset preparation status"
              class="text-label-12 text-jank-text-secondary"
            >
              {loading
                ? stats?.loadingPhase
                : loadingMessage || "Open the Loading tab to inspect preparation."}
            </p>
            <p class="text-label-12 text-jank-text-secondary">
              Cancel aborts supported file requests. Shader compilation may finish in the background
              before cleanup. Cache outcomes stay unknown; received bytes describe file bodies, not
              network traffic.
            </p>
          </fieldset>
          <dl
            aria-label="Scene statistics"
            class="grid grid-cols-4 gap-3 rounded-lg border border-jank-divider p-4 text-label-12"
          >
            {[
              ["CPU simulation", stats ? formatMs(stats.cpuMs, 2) : "—"],
              ["CPU submission", stats ? formatMs(stats.submissionMs, 2) : "—"],
              ["Draw calls", stats?.drawCalls.toLocaleString() ?? "—"],
              ["Triangles", stats?.triangles.toLocaleString() ?? "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt class="text-jank-text-secondary">{label}</dt>
                <dd class="mt-2 font-mono text-label-14">{value}</dd>
              </div>
            ))}
          </dl>
          <p class="text-copy-13 text-jank-text-secondary">
            CPU stress performs extra simulation math. GPU stress repeats the same visible scene at
            a higher resolution; repeated draws also cost CPU submission time. Start with Baseline,
            warm up, then change one control at a time. Timing results describe this workload, not
            GPU utilization.
          </p>
          <p class="text-copy-13 text-jank-text-secondary">
            Use the panel’s Capture tab to record, export and inspect probe evidence. Freeze holds
            the panel display; Pause workload stops simulation and rendering while collection
            continues. WebGPU requires HTTPS or localhost, including when viewing from Jarvis.
          </p>
        </section>
        <aside aria-label="Live Jank panel">
          <div ref={hud} />
        </aside>
      </div>
    </main>
  );
}

const root = document.getElementById("app");
if (!root) throw new Error("Missing playground root");
render(<Playground />, root);
import.meta.hot?.dispose(() => render(null, root));
