export {};

const frames = [...document.querySelectorAll<HTMLIFrameElement>("iframe")];
const view = document.querySelector<HTMLSelectElement>("#view");
const size = document.querySelector<HTMLSelectElement>("#size");
const scale = document.querySelector<HTMLSelectElement>("#scale");
const status = document.querySelector<HTMLElement>("#status");
if (!view || !size || !scale || !status) {
  throw new Error("Missing comparison controls");
}
const requestedView = new URLSearchParams(location.search).get("view");
if ([...view.options].some((option) => option.value === requestedView)) {
  view.value = requestedView ?? "viewer";
}
let generation = 0;
function fitViews(): void {
  const desktopWidth = view?.value === "viewer" ? 1440 : 640;
  const width = size?.value === "narrow" ? 390 : desktopWidth;
  for (const frame of frames) {
    const container = frame.parentElement;
    const viewport = container?.parentElement;
    if (!container || !viewport) {
      continue;
    }
    const factor = scale?.value === "actual" ? 1 : Math.min(1, viewport.clientWidth / width);
    frame.style.width = `${width}px`;
    frame.style.height = "900px";
    frame.style.transform = `scale(${factor})`;
    container.style.width = `${width * factor}px`;
    container.style.height = `${900 * factor}px`;
    viewport.style.maxHeight = "calc(100vh - 190px)";
  }
}
async function load(): Promise<void> {
  const epoch = ++generation;
  if (!status || !view) {
    return;
  }
  status.textContent = "Loading matched examples…";
  fitViews();
  try {
    await Promise.all(
      frames.map(async (frame, index) => {
        const original = index === 0;
        let source = original ? "/reference/viewer.html" : "/examples/viewer/";
        if (view.value !== "viewer") {
          source = `/examples/parity/${original ? "original" : "rewrite"}-panel.html?mode=${view.value}`;
        }
        await new Promise<void>((resolve) => {
          frame.onload = () => resolve();
          frame.src = source;
        });
        if (epoch !== generation || view.value !== "viewer") {
          return;
        }
        await importSample(frame, original);
      }),
    );
    if (epoch === generation) {
      status.textContent =
        "Ready. Both panes are interactive. Viewers start at spike #243; Loading uses matched cold and repeat runs. Reset restores the synthetic sample.";
    }
  } catch (cause) {
    status.textContent = cause instanceof Error ? cause.message : "Unable to load comparison";
  }
}
view.addEventListener("change", () => void load());
size.addEventListener("change", fitViews);
scale.addEventListener("change", fitViews);
document.querySelector("#reset")?.addEventListener("click", () => void load());
new ResizeObserver(fitViews).observe(document.body);
void load();

async function importSample(frame: HTMLIFrameElement, original: boolean): Promise<void> {
  const response = await fetch(`/samples/${original ? "original" : "rewrite"}.json`);
  if (!response.ok) {
    throw new Error("Start the parity preview server on port 4189.");
  }
  const input = frame.contentDocument?.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error("Viewer file input unavailable");
  }
  const transfer = new DataTransfer();
  transfer.items.add(
    new File([await response.text()], "matched-synthetic-scene.json", {
      type: "application/json",
    }),
  );
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  if (!original) {
    await alignRewrite(frame);
  }
}

async function alignRewrite(frame: HTMLIFrameElement): Promise<void> {
  const document = frame.contentDocument;
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const capture = document?.querySelector<HTMLButtonElement>('[data-capture-action="open"]');
    const count = document?.querySelector<HTMLSelectElement>("[data-viewer-range-count]");
    const start = document?.querySelector<HTMLInputElement>("[data-viewer-range-start]");
    if (capture && count && start) {
      count.value = "200";
      count.dispatchEvent(new Event("change", { bubbles: true }));
      capture.click();
      start.value = "146";
      start.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The rewrite viewer did not finish opening the matched sample.");
}
