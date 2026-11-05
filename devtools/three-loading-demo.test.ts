import {
  FileLoader,
  IcosahedronGeometry,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  type WebGLRenderer,
} from "three";
import { afterEach, expect, test, vi } from "vitest";
import { createThreeLoadingDemo } from "./three-loading-demo.ts";

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(FileLoader.prototype, "loadAsync").mockImplementation(
    async (url) =>
      new TextEncoder().encode(
        url.includes("geometry") ? '{"radius":1,"detail":1}' : '{"color":"#38bdf8"}',
      ).buffer,
  );
  const scene = new Scene();
  const compile = vi.fn(async () => {});
  const demo = createThreeLoadingDemo(scene, new PerspectiveCamera(), {
    compileAsync: compile,
  } as unknown as WebGLRenderer);
  return { demo, scene, compile };
}

test("preparation publishes only after compilation; failures preserve the existing object", async () => {
  const { demo, scene, compile } = setup();
  const geometryDispose = vi.spyOn(IcosahedronGeometry.prototype, "dispose");
  await demo.load();
  const previous = scene.children[0];
  expect(previous).toBeDefined();
  expect(demo.read().current?.kind).toBe("editor");
  compile.mockRejectedValueOnce(new Error("compile rejected"));
  await demo.load();
  expect(scene.children).toEqual([previous]);
  expect(demo.read().current).toMatchObject({ status: "failed", failure: "compile rejected" });
  expect(geometryDispose).toHaveBeenCalledTimes(1);
  await demo.dispose();
  expect(geometryDispose).toHaveBeenCalledTimes(2);
  expect(scene.children).toHaveLength(0);
});

test("cancellation and disposal defer candidate cleanup until compilation settles", async () => {
  const { demo, scene, compile } = setup();
  let resolve = () => {};
  compile.mockImplementationOnce(
    () =>
      new Promise<void>((yes) => {
        resolve = yes;
      }),
  );
  const materialDispose = vi.spyOn(MeshStandardMaterial.prototype, "dispose");
  const load = demo.load();
  await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
  demo.cancel();
  const held = demo.read();
  const disposed = demo.dispose();
  expect(held.current).toMatchObject({ status: "cancelled", pending: 1 });
  expect(materialDispose).not.toHaveBeenCalled();
  resolve();
  await load;
  await disposed;
  expect(materialDispose).toHaveBeenCalledOnce();
  expect(scene.children).toHaveLength(0);
  expect(demo.read()).toEqual(held);
});

test("renderer failure remains Failed when its later compilation result settles", async () => {
  const { demo, compile } = setup();
  let resolve = () => {};
  compile.mockImplementationOnce(
    () =>
      new Promise<void>((yes) => {
        resolve = yes;
      }),
  );
  const task = demo.load();
  await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
  demo.fail("device lost");
  resolve();
  await task;
  expect(demo.read().current).toMatchObject({
    status: "failed",
    failure: "device lost",
    pending: 1,
  });
  expect(demo.phase).toContain("Failed");
  await demo.dispose();
});
