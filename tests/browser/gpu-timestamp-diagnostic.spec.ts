import { expect, test } from "@playwright/test";

test("PMREM diagnostics retain exact native timestamp pairs across query reuse", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/fixtures/gpu/timestamp-diagnostic.html");
  await page.waitForFunction(() => Boolean(window.timestampDiagnostic));
  const result = await page.evaluate(() => window.timestampDiagnostic());
  test.skip(result.status === "unsupported", "WebGPU timestamp queries unavailable");
  if (result.status !== "ready") {
    return;
  }
  expect(result.errors).toEqual([]);
  expect(result.native.map((pair) => pair.draw)).toEqual([true, false, false, true]);
  expect(result.frames).toHaveLength(12);
  for (const frame of result.frames) {
    expect(frame.resolution.status).toBe("settled");
    const sample = frame.resolution.samples[0];
    if (!sample) {
      throw new Error("Missing GPU frame");
    }
    expect(sample.expectedPasses).toBe(frame.raw.length);
    for (const [index, raw] of frame.raw.entries()) {
      const pass = sample.passes.find((pass) => pass.invocation === index + 1);
      const rejected = sample.rejectedPasses.find((pass) => pass.invocation === index + 1);
      if (pass) {
        expect(String(BigInt(sample.clock.originNs) + BigInt(pass.startNs))).toBe(raw.startNs);
        expect(String(BigInt(sample.clock.originNs) + BigInt(pass.endNs))).toBe(raw.endNs);
      } else {
        expect(rejected?.startNs).toBe(raw.startNs);
        expect(rejected?.endNs).toBe(raw.endNs);
        expect(sample.metrics).toBeNull();
      }
    }
  }
  await testInfo.attach("native-and-pmrem-timestamps.json", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
});
