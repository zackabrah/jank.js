# Changelog

## Unreleased

- Use system monospace fonts in the panel and offline viewer, removing bundled font downloads. The `jank.js/font.css` export remains as an empty compatibility stylesheet.
- Minify packaged panel CSS while retaining the `--jank-*` theming properties.

## 0.1.0 — Unreleased

Initial public release.

- Framework-free performance monitor with zero runtime dependencies. The host owns its frame loop; explicit frame boundaries give stable frame IDs, bounded named scopes, overlap-safe attribution and honest unavailable/truncated coverage.
- Live panel: one line, a mini corner HUD or the full panel docked in a chosen corner, with LIVE, LOADING and CAPTURE tabs and the panel's own overhead under every tab. The size is remembered per origin. Options-based mounting with `mode`, `corner`, `viewerUrl` and `capture` options, an optional GPU source `label`, duplicate-mount protection and safe repeated disposal/late refresh.
- Frame-budget controls (over budget means longer than the budget by more than two timer ticks), automatic pre/post spike capture with cooldown, and live collection/refresh costs without double-counting nested collection.
- `jank.js-recording` version 2 recordings with environment/timer metadata, strict parsing and a 32 MiB limit. Legacy version 1 recordings migrate on import. Recording format versions are separate from package versions.
- Self-contained offline recording viewer, also exported as `jank.js/viewer.html`: environment line, session strip with a draggable range, a 4 px-per-frame timeline with exact CPU lanes and dashed GPU and counter lanes, a captures table, and a frame inspector with a labelled LIKELY heuristic, EXPORT CAPTURE and COPY FRAME. Keyboard playhead, a narrow stacked layout, and a local handoff from the panel's OPEN IN VIEWER. `createRecordingViewModel()` is a presentation-independent view model for custom viewers.
- Typed entry points, optional named DevTools scopes/markers, a Three.js counter adapter, a scoped Three r186 WebGPU timestamp adapter with asynchronous frame correlation, and configurable loading stages.
- Theming through the `--jank-*` CSS custom properties, and optional IBM Plex Mono (400, 500, 600) through `jank.js/font.css`.
- Isolated-package verification, cross-browser accessibility/lifecycle/export checks and a reproducible overhead benchmark.
