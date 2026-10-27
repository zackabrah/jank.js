import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";

import type { Diagnostics } from "../src/core/diagnostics.ts";

declare global {
  interface Window {
    fixture: {
      monitor: Diagnostics;
      spike(ms?: number): void;

      event(label: string): void;
      loaded: Promise<void>;
    };
  }
}

const types: Record<string, string> = {
  css: "text/css",
  html: "text/html",
  js: "text/javascript",
  woff2: "font/woff2",
};

/**
 * Serve the fixture game beside the built package, on the viewer server's origin so the
 * hosted viewer at /viewer/ is same-origin. Requires `pnpm build` (dist-package).
 */
export async function openFixture(
  page: Page,
  query: Record<string, string> = {},
) {
  await page.route("**/__fixture/**", async (route) => {
    const name =
      new URL(route.request().url()).pathname.split("/__fixture/")[1] ?? "";

    if (name.includes("..")) return route.fulfill({ status: 404 });

    const file =
      name === "" || name === "index.html"
        ? "e2e/fixtures/game.html"
        : name === "game.js"
          ? "e2e/fixtures/game.js"
          : `dist-package/${name}`;

    try {
      await route.fulfill({
        body: await readFile(file),
        contentType: types[file.split(".").pop() ?? ""] ?? "text/plain",
      });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });

  await page.goto(`/__fixture/index.html?${new URLSearchParams(query)}`);

  await page.evaluate(() => window.fixture.loaded);
}

/** Board-sized screenshots, taken once (Chromium). `pnpm docs:images` copies them into the manual. */
export const boardShot = (name: string) => `artifacts/screenshots/${name}`;
