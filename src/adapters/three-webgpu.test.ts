import { expect, it, vi } from "vitest";

import { createThreeWebGpuSource } from "./three-webgpu.ts";

import type { GpuProfile } from "../types/gpu-profile-types.ts";

function rendererFixture() {
  let frames: number[] = [],
    complete: ((value: number | undefined) => void) | undefined;

  const renderer = {
    info: { frame: 1 },
    backend: {
      isWebGPUBackend: true,
      trackTimestamp: true,
      getTimestampFrames: () => frames,
    },
    hasFeature: () => true,
    resolveTimestampsAsync: vi.fn<() => Promise<number | undefined>>(
      () =>
        new Promise((done) => {
          complete = done;
        }),
    ),
  };

  return {
    renderer,
    resolve: async (frameIds: number[], ms: number) => {
      frames = frameIds;

      complete?.(ms);

      await Promise.resolve();

      await Promise.resolve();

      await Promise.resolve();
    },
  };
}

it("correlates delayed samples and does not count repeated or cached values as new GPU frames", async () => {
  const fixture = rendererFixture(),
    samples: GpuProfile[] = [];

  const source = createThreeWebGpuSource(fixture.renderer, {
    revision: "186",
    onSample: (sample) => samples.push(sample),
  });

  source.captureFrame(10);

  fixture.renderer.info.frame = 2;

  source.captureFrame(11);

  expect(fixture.renderer.resolveTimestampsAsync).toHaveBeenCalledTimes(1);

  await fixture.resolve([1], 0);

  expect(samples[0]).toMatchObject({
    sampleFrame: 1,
    diagnosticFrame: 10,
    sampleAgeFrames: 1,
    gpuMilliseconds: null,
    passes: [{ milliseconds: 0 }],
  });

  source.captureFrame(11);

  await fixture.resolve([1], 0);

  expect(samples).toHaveLength(1);

  fixture.renderer.info.frame = 3;

  source.captureFrame(12);

  await fixture.resolve([2, 3], 2.5);

  expect(samples[1]).toMatchObject({
    sampleFrame: 3,
    diagnosticFrame: 12,
    passes: [{ milliseconds: 2.5 }],
  });
});

it("ignores completions after disable/dispose and does not dispose host resources", async () => {
  const fixture = rendererFixture(),
    onSample = vi.fn<(profile: GpuProfile) => void>();

  const source = createThreeWebGpuSource(fixture.renderer, {
    revision: "186",
    onSample,
  });

  source.captureFrame(1);
  source.setEnabled(false);

  await fixture.resolve([1], 3);

  expect(onSample).not.toHaveBeenCalled();
  expect(source.read().status).toBe("disabled");

  source.setEnabled(true);

  fixture.renderer.info.frame = 2;

  source.captureFrame(2);
  source.dispose();

  await fixture.resolve([2], 3);

  expect(onSample).not.toHaveBeenCalled();
  expect(fixture.renderer.backend.trackTimestamp).toBe(true);
});

it("reports unsupported features and rejects unverified Three revisions", () => {
  const fixture = rendererFixture();

  fixture.renderer.hasFeature = () => false;

  expect(
    createThreeWebGpuSource(fixture.renderer, { revision: "186" }).read()
      .status,
  ).toBe("unsupported");
  expect(() =>
    createThreeWebGpuSource(fixture.renderer, { revision: "185" }),
  ).toThrow("only with Three.js r186");
});
