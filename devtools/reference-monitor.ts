import type { InstrumentationControl } from "../src/capture/instrumentation-model.ts";
import { createDiagnostics } from "../src/core/diagnostics.ts";

export async function loadReferenceMonitor(application: string) {
  const monitor = createDiagnostics({
    devTools: false,
    application: { name: application },
  });
  let traceEnabled = false;
  const traceEvents: InstrumentationControl = {
    get enabled() {
      return traceEnabled;
    },
    setEnabled(enabled) {
      monitor.setDevToolsEnabled(enabled);
      traceEnabled = enabled;
    },
  };
  return Object.assign(monitor, { traceEvents });
}
