import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startParityPreview } from "../../scripts/parity-preview.mjs";

test("parity preview serves only allowlisted reference assets and proxies the rewrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "jank-parity-"));
  await mkdir(join(root, "dist-package"));
  await writeFile(join(root, "dist-package/viewer.html"), "Original viewer");
  const upstream = createServer((request, response) =>
    response.end(request.headers.accept === "text/css" ? "Rewrite CSS" : "Rewrite"),
  );
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  assert.ok(address && typeof address === "object");
  const server = await startParityPreview({
    referenceRoot: root,
    rewriteOrigin: `http://127.0.0.1:${address.port}`,
    recordings: { original: "{}", rewrite: "{}" },
    port: 0,
  });
  const local = server.address();
  assert.ok(local && typeof local === "object");
  const origin = `http://127.0.0.1:${local.port}`;
  try {
    assert.equal(await (await fetch(`${origin}/reference/viewer.html`)).text(), "Original viewer");
    assert.equal((await fetch(`${origin}/reference/package.json`)).status, 404);
    assert.equal((await fetch(`${origin}/reference/%2e%2e%2fpackage.json`)).status, 404);
    assert.equal(await (await fetch(`${origin}/examples/viewer/`)).text(), "Rewrite");
    assert.equal(await (await fetch(`${origin}/samples/rewrite.json`)).text(), "{}");
    assert.equal(
      await (await fetch(`${origin}/style.css`, { headers: { accept: "text/css" } })).text(),
      "Rewrite CSS",
    );
  } finally {
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
    await rm(root, { recursive: true, force: true });
  }
});
