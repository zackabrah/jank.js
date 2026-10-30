import { createTabs, type Tab } from "../src/index.ts";

function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) {
    throw new Error(`Missing gallery element: ${selector}`);
  }
  return result;
}

const tabs: Tab[] = ["controls", "fields", "unavailable", "details"].map((id) => ({
  id,
  button: element<HTMLButtonElement>(`#${id}-tab`),
  panel: element(`#${id}-panel`),
}));
let changes = 0;
function mountTabs() {
  element("#selected").textContent = "controls";
  return createTabs({
    tablist: element("#examples"),
    tabs,
    selectedId: "controls",
    onSelect: (id) => {
      changes += 1;
      element("#selected").textContent = id;
      element("#changes").textContent = String(changes);
    },
  });
}

let control = mountTabs();
element("#select-fields").addEventListener("click", () => control.select("fields"));
element("#dispose-tabs").addEventListener("click", () => {
  control.dispose();
  element("#lifecycle").textContent = "disposed";
});
element("#mount-tabs").addEventListener("click", () => {
  control.dispose();
  control = mountTabs();
  element("#lifecycle").textContent = "mounted";
});
element("#toggle").addEventListener("click", () => {
  const button = element<HTMLButtonElement>("#toggle");
  const pressed = button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(pressed));
  button.textContent = pressed ? "ON" : "OFF";
});
element("#example-form").addEventListener("submit", (event) => {
  event.preventDefault();
  element("#validation").textContent = "Fields are valid.";
});
element("#gallery").dataset.ready = "true";
