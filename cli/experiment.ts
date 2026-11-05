import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "@playwright/test";
import { analyzeDocument } from "../src/agent/analyze.ts";
import {
  type ComparisonBundle,
  comparisonSchedule,
  MAX_COMPARISON_MEASURE_MS,
  serializeComparison,
  type VariantKey,
} from "../src/compare/model.ts";
import type { PerformanceRecording } from "../src/recording/types.ts";

export interface ExperimentOptions {
  a: string;
  b: string;
  labelA: string;
  labelB: string;
  cdp: string | undefined;
  headless: boolean;
  pairs: number;
  warmupMs: number;
  measureMs: number;
  viewport: { width: number; height: number };
  init: string[];
  replace: { glob: string; find: string; to: string }[];
  /** Patches for B only: what if this changed? Trying one needs no second build. */
  replaceB: { glob: string; find: string; to: string }[];
  scenario: string | undefined;
  hide: string | undefined;
  screenshot: boolean;
  profile: boolean;
  out: string;
}

interface CpuProfile {
  nodes: {
    id: number;
    callFrame: { functionName: string; url: string; lineNumber: number };
    children?: number[];
  }[];
  samples: number[];
  timeDeltas: number[];
}

const HOTSPOTS = 20;
const LOAD_TIMEOUT_MS = 120000;
const SCREENSHOT_SETTLE_MS = 300;
const NOT_CODE = new Set(["(idle)", "(root)"]);

const fileOf = (url: string) => {
  const file = url.split(/[?#]/)[0]?.split("/").pop() ?? "";
  // WebAssembly URLs are hashes and its functions are numbered, so only the total means anything.
  return url.startsWith("wasm://") ? "WebAssembly" : file;
};

/**
 * For ranking only: sampling itself makes short functions look slower. Self time finds tight
 * loops; inclusive time finds which part of the host to look at; per-file time separates the
 * host's own code from its libraries.
 */
export function hotspotsFrom(profile: CpuProfile, top = HOTSPOTS) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  const label = (frame: CpuProfile["nodes"][number]["callFrame"]) => {
    const file = fileOf(frame.url);
    return file === "WebAssembly"
      ? "WebAssembly"
      : file
        ? `${frame.functionName || "(anonymous)"} ${file}:${frame.lineNumber + 1}`
        : frame.functionName;
  };
  const self = new Map<string, number>();
  const inclusive = new Map<string, number>();
  const byFile = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, ms: number) =>
    map.set(key, (map.get(key) ?? 0) + ms);
  let busy = 0;
  profile.samples.forEach((id, index) => {
    const node = nodes.get(id);
    const name = node?.callFrame.functionName ?? "";
    if (!node || NOT_CODE.has(name)) return;
    const ms = (profile.timeDeltas[index] ?? 0) / 1000;
    busy += ms;
    add(self, label(node.callFrame), ms);
    add(byFile, fileOf(node.callFrame.url) || name || "(native)", ms);
    const seen = new Set<string>();
    for (let at: number | undefined = id; at !== undefined; at = parents.get(at)) {
      const frame = nodes.get(at)?.callFrame;
      // Named host and library functions only: "(root)" and "(anonymous)" contain everything.
      if (!frame?.url || !frame.functionName || fileOf(frame.url) === "WebAssembly") continue;
      seen.add(label(frame));
    }
    for (const key of seen) add(inclusive, key, ms);
  });
  const ranked = (map: Map<string, number>) =>
    [...map]
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([where, ms]) => ({
        where,
        ms: Number(ms.toFixed(1)),
        share: busy ? Number((ms / busy).toFixed(3)) : 0,
      }));
  return {
    busyMs: Number(busy.toFixed(1)),
    byFile: ranked(byFile),
    inclusive: ranked(inclusive),
    self: ranked(self),
  };
}

/** Peak signal-to-noise of two PNGs, computed in the browser so no image library is needed. */
async function imageDifference(browser: Browser, a: Buffer, b: Buffer) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const db = await page.evaluate(
    async ([first, second]) => {
      const read = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const painter = canvas.getContext("2d");
        painter?.drawImage(bitmap, 0, 0);
        return painter?.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [x, y] = [await read(first ?? ""), await read(second ?? "")];
      if (!x || !y || x.length !== y.length) return null;
      let sum = 0;
      for (let i = 0; i < x.length; i += 4)
        for (let c = 0; c < 3; c++) sum += ((x[i + c] ?? 0) - (y[i + c] ?? 0)) ** 2;
      const mean = sum / ((x.length / 4) * 3);
      // JSON has no infinity, so "identical" stays distinct from a failed comparison's null.
      return mean ? 10 * Math.log10((255 * 255) / mean) : "identical";
    },
    [a.toString("base64"), b.toString("base64")],
  );
  await context.close();
  return typeof db === "number" ? Number(db.toFixed(1)) : db;
}

