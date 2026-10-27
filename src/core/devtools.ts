export interface DiagnosticTraceSink {
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;

  scope(system: string, label: string, start: number, end: number): void;

  marker(label: string, detail: string, at: number): void;

  dispose(): void;
}

let nextSink = 0;

/** Named scopes and markers only. Clears only this sink's entries, even after failures. */
export function createDevToolsSink(
  options: {
    enabled?: boolean;
    performance?: Pick<
      Performance,
      "mark" | "measure" | "clearMarks" | "clearMeasures"
    >;
  } = {},
): DiagnosticTraceSink {
  const timeline = options.performance ?? globalThis.performance;

  const name = `jank.js:${++nextSink}`;

  let enabled = options.enabled ?? true,
    disposed = false;

  return {
    get enabled() {
      return enabled && !disposed;
    },
    setEnabled(value) {
      enabled = value;
    },
    scope(system, label, start, end) {
      if (!enabled || disposed || !timeline) return;

      try {
        timeline.measure(name, {
          start,
          end,
          detail: {
            devtools: {
              dataType: "track-entry",
              track: label,
              trackGroup: "jank.js",
              tooltipText: label,
              properties: [["System", system]],
            },
          },
        });
      } catch {
        /* Diagnostics must not interrupt the application on unsupported browsers. */
      } finally {
        timeline.clearMeasures(name);
      }
    },
    marker(label, detail, at) {
      if (!enabled || disposed || !timeline) return;

      try {
        timeline.mark(name, {
          startTime: at,
          detail: {
            devtools: {
              dataType: "marker",
              tooltipText: label,
              properties: [
                ["Event", label],
                ["Detail", detail],
              ],
            },
          },
        });
      } catch {
        /* Unsupported timing extensions degrade to no trace entry. */
      } finally {
        timeline.clearMarks(name);
      }
    },
    dispose() {
      disposed = true;

      timeline?.clearMarks(name);

      timeline?.clearMeasures(name);
    },
  };
}
