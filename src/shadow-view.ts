import { type ComponentChild, render } from "preact";

export function mountShadowView(container: HTMLElement, styles: string) {
  const document = container.ownerDocument;
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  const properties = document.createElement("style");
  properties.setAttribute("data-panel-properties", "");
  // Browsers register @property at document scope; inject no selectors or host resets.
  properties.textContent = styles.match(/@property\s+[^{}]+\{[^{}]*\}/g)?.join("\n") ?? "";
  document.head.append(properties);
  container.append(host);
  let destroyed = false;
  return {
    get destroyed() {
      return destroyed;
    },
    render(content: ComponentChild) {
      if (!destroyed) render(content, root);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      render(null, root);
      host.remove();
      properties.remove();
    },
  };
}
