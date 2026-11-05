// Redraws the README's chips: the fixed ones, and the version, the unit tests
// and each browser engine's tests passing and unit test line coverage from the last full test
// run. Prints the files it wrote, so the pre-commit hook can stage them. Run `pnpm docs:chips`
// after `pnpm check` and `pnpm test:e2e`.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

import {
  chip,
  engineCounts,
  engines,
  themeTokens,
  unitCount,
} from "./chips.mjs";

const coverageDigits = 1;

/** Parsed JSON from a file. */
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

/** Files under a folder whose names end a certain way, as paths relative to it. */
const filesIn = (folder, ending) =>
  readdirSync(folder, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(ending));

const theme = themeTokens(`
  --jl-ink: #0a0a0a;
  --jl-control: #3a3a3a;
  --jl-text: #e8e8e8;
  --jl-green: #00fd00;
  --jl-size-label: 11px;
  --jl-track-label: 0.12em;
  --jl-font: ui-monospace, Menlo, Consolas, monospace;
`);

const engineTests = engineCounts(
  json("artifacts/e2e/results.json"),
  filesIn("e2e", ".spec.ts"),
);

const unitTests = unitCount(
  json("artifacts/unit/results.json"),
  filesIn("src", ".test.ts"),
);

const lines = json("coverage/coverage-summary.json").total.lines.pct;

const chips = {
  // Fixed chips: change the README's alt text and prose with them.
  "badge-measured.svg": chip(theme, "", "MEASURED · NOT SIMULATED"),
  "badge-deps.svg": chip(theme, "", "NOTHING ELSE TO INSTALL"),
  "badge-core.svg": chip(theme, "~4.6", "KB CORE"),
  "badge-panel.svg": chip(theme, "~64", "KB WITH THE LIVE PANEL"),
  "badge-mit.svg": chip(theme, "", "MIT"),
  "badge-version.svg": chip(theme, "", `V${json("package.json").version}`),
  "badge-junklab.svg": chip(theme, "", "A JUNKLAB PRODUCTION"),
  "badge-unit.svg": chip(theme, String(unitTests), "UNIT TESTS"),
  ...Object.fromEntries(
    Object.entries(engines).map(([engine, name]) => [
      `badge-${engine}.svg`,
      chip(theme, String(engineTests[engine]), `${name.toUpperCase()} TESTS`),
    ]),
  ),
  "badge-coverage.svg": chip(
    theme,
    `${lines.toFixed(coverageDigits)}%`,
    "LINE COVERAGE",
  ),
};

for (const [name, svg] of Object.entries(chips)) {
  const path = `docs/readme/${name}`;

  writeFileSync(path, svg);

  console.log(path);
}
