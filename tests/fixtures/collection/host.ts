import { createFrameCollector } from "../../../packages/jank/src/core/collector.ts";

function element(id: string): HTMLElement {
  const result = document.getElementById(id);
  if (!result) {
    throw new Error(`Missing fixture element: ${id}`);
  }
  return result;
}

const collector = createFrameCollector({ now: () => performance.now() });
const physics = collector.createChannel({ id: "physics", label: "Physics" });
const releaseScopes = collector.requestScopes();
const hostFrames = element("host-frames");
const sealedFrames = element("sealed-frames");
const frameId = element("frame-id");
const scopes = element("scopes");
const result = element("result");
let hostFrameCount = 0;

function frame(atMs: number): void {
  hostFrameCount += 1;
  collector.beginFrame(atMs);
  const startMs = performance.now();
  const token = physics.begin();
  let total = 0;
  // A small real CPU workload; the result is consumed so it cannot be discarded.
  for (let index = 0; index < 20_000; index += 1) {
    total += Math.sin(index + hostFrameCount);
  }
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
  });
  requestAnimationFrame(frame);
}

element("clear").addEventListener("click", () => collector.clear());
element("dispose").addEventListener("click", () => {
  releaseScopes();
  physics.dispose();
  collector.dispose();
});
requestAnimationFrame(frame);
