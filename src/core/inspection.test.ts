import { describe, expect, it } from "vitest";

import { eventGlyph, iconLabel } from "./inspection.ts";

import { toolEvent } from "./recording.ts";

describe("event icons", () => {
  // What: the monitor's own events always get the same fixed icons.
  // Why: recording and capture markers are the ones people look for first; a fixed shape
  // (● start, ■ stop, ▲ spike) is learnable, where a hashed one would look arbitrary.
  it("gives the monitor's own events fixed icons", () => {
    expect(eventGlyph(toolEvent.recordingStarted).glyph).toBe("●");
    expect(eventGlyph(toolEvent.recordingStopped).glyph).toBe("■");
    expect(eventGlyph(toolEvent.recordingComplete).glyph).toBe("■");
    expect(eventGlyph(toolEvent.spikeCaptured).glyph).toBe("▲");
  });

  // What: a host label always maps to the same icon, never to one of the monitor's own.
  // Why: the icon has to mean the same thing in the live panel, an exported recording and the
  // viewer, and must never pass a game event off as a recording or capture marker.
  it("gives a host label the same icon every time, never a monitor icon", () => {
    const icons = new Set(["●", "■", "▲"]);

    for (const label of ["Level loaded", "Boss spawned", "wave 3", "GC"]) {
      const { glyph, text } = eventGlyph(label);

      expect(eventGlyph(label).glyph).toBe(glyph);
      expect(icons.has(glyph)).toBe(false);
      expect(text).toBe(label);
    }

    expect(eventGlyph("Level loaded").glyph).not.toBe(
      eventGlyph("Boss spawned").glyph,
    );
  });

  // What: a label that starts with a known icon and a space keeps that icon, and the icon is
  // removed from the text; any other leading symbol is left alone.
  // Why: this lets a game pick an icon without any new API, while a label that just happens
  // to start with punctuation isn't mangled.
  it("lets a label choose its icon by starting with it", () => {
    expect(eventGlyph("◆ Boss spawned")).toEqual({
      glyph: "◆",
      text: "Boss spawned",
    });
    expect(iconLabel("◆ Boss spawned")).toBe("◆ Boss spawned");
    expect(eventGlyph("◆Boss").text).toBe("◆Boss");
    expect(eventGlyph("# not an icon").text).toBe("# not an icon");
  });
});
