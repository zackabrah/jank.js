// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { expect, test, vi } from "vitest";
import { mountDiagnosticsPanel } from "../live/diagnostics-adapter.ts";
import { createCaptureController } from "./controller.ts";
import { captureFixture } from "./fixtures.ts";
import type { ReadInstrumentation } from "./instrumentation-model.ts";

function setup(instrumentation?: ReadInstrumentation) {
  const container = document.createElement("div");
  document.body.append(container);
  const fixture = captureFixture(12);
  const controller = createCaptureController(fixture.source);
  const panel = mountDiagnosticsPanel(
    container,
    { ...fixture.source, measureRefresh: (work) => work() },
    undefined,
    { controller, onOpen: vi.fn() },
    instrumentation,
  );
  panel.refresh(0);
  const root = container.firstElementChild?.shadowRoot;
  if (!root) throw new Error("Missing panel");
  const button = (name: string) => {
    const found = [...root.querySelectorAll("button")].find(
      (item) => !item.closest("[hidden]") && item.textContent?.includes(name),
    );
    if (!found) throw new Error(`Missing ${name}`);
    return found;
  };
  const control = (name: "gpuTiming" | "traceEvents") => {
    const found = root.querySelector<HTMLButtonElement>(
      `[role="switch"][aria-labelledby$="-${name}-label"]`,
    );
    if (!found) throw new Error(`Missing ${name}`);
    return found;
  };
  return {
    ...fixture,
    root,
    panel,
    controller,
    button,
    control,
    close() {
      panel.destroy();
      container.remove();
    },
  };
}

test("instrumentation follows the host while frozen and recording, including external changes and teardown", async () => {
  let enabled = true;
  const setEnabled = vi.fn((value: boolean) => {
    enabled = value;
  });
  const host = setup(() => ({ gpuTiming: { enabled, setEnabled } }));
  try {
    await act(() => host.button("Capture (0)").click());
    await act(() => host.button("Freeze").click());
    await act(() => host.button("Start recording").click());
    const held = host.root.querySelector("section")?.getAttribute("data-frame");
    await act(() => host.control("gpuTiming").click());
    expect(setEnabled).toHaveBeenCalledExactlyOnceWith(false);
    expect(host.control("gpuTiming").getAttribute("aria-checked")).toBe("false");
    host.advance(2);
    enabled = true;
    await act(() => host.panel.refresh(250));
    expect(host.control("gpuTiming").getAttribute("aria-checked")).toBe("true");
    expect(host.controller.getSnapshot().phase).toBe("recording");
    expect(host.controller.getSnapshot().frames).toBe(2);
    expect(host.root.querySelector("section")?.getAttribute("data-frame")).toBe(held);
    // Read again at activation: the host may change between display refreshes.
    enabled = false;
    await act(() => host.control("gpuTiming").click());
    expect(setEnabled).toHaveBeenLastCalledWith(true);
    const calls = setEnabled.mock.calls.length;
    host.panel.destroy();
    expect(enabled).toBe(true);
    expect(setEnabled).toHaveBeenCalledTimes(calls);
    expect(host.controller.getSnapshot().phase).toBe("recording");
  } finally {
    host.close();
  }
});

test("missing, read-only and unsupported controls explain themselves without calling the host", async () => {
  const setEnabled = vi.fn();
  let supplied = false;
  const host = setup(() =>
    supplied
      ? {
          gpuTiming: {
            enabled: false,
            unavailableReason: "Timestamp queries unsupported.",
            setEnabled,
          },
          traceEvents: { enabled: true },
        }
      : {},
  );
  try {
    await act(() => host.button("Capture (0)").click());
    for (const name of ["gpuTiming", "traceEvents"] as const) {
      const control = host.control(name);
      expect(control.getAttribute("aria-disabled")).toBe("true");
      expect(
        host.root.getElementById(control.getAttribute("aria-describedby") ?? "")?.textContent,
      ).toContain("host has not supplied");
    }
    supplied = true;
    await act(() => host.panel.refresh(0, true));
    expect(host.control("traceEvents").getAttribute("aria-checked")).toBe("true");
    await act(() => host.control("gpuTiming").click());
    expect(setEnabled).not.toHaveBeenCalled();
    expect(host.root.querySelector('[role="alert"]')?.textContent).toContain(
      "Timestamp queries unsupported.",
    );
    expect(host.root.querySelectorAll("[data-panel-notice]")).toHaveLength(1);
  } finally {
    host.close();
  }
});

test("host read and write failures preserve real settings and leave capture usable", async () => {
  let failRead = false;
  let failWrite = true;
  let enabled = false;
  const host = setup(() => {
    if (failRead) throw new Error("Host disconnected.");
    return {
      traceEvents: {
        enabled,
        setEnabled(value) {
          if (failWrite) throw new Error("Trace sink rejected the change.");
          enabled = value;
        },
      },
    };
  });
  try {
    await act(() => host.button("Capture (0)").click());
    await act(() => host.control("traceEvents").click());
    expect(host.control("traceEvents").getAttribute("aria-checked")).toBe("false");
    expect(host.root.querySelector('[role="alert"]')?.textContent).toContain("Trace sink rejected");
    failWrite = false;
    await act(() => host.control("traceEvents").click());
    expect(host.control("traceEvents").getAttribute("aria-checked")).toBe("true");
    expect(host.root.querySelector('[role="alert"]')).toBeNull();
    failRead = true;
    await act(() => host.panel.refresh(250));
    expect(host.control("traceEvents").getAttribute("aria-disabled")).toBe("true");
    expect(host.root.textContent).toContain("Host disconnected.");
    await act(() => host.button("Start recording").click());
    expect(host.controller.getSnapshot().phase).toBe("recording");
    expect(enabled).toBe(true);
  } finally {
    host.close();
  }
});
