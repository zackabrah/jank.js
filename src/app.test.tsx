// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, test, vi } from "vitest";
import { startLivePreview } from "../devtools/live-preview.ts";
import { App } from "./app.tsx";

vi.mock("../devtools/live-preview.ts", () => ({ startLivePreview: vi.fn() }));

test("switches between live and reference sources, reports failures and disposes a late connection", async () => {
  let connect: (cleanup: () => void) => void = () => {};
  const cleanup = vi.fn();
  vi.mocked(startLivePreview).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        connect = resolve;
      }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  try {
    await act(async () => {
      render(<App />, container);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const scenario = container.querySelector("select");
    if (!scenario) throw new Error("Missing scenario control");
    const select = async (value: string) => {
      await act(() => {
        scenario.value = value;
        scenario.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    expect(startLivePreview).toHaveBeenCalledOnce();
    await select("sample");
    await act(async () => {
      connect(cleanup);
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(document.head.querySelectorAll("[data-panel-properties]")).toHaveLength(1);
    const root = () => container.querySelector("#hud")?.firstElementChild?.shadowRoot;
    expect(root()?.textContent).toContain("3 of 3 expected timed");
    await select("empty");
    expect(root()?.querySelector('[data-chart="line"]')?.getAttribute("d")).toBe("");
    expect(document.head.querySelectorAll("[data-panel-properties]")).toHaveLength(1);
    vi.mocked(startLivePreview).mockRejectedValueOnce(new Error("Checkout missing"));
    await select("live");
    expect(container.textContent).toContain("Checkout missing");
    expect(document.head.querySelectorAll("[data-panel-properties]")).toHaveLength(0);
  } finally {
    await act(() => render(null, container));
    container.remove();
  }
});
