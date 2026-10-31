# jank.js · private preview 0.2.1-rewrite.4

Host-owned profiling, live panel, loading diagnostics, capture/export, offline analysis and
optional renderer integrations. ESM, TypeScript declarations and self-contained CSS are included.
The package has zero runtime dependencies; Three.js and junkui need no separate installation
unless your application uses them independently.

```sh
pnpm add /absolute/path/to/jank.js-0.2.1-rewrite.4.tgz
```

- [Usage guide](docs/USAGE.md): panel controls, capture completeness, loading and offline A/B review.
- [Integration guide](docs/INTEGRATION.md): frame loop, renderer counters, GPU adapters, loading,
  optional diagnostics, comparisons, viewer handoff and resource ownership.

Import `jank.js/styles.css` once and call the profiler/panel from your existing host loop.
The separate bundle contains `jank-viewer.html` and `jank-ui-library.html` for offline use.
This build writes recording schema 5 and comparison version 1; legacy files are not imported.
The API remains a private preview. Nothing is published to a registry.
