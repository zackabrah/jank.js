// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { createCaptureController } from "../capture/controller.ts";
import { captureFixture } from "../capture/fixtures.ts";
import { parseRecording } from "../recording/format.ts";
import { createAgentApi, describeLongFrame, installAgentApi } from "./api.ts";

function setup() {
  const fixture = captureFixture(100);
  const controller = createCaptureController(fixture.source);
  return { ...fixture, controller, api: createAgentApi(controller) };
}

afterEach(() => {
  delete window.jank;
});

test("a long frame names its slowest scripts, or says it ran none", () => {
  const entry = (scripts: object[]) =>
    ({ duration: 120.4, startTime: 2000.2, scripts }) as unknown as PerformanceEntry;
  expect(describeLongFrame(entry([]))).toBe("120 ms from 2000 ms; scripts: none");
  expect(
    describeLongFrame(
      entry([
        { duration: 5, sourceFunctionName: "small", sourceURL: "http://x/a.js" },
        { duration: 90, sourceFunctionName: "step", sourceURL: "http://x/sim.js?v=1" },
        { duration: 20, invoker: "TimerHandler:setTimeout" },
      ]),
    ),
  ).toBe(
    "120 ms from 2000 ms; scripts: step sim.js 90 ms, TimerHandler:setTimeout 20 ms, small a.js 5 ms",
  );
});

test("start and stop drive a real capture and return its report", async () => {
  const { api, advance } = setup();
  api.start();
  expect(api.status()).toMatchObject({ phase: "recording", kind: "manual", captures: [] });
  advance(6, 40);
  const { id, report } = await api.stop();
  expect(report).toMatchObject({ format: "jank-analysis", kind: "recording" });
  expect(report.summary.frames).toBe(6);
  expect(api.status()).toMatchObject({ phase: "idle", captures: [{ id, frames: 6 }] });
});

test("report and export read saved captures by ID, defaulting to the latest", async () => {
  const { api, advance } = setup();
  api.start();
  advance(3);
  const first = await api.stop();
  api.start();
  advance(5);
  const second = await api.stop();
  expect(api.report().summary.frames).toBe(5);
  expect(api.report(first.id).summary.frames).toBe(3);
  expect(parseRecording(api.export(second.id)).frames).toHaveLength(5);
});

test("stop waits for GPU finalization", async () => {
  const { api, advance, source } = setup();
  let release = () => {};
  source.finalizeGpu = () =>
    new Promise((resolve) => {
      release = () => resolve({ version: 1, frames: [] });
    });
  api.start();
  advance(2);
  let done = false;
  const stopping = api.stop().then((result) => {
    done = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve));
  expect(done).toBe(false);
  expect(api.status().phase).toBe("finalizing");
  release();
  expect((await stopping).report.summary.frames).toBe(2);
});

test("stop rejects when GPU finalization fails instead of hanging", async () => {
  const { api, advance, source } = setup();
  source.finalizeGpu = () => Promise.reject(new Error("GPU readback failed"));
  api.start();
  advance(2);
  await expect(api.stop()).rejects.toThrow();
  expect(api.status().phase).toBe("unsaved");
});

test("misuse fails with a reason rather than doing nothing", async () => {
  const { api, advance } = setup();
  expect(() => api.report()).toThrow("No saved captures.");
  expect(() => api.export(7)).toThrow("No capture 7.");
  await expect(api.stop()).rejects.toThrow("No recording is running.");
  api.start();
  expect(() => api.start()).toThrow();
  await expect(api.stop()).rejects.toThrow("No completed frames");
  expect(api.status().phase).toBe("idle");
  api.start();
  advance(1);
  expect((await api.stop()).report.summary.frames).toBe(1);
});

test("start explains a host's own recording instead of taking it over", () => {
  const { api, source } = setup();
  source.startRecording();
  expect(() => api.start()).toThrow("outside this panel");
});

test("installs on the window and only removes itself", () => {
  const first = setup();
  const removeFirst = installAgentApi(window, first.controller);
  const firstApi = window.jank;
  expect(firstApi?.version).toBe(1);
  const removeSecond = installAgentApi(window, setup().controller);
  const secondApi = window.jank;
  expect(secondApi).not.toBe(firstApi);
  removeFirst();
  expect(window.jank).toBe(secondApi);
  removeSecond();
  expect(window.jank).toBeUndefined();
});
