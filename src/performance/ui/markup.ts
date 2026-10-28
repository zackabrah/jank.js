import { buildLabel } from "../../core/build-info.ts";

/** Static panel markup. Values are written later as text; nothing here is host-supplied. */
export interface PanelSections {
  gpu: boolean;
  culling: boolean;
  temporal: boolean;
  viewer: boolean;
}

/** A LIVE tile: a label over the value slot that refresh fills. */
const tile = (label: string, key: string, extra = "") =>
  `<div class="jank-tile"><span class="jank-label">${label}</span><span class="jank-tile-v" data-k="${key}">–</span>${extra}</div>`;

/** The FPS tile's range: fastest rate on top, slowest below, the current one marked between. */
const fpsRange = `<span class="jank-range" data-k="fps-range" role="img" hidden><span data-k="fps-high" aria-hidden="true"></span><span class="jank-range-line" aria-hidden="true"><i data-k="fps-mark"></i></span><span data-k="fps-low" aria-hidden="true"></span></span>`;

/** A section heading with optional trailing meta markup. */
const heading = (label: string, meta = "") =>
  `<h2 class="jank-h"><span>${label}</span>${meta}</h2>`;

/** An on/off switch button that starts OFF; pass " hidden" to hide it. */
const toggle = (action: string, label: string, hidden = "") =>
  `<button type="button" class="jank-toggle" data-action="${action}" aria-label="${label}" aria-pressed="false"${hidden}>OFF</button>`;

/** A CAPTURE setting row: its value button and the hidden number input that edits it. */
const setting = (key: string, label: string, unit: string) =>
  `<div class="jank-row"><span class="jank-k">${label}</span><span class="jank-lead"></span><button type="button" class="jank-edit" data-edit="${key}" aria-label="${label}, edit"></button><input class="jank-edit-input" data-input="${key}" type="number" step="any" min="0" aria-label="${label} ${unit}" hidden></div>`;

