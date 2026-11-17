// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, test } from "vitest";
import { comparisonFixture } from "../compare/fixtures.ts";
import { recordingFixture } from "../recording/fixtures.ts";
import { MAX_RECORDING_BYTES } from "../recording/format.ts";
import { ComparisonViewer } from "./comparison.tsx";
import { parseViewerDocument } from "./document.ts";
import { RecordingViewer } from "./view.tsx";

function setup() {
  const host = document.createElement("div");
  document.body.append(host);
  render(<RecordingViewer />, host);
  const input = host.querySelector("input");
  if (!input) throw new Error("Missing file control");
  return {
    host,
    async file(name: string, text: () => Promise<string>) {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [{ name, size: 100, text }],
      });
      await act(() => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    },
    async click(selector: string) {
      const button = host.querySelector<HTMLButtonElement>(selector);
      if (!button) throw new Error(`Missing ${selector}`);
      await act(() => button.click());
    },
    close() {
      render(null, host);
      host.remove();
    },
  };
}

test("comparison imports validate nested recordings and preserve the current tab and warning state on failure", async () => {
  const { host, file, click, close } = setup();
  const bundle = comparisonFixture("gpu-gap");
  try {
    await file("comparison.json", async () => JSON.stringify(bundle));
    expect(host.querySelector("h1")?.textContent).toBe("Comparison viewer");
    expect(host.querySelector('[aria-label="GPU verdict"]')?.textContent).toContain("Unknown");
    await click('[data-compare-tab="Settings"]');
    await click('[aria-label="Dismiss notice"]');
    const broken = structuredClone(bundle);
    const frame = broken.trials[0]?.recording.frames[0];
    if (!frame) throw new Error("Missing reference frame");
    frame.interval = -1;
    await file("invalid-nested.json", async () => JSON.stringify(broken));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "current comparison is still open",
    );
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toContain("Settings");
    expect(host.querySelector('[aria-label="Variant settings"]')?.textContent).toContain("128");
    expect(host.querySelector('[data-comparison-view] [role="status"]')).toBeNull();
    await file("new-comparison.json", async () => JSON.stringify(comparisonFixture("same")));
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe("Results");
    expect(host.querySelector('[data-comparison-view] [role="status"]')?.textContent).toContain(
      "objects",
    );
    expect(host.querySelector('[aria-label="CPU verdict"]')?.textContent).toContain(
      "No observed difference",
    );
    await file("recording.json", async () => JSON.stringify(recordingFixture()));
    expect(host.querySelector("h1")?.textContent).toBe("Recording viewer");
    expect(host.querySelector("[data-comparison-view]")).toBeNull();
    expect(host.querySelector('[aria-label="Selected frame details"]')).not.toBeNull();
  } finally {
    close();
  }
});

test("View trial opens and focuses the failing requirement, including repeated links and partial runs", async () => {
  const { host, file, click, close } = setup();
  try {
    await file("gap.json", async () => JSON.stringify(comparisonFixture("gpu-gap")));
    for (let attempt = 0; attempt < 2; attempt++) {
      await click('[aria-label="GPU verdict"] button');
      expect(host.querySelector('[aria-selected="true"]')?.textContent).toContain("Trials");
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Trial 1B");
      expect(document.activeElement?.textContent).toContain("80% is required");
    }
    const partial = comparisonFixture("stopped");
    partial.trials = [];
    await file("empty-run.json", async () => JSON.stringify(partial));
    expect(host.textContent).toContain("0 of 4 trials retained");
    await click('[aria-label="CPU verdict"] button');
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Trial 1A");
    expect(host.querySelectorAll("[data-comparison-trial]")).toHaveLength(4);
    expect(document.activeElement?.textContent).toContain("Not completed");
  } finally {
    close();
  }
});

test("a slow recording read cannot replace a newer comparison", async () => {
  const { host, file, close } = setup();
  let resolve: (value: string) => void = () => {};
  const pending = new Promise<string>((done) => {
    resolve = done;
  });
  try {
    await file("slow.json", () => pending);
    await file("latest.json", async () => JSON.stringify(comparisonFixture()));
    await act(async () => {
      resolve(JSON.stringify(recordingFixture()));
      await pending;
    });
    expect(host.querySelector("h1")?.textContent).toBe("Comparison viewer");
    expect(host.textContent).toContain("latest.json");
    expect(host.textContent).not.toContain("slow.json");
  } finally {
    close();
  }
});

test("format dispatch rejects unsupported versions, non-objects and oversized UTF-8 before opening", () => {
  for (const json of [
    "null",
    "[]",
    '"jank.js-comparison"',
    '{"format":"jank.js-comparison","version":2}',
    '{"format":"unknown","version":1}',
  ])
    expect(() => parseViewerDocument(json)).toThrow();
  expect(() => parseViewerDocument(`"${"é".repeat(MAX_RECORDING_BYTES / 2)}"`)).toThrow("32 MiB");
});

test("frame interval readouts retain millisecond precision after a long frame", async () => {
  const bundle = comparisonFixture();
  const trial = bundle.trials[0];
  const frame = trial?.recording.frames[0];
  if (!trial || !frame) throw new Error("Missing trial");
  trial.recording.frames = [
    { ...frame, id: 1, interval: 100123, at: 100623, scopes: [] },
    { ...frame, id: 2, interval: 20, at: 100643, scopes: [] },
  ];
  trial.measurementEndMs = 100643;
  const host = document.createElement("div");
  try {
    render(<ComparisonViewer bundle={bundle} />, host);
    await act(() => {
      host
        .querySelector("[data-comparison-track]")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(host.querySelector('[data-comparison-readout="A"]')?.textContent).toContain(
      "100.123\u00a0s–100.143\u00a0s",
    );
  } finally {
    render(null, host);
  }
});
