# Release guide

This repository releases only the performance tool and recording viewer.

Before the first publication, add the real `repository`, `bugs` and `homepage` URLs to `package.json`; npm uses them for the package page and to resolve the README’s relative links. Recording format version 2 is independent of the package version. When bumping the package, update `src/core/environment.ts` too; `pnpm test:package` fails if the two disagree.

## Verify and assemble

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium firefox webkit
pnpm check:full
pnpm bench
pnpm pack --pack-destination artifacts
```

`pnpm verify:boundary` checks the source boundary. `pnpm test:package` installs the tarball in an isolated consumer and checks exports, types, styles, fonts, the offline viewer and the package version written into recordings. Inspect the archive and open `OPEN RECORDING VIEWER.html` before release. The package must have zero runtime dependencies. The viewer at `dist/viewer/viewer/index.html` can be served by any static host. When the panel or viewer has changed, run `pnpm docs:images` and review the screenshot diff.

Retain LICENSE, THIRD_PARTY_NOTICES.md and the licenses directory. The viewer embeds these notices. Review code provenance before publication. WebGPU timing support remains limited to the documented adapter contract; fallback tests do not validate hardware timing.

Update CHANGELOG.md and the version, commit verified changes, then tag and publish only when explicitly authorized. CI checks and uploads artifacts; it does not publish or deploy.

## Testing a build in another project

Build and pack this repository, then install the archive in the other project with `pnpm add /path/to/jank.js-0.1.0.tgz`. Import `jank.js`, `jank.js/style.css`, optional `jank.js/font.css` and adapters through their public exports, and copy `jank.js/viewer.html` to the project’s static viewer route. Do not import from this repository’s `src` tree. After publication, replace the archive dependency with a pinned published version.