/** The panel's HTML for the line, mini and full views; `id` prefixes the tab and panel ids. */
export function panelMarkup(id: string, has: PanelSections) {
  const viewerTitle = has.viewer
    ? ""
    : ' title="set viewerUrl in the panel options to open recordings in the viewer" disabled';

  /** A tab wired to its panel by id; only the selected tab is in the tab order. */
  const tab = (name: string, label: string, selected: boolean) =>
    `<button type="button" role="tab" id="${id}-tab-${name}" class="jank-tab" data-tab="${name}" aria-controls="${id}-${name}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}">${label}</button>`;

  return `<div class="jank-line" data-view="line"><span class="jank-word">JANK.JS</span><span class="jank-read"><b data-k="line-fps">–</b> fps</span><span class="jank-read"><b data-k="line-ms">–</b> ms</span><span class="jank-read"><b data-k="line-worst">–</b><span data-k="line-worst-unit"> worst</span></span><span class="jank-chip jank-push" data-k="line-rec" hidden>REC</span><button type="button" class="jank-icon jank-push" data-action="line-grow" aria-label="Open full panel">+</button></div>
<div class="jank-mini" data-view="mini"><div class="jank-mini-head"><span class="jank-word">JANK.JS</span><span class="jank-chip" data-k="mini-rec" hidden>REC</span><span class="jank-icons"><button type="button" class="jank-icon" data-action="mini-grow" aria-label="Expand to full panel">+</button><button type="button" class="jank-icon" data-action="mini-shrink" aria-label="Collapse to one line"><i class="jank-dash"></i></button></span></div><div class="jank-mini-read"><span><b data-k="mini-fps">–</b> fps</span><span><b data-k="mini-ms">–</b> ms</span><span><b data-k="mini-p95">–</b> p95</span></div><div class="jank-mini-view" data-k="mini-view"><canvas class="jank-mini-graph" data-k="mini-graph" aria-hidden="true"></canvas></div><div class="jank-mini-foot"><span><span data-k="mini-worst"></span><span class="jank-dim" data-k="mini-worst-at"></span></span><span class="jank-mini-top" data-k="mini-top-row"><span class="jank-mini-name"><span class="jank-dim">top </span><span data-k="mini-top"></span></span><span data-k="mini-top-ms"></span></span></div></div>
<div class="jank-full" data-view="full"><header class="jank-head"><span class="jank-word">JANK.JS</span><span class="jank-chip" data-k="rec-chip" hidden>REC</span><span class="jank-state" data-k="state"></span><span class="jank-icons"><button type="button" class="jank-icon" data-action="freeze-icon" aria-label="Freeze display" aria-pressed="false"><i class="jank-pause"></i></button><button type="button" class="jank-icon" data-action="full-shrink" aria-label="Shrink to mini view"><i class="jank-dash"></i></button></span></header>
<div class="jank-tabs" role="tablist" aria-label="jank.js views">${tab("live", "LIVE", true)}${tab("loading", "LOADING", false)}${tab("capture", "CAPTURE", false)}<span class="jank-budget">BUDGET <span data-k="budget">16.7</span></span></div>
<button type="button" class="jank-summary" data-action="summary">READ SUMMARY</button><p class="jank-sr" aria-live="polite" data-k="summary"></p>
<div class="jank-scroll">
<div role="tabpanel" class="jank-panel" id="${id}-live" aria-labelledby="${id}-tab-live" data-panel="live"><div class="jank-tiles" aria-live="off">${tile("FPS", "fps", fpsRange)}${tile("AVG MS", "avg")}${tile("P95 MS", "p95")}${tile("WORST MS", "worst")}${tile("AT FRAME", "worst-at")}${tile("MISSED", "missed")}</div>
<div class="jank-graph-box"><div class="jank-graph-view" data-k="graph-view"><canvas class="jank-graph" data-k="graph" role="img" aria-label="Frame time graph. The tiles above give its values."></canvas><canvas class="jank-graph-text" data-k="graph-text" aria-hidden="true"></canvas></div></div><ul class="jank-sr" data-k="events" aria-label="Recent events"></ul>
<section class="jank-sec">${heading("CPU", '<span class="jank-meta">ms avg</span>')}<div data-k="cpu"></div><p class="jank-note" data-k="cpu-note" hidden></p></section>
<section class="jank-sec" data-k="gpu-sec"${has.gpu ? "" : " hidden"}>${heading("GPU", '<span class="jank-meta"><span class="jank-src" data-k="gpu-src">renderer</span><span data-k="gpu-frame"></span></span>')}<div data-k="gpu"></div><p class="jank-note" data-k="gpu-status"></p></section>
<section class="jank-sec">${heading("COUNTERS", '<span class="jank-meta" data-k="counter-src"></span>')}<div class="jank-grid" data-k="counters"></div><p class="jank-note" data-k="counter-note" hidden></p></section>
<section class="jank-sec jank-culling"${has.culling ? "" : " hidden"}>${heading("VISIBILITY", '<span class="jank-meta">eligible · visible · culled</span>')}<div class="jank-switch"><span>frustum culling</span>${toggle("culling", "Frustum culling")}</div><div class="jank-switch"><span>gpu instance culling</span>${toggle("instances", "GPU instance culling")}</div><div class="jank-switch"><span>culling bounds</span>${toggle("bounds", "Culling bounds")}</div><div data-k="culling-rows"></div><p class="jank-note" data-k="culling-status"></p><p class="jank-note" data-k="culling-detail"></p></section>
<section class="jank-sec jank-temporal"${has.temporal ? "" : " hidden"}>${heading("TEMPORAL")}<div class="jank-switch"><span>rigid object history</span>${toggle("temporal", "Rigid object history")}</div><div class="jank-switch"><span>debug view</span><select class="jank-select" aria-label="Temporal debug view"><option value="none">final image</option><option value="motion">motion vectors</option><option value="history">history validity</option></select></div><p class="jank-note" data-k="temporal-counts"></p><p class="jank-note" data-k="temporal-status"></p></section>
<div class="jank-actions"><button type="button" class="jank-btn" data-action="freeze" aria-pressed="false">FREEZE</button><button type="button" class="jank-btn" data-action="record">REC</button><button type="button" class="jank-btn" data-action="clear">CLEAR</button><button type="button" class="jank-btn jank-push" data-action="export">EXPORT JSON</button></div><p class="jank-error" role="alert" data-k="live-error" hidden></p></div>
<div role="tabpanel" class="jank-panel" id="${id}-loading" aria-labelledby="${id}-tab-loading" data-panel="loading" hidden><div class="jank-tiles jank-tiles-1">${tile('TOTAL <span data-k="unit">S</span>', "total")}${tile('COLD <span data-k="unit-cold">S</span>', "cold")}${tile("CACHE", "cache")}</div>
<section class="jank-sec jank-first">${heading("STAGES", '<span class="jank-axis" data-k="axis"></span>')}<div data-k="stages"></div></section>
<section class="jank-sec">${heading("CACHE", '<span class="jank-meta">this session</span>')}<div data-k="cache-rows"></div></section>
<section class="jank-sec">${heading("SESSIONS", '<span class="jank-meta">total load</span>')}<div data-k="sessions"></div></section><p class="jank-note jank-pad" data-k="loading-status"></p></div>
<div role="tabpanel" class="jank-panel" id="${id}-capture" aria-labelledby="${id}-tab-capture" data-panel="capture" hidden>
<section class="jank-sec jank-first">${heading("BUDGET")}<div class="jank-seg-row"><div class="jank-seg" role="group" aria-label="Frame budget"><button type="button" data-fps="30" aria-pressed="false">30</button><button type="button" data-fps="60" aria-pressed="true">60</button><button type="button" data-fps="120" aria-pressed="false">120</button><button type="button" data-action="custom-fps" aria-pressed="false">custom</button><input type="number" class="jank-seg-input" min="1" max="1000" step="1" aria-label="Target FPS" hidden></div><span class="jank-meta" data-k="budget-ms"></span></div></section>
<section class="jank-sec">${heading("AUTO CAPTURE", toggle("auto", "Automatic spike capture"))}${setting("threshold", "threshold", "ms")}${setting("before", "before", "frames")}${setting("after", "after", "frames")}${setting("cooldown", "cooldown", "s")}</section>
<section class="jank-sec">${heading("INSTRUMENTATION", '<span class="jank-meta">saved in recordings</span>')}<div class="jank-switch"><span>cpu scopes <i data-k="scopes-why"></i></span><span class="jank-chip" data-k="scopes">OFF</span></div><div class="jank-switch"><span>gpu timing <i data-k="gpu-name">${has.gpu ? "" : "no source"}</i></span>${toggle("gpu", "GPU profiling", has.gpu ? "" : " disabled")}</div><div class="jank-switch"><span>devtools tracks <i>opt-in</i></span>${toggle("devtools", "DevTools tracks")}</div></section>
<section class="jank-sec">${heading("CAPTURED", '<span class="jank-meta" data-k="captured-meta"></span>')}<div data-k="captures"></div><p class="jank-note jank-pad" data-k="captures-empty">nothing captured yet. that is a good sign, or a quiet build.</p></section>
<div class="jank-actions"><button type="button" class="jank-btn jank-primary" data-action="viewer"${viewerTitle}>OPEN IN VIEWER</button><button type="button" class="jank-btn jank-push" data-action="export-capture">EXPORT JSON</button></div><p class="jank-error" role="alert" data-k="capture-error" hidden></p></div>
</div>
<section class="jank-sec jank-overhead" aria-label="jank.js overhead">${heading("OVERHEAD", '<span class="jank-meta">ms avg · peak</span>')}<div class="jank-kv"><span>collection</span><span><span data-k="oh-collect">–</span> <i>· <span data-k="oh-collect-peak">–</span></i></span></div><div class="jank-kv"><span>panel refresh</span><span><span data-k="oh-refresh">–</span> <i>· <span data-k="oh-refresh-peak">–</span></i></span></div><p class="jank-note" data-k="oh-note">excludes browser paint and GPU work</p><p class="jank-foot"><span data-k="honest-cpu"></span><span data-k="honest-gpu"></span></p><p class="jank-note" data-k="build-info" aria-label="jank.js build">${buildLabel}</p></section></div>`;
}
