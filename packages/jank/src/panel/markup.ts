import { buildVersion } from "../build.ts";
import { integrationMarkup } from "./integration-markup.ts";

const icon = (action: string, label: string, text: string) =>
  `<button type="button" class="jl-btn jl-icon" data-action="${action}" aria-label="${label}" title="${label}">${text}</button>`;

const metric = (name: string, label: string, extra = "") =>
  `<div class="jank-tile"><span>${label}</span><strong data-value="${name}">–</strong>${extra}</div>`;

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
      <div data-live-chart="mini" class="jank-frame-view"><canvas data-chart="mini" role="img" aria-label="Recent frame durations"></canvas></div>
      <div class="jank-mini-footer"><span data-value="mini-worst">–</span><span data-value="mini-channel">–</span></div>
    </div>
    <div data-view="full" hidden>
      <header class="jank-header"><strong class="jank-wordmark">JANK.JS</strong><span data-value="state" class="jl-chip"></span>
        ${icon("freeze", "Freeze display", "Ⅱ")}${icon("mini", "Shrink to mini view", "↙")}${icon("line", "Collapse to one line", "−")}
      </header>
      <div class="jl-tabs" aria-label="Performance views" data-tabs>
        <button type="button" class="jl-tab" data-tab="live">LIVE</button>
        <button type="button" class="jl-tab" data-tab="loading">LOADING</button>
        <button type="button" class="jl-tab" data-tab="capture">CAPTURE</button>
        <span class="jank-header-budget">BUDGET <span data-value="header-budget"></span></span>
      </div>
      <button type="button" class="jl-btn jank-read-summary" data-action="summary">Read summary</button><p class="jl-sr" aria-live="polite" data-value="summary"></p>
      <p class="jank-note" data-value="capture-health" hidden></p>
      <p class="jank-note" data-viewer-transfer-status role="status" hidden></p>
      <button type="button" class="jl-btn" data-action="retry-viewer-download" hidden>Retry viewer download</button>
      <div class="jank-views">
        <section data-tabpanel="live" class="jank-live">
          <div class="jank-metrics">${metric("fps", "FPS", `<span class="jank-fps-range" data-fps-range role="img" hidden><span data-value="fps-high"></span><i><i data-fps-mark></i></i><span data-value="fps-low"></span></span>`)}${metric("average", "AVG MS")}${metric("p95", "P95 MS")}${metric("worst", "WORST MS")}${metric("frame", "AT FRAME")}${metric("missed", "MISSED")}</div>
          <div class="jank-chart"><div data-live-chart="full" class="jank-frame-view"><canvas data-chart="full" role="img" aria-label="Recent frame durations"></canvas></div><div class="jank-chart-labels"><span data-value="range">–</span><span data-value="budget">–</span></div></div>
          <div class="jank-automatic-live">
            <div class="jank-actions"><button type="button" class="jl-btn" data-action="auto-toggle" aria-pressed="false">Capture slow frames</button><button type="button" class="jl-btn jl-small" data-action="auto-settings">Settings</button></div>
            <p class="jank-note" data-automatic-status role="status"></p>
            <div data-automatic-saved hidden><p class="jank-note" data-automatic-notice role="status"></p><button type="button" class="jl-btn jl-small" data-action="inspect-trigger">Inspect trigger</button></div>
          </div>
          <div class="jank-scroll" role="region" aria-label="Performance details" tabindex="0">
            <details class="jank-section" data-section="scopes" open>
              <summary><h2>CPU SCOPES <span>MS / FRAME</span></h2></summary>
              <div><div data-list="scopes" class="jank-list"></div><p class="jank-note" data-value="coverage"></p></div>
            </details>
            <details class="jank-section" data-section="gpu" open>
              <summary><h2>GPU <span data-value="gpu-source">ASYNCHRONOUS</span></h2></summary>
              <div><div data-list="gpu" class="jank-list"></div><p class="jank-note" data-value="gpu-note"></p><p class="jank-note" data-value="gpu-rows-note" hidden></p>
                <details data-gpu-explanation hidden><summary>About GPU measurements</summary><p class="jank-note">Pass sums count overlapping work more than once. Busy time is the union of measured intervals. Elapsed span includes gaps between the first and last pass. All values are milliseconds on the GPU clock, separate from CPU time. Incomplete frames have no complete totals; their measured passes remain visible.</p></details></div>
            </details>
            <details class="jank-section" data-section="counters" open>
              <summary><h2>COUNTERS <span data-value="counter-sources"></span></h2></summary>
              <div><div data-list="counters" class="jank-list jank-counter-list"></div><p class="jank-note" data-value="counter-note"></p></div>
            </details>
            ${integrationMarkup()}
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
            <button type="button" class="jl-btn" data-action="open-viewer" aria-label="Open viewer" title="Stops an active manual recording and finalizes GPU results before opening" hidden>OPEN VIEWER</button>
            <p class="jank-note" data-export-status role="status" hidden></p>
          </div>
        </section>
        <section data-tabpanel="loading" class="jank-scroll">
          <div class="jank-metrics jank-loading-metrics">${metric("loading-total", "TOTAL")}${metric("loading-cold", "COLD")}${metric("loading-cache-rate", "CACHE")}</div>
          <p class="jank-note jank-loading-status" data-value="loading-state">No loading source connected.</p>
          <details class="jank-section" data-section="loading" open>
            <summary><h2>STAGES <span data-value="loading-axis"></span></h2></summary>
            <div><div data-list="loading" class="jank-list"></div><details class="jank-loading-notes"><summary>Timing notes</summary><p class="jank-note">Bars show elapsed interval union; dim bars show the first completed fresh-context run. Combined operation times include overlap and waiting, not CPU/GPU execution.</p></details></div>
          </details>
          <details class="jank-section" data-section="loading-cache" open>
            <summary><h2>CACHE <span>THIS RUN</span></h2></summary>
            <div><div data-list="loading-cache" class="jank-list"></div><details class="jank-loading-notes"><summary>Cache notes</summary><p class="jank-note">Hit rate uses hits / (hits + misses). Shared in-flight requests are separate. Bytes are host-reported received bytes, not inferred network traffic.</p></details></div>
          </details>
          <details class="jank-section" data-section="loading-sessions" open>
            <summary><h2>SESSIONS <span>ELAPSED TOTAL</span></h2></summary>
            <div><div data-list="loading-sessions" class="jank-list"></div></div>
          </details>
        </section>
        <section data-tabpanel="capture" class="jank-scroll">
          <details class="jank-section" data-section="comparison" data-comparison hidden>
            <summary><h2>A/B COMPARISON</h2></summary>
            <div>
              <p class="jank-note">Configure A and B in the host. Jank alternates AB / BA and uses the current frame budget.</p>
              <fieldset class="jank-settings jank-fields"><legend>Measurement windows</legend>
                <label>Warm-up seconds <input class="jl-input" data-comparison-input="warmup" type="number" min="0.5" max="10" step="0.5" value="1" required></label>
                <label>Measurement seconds <input class="jl-input" data-comparison-input="measure" type="number" min="1" max="10" step="0.5" value="2" required></label>
                <label>Pairs <input class="jl-input" data-comparison-input="pairs" type="number" min="2" max="6" step="1" value="3" required></label>
              </fieldset>
              <div class="jank-actions">
                <button type="button" class="jl-btn jl-primary" data-action="comparison-start">Run A/B comparison</button>
                <button type="button" class="jl-btn" data-action="comparison-stop" disabled>Stop comparison</button>
                <button type="button" class="jl-btn" data-action="comparison-export" disabled>Export comparison</button>
              </div>
              <p class="jank-note" data-comparison-status role="status"></p>
              <div data-comparison-summary></div><div data-comparison-trials></div>
              <p class="jank-note">Quick estimate, not statistical significance. Medians of per-trial values; negative B − A is lower time. A paired range crossing zero shows mixed results. Each metric needs 20 samples and 80% coverage in every trial. Frame pacing allows 1 ms or 5% tolerance; CPU/GPU use the exact budget and can overlap. Export includes all completed A/B recordings. A 500 ms GPU drain follows each window; a connected interval resolver may wait up to 2 s more.</p>
            </div>
          </details>
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
              <div class="jank-budget-presets" role="group" aria-label="Frame budget presets">${[30, 60, 120].map((fps) => `<button type="button" class="jl-btn" data-action="budget-preset" data-fps="${fps}" aria-label="${fps} FPS" aria-pressed="false">${fps}</button>`).join("")}<button type="button" class="jl-btn" data-action="custom-fps" aria-label="Custom FPS" aria-pressed="false">CUSTOM</button></div><div class="jank-settings"><label>Target FPS <input class="jl-input" data-input="fps" type="number" min="1" step="1"></label><button type="button" class="jl-btn jl-small" data-action="budget">APPLY</button></div></div>
          </details>
          <details class="jank-section" data-section="automatic" open>
            <summary><h2>AUTOMATIC CAPTURE <span data-value="capture-state">IDLE</span></h2></summary>
            <div>
              <div class="jank-settings jank-fields">
                <label>Trigger mode <select class="jl-select" aria-label="Trigger mode" data-trigger-mode><option value="spike">Single-frame spike</option><option value="sustained">Sustained over budget</option></select></label>
                <label data-sustained-rule hidden>Sustained ms <input class="jl-input" data-input="sustainedMs" type="number" min="1" max="600000" step="1" value="250"></label>
                <label data-spike-rule>Trigger preset <select class="jl-select" aria-label="Trigger preset" data-trigger-preset><option value="custom">Custom milliseconds</option><option value="1.5">1.5 × frame budget</option><option value="2">2 × frame budget</option><option value="3">3 × frame budget</option></select></label>
                <label data-spike-rule>Threshold ms <input class="jl-input" data-input="thresholdMs" type="number" min="0.001" step="any"></label>
                <label>Capture window <select class="jl-select" aria-label="Capture window" data-capture-window><option value="frames">Frame-count window</option><option value="episode">Slowdown episode (seconds)</option></select></label>
                <label data-frame-window>Before frames <input class="jl-input" data-input="beforeFrames" type="number" min="0" step="1"></label>
                <label data-frame-window>After frames <input class="jl-input" data-input="afterFrames" type="number" min="0" step="1"></label>
                <label data-time-window hidden>Before seconds <input class="jl-input" data-time-window-input="beforeMs" type="number" min="0" max="600" step="any" value="2"></label>
                <label data-time-window hidden>Minimum after seconds <input class="jl-input" data-time-window-input="afterMs" type="number" min="0" max="600" step="any" value="4"></label>
                <label data-time-window hidden>Quiet recovery seconds <input class="jl-input" data-time-window-input="recoveryMs" type="number" min="0" max="600" step="any" value="2"></label>
                <label data-time-window hidden>Episode limit seconds <input class="jl-input" data-time-window-input="maxDurationMs" type="number" min="0.001" max="600" step="any" value="30"></label>
                <label>Cooldown ms <input class="jl-input" data-input="cooldownMs" type="number" min="0" step="any"></label>
              </div>
              <p class="jank-note" data-trigger-rule></p>
              <p class="jank-note">ARM applies these settings. Spike mode requires one frame above the threshold. Sustained mode requires contiguous frames above Jank’s budget for the selected duration; one long frame can qualify. A gap, an on-budget frame or a budget change resets the streak. Cooldown starts after collection finishes. Episode mode merges threshold crossings until no frame exceeds the threshold for the quiet recovery interval, capped at 6,000 frames or the elapsed limit. Prehistory is bounded to 599 frames; unavailable context is marked truncated.</p>
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
      <footer class="jank-overhead"><div class="jank-cost"><span>COLLECTION</span><span data-value="collection-cost"></span></div><div class="jank-cost"><span>PANEL REFRESH</span><span data-value="refresh-cost"></span></div><div class="jl-muted">MS AVG / PEAK · excludes browser paint and GPU work</div><div class="jl-muted" data-value="precision"></div><div class="jl-muted" data-value="isolation"></div><div class="jl-muted" aria-label="jank.js build">v${buildVersion}</div></footer>
    </div>
    <p role="alert" class="jank-error" hidden></p>
  `;
}
