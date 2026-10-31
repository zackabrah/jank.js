import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readBuildIdentity } from "./build-identity.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const identity = readBuildIdentity();
if (!identity.commit || identity.dirty) {
  throw new Error("Commit verified source before building a versioned preview bundle");
}
const run = (args, cwd = root) => execFileSync("pnpm", args, { cwd, stdio: "inherit" });
const manifest = JSON.parse(await readFile(join(root, "packages/jank/package.json"), "utf8"));
const name = `jank-${manifest.version}-${identity.revision}`;
const bundles = join(root, "artifacts/bundles");
const directory = join(bundles, name);
await mkdir(bundles, { recursive: true });
await mkdir(directory); // Existing versioned bundles are immutable; never overwrite one.
run(["build"]);
run(["build:ui-library"]);
run(["build:viewer"]);
await mkdir(join(directory, "packages"));
for (const folder of ["jank", "junkui"]) {
  run(["pack", "--pack-destination", join(directory, "packages")], join(root, "packages", folder));
}
for (const filename of ["jank-ui-library.html", "jank-viewer.html"]) {
  await cp(join(root, "artifacts", filename), join(directory, filename));
}
for (const filename of ["USAGE.md", "INTEGRATION.md"]) {
  await cp(join(root, "packages/jank/docs", filename), join(directory, filename));
}
await cp(join(root, "LICENSE"), join(directory, "LICENSE"));
await cp(join(root, "packages/junkui/README.md"), join(directory, "JUNKUI.md"));
await cp(
  join(root, "docs/verification/timestamp-clear-2026-11-01.md"),
  join(directory, "GPU-TIMESTAMP-LIMITATION.md"),
);
await cp(
  join(root, "docs/verification/timestamp-clear-2026-11-01.json"),
  join(directory, "GPU-TIMESTAMP-EVIDENCE.json"),
);
const { createProfiler, serializeRecording } = await import("../packages/jank/dist/index.js");
let timeMs = 0;
const profiler = createProfiler({
  now: () => timeMs,
  application: { name: "Synthetic sustained slowdown example" },
});
profiler.capture.arm({
  thresholdMs: 50,
  sustainedMs: 250,
  beforeFrames: 120,
  afterFrames: 120,
  cooldownMs: 5000,
  timeWindow: { beforeMs: 2000, afterMs: 100, recoveryMs: 100, maxDurationMs: 30000 },
});
profiler.beginFrame(timeMs);
for (const durationMs of [...Array(130).fill(16), ...Array(20).fill(35), ...Array(10).fill(16)]) {
  timeMs += durationMs;
  profiler.beginFrame(timeMs);
}
const sample = profiler.capture.completed()[0];
if (!sample || sample.metadata.toolVersion !== `${manifest.version}+${identity.revision}`) {
  throw new Error("Sample build identity did not match bundle source");
}
await mkdir(join(directory, "samples"));
await writeFile(
  join(directory, "samples/example-sustained-episode.json"),
  serializeRecording(sample),
);
profiler.dispose();
await writeFile(
  join(directory, "BUILD.json"),
  `${JSON.stringify(
    {
      name,
      version: manifest.version,
      sourceCommit: identity.commit,
      sourceDirty: false,
      builtAtUtc: new Date().toISOString(),
      node: process.version,
      pnpm: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
      supportedRecordingSchemas: [5, 6, 7],
      comparisonFormatVersion: 1,
      private: true,
      runtimeDependencies: [],
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  join(directory, "README.md"),
  `# Jank private preview ${manifest.version}

Source commit: ${identity.commit}

Open jank-ui-library.html to explore the simulated UI, or jank-viewer.html to inspect local
recordings. Import samples/example-sustained-episode.json for a synthetic slowdown example.
Read USAGE.md for controls and INTEGRATION.md for host integration.

Install packages/jank.js-${manifest.version}.tgz with pnpm add /absolute/path/to/the/archive.tgz.
The independent junkui archive is optional; Jank has zero runtime dependencies. Both packages
remain private. No registry publication or remote deployment is performed.

The updated viewer reads recording schemas 5, 6 and 7. Sustained triggers require schema 7.
Build identity appears in the panel/viewer and recording metadata.toolVersion. BUILD.json
records the full commit, and SHA256SUMS covers every other file in this directory.

GPU timestamp reliability remains limited: native clear-only passes reproduced stale end
values locally. See GPU-TIMESTAMP-LIMITATION.md. This release does not establish a GPU ranking.
`,
);
async function checksums(folder, prefix = "") {
  const lines = [];
  for (const entry of (await readdir(folder)).sort()) {
    const path = join(folder, entry);
    const relative = `${prefix}${entry}`;
    if ((await stat(path)).isDirectory()) {
      lines.push(...(await checksums(path, `${relative}/`)));
    } else {
      lines.push(
        `${createHash("sha256")
          .update(await readFile(path))
          .digest("hex")}  ${relative}`,
      );
    }
  }
  return lines;
}
await writeFile(join(directory, "SHA256SUMS"), `${(await checksums(directory)).join("\n")}\n`);
const current = readBuildIdentity();
if (current.commit !== identity.commit || current.dirty) {
  throw new Error("Source changed during bundle build");
}
execFileSync("zip", ["-qr", `${name}.zip`, name], { cwd: bundles });
console.log(join(bundles, `${name}.zip`));
