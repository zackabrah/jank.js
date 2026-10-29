import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("both public declaration packages work without workspace source files", () => {
  const directory = mkdtempSync(join(tmpdir(), "jank-package-consumer-"));
  try {
    for (const [folder, name] of [
      ["jank", "jank.js"],
      ["junkui", "junkui"],
    ]) {
      const destination = join(directory, "node_modules", name);
      mkdirSync(destination, { recursive: true });
      cpSync(`packages/${folder}/package.json`, join(destination, "package.json"));
      cpSync(`packages/${folder}/dist`, join(destination, "dist"), { recursive: true });
    }
    cpSync("node_modules/@types/web", join(directory, "node_modules/@types/web"), {
      recursive: true,
      dereference: true,
    });
    writeFileSync(join(directory, "package.json"), '{"type":"module"}');
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2025",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2025"],
          types: ["@types/web"],
          strict: true,
          noEmit: true,
        },
        include: ["consumer.ts"],
      }),
    );
    writeFileSync(
      join(directory, "consumer.ts"),
      `
import type { Channel, CreateProfiler, ScopeToken, ProfilerSnapshot } from "jank.js";
import type { CreateTabs } from "junkui";
declare const createProfiler: CreateProfiler;
declare const createTabs: CreateTabs;
const profiler = createProfiler({ targetFps: 60 });
const channel: Channel = profiler.createChannel({ id: "physics", label: "Physics" });
const token: ScopeToken = channel.begin();
channel.end(token);
const snapshot: ProfilerSnapshot = profiler.snapshot();
snapshot.frames.forEach(frame => frame.scopes.forEach(scope => scope.channelId));
// @ts-expect-error Consumers cannot fabricate a scope token from a timestamp.
channel.end(100);
// @ts-expect-error Public nested snapshots are readonly.
snapshot.frames[0].cpu.updateMs = 123;
const tabs = createTabs({ tabs: [], selectedId: "main" });
tabs.dispose();
`,
    );
    const result = spawnSync(
      process.execPath,
      [resolve("node_modules/typescript/bin/tsc"), "-p", join(directory, "tsconfig.json")],
      { encoding: "utf8" },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
