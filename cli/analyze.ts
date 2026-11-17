import { readFile } from "node:fs/promises";
import { analyzeDocument } from "../src/agent/analyze.ts";
import { parseViewerDocument } from "../src/viewer/document.ts";

export const ANALYZE_HELP = `analyze prints a short ranked JSON report: slow-frame episodes, event costs, GPU
passes and growing counters for a recording, or verdicts for a comparison. --top
limits each list (default 10).`;

/** Parses --top, reports through failUsage, and prints the report for one file. */
export async function runAnalyze(
  files: readonly (string | undefined)[],
  top: string | undefined,
  failUsage: (message: string) => never,
) {
  const [file] = files;
  if (!file || files.length !== 1) return failUsage("Expected analyze <file>.");
  const limit = top === undefined ? undefined : Number(top);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
    return failUsage("--top must be a whole number of at least 1.");
  const text = await readFile(file, "utf8");
  const document = parseViewerDocument(text.replace(/^\uFEFF/, ""));
  console.log(JSON.stringify(analyzeDocument(document, limit), null, 2));
}
