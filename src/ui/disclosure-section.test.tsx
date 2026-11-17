// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, test } from "vitest";
import { DisclosureSection } from "./disclosure-section.tsx";

test("keeps multiple disclosures independent and preserves hidden content", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  try {
    render(
      ["First", "Second"].map((label) => (
        <DisclosureSection key={label} title={label} summary={`${label} summary`} defaultOpen>
          <input aria-label={`${label} value`} />
        </DisclosureSection>
      )),
      host,
    );
    const [first, second] = host.querySelectorAll<HTMLButtonElement>("button");
    if (!first || !second) throw new Error("Missing collapse buttons");
    const firstId = first.getAttribute("aria-controls");
    const secondId = second.getAttribute("aria-controls");
    expect(firstId).not.toBe(secondId);
    const content = document.getElementById(firstId ?? "");
    const otherContent = document.getElementById(secondId ?? "");
    const input = content?.querySelector("input");
    if (!content || !otherContent || !input) throw new Error("Missing associated content");
    input.value = "Keep this value";
    await act(() => first.click());
    expect(content.hidden).toBe(true);
    expect(otherContent.hidden).toBe(false);
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(second.getAttribute("aria-expanded")).toBe("true");
    expect(first.textContent).toContain("First summary");
    // The chevron is an SVG rotated from aria-expanded; script never swaps Unicode glyphs.
    expect(first.querySelector("svg[aria-hidden='true']")?.getAttribute("class")).toContain(
      "group-aria-expanded:rotate-90",
    );
    expect(first.textContent).not.toMatch(/[▸▾]/);
    expect(second.textContent).not.toContain("Second summary");
    await act(() => first.click());
    expect(content.hidden).toBe(false);
    expect(content.querySelector("input")).toBe(input);
    expect(input.value).toBe("Keep this value");
  } finally {
    render(null, host);
    host.remove();
  }
});
