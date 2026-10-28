// Where each /__fixture/ path comes from. The Playwright route and `pnpm stress` both serve
// fixtures through this, so the two can't drift apart.
const named = new Map([
  ["", "e2e/fixtures/game.html"],
  ["index.html", "e2e/fixtures/game.html"],
  ["game.js", "e2e/fixtures/game.js"],
  ["load.html", "e2e/fixtures/load.html"],
  ["load.js", "e2e/fixtures/load.js"],
  ["stats.min.js", "node_modules/stats.js/build/stats.min.js"],
]);

const statsGl = "stats-gl/";

const types = new Map([
  ["css", "text/css"],
  ["html", "text/html"],
  ["js", "text/javascript"],
  ["woff2", "font/woff2"],
]);

// The accuracy scene runs cross-origin isolated, so its timers resolve to 5 µs, not 100 µs.
const isolated = new Set(["load.html"]);

const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/** The file behind a fixture path: a named fixture, a stats-gl module, or the built package. */
export function fixtureFile(name) {
  const fixture = named.get(name);

  if (fixture) return fixture;

  if (name.startsWith(statsGl))
    return `node_modules/stats-gl/dist/${name.slice(statsGl.length)}`;

  return `dist-package/${name}`;
}

/** Response headers for a fixture path and its file. */
export const fixtureHeaders = (name, file) => ({
  "Content-Type": types.get(file.split(".").pop() ?? "") ?? "text/plain",
  ...(isolated.has(name) && isolation),
});
