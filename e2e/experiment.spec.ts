import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const cli = fileURLToPath(new URL("../cli/jank.ts", import.meta.url));

test.skip(({ browserName }) => browserName !== "chromium", "The CLI launches its own Chromium.");

function experiment(...args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      [cli, "experiment", "--headless", ...args],
      { maxBuffer: 1 << 26 },
      (error, stdout, stderr) => {
        resolve({ code: error && typeof error.code === "number" ? error.code : 0, stdout, stderr });
      },
    );
  });
}

test("jank experiment records a real host in fresh pages and reports the comparison", async ({
  baseURL,
}) => {
  test.setTimeout(90_000);
  const out = await mkdtemp(join(tmpdir(), "jank-experiment-"));
  const scripts = await mkdtemp(join(tmpdir(), "jank-scenario-"));
  const scenario = join(scripts, "scenario.js");
  // A host phase timed during the scenario, so it ends before recording begins.
  await writeFile(scenario, 'performance.measure("scenario:setup", { start: 0, duration: 5 });');
  const url = `${baseURL}/checks/three.html?backend=webgl2`;
  try {
    const { code, stdout, stderr } = await experiment(
      ...["--a", url, "--b", url, "--pairs", "1", "--measure", "800", "--out", out],
      ...["--label-a", "One", "--label-b", "Two", "--screenshot", "--hide", "main"],
      ...["--replace-b", "**/three.html*::<title>::<title>Patched {nonce} ", "--profile"],
      ...["--scenario", scenario],
    );
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.comparison.variants).toEqual({ A: "One", B: "Two" });
    expect(report.comparison.results.map((result: { id: string }) => result.id)).toContain(
      "Frame-median",
    );
    expect(report.loads.map((load: { variant: string }) => load.variant)).toEqual(["A", "B"]);
    expect(report.loads[0].load.readyMs).toBeGreaterThan(0);
    expect(report.reports).toHaveLength(2);
    expect(report.hotspots.A.busyMs).toBeGreaterThan(0);
    expect(report.image.vsBaselineDb).not.toBeNull();
    const [cold, steady] = report.summary.rows;
    expect(cold.measures["scenario:setup"]).toMatchObject({ a: 5, b: 5, delta: 0 });
    expect(steady.results["Frame-median"].verdict).toBeTruthy();
    expect(report.summary.settings).toMatchObject({
      pairs: 1,
      scenario: { file: scenario },
      coldCompile: { A: false, B: true },
    });
    expect(report.summary.notes.join(" ")).toContain("Only B forces a cold shader compile");
    expect(JSON.parse(await readFile(join(out, "summary.json"), "utf8"))).toEqual(report.summary);
    expect((await readdir(out)).toSorted()).toEqual([
      "comparison.json",
      "summary.json",
      "trial-1A.json",
      "trial-1A.png",
      "trial-1B.json",
      "trial-1B.png",
    ]);
  } finally {
    await rm(out, { recursive: true });
    await rm(scripts, { recursive: true });
  }
});

test("a patch that matches nothing fails the experiment instead of testing the wrong thing", async ({
  baseURL,
}) => {
  test.setTimeout(60_000);
  const out = await mkdtemp(join(tmpdir(), "jank-experiment-"));
  const url = `${baseURL}/checks/three.html?backend=webgl2`;
  try {
    const { code, stderr } = await experiment(
      ...["--a", url, "--b", url, "--pairs", "1", "--measure", "200", "--out", out],
      ...["--replace", "**/three.html*::NOT-IN-THIS-FILE::x"],
    );
    expect(code).toBe(1);
    expect(stderr).toContain("found nothing to change");
    const unmatched = await experiment(
      ...["--a", url, "--b", url, "--pairs", "1", "--measure", "200", "--out", out],
      ...["--replace", "**/no-such-file.js::x::y"],
    );
    expect(unmatched.code).toBe(1);
    expect(unmatched.stderr).toContain("matched no request");
  } finally {
    await rm(out, { recursive: true });
  }
});
