import type { LoadingSource } from "../sources.ts";
import { element, milliseconds, rows, write } from "./dom.ts";

export function renderLoading(root: HTMLElement, source?: LoadingSource): void {
  const snapshot = source?.snapshot();
  if (!snapshot) {
    write(
      root,
      "loading-state",
      source ? "No loading run recorded." : "No loading source connected.",
    );
    rows(element(root, '[data-list="loading"]'), []);
    return;
  }
  write(
    root,
    "loading-state",
    `${snapshot.label} · ${snapshot.kind} · ${snapshot.status} · ${milliseconds(snapshot.elapsedMs, 0)} ms · ${snapshot.pendingOperations} pending`,
  );
  rows(
    element(root, '[data-list="loading"]'),
    snapshot.stages.map((stage) => [
      stage.name,
      `${milliseconds(stage.busyMs, 0)} ms busy · ${stage.operationCount} ops · ${stage.receivedBytes} bytes`,
    ]),
  );
}
