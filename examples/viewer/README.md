# Standalone Jank viewer

`pnpm build:viewer` writes `artifacts/jank-viewer.html`. Open the file directly in a browser;
no server or network connection is needed. During development, use `/examples/viewer/` on the
same Vite server as the demo.

Open or drop a recording or A/B comparison export. Review side-by-side metrics and setting
differences, select a trial, inspect its frames, or export that trial as a normal recording.
The view uses the shipped `createViewer` API and shared junkui theme, with no external assets.

See [viewer behavior and limits](../../docs/viewer.md) and [comparison semantics](../../docs/comparisons.md).
