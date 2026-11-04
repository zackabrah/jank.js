import { parseArgs } from "node:util";
import { ANALYZE_HELP, runAnalyze } from "./analyze.ts";

const USAGE = `Usage:
  jank analyze <recording-or-comparison.json> [--top <n>]
  jank experiment --a <url> --b <url> --out <dir> [options]

${ANALYZE_HELP}

experiment records fresh page loads in A-B-B-A order through each page's
window.jank, then saves the trials and a comparison and prints the results.
  --cdp <url>            Drive a browser already running, such as on another machine
  --headless             Use bundled headless Chromium instead of installed Chrome
  --pairs <n>            A/B pairs, 1-5 (default 2)
  --warmup <ms>          Wait after load before recording (default 0)
  --measure <ms>         Recording length (default 15000)
  --viewport <WxH>       Default 1440x900
  --label-a, --label-b   Names for the two builds
  --init <file>          Script to run before each page, repeatable
  --replace <glob::find::to>  Rewrite a response, repeatable. {nonce} in "to" differs
                         per page, which can force a cold shader compile
  --replace-b <glob::find::to>  The same, for B only: tries a change with no second build
  --scenario <file>      Script to run after load and before recording, to reach a
                         repeatable state
  --screenshot           Compare the builds' last frames, with the difference between
                         two runs of A as the noise floor. Needs a repeatable scene
  --hide <selector>      Hide overlays such as the panel before the screenshot
  --profile              Add one profiled load per build and report CPU hotspots
Compare a build with itself to see the noise floor.

Exits 1 if a file can't be read or a run fails, and 2 for bad arguments.`;

const failUsage = (message: string): never => {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
};

function whole(name: string, value: string | undefined, fallback: number, min: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min)
    return failUsage(`--${name} must be a whole number of at least ${min}.`);
  return parsed;
}

function readOptions() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        top: { type: "string" },
        a: { type: "string" },
        b: { type: "string" },
        out: { type: "string" },
        cdp: { type: "string" },
        headless: { type: "boolean" },
        pairs: { type: "string" },
        warmup: { type: "string" },
        measure: { type: "string" },
        viewport: { type: "string" },
        "label-a": { type: "string" },
        "label-b": { type: "string" },
        init: { type: "string", multiple: true },
        replace: { type: "string", multiple: true },
        "replace-b": { type: "string", multiple: true },
        profile: { type: "boolean" },
        scenario: { type: "string" },
        hide: { type: "string" },
        screenshot: { type: "boolean" },
      },
    });
  } catch (error) {
    return failUsage(error instanceof Error ? error.message : String(error));
  }
}

const { positionals, values } = readOptions();
const [command, file, ...extra] = positionals;

try {
  if (values.help) {
    console.log(USAGE);
  } else if (command === "analyze") {
    await runAnalyze([file, ...extra], values.top, failUsage);
  } else if (command === "experiment") {
    if (file) failUsage("experiment takes options only.");
    const { a, b, out } = values;
    if (!a || !b || !out) throw failUsage("experiment needs --a, --b and --out.");
    const pairs = whole("pairs", values.pairs, 2, 1);
    if (pairs > 5) failUsage("--pairs can be at most 5.");
    const [width, height] = (values.viewport ?? "1440x900").split("x").map(Number);
    if (!width || !height) throw failUsage("--viewport must look like 1440x900.");
    const rulesFrom = (rules: string[] | undefined) =>
      (rules ?? []).map((rule) => {
        const [glob, find, to] = rule.split("::");
        if (!glob || !find || to === undefined) throw failUsage("--replace needs glob::find::to.");
        return { glob, find, to };
      });
    const { runExperiment } = await import("./experiment.ts");
    const result = await runExperiment({
      a,
      b,
      out,
      replace: rulesFrom(values.replace),
      replaceB: rulesFrom(values["replace-b"]),
      labelA: values["label-a"] ?? "A",
      labelB: values["label-b"] ?? "B",
      cdp: values.cdp,
      headless: values.headless ?? false,
      pairs,
      warmupMs: whole("warmup", values.warmup, 0, 0),
      measureMs: whole("measure", values.measure, 15000, 100),
      viewport: { width, height },
      init: values.init ?? [],
      profile: values.profile ?? false,
      scenario: values.scenario,
      hide: values.hide,
      screenshot: values.screenshot ?? false,
    });
    console.log(JSON.stringify(result, null, 2));
  } else {
    failUsage("Expected analyze or experiment.");
  }
} catch (error) {
  console.error(`jank ${command}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
