# jank.js · private preview 0.2.1-rewrite.6

Host-owned profiling, live panel, loading diagnostics, capture/export, offline analysis and
optional renderer integrations. ESM, TypeScript declarations and self-contained CSS are included.
The package has zero runtime dependencies; Three.js and junkui need no separate installation
unless your application uses them independently.

```sh
pnpm add /absolute/path/to/jank.js-0.2.1-rewrite.6.tgz
```

- [Usage guide](docs/USAGE.md): panel controls, capture completeness, loading and offline A/B review.
- [Integration guide](docs/INTEGRATION.md): frame loop, renderer counters, GPU adapters, loading,
  optional diagnostics, comparisons, viewer handoff and resource ownership.

Import `jank.js/styles.css` once and call the profiler/panel from your existing host loop.
The separate bundle contains `jank-viewer.html`, `jank-ui-library.html` and
`jank-gpu-diagnostic.html` for offline use. The explicit native timestamp probe is also
exported from `jank.js/adapters/webgpu-diagnostic`.
This build writes recording schemas 5 (ordinary), 6 (spike episodes) and 7 (sustained captures),
and comparison version 1. The viewer reads all three recording schemas; versions 1–4 are rejected.
The API remains a private preview. Nothing is published to a registry.
