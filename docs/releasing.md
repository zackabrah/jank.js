# Release guide

This repository releases only the performance tool and recording viewer.

Keep the `repository`, `bugs` and `homepage` fields in `package.json` pointing at the public repository; npm uses them for the package page and to resolve the README’s relative links, and `pnpm verify:boundary` fails if one is missing. Before publishing, verify that private vulnerability reporting is enabled under **Settings → Advanced Security**, which `SECURITY.md` relies on.

Recording format version 2 is independent of the package version. The build generates its identity from the package version and source commit; `src/core/environment.ts` reads that identity and needs no manual version edit. Merge-based versioning owns version bumps and tags; see [versioning](versioning.md).

## Verify and assemble

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium firefox webkit
pnpm check:full
pnpm test:e2e:gpu
pnpm docs:captures
pnpm pack --pack-destination artifacts
```

`pnpm docs:captures` retakes the README's images from a scripted run in real Chrome, on this machine's GPU, so they show measurements rather than fixtures. It needs Chrome and ffmpeg, and it opens a window for about 30 seconds. Review the images and commit them with the release.

`pnpm test:e2e:gpu` needs an idle interactive desktop and installed Chrome with a physical GPU. It includes native timing fidelity, failure/lifecycle handling, recording checks and the queue-counting microbenchmark. Headless fallback tests do not replace this gate.

`pnpm verify:boundary` checks the source boundary. `pnpm test:package` installs the tarball in an isolated consumer and checks exports, types, styles, fonts, the offline viewer and the package version written into recordings. Inspect the archive and open `OPEN RECORDING VIEWER.html` before release. The package must have zero runtime dependencies. The viewer at `dist-package/viewer.html` can be served by any static host. When the panel or viewer has changed, run `pnpm docs:captures`, then review the screenshot diff.

Retain LICENSE, THIRD_PARTY_NOTICES.md and the licenses directory. The viewer embeds these notices. Review code provenance before publication. WebGPU timing support remains limited to the documented adapter contract; fallback tests do not validate hardware timing.

Update CHANGELOG.md and commit verified changes. Merging a PR into main bumps the stable version and creates its tag, so don't do either by hand for stable releases; release-candidate tags follow the [beta procedure](publishing.md#prepare-the-beta-tag); see [versioning](versioning.md). Publish only when explicitly authorized, through [the manual workflow](publishing.md#run-the-manual-workflow). CI checks and uploads artifacts; it does not publish or deploy.

## Testing a build in another project

Build and pack this repository, then install the archive in the other project with `pnpm add /path/to/jank.js-<version>.tgz`. Import `jank.js`, `jank.js/panel` and adapters through their public exports, and copy `jank.js/viewer.html` to the project’s static viewer route. Do not import from this repository’s `src` tree. After publication, replace the archive dependency with a pinned published version.

## Checklist audit — 5 November 2026

The fixes below are committed locally. GitHub issues remain open until the changes
are pushed and reviewed; this audit did not publish or change registry metadata.

| Tickets | Resolution |
| --- | --- |
| #6, #14, #16 | Shared over-budget tolerance and bounded decisions independent of imported timer resolution (`6622446`). |
| #17, #19, #20 | Trial-specific parse errors, unknown empty-capture statistics and UTF-8 BOM input support (`11274e8`). |
| #18 | Collector lifecycle markers excluded from unmatched-host-event warnings and event costs (`2bdab35`). |
| #15 | Explicit frame reset for known pauses, measured-interval FPS and gap-aware episodes/GPU lookback (`f544655`). |

For [the release checklist, #3](https://github.com/zackabrah/jank.js/issues/3):

- Verified through GitHub: the repository is public; private vulnerability reporting,
  secret scanning and push protection are enabled; description and topics are populated;
  the `npm` environment exists. The homepage field remains empty; the project metadata
  lists the repository README rather than a separate product website.
- The changelog includes 0.2.0 and 0.2.1. Publishing guidance reflects the published
  0.3.0 package and system fonts. This guide no longer asks for manual environment
  version edits.
- Restored a pinned [Stats.js comparison](measurements.md#statsjs-reference-checks)
  alongside the real-workload CPU accuracy fixture. Keep the current property-based
  collector/parser tests and explicit GPU capacity, loss and fidelity cases instead
  of restoring the obsolete extremes fixture. Native GPU query comparisons provide
  direct evidence for the current adapters; stats-gl and Chrome-trace comparison
  fixtures remain deferred, and no independent tracing calibration is claimed.
- Measured [WebGPU queue-counting overhead](performance.md#webgpu-queue-counting-overhead).
  The report separates observed overhead from same-setting variation and states the
  unmeasured resource-creation and full-frame costs.
- The packed public exports passed a smoke test in an existing production WebGPU
  application: capture, export, lazy viewer and cleanup, with no page errors or missing
  assets. [Evidence and limits](verification/consumer-smoke.json). Private host source,
  assets, server configuration and raw captures remain outside this repository.
- `docs/readme/social-preview.png` is prepared without the obsolete size claims.
  `pnpm docs:assets` regenerates it from the canonical SVG with the current version,
  alongside the README chips. CI uploads these assets for review and regenerates
  them before the automatic version commit; the GitHub Social preview upload remains
  manual. Existing panel/viewer captures retain the
  applicable layouts; retake them if the final release changes those layouts or the
  measurements displayed in them.

The current source passed 412 unit tests, 16 script tests, package verification,
287 headless browser cases (19 expected skips) and all 17 explicit hardware cases
on the Mac. The hardware gate included both WebGL2 and WebGPU; Windows hardware
results from the earlier [validation](gpu-measurements.md) were not rerun for this
follow-up. Two earlier Firefox cases required retries, then passed focused reruns
and subsequent full suites without retries.

Still required for release: upload the custom social image (GitHub currently uses
its generated card); deprecate `0.0.0-stage`; configure/verify npm trusted publishing
when ready to publish; run CI on
the final pushed commit; open and merge the release PR, then explicitly run the
publication workflow. The local test gates and hardware measurements do not verify
npm publishing permissions or license provenance.

## Design-token licensing review — 5 November 2026

Provenance confirmed by the author, Isaac Johnson, on 5 November 2026: the jank
design canvas and theme definitions were written by him. The Geist-inspired
[`src/theme.css`](../src/theme.css), introduced in `52bda12`, is original project
code covered by the repository's [MIT licence](../LICENSE). This closes the
design-token provenance and licensing item for release. The evidence is the
author's direct confirmation; it is not a third-party source audit.

[Vercel's colour documentation](https://vercel.com/geist/colors) offers raw values
for copying. No explicit MIT or equivalent redistribution licence for the complete
Geist design system was found in the upstream pages reviewed. The
[Geist font licence](https://github.com/vercel/geist-font/blob/main/OFL.txt) covers
font software, not the design system; jank.js uses system fonts.

The [US Copyright Office's guidance, §313.4(K)](https://www.copyright.gov/comp3/chap300/ch300-copyrightable-authorship.pdf)
distinguishes colours themselves from protectable original arrangements.
[IP Australia](https://ipfirstresponse.ipaustralia.gov.au/options/infringement-101-copyright-infringement)
likewise distinguishes ideas from protected expression, including software code.
These sources distinguish an independently implemented palette from a copied
stylesheet. The project's MIT licence covers its own implementation; it does not
assert that Vercel's Geist design system is MIT-licensed.
