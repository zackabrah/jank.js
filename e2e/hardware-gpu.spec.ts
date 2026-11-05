import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { gpuFrameCoverage, gpuFrameToLive } from "../src/gpu/model.ts";
import { parseRecording, serializeRecording } from "../src/recording/format.ts";
import { hardwareGpuProbe } from "./hardware-gpu-probe.ts";

for (const backend of ["webgl2", "webgpu"] as const) {
  test(`${backend} hardware timestamps, scaling, capacity and loss`, async ({
    page,
    browser,
  }, info) => {
    test.skip(info.project.name !== "chrome-gpu", "Requires the explicit physical-GPU run");
    test.setTimeout(60_000);
    const session = await browser.newBrowserCDPSession();
    const system: unknown = await session.send("SystemInfo.getInfo");
    await session.detach();
    await page.goto("/viewer.html");
    await page.bringToFront();
    page.on("console", (message) => {
      if (message.text().startsWith("GPU validation:")) console.log(message.text());
    });
    const report = await page.evaluate(hardwareGpuProbe, backend);
    const median = (values: number[]) =>
      values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
    const scaling = [0, 1, 2].map((block) => {
      const runs = report.samples.filter((sample) => sample.block === block);
      const light = median(
        runs.filter((s) => s.repeats === 1).map((s) => s.nativeMs.reduce((a, b) => a + b, 0)),
      );
      const heavy = median(
        runs.filter((s) => s.repeats === 4).map((s) => s.nativeMs.reduce((a, b) => a + b, 0)),
      );
      return { block, lightMs: light, heavyMs: heavy, ratio: heavy / light };
    });
    const path = info.outputPath("accuracy.json");
    await writeFile(
      path,
      JSON.stringify({ browser: browser.version(), system, ...report, scaling }, null, 2),
    );
    await info.attach(`${backend}-hardware-accuracy`, {
      path,
      contentType: "application/json",
    });
    expect(report.samples).toHaveLength(480);
    expect(report.errors).toEqual([]);
    for (const sample of report.samples) {
      // Completion includes submission and readback, so it is an upper bound, not GPU time.
      expect(Math.max(...sample.nativeMs)).toBeLessThanOrEqual(sample.completionMs + 1);
    }
    for (const scale of scaling) {
      expect(scale.lightMs).toBeGreaterThan(0);
      // Four times the submitted work must be distinguishable, not exactly linear under DVFS.
      expect(scale.ratio).toBeGreaterThan(1.5);
    }
  });

  test(`${backend} hardware probe overhead and recording fidelity`, async ({ page }, info) => {
    test.skip(info.project.name !== "chrome-gpu", "Requires the explicit physical-GPU run");
    test.setTimeout(180_000);
    await page.goto(`/checks/three.html?backend=${backend}`);
    await page.bringToFront();
    const timing = page.getByRole("checkbox", { name: "GPU timing probes", exact: true });
    await expect(timing).toBeEnabled();
    const trials = [];
    const percentile = (values: number[], fraction: number) =>
      values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * fraction)] ?? null;
    for (const workload of ["Baseline", "GPU stress"]) {
      await page.getByRole("button", { name: workload, exact: true }).click();
      for (let block = 0; block < 3; block++) {
        for (const enabled of [false, true, true, false]) {
          await timing.setChecked(enabled);
          await page.waitForTimeout(1000);
          await page.evaluate(() => {
            if (!window.jank) throw new Error("Missing agent API");
            window.jank.start();
          });
          await page.waitForTimeout(2000);
          // Read the agent's analysis before inspecting detailed recording evidence.
          const { report, json } = await page.evaluate(async () => {
            if (!window.jank) throw new Error("Missing agent API");
            const { id, report } = await window.jank.stop(3);
            return { report, json: window.jank.export(id) };
          });
          const recording = parseRecording(json);
          const frames = recording.gpuTiming?.frames ?? [];
          const coverage = frames.map(gpuFrameCoverage);
          const gpuSums = frames.flatMap((frame) => {
            const live = gpuFrameToLive(frame, frame.frameId);
            return live.timedWork?.status === "measured" ? [live.timedWork.value] : [];
          });
          const trial = {
            workload,
            block,
            enabled,
            frames: recording.frames.length,
            complete: coverage.filter((frame) => frame.completeness === "complete").length,
            pending: coverage.reduce((sum, frame) => sum + frame.pending, 0),
            rejected: coverage.reduce((sum, frame) => sum + frame.rejected, 0),
            omitted: coverage.reduce((sum, frame) => sum + frame.omitted, 0),
            gpuMedianMs: percentile(gpuSums, 0.5),
            gpuP95Ms: percentile(gpuSums, 0.95),
            report: report.summary,
          };
          trials.push(trial);
          await writeFile(info.outputPath(`trial-${trials.length}.json`), json);
          await writeFile(
            info.outputPath("overhead.json"),
            JSON.stringify({ backend, trials }, null, 2),
          );
          expect(recording.frames.length).toBeGreaterThan(20);
          expect(frames.map((frame) => frame.frameId)).toEqual(
            recording.frames.map((frame) => frame.id),
          );
          expect(parseRecording(serializeRecording(recording)).gpuTiming).toEqual(
            recording.gpuTiming,
          );
          expect(trial.pending).toBe(0);
          if (enabled) {
            expect(trial.complete / trial.frames).toBeGreaterThan(0.95);
            expect(trial.gpuMedianMs).toBeGreaterThan(0);
          } else {
            expect(
              frames.every((frame) =>
                frame.invocations.every(
                  (pass) =>
                    pass.state === "omitted" &&
                    pass.reason === "GPU timing disabled" &&
                    pass.milliseconds === null,
                ),
              ),
            ).toBe(true);
            expect(trial.gpuMedianMs).toBeNull();
          }
        }
      }
    }
    await info.attach(`${backend}-probe-overhead`, {
      path: info.outputPath("overhead.json"),
      contentType: "application/json",
    });
  });
}
