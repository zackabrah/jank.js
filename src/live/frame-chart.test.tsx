// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import { liveFixture } from "./fixtures.ts";
import { FrameChart } from "./frame-chart.tsx";
import { readLive } from "./model.ts";

const container = document.createElement("div");
document.body.append(container);
afterEach(() => {
  render(null, container);
  vi.restoreAllMocks();
});

function view(intervals: number[], at = 1000, firstId = 100, budget = 10) {
  const source = liveFixture(true);
  source.diagnostics.budget.frameMs = budget;
  source.diagnostics.frames = intervals.map((interval, index) => ({
    id: firstId + index,
    at: at + index * 100,
    interval,
    scopes: [],
    coverage: "complete",
    overhead: { collectionMs: 0, refreshMs: 0 },
  }));
  return readLive(source);
}

function chart() {
  const element = container.querySelector<SVGSVGElement>('svg[role="slider"]');
  if (!element) throw new Error("Missing chart slider");
  return element;
}

const readout = () => container.querySelector('[data-chart="readout"]');
const ceiling = () => Number(container.firstElementChild?.getAttribute("data-chart-ceiling"));
const draw = async (value: ReturnType<typeof view>, compact = false) => {
  await act(() => render(<FrameChart view={value} compact={compact} />, container));
};
const key = async (value: string) => {
  await act(() => {
    chart().dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true }));
  });
};

test("inspects actual slots in a partial window, including zero; blank slots have no crosshair", async () => {
  await draw(view([0, 10, 20]));
  expect(readout()?.textContent).toBe("Worst f102 · 20.0\u00a0ms · +10.0\u00a0ms vs budget");
  expect(Number(container.querySelector('[data-chart="worst"]')?.getAttribute("cx"))).toBeCloseTo(
    299.167,
  );
  const svg = chart();
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 0, 600, 96));
  const hover = async (x: number) => {
    await act(() => {
      svg.dispatchEvent(new MouseEvent("pointermove", { clientX: x, bubbles: true }));
    });
  };
  // The three frames occupy only the final three of 180 slots, even at CSS-scaled widths.
  await hover(20 + (177.5 / 180) * 600);
  expect(readout()?.textContent).toBe("f100 · 0.0\u00a0ms · -10.0\u00a0ms vs budget");
  expect(container.querySelector('[data-chart="inspection"]')).not.toBeNull();
  await hover(620);
  expect(readout()?.textContent).toBe("f102 · 20.0\u00a0ms · +10.0\u00a0ms vs budget");
  await hover(100);
  expect(container.querySelector('[data-chart="inspection"]')).toBeNull();
  expect(readout()?.textContent).toBe("Worst f102 · 20.0\u00a0ms · +10.0\u00a0ms vs budget");
  await hover(618);
  await act(() => {
    svg.dispatchEvent(new MouseEvent("pointerleave"));
  });
  expect(readout()?.textContent).toBe("Worst f102 · 20.0\u00a0ms · +10.0\u00a0ms vs budget");
});

test("keyboard inspection keeps frame identity as the window moves and drops stale samples", async () => {
  await draw(view([5, 10, 20]));
  await act(() => chart().focus());
  expect(document.activeElement).toBe(chart());
  await key("Home");
  expect(chart().getAttribute("aria-valuetext")).toBe(
    "Frame 100, 5.0 milliseconds, 5.0 milliseconds below budget",
  );
  await key("ArrowLeft");
  expect(chart().getAttribute("aria-valuenow")).toBe("0");
  await key("ArrowRight");
  expect(readout()?.textContent).toContain("f101 · 10.0\u00a0ms");
  await draw(view([10, 20, 6], 1100, 101));
  expect(chart().getAttribute("aria-valuenow")).toBe("0");
  expect(readout()?.textContent).toContain("f101 · 10.0\u00a0ms");
  await draw(view([20, 6, 8], 1200, 102));
  expect(readout()?.textContent).toContain("f104 · 8.0\u00a0ms");
  await key("Home");
  await key("End");
  await key("ArrowRight");
  expect(chart().getAttribute("aria-valuenow")).toBe("2");
  await act(() => chart().blur());
  expect(readout()?.textContent).toBe("Worst f102 · 20.0\u00a0ms · +10.0\u00a0ms vs budget");
  await draw(view([]));
  expect(container.querySelector('[role="slider"]')).toBeNull();
  expect(container.querySelector('[data-chart="worst"]')).toBeNull();
  expect(readout()?.textContent).toBe("No frame samples");
});

test("expands the scale immediately, then waits for two seconds of lower requirements", async () => {
  await draw(view([16]));
  expect(ceiling()).toBe(20);
  await draw(view([81], 1100, 101));
  expect(ceiling()).toBe(100);
  await draw(view([16], 1200, 102));
  expect(ceiling()).toBe(100);
  await draw(view([16], 3199, 103));
  expect(ceiling()).toBe(100);
  await draw(view([16], 3200, 104));
  expect(ceiling()).toBe(20);
  await draw(view([201], 3300, 105));
  expect(ceiling()).toBe(500);
  await draw(view([16], 3400, 106));
  await draw(view([401], 5000, 107));
  await draw(view([16], 5400, 108));
  expect(ceiling()).toBe(500);
});

test("display-clock scale holds on rerenders and resets for budgets, empty data and new sessions", async () => {
  await draw(view([81]));
  const held = view([16], 2000, 101);
  await draw(held);
  for (let index = 0; index < 12; index++) await draw(held);
  expect(ceiling()).toBe(100);
  await draw(view([16], 2000, 101, 20));
  expect(ceiling()).toBe(50);
  await draw(view([81], 2100, 102));
  await draw(view([], 2200));
  expect(ceiling()).toBe(20);
  await draw(view([81], 3000, 100));
  await draw(view([16], 3100, 1));
  expect(ceiling()).toBe(20);
  await draw(view([81], 4000, 101));
  await draw(view([16], 100, 102));
  expect(ceiling()).toBe(20);
});

test("mini shares scale steps without adding controls; rounded deltas preserve budget tolerance", async () => {
  await draw(view([31]), true);
  expect(ceiling()).toBe(50);
  expect(container.querySelector('[role="slider"]')).toBeNull();
  expect(readout()).toBeNull();
  const source = view([9.9, 10, 10.1, 20]);
  await draw(source);
  await act(() => chart().focus());
  await key("Home");
  await key("ArrowRight");
  await key("ArrowRight");
  expect(readout()?.textContent).toContain("+0.1\u00a0ms vs budget");
  expect(readout()?.hasAttribute("data-over-budget")).toBe(false);
  await key("End");
  expect(readout()?.hasAttribute("data-over-budget")).toBe(true);
});
