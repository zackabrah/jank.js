import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";

import type { Diagnostics } from "../src/core/diagnostics.ts";

import { fixtureFile, fixtureHeaders } from "./fixtures/files.mjs";

declare global {
  interface Window {
    fixture: {
      monitor: Diagnostics;
      spikeFrames: number[];
      spike(ms?: number): void;

      event(label: string): void;
      loaded: Promise<void>;
    };
  }
}

/** Serves the fixtures and the built package under /__fixture/ on the viewer's origin. */
export async function serveFixtures(page: Page) {
  await page.route("**/__fixture/**", async (route) => {
    const name =
      new URL(route.request().url()).pathname.split("/__fixture/")[1] ?? "";

    if (name.includes("..")) return route.fulfill({ status: 404 });

    const file = fixtureFile(name);

    try {
      await route.fulfill({
        body: await readFile(file),
        headers: fixtureHeaders(name, file),
      });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
}

/**
 * Serve the fixture game beside the built package, on the viewer server's origin so the
 * hosted viewer at /viewer/ is same-origin. Requires `pnpm build` (dist-package).
 */
export async function openFixture(
  page: Page,
  query: Record<string, string> = {},
) {
  await serveFixtures(page);

  await page.goto(`/__fixture/index.html?${new URLSearchParams(query)}`);

  await page.evaluate(() => window.fixture.loaded);
}

/** Board-sized screenshots, taken once (Chromium). `pnpm docs:images` copies them into the manual. */
export const boardShot = (name: string) => `artifacts/screenshots/${name}`;
