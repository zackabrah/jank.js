# junkui

Native HTML controls, a scoped neutral theme and horizontal tabs. This is an unstable source preview; its `private: true` flag
prevents accidental registry publication. It has no profiler imports, runtime dependencies or font downloads.

```ts
import { createTabs } from "junkui";
import "junkui/styles.css";
```

Link `dist/styles.css` directly when using a browser without a bundler. The stylesheet is
self-contained. Wrap a view in `.jl`; controls opt into `.jl-btn`, `.jl-icon`, `.jl-toggle`,
`.jl-input`, `.jl-select`, `.jl-tabs` and `.jl-tab`. Native checkboxes, radio inputs and summary
elements keep their normal behavior. `.jl-primary`, `.jl-small`, `.jl-muted`, `.jl-dim`,
`.jl-chip`, `.jl-sr` and `.jl-skip` cover the existing variants without a component framework.

Use real labels, native `disabled`, `aria-pressed` for toggles and `aria-invalid` with a readable
error message for invalid fields. Validation and product actions belong to the caller.

## Tabs

Provide a labelled container, native buttons and panels with unique DOM IDs. Logical tab IDs
are local to an instance; DOM IDs must remain unique in their document or shadow root.

```ts
const tabs = createTabs({
  tablist: labelledTablist,
  tabs: [
    { id: "overview", button: overviewButton, panel: overviewPanel },
    { id: "settings", button: settingsButton, panel: settingsPanel },
  ],
  selectedId: "overview",
  onSelect: (id) => console.info(id),
});

tabs.select("settings");
tabs.dispose();
```

The helper connects ARIA roles/relationships, sets button types, hides inactive panels and
maintains one tab stop. Left/Right wrap and skip disabled buttons; Home/End select the first/
last enabled tab. Focus automatically activates a tab; panels are already present, so this
does not wait for loading. Up/Down, modified shortcuts, Enter and Space retain native behavior.
The interaction follows the [WAI-ARIA tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

Selection notifies once after state changes, with no initial or same-selection notification.
Programmatic selection preserves outside focus and moves focus out of a panel it hides.
Missing/disabled selections throw before changing state. Initial configuration is validated
before modifying the DOM. Dispose is idempotent, removes only owned listeners, leaves the last
rendered DOM attached, and makes later selections harmless. Dispose before remounting an
instance or replacing its tab elements; no global registry or observer owns caller markup.

## Theme and gallery

CSS custom properties on `.jl` are the theme API. Override the `--jl-*` tokens on your root;
there is no JavaScript theme store. `src/theme/tokens.css` is their single source. Controls
retain the reference's 28 px buttons, 20 px inputs, 24 px tab strip, square borders and system
monospace type. Semantic warning colors and panel widths belong to the product.

Styles resist ordinary host selectors and never target outside `.jl`. A class namespace is
not complete isolation from arbitrary higher-specificity or important host rules. Hidden panels
use one documented `!important` rule so host display styles cannot expose inactive content.

From the workspace, run `pnpm dev:fixture` and open
`http://127.0.0.1:4186/packages/junkui/gallery/`. The gallery is independent of jank.js and shows
native controls, labelled fields, disclosure, focus, disabled states and tab lifecycle.

Run `pnpm test:browser`, `pnpm test:package` and, on the baseline OS, `pnpm test:visual`.
Visual baselines use macOS 26 arm64 with the pinned Playwright browsers. Review image changes
before updating them; font rasterization and native input appearance differ across systems.
