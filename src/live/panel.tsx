import type { CaptureConnection } from "../capture/controller.ts";
import type { ReadInstrumentation } from "../capture/instrumentation-model.ts";
import type { ComparisonController } from "../compare/controller.ts";
import { mountShadowView } from "../shadow-view.ts";
import { type LiveSnapshot, readLive, validateSelectedBudget } from "./model.ts";
import styles from "./panel.css?inline";
import type { PanelMode } from "./state-strip.tsx";
import { LivePanel } from "./view.tsx";

export function mountLivePanel(
  container: HTMLElement,
  options: {
    initialMode?: PanelMode;
    comparison?: ComparisonController;
    onBudgetChange?: (milliseconds: number) => void;
    capture?: CaptureConnection;
    instrumentation?: ReadInstrumentation | undefined;
  } = {},
) {
  if (options.comparison && options.comparison.capture !== options.capture?.controller)
    throw new Error("Comparison and panel must use the same capture controller.");
  const view = mountShadowView(container, styles);
  return {
    update(snapshot: LiveSnapshot) {
      if (view.destroyed) return;
      const model = readLive(snapshot);
      view.render(
        <>
          <style>{styles}</style>
          <LivePanel
            view={model}
            initialMode={options.initialMode}
            capture={options.capture}
            comparison={options.comparison}
            instrumentation={options.instrumentation}
            onBudgetChange={
              options.onBudgetChange
                ? (milliseconds) => {
                    if (view.destroyed) return;
                    validateSelectedBudget(milliseconds);
                    options.onBudgetChange?.(milliseconds);
                  }
                : undefined
            }
          />
        </>,
      );
    },
    destroy: view.destroy,
  };
}
