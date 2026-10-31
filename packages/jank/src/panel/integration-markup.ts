const toggle = (key: string, label: string) =>
  `<button type="button" class="jl-btn" data-integration="${key}" aria-label="${label}" aria-pressed="false">OFF</button>`;
export function integrationMarkup(): string {
  return `<details class="jank-section" data-section="visibility" open>
    <summary><h2>VISIBILITY</h2></summary><div>
    <div class="jank-integration-setting"><span>culling</span>${toggle("visibility", "Visibility culling")}</div>
    <div class="jank-integration-setting"><span>debug bounds</span>${toggle("bounds", "Debug bounds")}</div>
    <p class="jank-note" data-value="visibility-status"></p><div class="jank-list" data-list="visibility"></div>
    <p class="jank-note" data-value="visibility-distance"></p></div></details>
    <details class="jank-section" data-section="instances" open><summary><h2>INSTANCES</h2></summary><div>
    <div class="jank-integration-setting"><span>instance culling</span>${toggle("instances", "Instance culling")}</div>
    <p class="jank-note" data-value="instances-status"></p><div class="jank-list" data-list="instances"></div>
    <p class="jank-note">Delayed host observations; draw and triangle counters remain submission upper bounds.</p></div></details>
    <details class="jank-section" data-section="temporal" open><summary><h2>TEMPORAL</h2></summary><div>
    <div class="jank-integration-setting"><span>rigid object history</span>${toggle("temporal", "Rigid object history")}</div>
    <label class="jank-integration-setting">debug view<select class="jl-input" data-integration="debug" aria-label="Temporal debug view"><option value="none">Final image</option><option value="motion">Motion vectors</option><option value="history">History validity</option></select></label>
    <p class="jank-note" data-value="temporal-status"></p><div class="jank-list" data-list="temporal"></div></div></details>`;
}
