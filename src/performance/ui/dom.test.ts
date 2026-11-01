import { describe, expect, it } from "vitest";

import { compactMarkup } from "./dom.ts";

describe("compactMarkup", () => {
  // What: indentation the formatter puts between tags is removed entirely.
  // Why: the viewer's markup lives in a formatted .html file. Between inline elements that
  // indentation would render as visible spaces the hand-written template never had, so the
  // page must get back exactly the tags, attributes and text it had before the move.
  it("drops line breaks and indentation next to tags", () => {
    const formatted = `<h1 class="brand">
  <span>JANK.JS</span>
  <span>VIEWER</span>
</h1>
`;

    expect(compactMarkup(formatted)).toBe(
      '<h1 class="brand"><span>JANK.JS</span><span>VIEWER</span></h1>',
    );
  });

  // What: a line break inside text, or between a tag's attributes, becomes one space.
  // Why: the formatter wraps long sentences and long attribute lists at a space. Removing
  // those breaks outright would glue words together ("delayedsample") or merge attributes
  // into one invalid name ("<inputid=...").
  it("turns wrapped text and wrapped attributes back into single spaces", () => {
    const formatted = `<p>
  periodic or delayed
  sample
</p>
<input
  id="file"
  type="file"
/>`;

    expect(compactMarkup(formatted)).toBe(
      '<p>periodic or delayed sample</p><input id="file" type="file" />',
    );
  });

  // What: spaces written on purpose survive: a space on one line, and the &#32; entity.
  // Why: the frame-time readout needs the space in "16.7 ms". The formatter drops a bare
  // leading space inside an element, so the markup spells it &#32;, which only the HTML
  // parser turns into a space. Neither may be treated as indentation.
  it("keeps intentional spaces and the &#32; entity", () => {
    expect(compactMarkup("<b>16.7</b> <i>x</i>")).toBe("<b>16.7</b> <i>x</i>");
    expect(compactMarkup("<b></b>\n<span>&#32;ms</span>")).toBe(
      "<b></b><span>&#32;ms</span>",
    );
  });
});
