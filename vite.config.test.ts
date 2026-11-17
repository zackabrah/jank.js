import { build } from "vite";
import { expect, test } from "vitest";
import { runtimeDependencyGuard } from "./vite.config.ts";

function buildFixture(entry: string, modules: Record<string, string> = {}) {
  const sources: Record<string, string> = { entry, ...modules };
  return build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "fixture-modules",
        resolveId(id) {
          if (Object.hasOwn(sources, id)) return `\0${id}`;
          if (id === "external-package") return { id, external: true };
          return null;
        },
        load(id) {
          return sources[id.slice(1)];
        },
      },
      runtimeDependencyGuard,
    ],
    build: {
      write: false,
      minify: false,
      rolldownOptions: { input: "entry" },
    },
  });
}

test("allows local JavaScript, code splitting, and compiled package CSS", async () => {
  await expect(
    buildFixture('import "fixture/node_modules/theme/style.css"; import("local");', {
      "fixture/node_modules/theme/style.css": "body { color: red; }",
      local: 'console.log("local code");',
    }),
  ).resolves.toBeDefined();
});

test.each(["import", "dynamic import"])("rejects bundled package code via %s", async (kind) => {
  const id = "fixture/node_modules/example/index.js";
  const entry = kind === "import" ? `import "${id}";` : `import("${id}");`;
  await expect(buildFixture(entry, { [id]: 'console.log("third-party code");' })).rejects.toThrow(
    "Third-party runtime code is forbidden",
  );
});

test.each(['import "external-package";', 'import("external-package");'])(
  "rejects external runtime imports: %s",
  async (entry) => {
    await expect(buildFixture(entry)).rejects.toThrow("External runtime import is forbidden");
  },
);

test("allows Preact including pnpm paths, but rejects similarly named packages", async () => {
  const id = "fixture/node_modules/.pnpm/preact@11.1.1/node_modules/preact/dist/preact.mjs";
  await expect(
    buildFixture(`import "${id}";`, { [id]: 'console.log("preact");' }),
  ).resolves.toBeDefined();
  const other = "fixture/node_modules/preact-other/index.js";
  await expect(
    buildFixture(`import "${other}";`, { [other]: 'console.log("other");' }),
  ).rejects.toThrow("Third-party runtime code is forbidden");
});
