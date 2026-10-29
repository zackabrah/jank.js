import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

function lint(source, path = "packages/jank/src/core/policy-probe.ts") {
  const directory = mkdtempSync(join(tmpdir(), "jank-biome-policy-"));
  const file = join(directory, path);
  const config = JSON.parse(readFileSync("biome.json", "utf8"));
  // Fixtures have no Git checkout. All actual lint rules and path overrides remain intact.
  config.vcs.enabled = false;

  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
    writeFileSync(join(directory, "biome.json"), JSON.stringify(config));
    const result = spawnSync(
      process.execPath,
      [
        resolve("node_modules/@biomejs/biome/bin/biome"),
        "lint",
        `--config-path=${directory}`,
        "--error-on-warnings",
        "--colors=off",
        file,
      ],
      { encoding: "utf8" },
    );

    assert.ifError(result.error);
    return { status: result.status, report: result.stdout + result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("ordinary readable TypeScript needs no rule exemptions", () => {
  const result = lint(`
export function average(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}
`);

  assert.equal(result.status, 0, result.report);
});

const violations = [
  ["explicit any", "export const value: any = 1;", "suspicious/noExplicitAny"],
  [
    "non-null assertion",
    "export function first(values: readonly number[]) { return values[0]!; }",
    "style/noNonNullAssertion",
  ],
  [
    "nested ternary",
    "export function label(a: boolean, b: boolean) { return a ? b ? 'one' : 'two' : 'three'; }",
    "style/noNestedTernary",
  ],
  [
    "too many positional parameters",
    "export function sum(a: number, b: number, c: number, d: number, e: number) { return a+b+c+d+e; }",
    "complexity/useMaxParams",
  ],
  ["an unobserved promise", "Promise.resolve(42);", "nursery/noFloatingPromises"],
  [
    "excessive branching",
    `export function nested(value: number): number {
      if (value > 0) { if (value > 1) { if (value > 2) {
        if (value > 3) { if (value > 4) { if (value > 5) { return 1; } } }
      } } }
      return 0;
    }`,
    "complexity/noExcessiveCognitiveComplexity",
  ],
];

for (const [name, source, category] of violations) {
  test(`policy rejects ${name}`, () => {
    const result = lint(source);
    assert.notEqual(result.status, 0, result.report);
    assert.ok(result.report.includes(`lint/${category}`), result.report);
  });
}

test("junkui cannot depend on the profiler package", () => {
  const result = lint(
    'import type { Profiler } from "jank.js"; export type Forbidden = Profiler;',
    "packages/junkui/src/policy-probe.ts",
  );

  assert.notEqual(result.status, 0, result.report);
  assert.ok(result.report.includes("lint/style/noRestrictedImports"), result.report);
});

test("the core cannot import the panel through a relative path", () => {
  const result = lint(
    'import type { Panel } from "../panel/panel.ts"; export type Forbidden = Panel;',
  );

  assert.notEqual(result.status, 0, result.report);
  assert.ok(result.report.includes("lint/style/noRestrictedImports"), result.report);
});
