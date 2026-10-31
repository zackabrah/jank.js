export function viewerMarkup(): string {
  return `
    <header class="jank-viewer-header">
      <h1>JANK.JS <span>VIEWER</span></h1><span class="jank-viewer-file" data-viewer-file-name>No recording</span><span class="jl-chip">OFFLINE</span>
      <label class="jank-viewer-open">OPEN<input aria-label="Open recording or comparison" type="file" accept=".json,application/json" data-viewer-file></label>
      <button type="button" class="jl-btn" data-viewer-action="export" aria-label="Export selected recording" disabled>EXPORT</button>
    </header>
    <div class="jank-viewer-environment"><span data-viewer-environment>Local recording viewer · files stay on this device</span><span data-viewer-coverage></span></div>
    <p class="jank-viewer-error" role="alert" hidden></p>
    <div class="jank-viewer-empty" data-viewer-empty>Open or drop a Jank recording or A/B bundle.<span>Files stay on this device · maximum 32 MiB</span></div>
    <section class="jank-viewer-workspace" data-viewer-recording hidden aria-label="Recording inspection">
      <section class="jank-viewer-session" aria-label="Session overview">
        <div class="jank-viewer-session-label">SESSION<span data-session-info></span></div>
        <div><div class="jank-viewer-session-plot"><canvas data-session-chart role="img" aria-label="Session frame overview"></canvas><div data-session-markers></div></div><div class="jank-viewer-axis" data-session-axis></div></div>
      </section>
      <div class="jank-viewer-main">
        <section class="jank-viewer-timeline" aria-label="Timeline workspace">
          <div class="jank-viewer-toolbar">
            <span class="jank-viewer-track">TIMELINE</span>
            <details class="jank-counter-pin-controls"><summary>PIN COUNTERS</summary><div data-counter-pin-options></div></details>
            <div class="jank-viewer-legend" data-comparison-only hidden>
              <label class="jank-series-a"><input type="checkbox" data-series-visibility="a" aria-label="Show A" checked> A —</label>
              <label class="jank-series-b"><input type="checkbox" data-series-visibility="b" aria-label="Show B" checked> B ┄</label>
              <label>Trial <select class="jl-select" data-viewer-trial></select></label>
            </div>
            <details class="jank-viewer-controls"><summary>VIEW</summary>
              <div data-comparison-only hidden>
                <label>Comparison elapsed time (ms) <input class="jl-input" type="number" min="0" step="any" data-paired-time></label>
                <label>Comparison window (ms) <select class="jl-select" data-paired-window><option>50</option><option>100</option><option>250</option><option>500</option><option selected>1000</option><option>2500</option><option>5000</option></select></label>
                <button type="button" class="jl-btn" data-timeline-zoom="in" data-timeline-side="a">Zoom in comparison</button>
                <button type="button" class="jl-btn" data-timeline-zoom="out" data-timeline-side="a">Zoom out comparison</button>
                <label>Comparison horizontal scroll <input type="range" min="0" step="any" value="0" data-paired-scroll></label>
                <p data-paired-range></p>
              </div>
              <div data-single-only>
                <button type="button" class="jl-btn" data-viewer-action="range-previous">Previous range</button>
                <label>Range start <input class="jl-input" type="number" min="1" step="1" data-viewer-range-start></label>
                <label>Frames shown <select class="jl-select" data-viewer-range-count><option>50</option><option selected>100</option><option>200</option></select></label>
                <button type="button" class="jl-btn" data-viewer-action="range-next">Next range</button>
                <label>Recording horizontal scroll <input type="range" min="0" step="1" value="0" data-recording-scroll></label>
                <p data-viewer-range-note></p>
              </div>
            </details>
          </div>
          <section data-paired-section data-comparison-only hidden aria-label="Synchronized A/B inspection">
            <div class="jank-viewer-graph"><span>frame time</span><div><canvas data-paired-chart="overlay" role="img" aria-label="A/B frame overlay"></canvas><div class="jank-viewer-axis" data-paired-axis></div></div></div>
            <div data-timeline-lanes="overlay"></div>
          </section>
          <section data-single-only aria-label="Recording timeline">
            <div class="jank-viewer-graph"><span>frame time</span><div><canvas data-viewer-chart role="img" aria-label="Frame durations"></canvas><div class="jank-viewer-axis" data-recording-axis></div></div></div>
            <div data-timeline-lanes="single"></div>
          </section>
          <details class="jank-viewer-help"><summary>NAVIGATION &amp; MEASUREMENT NOTES</summary>
            <p>Click to select; hover previews without changing selection. Focus a lane and use Left/Right, Home/End. Shift + Left/Right moves ten frames; [ / ] cycles captures. Drag the session strip to pan while preserving selection. Ctrl/⌘ + wheel zooms; horizontal or Shift + wheel scrolls.</p>
            <p>A is cyan and solid; B is violet and dashed. Each overlay uses shared time and height scales. Aligning elapsed time does not guarantee identical scene state. Missing samples stay gaps. GPU durations are placed at their correlated CPU frame; CPU and GPU clocks remain separate.</p>
            <p>Counter points show actual sample timestamps, without interpolation. Counter identity is provider ID plus field name; units are not recorded, so verify definitions before comparing raw A/B values. The inspector shows last observed samples and age, not an assertion that a value remained unchanged. Missing fields, non-numeric values, errors and duplicate timestamps invalidate the previous value.</p>
            <p>Frame context shows interval minus scope union (including waiting and unobserved work), and synchronous collection + refresh overhead. Profiler lane heights are magnified ×20; values stay in actual milliseconds. Missing scope collection leaves unattributed time unknown. Scope intervals use their union per channel; channels can overlap. Partial CPU observations have no comparison delta. Individual frames do not establish statistical significance.</p>
            <p class="jank-viewer-capture-note">Detected spikes are grouped within 10 frames and ranked by duration (up to 50). Exported excerpts preserve timestamps; clipped context and omitted unlinked GPU samples mark the excerpt truncated.</p>
          </details>
          <details class="jank-viewer-captures" open><summary>CAPTURES</summary><p data-capture-rule></p><div data-capture-list tabindex="0" role="region" aria-label="Capture list"></div></details>
        </section>
        <aside class="jank-viewer-inspector" aria-label="Frame inspector">
          <div class="jank-viewer-inspector-head"><h2 data-viewer-frame>FRAME —</h2><button class="jl-btn" type="button" data-viewer-action="previous" aria-label="Previous frame">◂</button><button class="jl-btn" type="button" data-viewer-action="next" aria-label="Next frame">▸</button></div>
          <div class="jank-viewer-headline"><strong data-viewer-duration>—</strong><span>ms</span><span data-viewer-budget-ratio></span></div>
          <p class="jank-viewer-budget-note" data-viewer-budget-note>Unknown timing</p>
          <p class="jank-viewer-likely" data-viewer-likely></p>
          <div class="jank-trigger-summary" data-trigger-summary hidden><button type="button" class="jl-btn" data-capture-action="open" data-go-trigger>Go to trigger</button><p data-trigger-context></p></div>
          <div data-comparison-only hidden class="jank-viewer-paired-frames"><p class="jank-series-a" data-paired-title="a"></p><p data-paired-frame="a"></p><p class="jank-series-b" data-paired-title="b"></p><p data-paired-frame="b"></p></div>
          <section class="jank-viewer-inspector-section jank-viewer-counters" data-pinned-counter-readout hidden></section>
          <section class="jank-viewer-inspector-section"><h3>CPU <span>scope union / ms</span></h3><div data-inspector-cpu></div></section>
          <section class="jank-viewer-inspector-section"><h3>GPU <span>observed / ms</span></h3><div data-inspector-gpu></div><details class="jank-viewer-gpu-evidence"><summary>GPU coverage &amp; timestamp evidence</summary><p data-viewer-gpu-evidence></p></details></section>
          <section class="jank-viewer-inspector-section"><h3>COUNTERS <span data-counter-time></span></h3><p class="jank-viewer-counter-note">Last observations · Δ prev valid sample · units not recorded</p><div class="jank-viewer-counters" data-counter-inspector></div></section>
          <section class="jank-viewer-inspector-section"><h3>NEARBY EVENTS <span>±10 retained frames</span></h3><div data-nearby-events></div></section>
          <details><summary>FRAME DETAILS</summary>
            <label>Frame position <input class="jl-input" type="number" min="1" step="1" data-viewer-frame-position></label>
            <button type="button" class="jl-btn" data-viewer-action="worst">Jump to worst frame</button>
            <h3>EVENTS &amp; COUNTERS IN FRAME</h3><div data-viewer-events></div><h3>CPU INTERVALS</h3><div data-viewer-cpu></div><h3>GPU PASSES &amp; DIAGNOSTICS</h3><div data-viewer-gpu></div>
          </details>
          <details data-viewer-comparison hidden><summary>COMPARISON DETAILS</summary>
            <p data-viewer-experiment></p><div class="jank-viewer-table" tabindex="0" role="region" aria-label="Comparison measurements" data-viewer-results></div>
            <h3>TRIALS &amp; COVERAGE</h3><div class="jank-viewer-table" tabindex="0" role="region" aria-label="Trial coverage" data-viewer-trials></div>
            <h3>SCENE SETTING DIFFERENCES</h3><p data-viewer-settings-note></p><div class="jank-viewer-table" tabindex="0" role="region" aria-label="Scene setting differences" data-viewer-settings></div>
            <div class="jank-viewer-table" tabindex="0" role="region" aria-label="Paired CPU measurements" data-paired-cpu></div><div class="jank-viewer-table" tabindex="0" role="region" aria-label="Paired GPU measurements" data-paired-gpu></div>
            <p>Results are recalculated from recordings, with equal weight per trial. Paired B − A may differ from the displayed median difference. A range crossing zero means mixed results. Unknown is never zero.</p>
          </details>
          <details><summary>RECORDING &amp; COVERAGE</summary><h3 data-viewer-recording-title></h3><p data-viewer-evidence></p></details>
          <div class="jank-viewer-capture-actions"><p data-capture-selection>No capture at this frame</p><button type="button" class="jl-btn" data-capture-action="previous" aria-label="Previous capture" disabled>◂</button><button type="button" class="jl-btn" data-capture-action="next" aria-label="Next capture" disabled>▸</button><button type="button" class="jl-btn" data-capture-action="export" aria-label="Export selected capture" disabled>EXPORT CAPTURE</button><button type="button" class="jl-btn" data-copy-frame aria-label="Copy frame" disabled>COPY FRAME</button></div>
          <div data-copy-fallback hidden><p>Clipboard unavailable. Select this report and copy it manually.</p><pre tabindex="0" aria-label="Frame evidence for manual copy" data-frame-report></pre></div>
          <p class="jank-viewer-mixed" data-viewer-mixed hidden></p>
        </aside>
      </div>
    </section>
    <footer class="jank-viewer-status"><span data-viewer-status role="status">Ready · local files only</span><span>jank.js · offline</span></footer>
  `;
}