/** CDP's URL patterns: `*` is any run of characters, `?` is one. */
export function matchesGlob(url: string, glob: string) {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*+/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${pattern}$`).test(url);
}

async function openPage(
  browser: Browser,
  options: ExperimentOptions,
  variant: VariantKey,
  url: string,
  nonce: number,
) {
  const rules = variant === "B" ? [...options.replace, ...options.replaceB] : options.replace;
  const context = await browser.newContext({ viewport: options.viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  const failures: string[] = [];
  const applied = new Set<(typeof rules)[number]>();
  page.on("pageerror", (error) => errors.push(error.message));
  for (const file of options.init) await page.addInitScript(await readFile(file, "utf8"));
  // In the browser rather than here: only it can reach a remote machine's localhost.
  if (rules.length) {
    const cdp = await context.newCDPSession(page);
    cdp.on("Fetch.requestPaused", ({ requestId, request, responseStatusCode, responseHeaders }) => {
      const matching = rules.filter(({ glob }) => matchesGlob(request.url, glob));
      const rewrite = async () => {
        const { body, base64Encoded } = await cdp.send("Fetch.getResponseBody", { requestId });
        let text = base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
        for (const rule of matching) {
          if (!text.includes(rule.find))
            throw new Error(`--replace found nothing to change in ${request.url}: ${rule.find}`);
          text = text.replaceAll(rule.find, rule.to.replace("{nonce}", `${nonce}`));
          applied.add(rule);
        }
        await cdp.send("Fetch.fulfillRequest", {
          requestId,
          responseCode: responseStatusCode ?? 200,
          responseHeaders: responseHeaders ?? [],
          body: Buffer.from(text, "utf8").toString("base64"),
        });
      };
      rewrite().catch((error: unknown) => {
        failures.push(error instanceof Error ? error.message : String(error));
        cdp.send("Fetch.continueRequest", { requestId }).catch(() => {});
      });
    });
    await cdp.send("Fetch.enable", {
      patterns: rules.map(({ glob }) => ({
        urlPattern: glob,
        requestStage: "Response" as const,
      })),
    });
  }
  await page.goto(url);
  await page.waitForFunction(() => window.jank?.version === 1, null, { timeout: LOAD_TIMEOUT_MS });
  // A patch that never applied means the trial isn't testing what it claims to.
  for (const rule of rules)
    if (!applied.has(rule)) failures.push(`--replace matched no request: ${rule.glob}`);
  const [failure] = failures;
  if (failure) throw new Error(failure);
  const load = await page.evaluate(() => {
    const round = (value: number) => Math.round(value);
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    return {
      readyMs: round(performance.now()),
      domContentLoadedMs: round(navigation?.domContentLoadedEventEnd ?? 0),
      slowestResources: (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 5)
        .map((entry) => ({
          name: entry.name.split("/").slice(-2).join("/"),
          ms: round(entry.duration),
          kb: round(entry.transferSize / 1024),
        })),
      // Anything the host timed itself: this is how startup phases reach the report.
      measures: performance.getEntriesByType("measure").map((entry) => ({
        name: entry.name,
        startMs: round(entry.startTime),
        ms: round(entry.duration),
      })),
    };
  });
  if (options.scenario) await page.evaluate(await readFile(options.scenario, "utf8"));
  return { context, page, errors, load };
}

async function record(page: Page, options: ExperimentOptions) {
  if (options.warmupMs) await page.waitForTimeout(options.warmupMs);
  await page.evaluate(() => window.jank?.start());
  await page.waitForTimeout(options.measureMs);
  const stopped = await page.evaluate(() => window.jank?.stop());
  if (!stopped) throw new Error("The page's window.jank went away during the trial.");
  const json = await page.evaluate((id) => window.jank?.export(id) ?? "", stopped.id);
  return { json, recording: JSON.parse(json) as PerformanceRecording };
}

/** Fresh pages in A-B-B-A order, so slow drift on the machine affects both builds evenly. */
export async function runExperiment(options: ExperimentOptions) {
  await mkdir(options.out, { recursive: true });
  const browser = options.cdp
    ? await chromium.connectOverCDP(options.cdp)
    : options.headless
      ? await chromium.launch()
      : await chromium.launch({ channel: "chrome", headless: false });
  const urls: Record<VariantKey, string> = { A: options.a, B: options.b };
  const trials: ComparisonBundle["trials"] = [];
  const loads: { pair: number; variant: VariantKey; errors: string[]; load: unknown }[] = [];
  const hotspots: Partial<Record<VariantKey, ReturnType<typeof hotspotsFrom>>> = {};
  const screenshots: Record<VariantKey, Buffer[]> = { A: [], B: [] };
  const image: { noiseFloorDb: number | string | null; vsBaselineDb: number | string | null } = {
    noiseFloorDb: null,
    vsBaselineDb: null,
  };
  let nonce = Date.now() % 1000000;
  try {
    for (const { pair, variant } of comparisonSchedule(options.pairs)) {
      const { context, page, errors, load } = await openPage(
        browser,
        options,
        variant,
        urls[variant],
        ++nonce,
      );
      const { json, recording } = await record(page, options);
      if (options.screenshot) {
        if (options.hide)
          await page.addStyleTag({ content: `${options.hide} { display: none !important; }` });
        await page.waitForTimeout(SCREENSHOT_SETTLE_MS);
        const shot = await page.screenshot();
        screenshots[variant].push(shot);
        await writeFile(join(options.out, `trial-${pair}${variant}.png`), shot);
      }
      await context.close();
      await writeFile(join(options.out, `trial-${pair}${variant}.json`), json);
      const first = recording.frames[0];
      const last = recording.frames.at(-1);
      if (!first || !last) throw new Error(`Trial ${pair}${variant} recorded no frames.`);
      trials.push({
        pair,
        variant,
        measurementStartMs: first.at - first.interval,
        measurementEndMs: last.at,
        recording,
      });
      loads.push({ pair, variant, errors, load });
    }
    // Separate trials: the profiler slows the page, so it stays out of the timings above.
    if (options.profile)
      for (const variant of ["A", "B"] as const) {
        const { context, page } = await openPage(browser, options, variant, urls[variant], ++nonce);
        const cdp = await context.newCDPSession(page);
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
        await cdp.send("Profiler.start");
        if (options.warmupMs) await page.waitForTimeout(options.warmupMs);
        await page.waitForTimeout(options.measureMs);
        const { profile } = await cdp.send("Profiler.stop");
        hotspots[variant] = hotspotsFrom(profile as CpuProfile);
        await context.close();
      }
    if (options.screenshot) {
      const [a1, a2] = screenshots.A;
      const [b1] = screenshots.B;
      if (a1 && a2) image.noiseFloorDb = await imageDifference(browser, a1, a2);
      if (a1 && b1) image.vsBaselineDb = await imageDifference(browser, a1, b1);
    }
  } finally {
    await browser.close();
  }
  const durations = trials.map((trial) => trial.measurementEndMs - trial.measurementStartMs);
  const first = trials[0];
  if (!first) throw new Error("The experiment ran no trials.");
  const settings = (build: string) => ({ Build: build });
  const bundle: ComparisonBundle = {
    format: "jank.js-comparison",
    version: 1,
    status: "complete",
    reason: "Each trial is a fresh page load, assembled by jank experiment.",
    plan: {
      warmupMs: Math.min(options.warmupMs, 10000),
      measureMs: Math.min(MAX_COMPARISON_MEASURE_MS, Math.floor(Math.min(...durations))),
      pairs: options.pairs,
    },
    budgetMs: first.recording.budget.frameMs,
    change: "Build",
    variants: {
      A: { label: options.labelA, settings: settings(options.labelA) },
      B: { label: options.labelB, settings: settings(options.labelB) },
    },
    policy: { minSamples: 20, minCoverage: 0.8 },
    trials,
  };
  const reports = trials.map((trial) => analyzeDocument(trial.recording));
  let comparison: ReturnType<typeof analyzeDocument> | { error: string };
  try {
    await writeFile(join(options.out, "comparison.json"), serializeComparison(bundle));
    comparison = analyzeDocument(bundle);
  } catch (error) {
    // A long recording can pass the import limit; the trials are still saved and reported.
    comparison = { error: error instanceof Error ? error.message : String(error) };
  }
  return {
    comparison,
    loads,
    ...(options.screenshot ? { image } : {}),
    hotspots,
    reports,
    out: options.out,
  };
}
