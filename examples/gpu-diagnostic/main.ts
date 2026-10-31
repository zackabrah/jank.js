import {
  runWebGpuTimestampDiagnostic,
  type TimestampDiagnosticReport,
} from "../../packages/jank/src/adapters/webgpu-diagnostic.ts";
import { buildVersion } from "../../packages/jank/src/build.ts";
import "../../packages/junkui/src/junkui.css";
import "./page.css";

const run = document.querySelector<HTMLButtonElement>("#run");
const download = document.querySelector<HTMLButtonElement>("#download");
const status = document.querySelector<HTMLElement>("#status");
const rows = document.querySelector<HTMLElement>("#pairs");
if (!run || !download || !status || !rows) {
  throw new Error("Missing diagnostic controls");
}
let saved = "";

run.addEventListener("click", async () => {
  run.disabled = true;
  download.disabled = true;
  rows.replaceChildren();
  status.textContent = "Running six probes…";
  const report = await diagnose();
  saved = JSON.stringify(report, null, 2);
  for (const [index, pair] of report.probe.pairs.entries()) {
    const row = document.createElement("tr");
    const values = [
      `${index + 1}. ${pair.draw ? "Draw" : "Clear only"}`,
      pair.query,
      pair.startNs ?? "missing",
      pair.endNs ?? "missing",
      pair.reason ?? "Accepted pair",
      pair.durationMs?.toFixed(6) ?? "unknown",
    ];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    rows.append(row);
  }
  const rejected = report.probe.pairs.filter((pair) => pair.reason !== null).length;
  status.textContent =
    report.probe.status === "finished"
      ? `Finished: ${rejected} of 6 pairs rejected. ${report.gpuErrors.length} GPU errors. This is not a scene timing calibration.`
      : `${report.probe.status}: ${report.probe.error ?? "WebGPU timestamp queries are unavailable."}`;
  download.disabled = false;
  run.disabled = false;
});

download.addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([saved], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "jank-timestamp-diagnostic.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function diagnose() {
  const gpuErrors: string[] = [];
  let device: GPUDevice | null = null;
  let adapterInfo: Record<string, string> | null = null;
  let probe: TimestampDiagnosticReport;
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter?.features.has("timestamp-query")) {
      probe = { status: "unsupported", pairs: [], error: null };
    } else {
      adapterInfo = {
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
        device: adapter.info.device,
        description: adapter.info.description,
      };
      device = await adapter.requestDevice({ requiredFeatures: ["timestamp-query"] });
      device.addEventListener("uncapturederror", (event) => gpuErrors.push(event.error.message));
      probe = await runWebGpuTimestampDiagnostic(device);
    }
  } catch (cause) {
    probe = { status: "failed", pairs: [], error: String(cause) };
  } finally {
    device?.destroy();
  }
  return {
    format: "jank-timestamp-diagnostic",
    toolVersion: buildVersion,
    version: 1,
    userAgent: navigator.userAgent,
    adapterInfo,
    gpuErrors,
    probe,
  };
}
