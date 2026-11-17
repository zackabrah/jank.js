// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, test } from "vitest";
import { recordingFixture } from "../recording/fixtures.ts";
import { MAX_RECORDING_BYTES } from "../recording/format.ts";
import { RecordingViewer } from "./view.tsx";

function setup() {
  const host = document.createElement("div");
  document.body.append(host);
  const recording = recordingFixture();
  recording.capture.triggerFrame = 1;
  render(<RecordingViewer initial={recording} name="Capture C1" />, host);
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Missing file control");
  const file = async (name: string, text: () => Promise<string>, size = 100) => {
    Object.defineProperty(input, "files", { configurable: true, value: [{ name, size, text }] });
    await act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  const details = () => host.querySelector('[aria-label="Selected frame details"]')?.textContent;
  return {
    host,
    file,
    details,
    close: () => {
      render(null, host);
      host.remove();
    },
  };
}

test("opens at the trigger, supports frame navigation and keeps a recording on invalid or oversized import", async () => {
  const { host, file, details, close } = setup();
  try {
    expect(details()).toContain("Frame f1");
    const worst = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Worst",
    );
    await act(() => worst?.click());
    expect(details()).toContain("Frame f2");
    await file("broken.json", async () => "broken");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't open broken.json",
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/\. The current recording/);
    await file("wrong.json", async () => '{"format":"something else"}');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "It isn't a valid jank.js recording: `format` is missing or wrong.",
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "current recording is still open",
    );
    expect(details()).toContain("Frame f2");
    expect(host.textContent).toContain("Capture C1");
    await act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Dismiss notice"]')?.click(),
    );
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(details()).toContain("Frame f2");
    await file(
      "large.json",
      async () => {
        throw new Error("Must not read an oversized file");
      },
      MAX_RECORDING_BYTES + 1,
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("32 MiB");
    expect(details()).toContain("Frame f2");
    await file("manual.json", async () => JSON.stringify(recordingFixture()));
    expect(details()).toContain("Frame f2");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("worst frame");
    expect(host.querySelector('svg path[d*="NaN"], svg path[d*="Infinity"]')).toBeNull();
    const range = host.querySelector<HTMLElement>('[aria-label="Selected frame"]');
    if (!range) throw new Error("Missing selection");
    await act(() => {
      range.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(details()).toContain("Frame f3");
    await act(() => {
      range.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    });
    expect(details()).toContain("Frame f2");
    await act(() => {
      host
        .querySelector("input")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(details()).toContain("Frame f2");
  } finally {
    close();
  }
});

test("frame timestamps retain millisecond precision after 100 seconds", async () => {
  const { host, file, details, close } = setup();
  const recording = recordingFixture();
  recording.capture.triggerFrame = 1;
  recording.frames.forEach((frame, index) => {
    const offset = 100123 + index * 333 - frame.at;
    frame.at += offset;
    for (const scope of frame.scopes) {
      scope.start += offset;
      scope.end += offset;
    }
  });
  try {
    await file("later.json", async () => JSON.stringify(recording));
    expect(details()).toContain("At 100.123\u00a0s");
    const next = [...host.querySelectorAll("button")].find((node) => node.textContent === "Next");
    if (!next) throw new Error("Missing Next button");
    await act(() => next.click());
    expect(details()).toContain("At 100.456\u00a0s");
  } finally {
    close();
  }
});

test("a slow earlier import cannot replace a newer file, and an empty recording stays meaningful", async () => {
  const { host, file, details, close } = setup();
  let finish: (text: string) => void = () => {};
  try {
    await file(
      "old.json",
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await file("empty.json", async () => JSON.stringify(recordingFixture(0)));
    await act(() => finish(JSON.stringify(recordingFixture())));
    expect(host.textContent).toContain("empty.json");
    expect(host.textContent).toContain("no completed frames");
    expect(details()).toBeUndefined();
  } finally {
    close();
  }
});

test("does not attribute GPU data using a renderer frame ID", () => {
  const host = document.createElement("div");
  const recording = recordingFixture();
  recording.gpu = {
    units: "milliseconds",
    measurement: "span",
    latest: null,
    samples: [
      {
        available: true,
        enabled: true,
        status: "ready",
        currentFrame: 2,
        sampleFrame: 2,
        sampleAgeFrames: 0,
        gpuMilliseconds: 8,
        passes: [],
        droppedFrames: 0,
        truncatedPasses: 0,
        error: null,
      },
    ],
  };
  try {
    render(<RecordingViewer initial={recording} />, host);
    expect(host.textContent).toContain("GPU span: Unknown");
    expect(host.textContent).toContain("No GPU record explicitly linked");
  } finally {
    render(null, host);
  }
});

// What: jank.js's own recording events aren't reported as unmatched; a host's event still is.
// Why: #18. Almost every recording said "1 event outside the recorded frames" for Recording stopped.
test("only a host's events count as outside the recorded frames", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const recording = recordingFixture();
  const end = recording.frames.at(-1)?.at ?? 0;
  recording.events = [
    { at: -1, label: "Recording started", detail: "" },
    ...["Recording stopped", "Recording complete", "Spike captured"].map((label) => ({
      at: end + 1000,
      label,
      detail: "",
    })),
  ];
  render(<RecordingViewer key="lifecycle" initial={recording} />, host);
  expect(host.textContent).not.toContain("outside the recorded frames");
  const withHostEvent = structuredClone(recording);
  withHostEvent.events.push({ at: end + 2000, label: "Level loaded", detail: "" });
  render(<RecordingViewer key="host" initial={withHostEvent} />, host);
  expect(host.textContent).toContain("1 event outside the recorded frames");
  render(null, host);
  host.remove();
});
