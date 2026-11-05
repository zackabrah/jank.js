// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, test, vi } from "vitest";
import styles from "../live/panel.css?inline";
import { Button, IconButton } from "./button.tsx";
import { Notice } from "./notice.tsx";
import { StateBadge } from "./state-badge.tsx";

test("unavailable buttons remain focusable, explain why and never invoke the action or submit", async () => {
  const form = document.createElement("form");
  document.body.append(form);
  const action = vi.fn();
  const explain = vi.fn();
  const submit = vi.fn((event: Event) => event.preventDefault());
  form.addEventListener("submit", submit);
  try {
    const view = (blocked: boolean) => (
      <>
        <Button
          onPress={action}
          pressed={false}
          unavailable={
            blocked
              ? { reason: "Recording is active", reasonId: "reason", onExplain: explain }
              : undefined
          }
        >
          Auto
        </Button>
        <p id="reason">Recording is active</p>
      </>
    );
    render(view(true), form);
    const button = form.querySelector("button");
    if (!button) throw new Error("Missing button");
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-describedby")).toBe("reason");
    await act(() => button.click());
    expect(explain).toHaveBeenCalledOnce();
    expect(action).not.toHaveBeenCalled();
    render(view(false), form);
    await act(() => button.click());
    expect(button.hasAttribute("aria-disabled")).toBe(false);
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    expect(action).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  } finally {
    render(null, form);
    form.remove();
  }
});

test("badges keep a stable status name and notices have appropriate announcements and dismissal", async () => {
  const host = document.createElement("div");
  const dismiss = vi.fn();
  render(
    <>
      <StateBadge state="recording" detail="4.2s" />
      <Notice tone="error" onDismiss={dismiss}>
        Import failed
      </Notice>
    </>,
    host,
  );
  expect(host.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Recording");
  expect(host.querySelector('[role="status"] [aria-hidden="true"]')?.textContent).toBe("●");
  expect(host.querySelector('[role="status"]')?.getAttribute("tabindex")).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Import failed");
  const button = host.querySelector("button");
  if (!button) throw new Error("Missing dismiss button");
  expect(button.getAttribute("aria-label")).toBe("Dismiss notice");
  expect(button.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  expect(button.textContent).toBe("");
  await act(() => button.click());
  expect(dismiss).toHaveBeenCalledOnce();
  render(<Notice tone="warning">Capture unavailable</Notice>, host);
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Capture unavailable");
  render(null, host);
});

test("compiles all shared component variant classes", () => {
  const host = document.createElement("div");
  const nothing = () => undefined;
  render(
    <>
      <Button onPress={nothing}>Secondary</Button>
      <Button variant="primary" onPress={nothing}>
        Primary
      </Button>
      <IconButton label="Close" onPress={nothing}>
        ×
      </IconButton>
      {(["live", "frozen", "recording", "armed", "capturing", "cooldown", "activity"] as const).map(
        (state) => (
          <StateBadge key={state} state={state} />
        ),
      )}
      {(["info", "warning", "error", "success", "frozen", "pending"] as const).map((tone) => (
        <Notice key={tone} tone={tone}>
          Message
        </Notice>
      ))}
    </>,
    host,
  );
  for (const element of host.querySelectorAll("[class]")) {
    for (const token of element.classList) {
      expect(
        styles.includes(`.${token.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`),
        `Missing utility ${token}`,
      ).toBe(true);
    }
  }
  render(null, host);
});
