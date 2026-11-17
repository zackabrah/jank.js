import { BoxGeometry, InstancedMesh, MeshBasicMaterial, type WebGLRenderer } from "three";
import Info from "three/src/renderers/common/Info.js";
import { afterEach, expect, test, vi } from "vitest";
import { observeThreeInstances } from "./three-instances.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function harness(backend: "webgl2" | "webgpu") {
  const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 16);
  mesh.count = 4;
  mesh.frustumCulled = false;
  const info: WebGLRenderer["info"] | Info =
    backend === "webgpu"
      ? new Info()
      : {
          render: { frame: 1, calls: 0, triangles: 0, lines: 0, points: 0 },
          memory: { geometries: 1, textures: 0 },
          programs: [],
          autoReset: false,
          reset: vi.fn(),
          update: vi.fn(),
        };
  info.autoReset = false;
  const draw = (count = 1) => {
    if ("drawCalls" in info.render) info.render.drawCalls += count;
    else info.render.calls += count;
  };
  const before = vi.fn(function (this: unknown) {
    expect(this).toBe(mesh);
    draw(3);
  });
  const after = vi.fn(function (this: unknown) {
    expect(this).toBe(mesh);
    draw(5);
  });
  mesh.onBeforeRender = before;
  mesh.onAfterRender = after;
  const observer = observeThreeInstances(mesh, info);
  const submit = (calls = 1) => {
    Reflect.apply(mesh.onBeforeRender, mesh, []);
    draw(calls);
    Reflect.apply(mesh.onAfterRender, mesh, []);
  };
  cleanups.push(() => {
    observer.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh.dispose();
  });
  return { mesh, info, draw, observer, before, after, submit };
}

for (const backend of ["webgl2", "webgpu"] as const) {
  test(`${backend} separates configured/active instances and sums repeats without duplicating unique instances`, () => {
    const { mesh, info, observer, before, after, draw, submit } = harness(backend);
    observer.beginFrame();
    draw(7);
    submit();
    submit();
    const snapshot = observer.read(8);
    expect(snapshot).toEqual({
      configuredInstances: 8,
      activeInstances: 4,
      instanceCapacity: 16,
      meshVisible: true,
      frustumCullingEnabled: false,
      instanceDrawCalls: 2,
      submittedInstances: 8,
      uniqueSubmittedInstances: 4,
      visibleInstances: null,
    });
    expect(before).toHaveBeenCalledTimes(2);
    expect(after).toHaveBeenCalledTimes(2);
    expect(info.autoReset).toBe(false);
    mesh.count = 8;
    expect(snapshot.activeInstances).toBe(4);
    observer.beginFrame();
    submit();
    expect(observer.read(8)).toMatchObject({
      activeInstances: 8,
      instanceDrawCalls: 1,
      submittedInstances: 8,
      uniqueSubmittedInstances: 8,
    });
  });

  test(`${backend} distinguishes zero submissions from unknown pixel visibility and unsupported draw patterns`, () => {
    const { mesh, observer, submit } = harness(backend);
    mesh.visible = false;
    observer.beginFrame();
    expect(observer.read(8)).toMatchObject({
      meshVisible: false,
      activeInstances: 4,
      submittedInstances: 0,
      uniqueSubmittedInstances: 0,
      visibleInstances: null,
    });
    mesh.visible = true;
    mesh.count = 0;
    observer.beginFrame();
    submit(0);
    expect(observer.read(8)).toMatchObject({ instanceDrawCalls: 0, submittedInstances: 0 });
    mesh.count = 4;
    observer.beginFrame();
    submit(2);
    expect(observer.read(8)).toMatchObject({
      configuredInstances: 8,
      activeInstances: 4,
      instanceDrawCalls: null,
      submittedInstances: null,
      uniqueSubmittedInstances: null,
    });
  });
}

test("instance observer restores owned callbacks, preserves later replacements and ignores late calls", () => {
  const { mesh, observer, before, after, draw } = harness("webgl2");
  const installedBefore = mesh.onBeforeRender;
  const installedAfter = mesh.onAfterRender;
  observer.beginFrame();
  observer.dispose();
  observer.dispose();
  expect(mesh.onBeforeRender).toBe(before);
  expect(mesh.onAfterRender).toBe(after);
  Reflect.apply(installedBefore, mesh, []);
  draw();
  Reflect.apply(installedAfter, mesh, []);
  expect(observer.read(4).submittedInstances).toBe(0);
  const replacement = vi.fn();
  mesh.onAfterRender = replacement;
  observer.dispose();
  expect(mesh.onAfterRender).toBe(replacement);
});
