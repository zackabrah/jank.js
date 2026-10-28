# Changelog

## Unreleased

- Balance the panel's spacing: in every section the space from its rule to the heading's capitals matches the space from its last line, or the edge of its last control, to the next rule. The footer and the GPU source tag are balanced the same way, and the mini view's heaviest scope shows its name and time spaced apart again.
- Keep a frame's work finite when repeated timestamps add host-reported values that would overflow to Infinity. Such a recording previously failed to load in the viewer.
- Fix readouts that random input broke. Large counters now scale through M, B and T, then powers of ten, so any value fits the value column. Durations round before choosing a unit, so 0.9996 ms reads 1.0 ms rather than 1000 µs. In the mini view the heaviest scope's name gives way before its time when space runs out.
- Glide the panel's graphs between redraws instead of jumping. After each redraw the bars slide from where they were to where they belong, at the real scroll speed, on the compositor; a glide cut short by an early redraw carries into the next. Only motion is smoothed: no value is interpolated or predicted, and labels sit on a fixed layer. Graphs jump as before when the system asks for reduced motion.
- Give events icons. The monitor's own events have fixed ones (● recording started, ■ stopped or complete, ▲ spike captured). Every other label gets a stable icon from its text (`◆ ◇ ○ □ △ ▽ ◊ ∗ × + ∆ ≡`), so it looks the same in the panel, recordings and the viewer. A label can choose its icon by starting with one and a space. The panel graph shows each event's icon under its frame, names the newest at the top right, and gives the worst-frame ▾ its own row; the event list, capture summaries and the viewer's timeline and inspector show the icons too.
- Line up the CAPTURE tab's ON/OFF toggles and status chips: they share one box, so ON and OFF sit in a straight column.
- Make the panel easier to read. The graph's text stays still: the worst frame's time sits in the top-left corner and the newest event's label, with its age, sits under the graph, while only the worst-frame marker and event ticks move with the bars. Over-budget ▲ markers are drawn as tall as the digits they mark and are named "over budget" for screen readers. The mini readout splits into three equal columns, so readings keep their place as digits change; an extreme value keeps its digits and its unit gives way.
- Add `jank.js/adapters/webgl2`, which times named WebGL2 render passes with `EXT_disjoint_timer_query_webgl2` and links each sample to the frame that drew it. Where the browser doesn't expose the extension it reports `unsupported` rather than estimating GPU time from CPU timing.
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
