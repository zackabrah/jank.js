import { expect, test } from "vitest";
import { parseComparison, parseRecording } from "../../packages/jank/src/index.ts";
import { designerMockFiles } from "./designer.ts";

test("designer samples are valid portable files with explicit mock provenance and useful incomplete evidence", () => {
  const files = designerMockFiles();
  for (const [name, value] of Object.entries(files)) {
    const parsed = name.includes("comparison")
      ? parseComparison(JSON.stringify(value))
      : parseRecording(JSON.stringify(value));
    expect(parsed.ok, name).toBe(true);
    expect(JSON.stringify(value)).toContain("SIMULATED");
  }
  expect(files["mock-recording.json"].frames).toHaveLength(360);
  expect(
    files["mock-recording.json"].gpu.some(
      (sample) => sample.measurement === "intervals" && sample.metrics === null,
    ),
  ).toBe(true);
  expect(files["mock-comparison.json"].trials).toHaveLength(4);
});
