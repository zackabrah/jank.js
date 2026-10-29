import { readFile } from "node:fs/promises";

import { createServer } from "node:http";

import { fixtureFile, fixtureHeaders } from "../e2e/fixtures/files.mjs";

const host = "127.0.0.1";

// One above the viewer's dev port, so both can run at once.
const defaultPort = 5184;

const port = Number(process.env.PORT ?? defaultPort);

const prefix = "/__fixture/";

const scene = `${prefix}load.html`;

const status = { ok: 200, found: 302, missing: 404 };

// Serves the stress scene and the built package on loopback only, as the Playwright route does.
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", `http://${host}`).pathname;

  if (!path.startsWith(prefix)) {
    response.writeHead(status.found, { Location: scene }).end();

    return;
  }

  const name = decodeURIComponent(path.slice(prefix.length));

  const file = fixtureFile(name);

  try {
    if (name.includes("..")) throw new Error("Outside the fixtures");

    const body = await readFile(file);

    response.writeHead(status.ok, fixtureHeaders(name, file)).end(body);
  } catch {
    response.writeHead(status.missing).end();
  }
});

server.listen(port, host, () =>
  console.log(`Stress scene: http://${host}:${port}${scene}`),
);
