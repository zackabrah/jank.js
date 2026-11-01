import { test } from "node:test";

import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { fileURLToPath } from "node:url";

import { noMagicStrings } from "./plugin.mjs";

/** A string literal node. */
const string = (value) => ({ type: "Literal", value });

const name = { type: "Identifier", name: "mode" };

const lint = (visit) => {
  const reports = [];

  const visitors = noMagicStrings.create({
    report: (report) => reports.push(report),
  });

  visit(visitors);

  return reports.length;
};

const compare = (operator, left, right) => (visitors) =>
  visitors.BinaryExpression({
    type: "BinaryExpression",
    operator,
    left,
    right,
  });

await test("string literals in comparisons and case labels are reported", () => {
  assert.equal(lint(compare("===", name, string("line"))), 1);
  assert.equal(lint(compare("!=", string("line"), name)), 1);
  assert.equal(
    lint((visitors) => visitors.SwitchCase({ test: string("ready") })),
    1,
  );
  assert.equal(
    lint(
      compare("===", name, {
        type: "TemplateLiteral",
        expressions: [],
        quasis: [{ value: { cooked: "full" } }],
      }),
    ),
    1,
  );
});

await test("typeof checks, empty strings, non-comparisons and default cases pass", () => {
  const typeOf = {
    type: "UnaryExpression",
    operator: "typeof",
    argument: name,
  };

  assert.equal(lint(compare("===", typeOf, string("string"))), 0);
  assert.equal(lint(compare("===", name, string(""))), 0);
  assert.equal(lint(compare("+", name, string("px"))), 0);
  assert.equal(lint(compare("===", name, { type: "Literal", value: 4 })), 0);
  assert.equal(
    lint((visitors) => visitors.SwitchCase({ test: null })),
    0,
  );
});

const sample = `/** Adds one. */
function commented() {}

// Line comment.
function lineComment() {}

// First line,
// second line.
function multiLine() {}

/* Plain block. */
function plainBlock() {}

function bare() {}

/** Exported. */
export const exported = () => 1;

/** Detached by a blank line. */

const detached = () => 2;

// oxlint-disable-next-line no-console
const directiveOnly = () => 3;

// Doc above a directive.
// oxlint-disable-next-line no-console
const lineAboveDirective = () => 4;

class Runner {
  /** Runs. */
  run() {}

  // Stops.
  stop() {}

  handler = () => {};
}

export const api = { method() {} };

[1].map((value) => value);
`;

const lineOf = (text) =>
  sample.split("\n").findIndex((line) => line.includes(text)) + 1;

/** Runs oxlint with one jank rule on some source; returns its report and the file afterwards. */
const lintSource = (rule, text, ...flags) => {
  const root = mkdtempSync(join(tmpdir(), "jank-lint-"));

  const file = join(root, "sample.ts");

  try {
    writeFileSync(file, text);

    writeFileSync(
      join(root, "config.json"),
      JSON.stringify({
        jsPlugins: [fileURLToPath(new URL("plugin.mjs", import.meta.url))],
        rules: { [`jank/${rule}`]: "error" },
      }),
    );

    const { stdout } = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../node_modules/oxlint/bin/oxlint", import.meta.url),
        ),
        "-A",
        "all",
        "-c",
        join(root, "config.json"),
        "--format=unix",
        ...flags,
        file,
      ],
      { encoding: "utf8" },
    );

    return { stdout, source: readFileSync(file, "utf8") };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

await test("functions need a /** */ comment directly above them; object methods and callbacks don't", () => {
  const flagged = [
    ...lintSource("require-function-comment", sample).stdout.matchAll(
      /sample\.ts:(\d+):/g,
    ),
  ].map(([, line]) => Number(line));

  assert.deepEqual(
    flagged,
    [
      "function lineComment",
      "function multiLine",
      "function plainBlock",
      "function bare",
      "const detached",
      "const directiveOnly",
      "const lineAboveDirective",
      "stop()",
      "handler =",
    ].map(lineOf),
  );
});

await test("the fix turns existing comments into /** */ and keeps directives above the code", () => {
  const { source } = lintSource("require-function-comment", sample, "--fix");

  assert.match(source, /\/\*\* Line comment\. \*\/\nfunction lineComment/);
  assert.match(
    source,
    /\/\*\*\n \* First line,\n \* second line\.\n \*\/\nfunction multiLine/,
  );
  assert.match(source, /\/\*\* Plain block\. \*\/\nfunction plainBlock/);
  assert.match(
    source,
    /\/\*\* Doc above a directive\. \*\/\n\/\/ oxlint-disable-next-line no-console\nconst lineAboveDirective/,
  );
  assert.match(source, / {2}\/\*\* Stops\. \*\/\n {2}stop\(\)/);
  assert.match(source, /\nfunction bare/);
});

await test("statements on the same object group; other expression statements stay apart", () => {
  const before = `function save(url, name) {
  const a = document.createElement("a");

  a.href = url;

  a.download = name;

  a.click();
  URL.revokeObjectURL(url);

  frames[0].at = 1;

  frames[1].at = 2;

  // A comment keeps this apart.

  frames[2].at = 3;
}
`;

  const after = `function save(url, name) {
  const a = document.createElement("a");

  a.href = url;
  a.download = name;
  a.click();

  URL.revokeObjectURL(url);

  frames[0].at = 1;
  frames[1].at = 2;

  // A comment keeps this apart.

  frames[2].at = 3;
}
`;

  assert.equal(
    lintSource("group-object-statements", before, "--fix").source,
    after,
  );
  assert.doesNotMatch(
    lintSource("group-object-statements", after).stdout,
    /group-object-statements/,
  );
});
