import { expect, test } from "../fixtures/visual-test.ts";

test("@visual full-page captures preserve canvas fonts across captures and navigation", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium" || process.platform !== "darwin");
  const documentUrl = `data:text/html,${encodeURIComponent('<body style="height:2000px">Font capture regression</body>')}`;
  const renderedLabel = () =>
    page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 180;
      canvas.height = 24;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas context unavailable");
      }
      context.font = "10px monospace";
      context.fillText("16.67 ms budget", 4, 16);
      return canvas.toDataURL();
    });
  await page.goto(documentUrl);
  const initial = await renderedLabel();
  for (let navigation = 0; navigation < 2; navigation += 1) {
    await page.goto(documentUrl);
    for (let capture = 0; capture < 3; capture += 1) {
      await page.screenshot({ fullPage: true });
      expect(await renderedLabel()).toBe(initial);
    }
  }
});
