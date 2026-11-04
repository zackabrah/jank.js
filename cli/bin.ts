import { parseArgs } from "node:util";
import { ANALYZE_HELP, runAnalyze } from "./analyze.ts";

const USAGE = `Usage: jank analyze <recording-or-comparison.json> [--top <n>]

${ANALYZE_HELP}

Exits 1 if a file can't be read, and 2 for bad arguments.`;

const failUsage = (message: string): never => {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
};

if (process.argv[2] === "experiment")
  failUsage(
    "jank experiment drives a browser with Playwright, so it only runs from a checkout of the jank.js repository.",
  );
const { positionals, values } = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: { help: { type: "boolean", short: "h" }, top: { type: "string" } },
    });
  } catch (error) {
    return failUsage(error instanceof Error ? error.message : String(error));
  }
})();
const [command, ...files] = positionals;

try {
  if (values.help) console.log(USAGE);
  else if (command === "analyze") await runAnalyze(files, values.top, failUsage);
  else failUsage("Expected analyze.");
} catch (error) {
  console.error(`jank ${command}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
