const icon = (action: string, label: string, text: string) =>
  `<button type="button" class="jl-btn jl-icon" data-action="${action}" aria-label="${label}" title="${label}">${text}</button>`;

const metric = (name: string, label: string) =>
  `<div class="jank-tile"><span>${label}</span><strong data-value="${name}">–</strong></div>`;

export function panelMarkup(): string {
  return `
    <div data-view="line" class="jank-line">
      <strong class="jank-wordmark">JANK.JS</strong>
      <span data-value="line-recording" class="jl-chip"></span>
      <span><b data-value="line-fps">–</b> <small>FPS</small></span>
      <span><b data-value="line-average">–</b> <small>AVG</small></span>
      <span><b data-value="line-worst">–</b> <small>WORST</small></span>
      ${icon("full", "Open full panel", "+")}
    </div>
    <div data-view="mini" hidden>
      <header class="jank-header"><strong class="jank-wordmark">JANK.JS</strong><span data-value="mini-state" class="jl-chip"></span>
        ${icon("full", "Expand to full panel", "↗")}${icon("line", "Collapse to one line", "−")}
      </header>
      <div class="jank-mini-metrics">
        <span><b data-value="mini-fps">–</b> <small>FPS</small></span>
        <span><b data-value="mini-average">–</b> <small>AVG</small></span>
        <span><b data-value="mini-p95">–</b> <small>P95</small></span>
      </div>
      <canvas data-chart="mini" role="img" aria-label="Recent frame durations"></canvas>
      <div class="jank-mini-footer"><span data-value="mini-worst">–</span><span data-value="mini-channel">–</span></div>
    </div>
    <div data-view="full" hidden>
      <header class="jank-header"><strong class="jank-wordmark">JANK.JS</strong><span data-value="state" class="jl-chip"></span>
        ${icon("mini", "Shrink to mini view", "↙")}${icon("line", "Collapse to one line", "−")}
      </header>
      <div class="jl-tabs" aria-label="Performance views" data-tabs>
        <button type="button" class="jl-tab" data-tab="live">LIVE</button>
        <button type="button" class="jl-tab" data-tab="loading">LOADING</button>
        <button type="button" class="jl-tab" data-tab="capture">CAPTURE</button>
      </div>
      <p class="jank-note" data-value="capture-health" hidden></p>
      <div class="jank-views">
        <section data-tabpanel="live" class="jank-live">
          <div class="jank-metrics">${metric("fps", "FPS")}${metric("average", "AVG MS")}${metric("p95", "P95 MS")}${metric("worst", "WORST MS")}${metric("frame", "AT FRAME")}${metric("missed", "MISSED")}</div>
          <div class="jank-chart"><canvas data-chart="full" role="img" aria-label="Recent frame durations"></canvas><div class="jank-chart-labels"><span data-value="range">–</span><span data-value="budget">–</span></div></div>
          <div class="jank-scroll" role="region" aria-label="Performance details" tabindex="0">
            <details class="jank-section" data-section="scopes" open>
              <summary><h2>CPU SCOPES <span>MS / FRAME</span></h2></summary>
              <div><div data-list="scopes" class="jank-list"></div><p class="jank-note" data-value="coverage"></p></div>
            </details>
            <details class="jank-section" data-section="gpu" open>
              <summary><h2>GPU <span>ASYNCHRONOUS</span></h2></summary>
              <div><div data-list="gpu" class="jank-list"></div><p class="jank-note" data-value="gpu-note"></p><p class="jank-note" data-value="gpu-rows-note" hidden></p>
                <details data-gpu-explanation hidden><summary>About GPU measurements</summary><p class="jank-note">Pass sums count overlapping work more than once. Busy time is the union of measured intervals. Elapsed span includes gaps between the first and last pass. All values are milliseconds on the GPU clock, separate from CPU time. Incomplete frames have no complete totals; their measured passes remain visible.</p></details></div>
            </details>
            <details class="jank-section" data-section="counters" open>
              <summary><h2>COUNTERS</h2></summary>
              <div><div data-list="counters" class="jank-list"></div></div>
            </details>
            <details class="jank-section" data-section="events" open>
              <summary><h2>EVENTS</h2></summary>
              <div><div data-list="events" class="jank-list"></div></div>
            </details>
            <div class="jank-actions">
              <button type="button" class="jl-btn" data-action="freeze" aria-pressed="false">FREEZE</button>
              <button type="button" class="jl-btn" data-action="record">REC</button>
              <button type="button" class="jl-btn" data-action="clear">CLEAR</button>
              <button type="button" class="jl-btn jl-primary" data-action="export">EXPORT JSON</button>
            </div>
          </div>
        </section>
        <section data-tabpanel="loading" class="jank-scroll"><details class="jank-section" data-section="loading" open>
            <summary><h2>LOADING</h2></summary>
            <div><p class="jank-note" data-value="loading-state">No loading source connected.</p><div data-list="loading" class="jank-list"></div></div>
          </details>
        </section>
        <section data-tabpanel="capture" class="jank-scroll">
          <details class="jank-section" data-section="completeness" open>
            <summary><h2>CAPTURE COMPLETENESS</h2></summary>
            <div>
              <p class="jank-note" data-value="capture-progress"></p>
              <p class="jank-note" data-value="capture-capacity"></p>
              <p class="jank-note">Absent intervals may be pending, disabled, unsupported or no longer retained. Coverage is not inferred from CPU timing.</p></div>
          </details>
          <details class="jank-section" data-section="budget" open>
            <summary><h2>FRAME BUDGET</h2></summary>
            <div>
              <div class="jank-settings"><label>Target FPS <input class="jl-input" data-input="fps" type="number" min="1" step="1"></label><button type="button" class="jl-btn jl-small" data-action="budget">APPLY</button></div></div>
          </details>
          <details class="jank-section" data-section="automatic" open>
            <summary><h2>AUTOMATIC CAPTURE <span data-value="capture-state">IDLE</span></h2></summary>
            <div>
              <div class="jank-settings jank-fields">
                <label>Threshold ms <input class="jl-input" data-input="thresholdMs" type="number" min="0.001" step="any"></label>
                <label>Before frames <input class="jl-input" data-input="beforeFrames" type="number" min="0" step="1"></label>
                <label>After frames <input class="jl-input" data-input="afterFrames" type="number" min="0" step="1"></label>
                <label>Cooldown ms <input class="jl-input" data-input="cooldownMs" type="number" min="0" step="any"></label>
              </div>
              <div class="jank-actions"><button type="button" class="jl-btn" data-action="arm" aria-label="Arm automatic capture">ARM</button><button type="button" class="jl-btn" data-action="disarm">DISARM</button></div></div>
          </details>
          <details class="jank-section" data-section="instrumentation" open>
            <summary><h2>INSTRUMENTATION</h2></summary>
            <div><div data-list="instrumentation" class="jank-list"></div>
              <div class="jank-actions"><button type="button" class="jl-btn" data-action="trace" aria-pressed="false">TRACE</button><button type="button" class="jl-btn" data-action="gpu" hidden>ENABLE GPU</button></div></div>
          </details>
          <details class="jank-section" data-section="captures" open>
            <summary><h2>SAVED CAPTURES <span>LAST 10</span></h2></summary>
            <div><div data-captures></div><p class="jank-note" data-value="capture-empty">No completed captures.</p></div>
          </details>
        </section>
      </div>
      <footer class="jank-overhead"><div class="jank-cost"><span>COLLECTION</span><span data-value="collection-cost"></span></div><div class="jank-cost"><span>PANEL REFRESH</span><span data-value="refresh-cost"></span></div><div class="jl-muted">MS AVG / PEAK · excludes browser paint and GPU work</div><div class="jl-muted" data-value="precision"></div></footer>
    </div>
    <p role="alert" class="jank-error" hidden></p>
  `;
}
