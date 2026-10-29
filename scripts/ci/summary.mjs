import { appendFile, readFile, readdir, stat } from "node:fs/promises";

import { join } from "node:path";

import { gzipSync } from "node:zlib";

import {
  accuracy,
  browserResults,
  coverage,
  packageFiles,
} from "./markdown.mjs";

/** The summary for each CI job: `node scripts/ci/summary.mjs check` or `browser`. */
const job = { check: "check", browser: "browser" };

const missing = "ENOENT";

const built = /\.(js|css|html)$/;

/** Shown in place of a report when the step that writes it did not finish. */
const absent = (what) =>
  `### ${what}\n\n_Not produced: the step that writes it did not finish._\n`;

/** A file's contents, or null when the step that writes it did not run. */
async function contents(read) {
  try {
    return await read();
  } catch (error) {
    if (error.code === missing) return null;

    throw error;
  }
}

/** Parsed JSON from a report file, or null when it was not written. */
const report = (path) =>
  contents(async () => JSON.parse(await readFile(path, "utf8")));

/** The built package files with their raw and gzipped sizes, or null before a build. */
const builtFiles = () =>
  contents(async () => {
    const names = (await readdir("dist-package", { recursive: true }))
      .filter((name) => built.test(name))
      .toSorted();

    return Promise.all(
      names.map(async (name) => {
        const body = await readFile(join("dist-package", name));

        return {
          name: name.replaceAll("\\", "/"),
          bytes: body.length,
          gzipped: gzipSync(body).length,
        };
      }),
    );
  });

/** The packed tarballs in artifacts/, with their sizes. */
const tarballs = async () =>
  Promise.all(
    ((await contents(() => readdir("artifacts"))) ?? [])
      .filter((name) => name.endsWith(".tgz"))
      .map(async (name) => ({
        name,
        bytes: (await stat(join("artifacts", name))).size,
      })),
  );

/** The check job: unit test coverage and the built package. */
async function check() {
  const summary = await report("coverage/coverage-summary.json");

  const files = await builtFiles();

  return [
    summary ? coverage(summary.total) : absent("Unit test coverage"),
    files ? packageFiles(files, await tarballs()) : absent("Package"),
  ].join("\n");
}

/** The browser job: results per browser and the accuracy comparison. */
async function browser() {
  const results = await report("artifacts/e2e/results.json");

  const measured = await report("artifacts/accuracy/report.json");

  return [
    results ? browserResults(results) : absent("Browser tests"),
    measured ? accuracy(measured) : absent("Accuracy against Chrome"),
  ].join("\n");
}

const name = process.argv[2];

const sections = { [job.check]: check, [job.browser]: browser };

if (!Object.hasOwn(sections, name))
  throw new Error(
    `Usage: node scripts/ci/summary.mjs ${Object.keys(sections).join("|")}`,
  );

const markdown = await sections[name]();

// GitHub shows what a step appends here on the run's summary page; locally it prints.
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
else console.log(markdown);
