// @vitest-environment jsdom
import { render } from "preact";
import { expect, test } from "vitest";
import type { MissingMeasurementState } from "./measurement.ts";
import { MeasurementValue } from "./measurement-value.tsx";

const missing: [MissingMeasurementState, string][] = [
  ["not-observed", "not observed"],
  ["pending", "pending"],
  ["unknown", "unknown"],
  ["unsupported", "n/a"],
  ["disabled", "off"],
  ["no-gpu-record", "no GPU record"],
  ["evicted", "evicted"],
  ["not-recorded", "not recorded"],
  ["rejected", "rejected"],
  ["error", "error"],
];

test.each(missing)("renders %s with a readable reason instead of a zero", (status, label) => {
  const host = document.createElement("div");
  render(<MeasurementValue measurement={{ status, reason: "Evidence from the host" }} />, host);
  expect(host.querySelector("[data-state]")?.firstChild?.textContent).toBe(label);
  expect(host.querySelector(".sr-only")?.textContent).toContain("Evidence from the host");
  expect(host.textContent).not.toMatch(/0\.0/);
  render(null, host);
});

test("compact readouts keep a spoken missing-data reason and display measured zero", () => {
  const host = document.createElement("div");
  render(
    <MeasurementValue
      compact
      measurement={{ status: "unknown", reason: "Waiting for a full second" }}
    />,
    host,
  );
  expect(host.querySelector('[aria-hidden="true"]')?.textContent).toBe("—");
  expect(host.querySelector(".sr-only")?.textContent).toBe("unknown: Waiting for a full second");
  render(<MeasurementValue compact measurement={{ status: "measured", value: 0 }} />, host);
  expect(host.textContent).toBe("0.0");
  render(null, host);
});
