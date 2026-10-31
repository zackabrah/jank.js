import { expect, test } from "@playwright/test";

test("bounds canvas clips, caps, follows its target and disposes without changing host resources", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/");
  const result = await page.evaluate(async () => {
    const path = "/packages/jank/src/index.ts";
    const { createBoundsOverlay }: typeof import("../../packages/jank/src/index.ts") = await import(
      path
    );
    const target = document.createElement("div");
    target.style.cssText = "width:200px;height:100px";
    document.body.append(target);
    const overlay = createBoundsOverlay(target, { maxBounds: 1 });
    const snapshot = {
      bounds: Array.from({ length: 3 }, () => ({
        min: [-0.5, -0.5, 0] as const,
        max: [0.5, 0.5, 0.5] as const,
        culled: true,
      })),
      omitted: 2,
      viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      clipDepth: "zero-to-one" as const,
    };
    overlay.render(snapshot);
    const canvas = document.querySelector<HTMLCanvasElement>("[data-jank-bounds]");
    if (!canvas) {
      throw new Error("No overlay");
    }
    const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
    const result = {
      drawn: canvas.dataset.drawn,
      omitted: canvas.dataset.omitted,
      colored: pixels?.some((value) => value > 0),
      width: canvas.style.width,
      host: target.isConnected,
    };
    target.style.width = "300px";
    overlay.render(snapshot);
    if (canvas.style.width !== "300px") {
      throw new Error("Overlay did not resize");
    }
    overlay.render(null);
    if (canvas.style.display !== "none") {
      throw new Error("Overlay did not hide");
    }
    overlay.dispose();
    overlay.dispose();
    overlay.render(snapshot);
    if (canvas.isConnected || !target.isConnected) {
      throw new Error("Bad ownership");
    }
    target.remove();
    return result;
  });
  expect(result).toEqual({ drawn: "1", omitted: "4", colored: true, width: "200px", host: true });
});
