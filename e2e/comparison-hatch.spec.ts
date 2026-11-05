import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`missing-data hatches keep their screen angle and spacing on resize in ${theme}`, async ({
    page,
  }, info) => {
    await page.goto(`/checks/viewer.html?comparison=gpu-gap&theme=${theme}`);
    const gpu = page.getByRole("region", { name: "Comparison GPU passes" });
    const track = gpu.getByRole("slider").first();
    await track.press("Home");
    for (let step = 0; step < 8; step++) await track.press("PageUp");
    for (const width of [1024, 1920]) {
      await page.setViewportSize({ width, height: 963 });
      await gpu.scrollIntoViewIfNeeded();
      for (const series of ["B", "difference"]) {
        const geometry = await gpu
          .locator(`[data-comparison-hatch="${series}"]`)
          .evaluate((svg) => {
            const path = svg.querySelector("pattern path");
            if (!(path instanceof SVGPathElement)) throw new Error("Missing hatch stroke");
            const matrix = path.getScreenCTM();
            if (!matrix) throw new Error("Missing screen transform");
            const start = path.getPointAtLength(0).matrixTransform(matrix);
            const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
            return { x: Math.abs(end.x - start.x), y: Math.abs(end.y - start.y) };
          });
        expect(geometry.x).toBeCloseTo(8);
        expect(geometry.y).toBeCloseTo(8);
      }
      await expect(gpu.locator('[data-comparison-lane-readout="B"]')).toContainText("missing");
      await expect(gpu.locator("[data-comparison-difference-readout]")).toHaveText("unavailable");
      await info.attach(`Missing-data hatches ${theme} ${width}`, {
        body: await gpu.screenshot({ path: `test-results/comparison-hatch-${theme}-${width}.png` }),
        contentType: "image/png",
      });
    }
  });
}
