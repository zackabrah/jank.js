import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Page } from "@playwright/test";

export const dist = "dist-package";
export const origin = "http://jank.test";
const types: Record<string, string> = { ".js": "text/javascript", ".html": "text/html" };

/** Serves the built files with no dev server involved, as a consumer's static host would. */
export async function servePackage(page: Page, html: string, headers?: Record<string, string>) {
  await page.route(`${origin}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/")
      return route.fulfill({
        contentType: "text/html",
        body: html,
        ...(headers ? { headers: { ...headers, "Content-Type": "text/html" } } : {}),
      });
    const file = join(dist, path);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({
      contentType: types[extname(file)] ?? "application/octet-stream",
      body: readFileSync(file),
      ...(headers ? { headers } : {}),
    });
  });
}
