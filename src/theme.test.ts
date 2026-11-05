import { expect, test } from "vitest";
import threeCss from "../checks/three.css?inline";
import threePage from "../checks/three.tsx?raw";
import syntheticCss from "../devtools/synthetic-preview.css?inline";
import syntheticPage from "../devtools/synthetic-preview.tsx?raw";
import page from "../index.html?raw";
import app from "./app.tsx?raw";
import liveCss from "./live/panel.css?inline";
import measurement from "./measurement-value.tsx?raw";
import previewCss from "./style.css?inline";
import disclosure from "./ui/disclosure-section.tsx?raw";
import coverage from "./ui/gpu-coverage.tsx?raw";
import viewerCss from "./viewer/viewer.css?inline";

const liveSources = Object.values(
  import.meta.glob<string>(
    ["./live/*.tsx", "./capture/*.tsx", "./loading/*.tsx", "./compare/*.tsx", "!./**/*.test.tsx"],
    {
      query: "?raw",
      import: "default",
      eager: true,
    },
  ),
);
const viewerSources = Object.values(
  import.meta.glob<string>(
    [
      "./viewer/*.tsx",
      "./compare/results-view.tsx",
      "./compare/settings.tsx",
      "!./viewer/*.test.tsx",
    ],
    {
      query: "?raw",
      import: "default",
      eager: true,
    },
  ),
);

test("compiles every literal utility after removing Tailwind default colors and text sizes", () => {
  for (const [sources, css] of [
    [[...liveSources, disclosure, measurement, coverage], liveCss],
    [[page, app], previewCss],
    [[...viewerSources, measurement, coverage], viewerCss],
    [[threePage], threeCss],
    [[syntheticPage], syntheticCss],
  ] as const) {
    for (const source of sources) {
      for (const match of source.matchAll(/class="([^"]+)"/g)) {
        for (const token of match[1]?.split(/\s+/) ?? []) {
          expect(css, `Missing utility ${token}`).toContain(
            `.${token.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`,
          );
        }
      }
    }
  }
});
