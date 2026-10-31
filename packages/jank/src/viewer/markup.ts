export function viewerMarkup(): string {
  return `
    <header class="jank-viewer-header"><h1>JANK.JS <span>VIEWER</span></h1><span class="jl-chip">OFFLINE</span>
      <label>Open recording or comparison <input class="jl-input" type="file" accept=".json,application/json" data-viewer-file></label>
      <button type="button" class="jl-btn" data-viewer-action="export" disabled>Export selected recording</button>
    </header>
    <p class="jank-viewer-note" data-viewer-status role="status">Open or drop a Jank recording or A/B bundle. Files stay on this device. Maximum 32 MiB.</p>
    <p class="jank-viewer-error" role="alert" hidden></p>
    <section data-viewer-comparison hidden aria-label="Comparison review">
      <details open><summary>A/B RESULTS</summary>
        <p data-viewer-experiment></p><p class="jank-viewer-mixed" data-viewer-mixed hidden></p>
        <div class="jank-viewer-table" tabindex="0" role="region" aria-label="Comparison measurements" data-viewer-results></div>
        <p class="jank-viewer-note">Results are recalculated from recordings. Equal weight per trial; paired B − A differences may differ from the displayed A/B median difference. Negative means lower time. A range crossing zero means mixed results, not a reliable improvement. No statistical significance is claimed.</p>
      </details>
      <details open><summary>TRIALS &amp; COVERAGE</summary>
        <label>Trial <select class="jl-select" data-viewer-trial></select></label>
        <div class="jank-viewer-table" tabindex="0" role="region" aria-label="Trial coverage" data-viewer-trials></div>
      </details>
      <details open><summary>SCENE SETTING DIFFERENCES</summary>
        <p data-viewer-settings-note></p><div class="jank-viewer-table" tabindex="0" role="region" aria-label="Scene setting differences" data-viewer-settings></div>
      </details>
      <section aria-label="Synchronized A/B inspection"><details open data-paired-section>
        <summary>SYNCHRONIZED A/B INSPECTION</summary>
        <p class="jank-viewer-note">Trials align by elapsed time from their first sealed measured frame, not frame ID or GPU clock. This is a time alignment, not proof of identical scene state. Gaps stay unknown. Click either timeline or use the elapsed-time field.</p>
        <div class="jank-viewer-actions">
          <label>Comparison elapsed time (ms) <input class="jl-input" type="number" min="0" step="any" data-paired-time></label>
          <label>Comparison window (ms) <select class="jl-select" data-paired-window><option>50</option><option>100</option><option>250</option><option>500</option><option selected>1000</option><option>2500</option><option>5000</option></select></label>
        </div>
        <div class="jank-viewer-actions">
          <button type="button" class="jl-btn" data-timeline-zoom="in" data-timeline-side="a">Zoom in comparison</button>
          <button type="button" class="jl-btn" data-timeline-zoom="out" data-timeline-side="a">Zoom out comparison</button>
          <label>Comparison horizontal scroll <input type="range" min="0" step="any" value="0" data-paired-scroll></label>
        </div>
        <p data-paired-range></p>
        <p class="jank-viewer-note">Hover previews both trials without changing selection. Click to select; arrow keys navigate a focused lane. Ctrl/⌘ + wheel zooms; horizontal or Shift + wheel scrolls. Ordinary vertical scrolling moves the page.</p>
        <div class="jank-viewer-pair">
          <section aria-label="Trial A frame"><h2 data-paired-title="a">A</h2><canvas data-paired-chart="a" role="img" aria-label="Trial A elapsed timeline"></canvas><p data-paired-frame="a"></p><div data-timeline-lanes="a"></div></section>
          <section aria-label="Trial B frame"><h2 data-paired-title="b">B</h2><canvas data-paired-chart="b" role="img" aria-label="Trial B elapsed timeline"></canvas><p data-paired-frame="b"></p><div data-timeline-lanes="b"></div></section>
        </div>
        <p class="jank-viewer-note">B − A: positive means longer, negative means shorter. Frame samples are exploratory, not a statistical result. CPU rows use each channel's interval union; rows may overlap. Partial CPU coverage has no delta. GPU matches stable pass ID, kind and invocation; duration-only labels must be unique. Multiple GPU observations remain ambiguous.</p>
        <div class="jank-viewer-table" tabindex="0" role="region" aria-label="Paired CPU measurements" data-paired-cpu></div>
        <div class="jank-viewer-table" tabindex="0" role="region" aria-label="Paired GPU measurements" data-paired-gpu></div>
      </details></section>
    </section>
    <section data-viewer-recording hidden aria-label="Recording inspection">
      <h2 data-viewer-recording-title>RECORDING</h2>
      <p data-viewer-evidence></p><p class="jank-viewer-note" data-viewer-environment></p>
      <details open><summary>FRAME TIMELINE</summary>
        <div class="jank-viewer-actions">
          <button type="button" class="jl-btn" data-viewer-action="range-previous">Previous range</button>
          <label>Range start <input class="jl-input" type="number" min="1" step="1" data-viewer-range-start></label>
          <label>Frames shown <select class="jl-select" data-viewer-range-count><option>50</option><option selected>100</option><option>200</option></select></label>
          <button type="button" class="jl-btn" data-viewer-action="range-next">Next range</button>
        </div>
        <canvas data-viewer-chart role="img" aria-label="Frame durations"></canvas>
        <p class="jank-viewer-note" data-viewer-range-note></p>
        <label>Recording horizontal scroll <input type="range" min="0" step="1" value="0" data-recording-scroll></label>
        <div data-timeline-lanes="single"></div>
        <div class="jank-viewer-actions">
          <button type="button" class="jl-btn" data-viewer-action="previous">Previous frame</button>
          <label>Frame position <input class="jl-input" type="number" min="1" step="1" data-viewer-frame-position></label>
          <button type="button" class="jl-btn" data-viewer-action="next">Next frame</button>
          <button type="button" class="jl-btn" data-viewer-action="worst">Jump to worst frame</button>
        </div>
      </details>
      <h2 data-viewer-frame>FRAME INSPECTOR</h2>
      <div class="jank-viewer-inspectors">
        <details open><summary>CPU SCOPES</summary><div data-viewer-cpu></div></details>
        <details open><summary>GPU PASSES &amp; DIAGNOSTICS</summary><div data-viewer-gpu></div></details>
      </div>
      <details><summary>EVENTS &amp; COUNTERS</summary><div data-viewer-events></div></details>
    </section>
    <footer class="jank-viewer-note">CPU and GPU clocks are separate; their times can overlap. Missing measurements stay unknown. Use the frame controls to inspect the timeline without a pointer.</footer>
  `;
}
