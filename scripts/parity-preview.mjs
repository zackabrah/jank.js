import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const referenceAssets = new Map([
  ["index.js", "text/javascript"],
  ["style.css", "text/css"],
  ["font.css", "text/css"],
  ["viewer.html", "text/html"],
]);

/** Read-only reference assets beside a proxied development build; never writes to the reference. */
export async function startParityPreview({
  referenceRoot,
  rewriteOrigin,
  recordings,
  port = 4189,
}) {
  const server = createServer(async (request, response) => {
    const requestedUrl = request.url ?? "/";
    const path = new URL(requestedUrl, "http://localhost").pathname;
    try {
      if (path.startsWith("/reference/")) {
        const name = path.slice("/reference/".length);
        const type = referenceAssets.get(name);
        if (!type) {
          response.writeHead(404).end();
          return;
        }
        const body = await readFile(resolve(referenceRoot, "dist-package", name));
        response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }).end(body);
      } else if (path === "/samples/original.json" || path === "/samples/rewrite.json") {
        response
          .writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
          .end(path.includes("original") ? recordings.original : recordings.rewrite);
      } else {
        await proxyRewrite(request, response, rewriteOrigin);
      }
    } catch {
      response
        .writeHead(502, { "Content-Type": "text/plain" })
        .end("Preview unavailable. Check the reference build and rewrite dev server.");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

async function matchedRecordings(referenceRoot) {
  const { viewerReferenceFixture } = await import("../tests/fixtures/viewer-reference.ts");
  const { createDiagnostics, serializeRecording, buildInfo } = await import(
    pathToFileURL(resolve(referenceRoot, "dist-package/index.js")).href
  );
  const rewrite = viewerReferenceFixture();
  const monitor = createDiagnostics({ now: () => 0, costClock: () => 0 });
  const original = monitor.export();
  monitor.dispose();
  const labels = new Map(rewrite.channels.map((channel) => [channel.id, channel.label]));
  original.metadata.application = rewrite.metadata.application;
  original.metadata.createdAt = rewrite.metadata.createdAt;
  original.budget = { targetFps: rewrite.targetFps, frameMs: 1000 / rewrite.targetFps };
  original.frames = rewrite.frames.map((frame) => ({
    id: frame.id,
    at: frame.endedAtMs,
    interval: frame.endedAtMs - frame.startedAtMs,
    update: frame.cpu.updateMs,
    render: frame.cpu.renderMs,
    coverage: "complete",
    droppedScopes: 0,
    overhead: frame.overhead,
    scopes: frame.scopes.map((scope) => ({
      system: scope.channelId,
      label: labels.get(scope.channelId),
      start: scope.startedAtMs,
      end: scope.endedAtMs,
    })),
  }));
  original.events = rewrite.events.map((event) => ({
    at: event.atMs,
    label: event.label,
    detail: event.detail ?? "",
  }));
  original.systems = rewrite.channels.map((channel) => ({
    ...channel,
    cpu: 0,
    peak: 0,
    values: {},
  }));
  original.samples = [];
  original.gpu = {
    units: "milliseconds",
    measurement: "Synthetic parity sample; legacy total",
    latest: null,
    samples: rewrite.gpu.map((sample) => ({
      diagnosticFrame: sample.frameId,
      available: true,
      enabled: true,
      status: "ready",
      currentFrame: sample.rendererFrameId,
      sampleFrame: sample.rendererFrameId,
      sampleAgeFrames: 0,
      gpuMilliseconds: sample.durationMs,
      passes: sample.passes.map((pass) => ({ label: pass.label, milliseconds: pass.durationMs })),
      droppedFrames: 0,
      truncatedPasses: 0,
      error: null,
    })),
  };
  console.info("Reference build", buildInfo);
  return { original: serializeRecording(original), rewrite: JSON.stringify(rewrite) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const referenceRoot = resolve(process.argv[2] ?? "../..");
  const recordings = await matchedRecordings(referenceRoot);
  await startParityPreview({ referenceRoot, recordings, rewriteOrigin: "http://127.0.0.1:4187" });
  console.info("Side-by-side audit: http://127.0.0.1:4189/examples/parity/");
}

async function proxyRewrite(request, response, rewriteOrigin) {
  const upstream = await fetch(new URL(request.url ?? "/", rewriteOrigin), {
    headers: { accept: request.headers.accept ?? "*/*" },
  });
  response.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") ?? "text/plain",
    "Cache-Control": "no-store",
  });
  response.end(Buffer.from(await upstream.arrayBuffer()));
}
