import { expect, test } from "@playwright/test";

test("GPU workload selection is captured for a run and unlocked on cancellation", async ({
  page,
}) => {
  await page.goto("/examples/basic/");
  await page.getByText("Quick headroom test", { exact: true }).click();
  const workload = page.getByRole("combobox", { name: "GPU workload", exact: true });
  await expect(workload.locator("option")).toHaveCount(4);
  await workload.selectOption("diffusion");
  await expect(page.locator("#headroom-workload-description")).toContainText("simulation");
  await page.getByRole("button", { name: "Estimate headroom", exact: true }).click();
  await expect(workload).toBeDisabled();
  await expect(page.locator("#headroom-context")).toContainText("Diffusion simulation");
  await page.getByRole("button", { name: "Stop estimate", exact: true }).click();
  await expect(workload).toBeEnabled();
  await workload.selectOption("texture");
  await expect(page.locator("#headroom-context")).toContainText("Diffusion simulation");
  await page.getByRole("button", { name: "Estimate headroom", exact: true }).click();
  await expect(page.locator("#headroom-context")).toContainText("Texture sampling");
  await page.getByRole("button", { name: "Stop estimate", exact: true }).click();
});

test("each GPU workload writes changing results, respects its cap, restores targets and frees resources", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  await page.goto("/examples/basic/");
  const result = await page.evaluate(async () => {
    const path = "/tests/fixtures/headroom/gpu-workloads.ts";
    const { exerciseGpuWorkloads }: typeof import("../fixtures/headroom/gpu-workloads.ts") =
      await import(path);
    return exerciseGpuWorkloads();
  });
  expect(errors).toEqual([]);
  for (const probe of result) {
    expect(probe.differentComponents).toBeGreaterThan(0);
    expect(probe.draws).toBe(probe.mode === "diffusion" ? 8 : 1);
    expect(probe.restoredTarget).toBe(true);
    expect(probe.failureRestored).toBe(true);
    expect(probe.glError).toBe(0);
    expect(probe.restoredMemory).toEqual(probe.baselineMemory);
    expect(probe.invalidLoadsRejected).toBe(4);
  }
});

test("scene workload switches release prior targets and expose the selected work in recording counters", async ({
  page,
}) => {
  await page.goto("/examples/basic/");
  const result = await page.evaluate(async () => {
    const path = "/examples/basic/scene.ts";
    const { createScene }: typeof import("../../examples/basic/scene.ts") = await import(path);
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:64px;height:64px";
    document.body.append(canvas);
    const scene = createScene(canvas);
    try {
      await new Promise(requestAnimationFrame);
      scene.render();
      const baseline = scene.counters();
      const steps = [];
      for (const mode of ["texture", "diffusion", "raymarch", "arithmetic"] as const) {
        scene.stressGpu(8, mode);
        scene.render();
        steps.push(scene.counters());
      }
      scene.clearStress(36);
      scene.render();
      return { baseline, steps, restored: scene.counters() };
    } finally {
      scene.dispose();
      canvas.remove();
    }
  });
  expect(result.steps.map((step) => step.gpuWorkload)).toEqual([
    "texture",
    "diffusion",
    "raymarch",
    "arithmetic",
  ]);
  for (const step of result.steps) {
    expect(step.gpuWorkUnits).toBe(8);
    expect(step.drawCalls).toBe(
      Number(result.baseline.drawCalls) + (step.gpuWorkload === "diffusion" ? 8 : 1),
    );
  }
  expect(result.baseline.textures).not.toBeNull();
  expect(
    result.steps.map((step) => Number(step.textures) - Number(result.baseline.textures)),
  ).toEqual([2, 3, 1, 1]);
  expect(result.restored).toEqual(result.baseline);
});
