// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { expect, test } from "vitest";
import { recordingFixture } from "../recording/fixtures.ts";
import { parseRecording, serializeRecording } from "../recording/format.ts";
import { formatCounter } from "./counters.ts";
import { liveFixture } from "./fixtures.ts";
import { mountLivePanel } from "./panel.tsx";

test("host temporal states retain false, zero, unknown and reset reasons in recordings", () => {
  const recording = recordingFixture();
  const values = {
    temporalEnabled: true,
    temporalHistoryValid: false,
    temporalHistoryAgeFrames: 0,
    temporalHistoryResetReason: "Camera cut",
  };
  const system = { id: "render", label: "Render submission", cpu: 0, peak: 0, values };
  recording.systems = [system];
  recording.samples = [{ at: recording.frames[0]?.at ?? 0, systems: [system] }];
  expect(parseRecording(serializeRecording(recording)).samples[0]?.systems[0]?.values).toEqual(
    values,
  );
  recording.systems = [
    {
      ...system,
      values: {
        temporalEnabled: false,
        temporalHistoryValid: null,
        temporalHistoryAgeFrames: null,
        temporalHistoryResetReason: null,
      },
    },
  ];
  expect(parseRecording(serializeRecording(recording)).systems).toEqual(recording.systems);
});

test("formats declared units and booleans without treating unavailable or tiny values as zero", () => {
  expect(formatCounter("drawCalls", 1200001)).toEqual({ label: "Draw Calls", text: "1,200,001" });
  expect(formatCounter("workloadPaused", false)).toEqual({ label: "Workload Paused", text: "No" });
  expect(formatCounter("workloadPaused", true).text).toBe("Yes");
  expect(formatCounter("extraWorkMs", 4.125)).toEqual({ label: "Extra Work", text: "4.125 ms" });
  expect(formatCounter("widthPx", 800).text).toBe("800 px");
  expect(formatCounter("trackedStorageEstimateBytes", 1536)).toEqual({
    label: "Tracked Storage Estimate",
    text: "1.5 KiB",
  });
  expect(formatCounter("trackedStorageEstimateBytes", 0).text).toBe("0 B");
  expect(formatCounter("latencyMs", 0.000001).text).toBe("0.000001 ms");
  expect(formatCounter("backend", "webgpu").text).toBe("webgpu");
  for (const value of [null, NaN, Infinity])
    expect(formatCounter("points", value).text).toBe("Unavailable");
  expect(formatCounter("points", 0).text).toBe("0");
  expect(formatCounter("legacy_width", 800)).toEqual({ label: "Legacy width", text: "800" });
  // @ts-expect-error Reject malformed values supplied by untyped hosts.
  expect(() => formatCounter("invalid", {})).toThrow("Counter values must be scalar");
});

test("groups counter sources, escapes host text and holds counter values through Freeze", async () => {
  const container = document.createElement("div");
  const panel = mountLivePanel(container);
  const source = liveFixture();
  source.diagnostics.systems = [
    { id: "first", label: "First source", values: { widthPx: 800, enabled: false } },
    {
      id: "second",
      label: "<img src=x>",
      values: { widthPx: 400, message: "<script>text</script>" },
    },
    { id: "empty", label: "Empty", values: {} },
  ];
  panel.update(source);
  const root = container.firstElementChild?.shadowRoot;
  if (!root) throw new Error("Missing panel");
  const button = (text: string) => {
    const found = [...root.querySelectorAll("button")].find((item) =>
      item.textContent?.includes(text),
    );
    if (!found) throw new Error(`Missing ${text}`);
    return found;
  };
  try {
    expect(button("Counters").textContent).toContain("4 reported");
    await act(() => button("Counters").click());
    const first = root.querySelector('dl[aria-label="First source counters"]');
    expect(first?.textContent).toContain("800 px");
    expect(first?.textContent).toContain("EnabledNo");
    expect(root.textContent).toContain("<script>text</script>");
    expect(root.querySelector("img, script")).toBeNull();
    expect(root.querySelector('dl[aria-label="Empty counters"]')).toBeNull();
    await act(() => button("Freeze").click());
    source.diagnostics.systems = [{ id: "first", label: "First source", values: { widthPx: 200 } }];
    await act(() => panel.update(source));
    expect(first?.textContent).toContain("800 px");
    await act(() => button("Freeze").click());
    expect(first?.textContent).toBe("Width200 px");
    expect(root.querySelectorAll('dl[aria-label$=" counters"]')).toHaveLength(1);
  } finally {
    panel.destroy();
  }
});
