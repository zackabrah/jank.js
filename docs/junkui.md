# Independent UI foundation

`packages/junkui` now owns the neutral theme, scoped native controls and tab interaction.
It imports no profiler or renderer code. Its public build contains ESM JavaScript, declarations
and one standalone stylesheet, with zero runtime dependencies. The gallery lives in the package
and is type-checked with the browser fixtures.

The reference was inspected before implementation: `src/ui/junkui.css`, performance tokens and
the existing full-panel screenshot. The rewrite preserves neutral colors, square borders,
monospace typography and compact control dimensions. It does not move panel modes, chart
colors, performance semantics or capture state into the UI package.

Only tabs need shared JavaScript. Other controls are labelled native elements with scoped CSS;
there is no widget registry, DOM abstraction, global event bus or mutable theme store.
The caller owns markup and product behavior. Tabs validate configuration before mutation,
copy tab descriptions, own their listeners and leave caller DOM attached after disposal.

## Verification

The first browser test failed because `createTabs` did not exist. Implementation then passed
tests for roles/relationships, keyboard wrapping and disabled skips, same-selection callbacks,
focus preservation, independent instances, callback reentry, invalid configuration, disposal
and repeated remounting. The package consumer failed on its missing runtime export before the
JavaScript/CSS build was added.

An isolated consumer also caught missing declarations for the CSS side-effect import under
strict TypeScript settings. The stylesheet export now includes its own declaration; consumers
do not need a blanket wildcard that would also hide misspelled CSS imports.

Chromium, Firefox and WebKit exercise native fields and disclosure as well as tab behavior.
Every enabled gallery panel passes axe checks. Host-style tests inject large fonts, rounded
buttons, padding and display rules; themed control dimensions stay fixed, hidden content stays
hidden, and the outside host button keeps the host's styles. This is bounded interference
testing, not a guarantee against arbitrary CSS specificity or `!important` overrides.

Nine reviewed images cover controls, fields and 360 px fields across three browsers. They
establish a new gallery regression baseline after comparison with the reference's control
styling; they do not establish full panel/viewer parity. System fonts require matching OS
baselines: `pnpm test:visual` uses macOS 26 arm64, while Linux CI runs the platform-independent
behavior/accessibility suite. CI's additional macOS job runs visual comparisons. Remote CI
has not been run or published from this worktree.

WebKit did not focus an ordinary button after a mouse click. The focus-preservation test uses
keyboard activation so it checks an existing focused control instead of assuming browser click
behavior. The library still explicitly focuses activated tabs.

The [package guide](../packages/junkui/README.md) documents usage and ownership. Next is the
live panel: LINE, MINI and FULL, consuming junkui while keeping capture ownership in the profiler.
