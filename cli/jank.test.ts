import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { comparisonFixture } from "../src/compare/fixtures.ts";
import { serializeComparison } from "../src/compare/model.ts";
import { recordingFixture } from "../src/recording/fixtures.ts";
import { serializeRecording } from "../src/recording/format.ts";

const script = fileURLToPath(new URL("./jank.ts", import.meta.url));

function run(...args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [script, ...args], (error, stdout, stderr) => {
      const code = error && typeof error.code === "number" ? error.code : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "jank-cli-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true });
});

test("analyzes a recording file, honouring --top", async () => {
  const file = join(dir, "recording.json");
  // Three slow frames far enough apart to stay separate episodes.
  const recording = recordingFixture(30);
  let at = 0;
  recording.frames = recording.frames.map((frame, index) => {
    const interval = index % 10 === 1 ? 42 : 16;
    at += interval;
    return { ...frame, at, interval, scopes: [] };
  });
  await writeFile(file, serializeRecording(recording));
  const { code, stdout, stderr } = await run("analyze", file, "--top", "1");
  expect(stderr).toBe("");
  expect(code).toBe(0);
  const report = JSON.parse(stdout);
  expect(report).toMatchObject({ format: "jank-analysis", kind: "recording" });
  expect(report.episodes).toHaveLength(1);
  expect(report.omitted.episodes).toBe(2);
});

test("analyzes a comparison file", async () => {
  const file = join(dir, "comparison.json");
  await writeFile(file, serializeComparison(comparisonFixture()));
  const { code, stdout } = await run("analyze", file);
  expect(code).toBe(0);
  expect(JSON.parse(stdout).kind).toBe("comparison");
});

test("exits 1 with a reason for a missing or invalid file, printing no report", async () => {
  const missing = await run("analyze", join(dir, "missing.json"));
  expect(missing.code).toBe(1);
  expect(missing.stdout).toBe("");
  expect(missing.stderr).toContain("jank analyze:");
  const file = join(dir, "invalid.json");
  await writeFile(file, '{"format":"nope"}');
  const invalid = await run("analyze", file);
  expect(invalid.code).toBe(1);
  expect(invalid.stdout).toBe("");
});

test.each([
  [[]],
  [["analyze"]],
  [["compare", "file.json"]],
  [["analyze", "a.json", "b.json"]],
  [["analyze", "a.json", "--top", "0"]],
  [["analyze", "a.json", "--top", "many"]],
  [["analyze", "a.json", "--nope"]],
])("exits 2 with usage for bad arguments %j", async (args) => {
  const { code, stdout, stderr } = await run(...args);
  expect(code).toBe(2);
  expect(stdout).toBe("");
  expect(stderr).toContain("Usage:");
});

test("--help prints usage and succeeds", async () => {
  const { code, stdout } = await run("--help");
  expect(code).toBe(0);
  expect(stdout).toContain("jank experiment");
});

// What: a file saved with a byte-order mark opens, as it does in the viewer.
// Why: #20. Some Windows editors add one, and Node keeps it where the browser drops it.
test("analyze reads a file that starts with a byte-order mark", async () => {
  const file = join(dir, "bom.json");
  await writeFile(file, `\uFEFF${serializeRecording(recordingFixture())}`);
  const { code, stdout } = await run("analyze", file);
  expect(code).toBe(0);
  expect(JSON.parse(stdout).kind).toBe("recording");
});
