import type { GpuProfile } from "../types/gpu-profile-types.ts";

export interface ThreeTimestampRenderer {
  info: { frame: number };
  backend: unknown;
  hasFeature(name: string): boolean;

  resolveTimestampsAsync(
    type?: "render" | "compute",
  ): Promise<number | undefined>;
}

interface TimestampBackend {
  isWebGPUBackend: true;
  trackTimestamp: boolean;
  getTimestampFrames(type: string): unknown;
}

function isTimestampBackend(value: unknown): value is TimestampBackend {
  return (
    typeof value === "object" &&
    value !== null &&
    "isWebGPUBackend" in value &&
    value.isWebGPUBackend === true &&
    "trackTimestamp" in value &&
    typeof value.trackTimestamp === "boolean" &&
    "getTimestampFrames" in value &&
    typeof value.getTimestampFrames === "function"
  );
}

/** Narrow adapter for Three r186's WebGPU backend. Initialize the renderer with
 * trackTimestamp:true first. This adapter exclusively owns render timestamp resolution.
 * It reports the sum of render-pass times, never mislabels it as GPU queue span. */
export function createThreeWebGpuSource(
  renderer: ThreeTimestampRenderer,
  options: { revision: string; onSample?: (profile: GpuProfile) => void },
) {
  if (options.revision !== "186")
    throw new Error("The WebGPU adapter is verified only with Three.js r186");

  const backend = isTimestampBackend(renderer.backend)
    ? renderer.backend
    : null;

  const supported = backend !== null && renderer.hasFeature("timestamp-query");

  const originalTracking = backend?.trackTimestamp ?? false;

  let enabled = supported && originalTracking,
    disposed = false,
    inFlight = false,
    generation = 0,
    lastFrame = -1,
    boundary = -1;

  let dropped = 0;

  const frameLinks = new Map<number, number>();

  let profile: GpuProfile = {
    available: supported,
    enabled,
    status: !supported ? "unsupported" : enabled ? "pending" : "disabled",
    currentFrame: renderer.info.frame,
    sampleFrame: null,
    sampleAgeFrames: null,
    diagnosticFrame: null,
    gpuMilliseconds: null,
    passes: [],
    droppedFrames: 0,
    truncatedPasses: 0,
    error: null,
  };

  const read = (): GpuProfile => ({
    ...profile,
    currentFrame: renderer.info.frame,
    sampleAgeFrames:
      profile.sampleFrame === null
        ? null
        : Math.max(0, renderer.info.frame - profile.sampleFrame),
    droppedFrames: dropped,
    passes: profile.passes.map((pass) => ({ ...pass })),
  });

  function captureFrame(diagnosticFrame: number): void {
    if (disposed || !enabled || !backend) return;

    if (
      !Number.isSafeInteger(diagnosticFrame) ||
      diagnosticFrame < 1 ||
      !Number.isSafeInteger(renderer.info.frame)
    )
      throw new RangeError(
        "Frame IDs must be positive diagnostics IDs and integer renderer IDs",
      );

    const nativeFrame = renderer.info.frame;

    frameLinks.set(nativeFrame, diagnosticFrame);

    if (frameLinks.size > 600) {
      frameLinks.delete(frameLinks.keys().next().value!);

      dropped++;
    }

    if (inFlight) return;

    inFlight = true;

    const epoch = generation;

    void renderer
      .resolveTimestampsAsync("render")
      .then((duration) => {
        if (disposed || epoch !== generation || !enabled) return undefined;

        const frames = backend.getTimestampFrames("render");

        if (
          !Array.isArray(frames) ||
          !frames.every(
            (frame: unknown) =>
              typeof frame === "number" &&
              Number.isSafeInteger(frame) &&
              frame >= 0,
          )
        )
          throw new Error("Unexpected timestamp frame data from Three.js");

        const sampleFrame = Math.max(-1, ...frames);

        // A fulfilled promise is not evidence of a fresh sample: Three may reuse an
        // in-flight resolve or return its last value after a readback failure.
        if (
          sampleFrame <= lastFrame ||
          sampleFrame <= boundary ||
          duration === undefined
        )
          return undefined;

        if (!Number.isFinite(duration) || duration < 0)
          throw new Error("Invalid GPU duration");

        lastFrame = sampleFrame;

        profile = {
          ...profile,
          status: "ready",
          enabled: true,
          sampleFrame,
          diagnosticFrame: frameLinks.get(sampleFrame) ?? null,
          gpuMilliseconds: null,
          passes: [
            { label: "Three.js render passes (sum)", milliseconds: duration },
          ],
          error: null,
        };

        for (const id of frameLinks.keys())
          if (id <= sampleFrame) frameLinks.delete(id);

        options.onSample?.(read());

        return undefined;
      })
      .catch((error: unknown) => {
        if (disposed || epoch !== generation) return;

        profile = {
          ...profile,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      })
      .finally(() => {
        inFlight = false;
      });
  }

  return {
    read,
    captureFrame,
    setEnabled(value: boolean) {
      if (disposed || !supported || !backend || enabled === value) return;

      enabled = value;

      generation++;

      boundary = renderer.info.frame;

      frameLinks.clear();

      backend.trackTimestamp = value;

      profile = {
        ...profile,
        enabled,
        status: enabled ? "pending" : "disabled",
        sampleFrame: null,
        sampleAgeFrames: null,
        diagnosticFrame: null,
        passes: [],
        error: null,
      };
    },
    dispose() {
      if (disposed) return;

      disposed = true;

      generation++;

      frameLinks.clear();

      if (backend && backend.trackTimestamp === enabled)
        backend.trackTimestamp = originalTracking;

      profile = {
        ...profile,
        enabled: false,
        status: supported ? "disabled" : "unsupported",
      };
    },
  };
}

export type ThreeWebGpuSource = ReturnType<typeof createThreeWebGpuSource>;
