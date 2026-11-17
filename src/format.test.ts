import { describe, expect, it } from "vitest";
import { formatMs, formatNumber, formatSeconds, NBSP, plural, withUnit } from "./format.ts";

describe("number formatting", () => {
  it("keeps decimals below 100 and whole numbers from 100", () => {
    expect(formatNumber(16.666)).toBe("16.7");
    expect(formatNumber(99.94)).toBe("99.9");
    expect(formatNumber(100.4)).toBe("100");
    expect(formatNumber(7214.04)).toBe("7214");
    expect(formatNumber(-185.3, 2)).toBe("-185");
    expect(formatNumber(2.454, 2)).toBe("2.45");
  });

  it("joins every number to its unit with a non-breaking space", () => {
    expect(formatMs(16.666)).toBe(`16.7${NBSP}ms`);
    expect(formatMs(7214.04)).toBe(`7214${NBSP}ms`);
    expect(formatMs(64.1, 2)).toBe(`64.10${NBSP}ms`);
    expect(formatSeconds(0.73)).toBe(`0.7${NBSP}s`);
    expect(formatSeconds(6.083, 2)).toBe(`6.08${NBSP}s`);
    expect(withUnit(60, "FPS")).toBe(`60${NBSP}FPS`);
    expect(formatMs(16.7)).not.toContain(" ");
  });

  it("pluralizes counts", () => {
    expect(plural(1, "trial")).toBe("trial");
    expect(plural(0, "trial")).toBe("trials");
    expect(plural(4, "pass", "passes")).toBe("passes");
  });
});
