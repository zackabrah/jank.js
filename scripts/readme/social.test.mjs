import { test } from "node:test";
import assert from "node:assert/strict";
import { socialSvg } from "./social.mjs";

await test("social card promotes the version without changing artwork and regenerates idempotently", () => {
  const source = '<svg><path d="M0 0"/><text id="release-version" x="56">V1.0.0-rc.0</text></svg>';
  const stable = socialSvg(source, "1.0.0");
  assert.equal(stable, source.replace("V1.0.0-rc.0", "V1.0.0"));
  assert.equal(socialSvg(stable, "1.0.0"), stable);
  assert.equal(socialSvg(stable, "1.0.0-rc.1"), source.replace("rc.0", "rc.1"));
  assert.throws(() => socialSvg("<svg/>", "1.0.0"), /exactly one/);
  assert.throws(() => socialSvg(source + source, "1.0.0"), /exactly one/);
  assert.throws(() => socialSvg(source, '<script>'), /Unsupported/);
});
