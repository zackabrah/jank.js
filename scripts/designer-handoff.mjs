import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { designerMockFiles } from "../tests/fixtures/designer.ts";
import { readBuildIdentity } from "./build-identity.ts";
import { capturePanels } from "./designer-panel-captures.mjs";
import { captureViewer } from "./designer-viewer-captures.mjs";

const identity = readBuildIdentity();
const output = resolve(process.argv[2] ?? `artifacts/designer-handoff-${identity.revision}`);
mkdirSync(output);
mkdirSync(resolve(output, "screenshots"));
for (const target of ["ui-library", "viewer"]) {
  execFileSync(process.execPath, ["scripts/build-standalone.mjs", target], { stdio: "pipe" });
  copyFileSync(`artifacts/jank-${target}.html`, resolve(output, `jank-${target}.html`));
}
for (const [name, value] of Object.entries(designerMockFiles())) {
  writeFileSync(resolve(output, name), JSON.stringify(value));
}
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
  colorScheme: "dark",
  locale: "en-US",
  timezoneId: "UTC",
});
await context.addInitScript(() => {
  // All preview costs are synthetic too; avoid machine-dependent overhead numbers in review images.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: () => Promise.reject(new Error("Mock clipboard denial")) },
  });
  let mockNow = 0;
  Object.defineProperty(performance, "now", {
    value: () => {
      mockNow += 0.01;
      return mockNow;
    },
  });
});
const errors = [];
const requests = [];
await context.route(/^https?:/, (route) => {
  requests.push(route.request().url());
  return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on("pageerror", (error) => errors.push(error.message));
await page.clock.setFixedTime(new Date("2026-11-01T00:00:00Z"));
const screenshots = [];
const take = async (id, title, locator) => {
  const file = `screenshots/${String(screenshots.length + 1).padStart(3, "0")}-${id}.png`;
  await (locator ?? page).screenshot({ path: resolve(output, file), animations: "disabled" });
  screenshots.push({ id, title, file, viewport: page.viewportSize(), deviceScaleFactor: 2 });
  console.log(`${screenshots.length}: ${title}`);
};
let panelGroups;
let viewerGroups;
try {
  await page.goto(pathToFileURL(resolve(output, "jank-ui-library.html")).href);
  panelGroups = await capturePanels(page, take);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(pathToFileURL(resolve(output, "jank-viewer.html")).href);
  viewerGroups = await captureViewer(page, take, (name) => resolve(output, name));
  assert.deepEqual(errors, [], "No page errors in the offline walkthrough");
  assert.deepEqual(requests, [], "No external resources in the offline walkthrough");
  assert.equal(new Set(screenshots.map((item) => item.id)).size, screenshots.length);
} finally {
  await browser.close();
}
const manifest = {
  identity,
  browser: "Chromium",
  mock: true,
  panelGroups,
  viewerGroups,
  screenshots,
};
writeFileSync(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2));
const brief = `# Jank UI/UX review — synthetic demonstration\n\nSource: ${identity.revision}. ${screenshots.length} screenshots, Chromium, 2× resolution. Desktop viewport 1440×1000; narrow viewport 390×844. Panel images are cropped to the real component.\n\nOpen index.html for the screenshot catalogue. Open jank-ui-library.html to explore LIVE, LOADING and CAPTURE, full/mini/line modes, controls and theme. The stream can be paused and advanced by 60 frames; select mock GPU and loading states in the labelled controls. Open jank-viewer.html and use OPEN with any mock-*.json file. Everything works offline.\n\nAll data is SIMULATED. These are actual current components, not proposed designs. Clock and overhead values are synthetic for repeatability. Animations are disabled in screenshots; use the interactive library with normal motion settings to review effects. Screens show focused expanded groups as well as default and collapsed layouts. Lower-content images retain the real scroll constraints.\n\nPlease review information hierarchy, scanability, density, labels, tab discoverability, recording/automatic capture feedback, loading vs CPU/GPU meaning, unavailable vs zero values, A/B colour legibility, keyboard focus, scroll affordances and narrow layouts. Preserve truthful missing measurements, pinned row ordering, accessible labelled controls, collapsible sections, and host-owned frame collection.\n\nMock files: mock-recording.json (360 frames, spike, sparse counters and incomplete GPU evidence), mock-episode.json (sustained slowdown), mock-comparison.json (four ABBA trials). No private scene assets or production measurements are included. The scope is the shared UI library, profiler panel and offline viewer; host-specific scene controls and native file dialogs are excluded. No files have been sent externally.\n\nPanel groups: ${panelGroups.join(", ")}.\nViewer disclosures: ${viewerGroups.join(", ")}.\n`;
writeFileSync(resolve(output, "README.md"), brief);
const cards = screenshots
  .map(
    (item) =>
      `<article><a href="${item.file}"><img loading="lazy" src="${item.file}" alt="${item.title}" /></a><h2>${item.title}</h2><p>${item.viewport.width} × ${item.viewport.height} viewport · 2× PNG</p></article>`,
  )
  .join("\n");
writeFileSync(
  resolve(output, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Jank designer handoff</title><style>body{margin:0;background:#111318;color:#e5e7ed;font:15px system-ui}header{padding:32px;max-width:1000px}h1{font-size:30px}a{color:#80d9f0}nav{display:flex;flex-wrap:wrap;gap:18px;margin:20px 0}label{display:block}input{display:block;width:min(90%,600px);padding:12px;margin-top:8px;background:#20242c;color:inherit;border:1px solid #667080;border-radius:4px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;padding:0 32px 32px}article{background:#1b1e25;padding:16px;border:1px solid #343a46}img{width:100%;height:330px;object-fit:contain;background:#101216}h2{font-size:17px}p{line-height:1.6;color:#bcc4d2}[hidden]{display:none}</style><header><h1>Jank UI/UX review</h1><p>Current UI · entirely synthetic data · ${screenshots.length} screenshots · source ${identity.revision}</p><p>Review hierarchy, labels, density, scrolling, capture feedback and missing measurements. Click any image for its full-resolution PNG. Screenshots freeze motion; use the interactive library to review animations.</p><nav><a href="jank-ui-library.html">Interactive UI library</a><a href="jank-viewer.html">Offline viewer</a><a href="README.md">Review brief</a><a href="manifest.json">Screen inventory</a><a href="mock-recording.json" download>Recording sample</a><a href="mock-episode.json" download>Episode sample</a><a href="mock-comparison.json" download>A/B sample</a></nav><label>Filter screenshots<input type="search" placeholder="e.g. loading, GPU, narrow, comparison"></label><p role="status" id="count">${screenshots.length} screenshots</p></header><main>${cards}</main><script>document.querySelector('input').addEventListener('input',event=>{let count=0;for(const card of document.querySelectorAll('article')){card.hidden=!card.textContent.toLowerCase().includes(event.target.value.toLowerCase());if(!card.hidden)count++;}document.querySelector('#count').textContent=count+' screenshots';});</script></html>`,
);
const files = [
  "index.html",
  "README.md",
  "manifest.json",
  "jank-ui-library.html",
  "jank-viewer.html",
  ...Object.keys(designerMockFiles()),
  ...screenshots.map((item) => item.file),
];
writeFileSync(
  resolve(output, "SHA256SUMS"),
  `${files
    .map(
      (file) =>
        `${createHash("sha256")
          .update(readFileSync(resolve(output, file)))
          .digest("hex")}  ${file}`,
    )
    .join("\n")}\n`,
);
console.log(`Designer handoff: ${output}`);
