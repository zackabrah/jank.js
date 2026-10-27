# Third-party notices

jank.js is MIT licensed, copyright 2026 Isaac Johnson. The initial monitor and diagnostics source were extracted from Junklab Engine 0.94.1, commit d6f5036, and adapted for independent use. The source engine carries the same author and MIT license.

Earlier panel styling was derived from shadcn/ui (MIT, copyright 2023 shadcn). Its notice is retained in `licenses/shadcn-ui.txt` for historical attribution; the current styling is original and uses native HTML with no React runtime dependency.

IBM Plex Mono is copyright 2017 IBM Corp. and licensed under SIL Open Font License 1.1. The original license and reserved font name are preserved in `licenses/ibm-plex-mono-OFL.txt`. Earlier distributions bundled the 400, 500 and 600 Latin-subset WOFF2 weights from `@fontsource/ibm-plex-mono` 5.2.7. The license is retained for historical attribution. The panel and offline viewer now use system monospace fonts and ship no font binaries. The `jank.js/font.css` export remains as an empty compatibility stylesheet.

The original extraction included React and React DOM. Their notices remain in `licenses/` for historical attribution; neither is included in the current runtime bundle.

Renderer adapters use host-supplied interfaces and do not bundle Three.js. Development dependencies retain their respective licenses.

Distributions must retain LICENSE, this notice and the licenses directory. The self-contained recording viewer embeds these notices. Private demonstration assets and their separate licenses are not part of this repository or package.
