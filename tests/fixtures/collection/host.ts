import {
  createProfiler,
  type Recording,
  serializeRecording,
} from "../../../packages/jank/src/index.ts";

function element(id: string): HTMLElement {
  const result = document.getElementById(id);
  if (!result) {
    throw new Error(`Missing fixture element: ${id}`);
  }
  return result;
}

let counterPolls = 0;
let iterations = 0;
const collector = createProfiler();
const physics = collector.createChannel({
  id: "physics",
  label: "Physics",
  readCounters: () => {
    counterPolls += 1;
    return { iterations };
  },
});
const releaseScopes = collector.requestScopes();
const hostFrames = element("host-frames");
const sealedFrames = element("sealed-frames");
const frameId = element("frame-id");
const scopes = element("scopes");
const result = element("result");
let hostFrameCount = 0;
let recording: Recording | null = null;

function frame(atMs: number): void {
  hostFrameCount += 1;
  collector.beginFrame(atMs);
  const token = physics.begin();
  const startMs = performance.now();
  let total = 0;
  // Span a measurable clock interval even when WebKit rounds time to milliseconds.
  // Consume real work and report its actual count; this fixture is not a throughput benchmark.
  iterations = 0;
  do {
    for (let index = 0; index < 20_000; index += 1) {
      total += Math.sin(index + iterations + hostFrameCount);
    }
    iterations += 20_000;
  } while (performance.now() - startMs < 1);
  physics.end(token);
  collector.endFrame({ updateMs: performance.now() - startMs, renderMs: 0 });
  collector.measureRefresh(() => {
    const snapshot = collector.snapshot();
    hostFrames.textContent = String(hostFrameCount);
    sealedFrames.textContent = String(snapshot.frames.length);
    frameId.textContent = String(snapshot.frames.at(-1)?.id ?? 0);
    scopes.textContent = String(
      snapshot.frames.reduce((count, sample) => count + sample.scopes.length, 0),
    );
    result.textContent = total.toFixed(3);
    const capture = collector.capture.getState();
    element("recorded-frames").textContent = String(
      capture.status === "manual" ? capture.recordedFrames : (recording?.frames.length ?? 0),
    );
    element("counter-polls").textContent = String(counterPolls);
  });
  requestAnimationFrame(frame);
}

element("clear").addEventListener("click", () => collector.clear());
element("start-recording").addEventListener("click", () => {
  counterPolls = 0;
  element("counter-polls").textContent = "0";
  collector.capture.start();
});
element("stop-recording").addEventListener("click", () => {
  recording = collector.capture.stop();
  if (recording) {
    element("export-recording").removeAttribute("disabled");
  }
});
element("export-recording").addEventListener("click", () => {
  if (!recording) {
    return;
  }
  const url = URL.createObjectURL(
    new Blob([serializeRecording(recording)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "jank-recording.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
element("dispose").addEventListener("click", () => {
  releaseScopes();
  physics.dispose();
  collector.dispose();
});
requestAnimationFrame(frame);
