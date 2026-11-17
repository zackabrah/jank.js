// The reports must pass validation before any social assets are generated.
import "./update.mjs";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { socialSvg } from "./social.mjs";

const svgPath = "docs/readme/social-preview.svg";
const pngPath = "docs/readme/social-preview.png";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const svg = socialSvg(readFileSync(svgPath, "utf8"), version);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await page.goto(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.locator("svg").screenshot({ animations: "disabled" });
  assert.equal(png.readUInt32BE(16), 1280, "Social card must be 1280px wide");
  assert.equal(png.readUInt32BE(20), 640, "Social card must be 640px high");
  writeFileSync(svgPath, svg);
  writeFileSync(pngPath, png);
  console.log(svgPath);
  console.log(pngPath);
} finally {
  await browser.close();
}
