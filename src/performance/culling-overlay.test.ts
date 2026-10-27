import { Matrix4, WebGPUCoordinateSystem } from "three";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CullingBounds,
  CullingDiagnostics,
} from "../types/culling-types.ts";

import {
  CullingBoundsProjector,
  createCullingBoundsOverlay,
} from "./culling-overlay.ts";

const identity = new Matrix4().toArray();

function box(
  min: CullingBounds["min"],
  max: CullingBounds["max"],
): CullingBounds {
  return { label: "Test", min, max, culled: false };
}

function coordinates(projector: CullingBoundsProjector, count: number) {
  return [...projector.segments.subarray(0, count * 4)];
}

describe("main-view culling bounds projection", () => {
  it("projects a column-major world box to CSS pixels with downward screen y", () => {
    const projector = new CullingBoundsProjector();

    const count = projector.project(
      box([-0.4, -0.25, 0.2], [0.4, 0.25, 0.8]),
      identity,
      100,
      80,
    );

    expect(count).toBe(12);

    expect(coordinates(projector, count).slice(0, 4)).toEqual([30, 50, 70, 50]);

    const translated = new Matrix4().makeTranslation(0.2, 0.25, 0).toArray();

    projector.project(box([0, 0, 0.2], [0.2, 0.2, 0.8]), translated, 100, 80);

    expect(coordinates(projector, 1)).toEqual([60, 30, 70, 30]);
  });

  it("clips partially visible edges at viewport sides rather than drawing giant boxes", () => {
    const projector = new CullingBoundsProjector();

    const count = projector.project(
      box([0.5, -0.5, 0.2], [20, 0.5, 0.8]),
      identity,
      200,
      100,
    );

    expect(count).toBe(8);

    const screen = coordinates(projector, count);

    expect(screen.some((coordinate) => coordinate === 200)).toBe(true);

    for (let i = 0; i < screen.length; i++)
      expect(screen[i]).toBeGreaterThanOrEqual(0);

    for (let i = 0; i < screen.length; i++)
      expect(screen[i]).toBeLessThanOrEqual(i % 2 ? 100 : 200);
  });

  it("uses WebGPU's zero-to-one depth at both near and far clip planes", () => {
    const projector = new CullingBoundsProjector();

    expect(
      projector.project(
        box([-0.2, -0.2, -0.5], [0.2, 0.2, 0.2]),
        identity,
        100,
        100,
      ),
    ).toBe(8);

    expect(
      projector.project(
        box([-0.2, -0.2, 0.8], [0.2, 0.2, 1.5]),
        identity,
        100,
        100,
      ),
    ).toBe(8);

    expect(
      projector.project(
        box([-0.2, -0.2, -1], [0.2, 0.2, -0.5]),
        identity,
        100,
        100,
      ),
    ).toBe(0);

    expect(
      projector.project(
        box([-0.2, -0.2, 1.5], [0.2, 0.2, 2]),
        identity,
        100,
        100,
      ),
    ).toBe(0);
  });

  it("clips a box crossing the camera before homogeneous division", () => {
    const perspective = new Matrix4()
      .makePerspective(
        -0.1,
        0.1,
        0.1,
        -0.1,
        0.1,
        10,
        WebGPUCoordinateSystem,
        true,
      )
      .toArray();

    const projector = new CullingBoundsProjector();

    const count = projector.project(
      box([-0.05, -0.05, -0.5], [0.05, 0.05, 0.5]),
      perspective,
      300,
      200,
    );

    expect(count).toBeGreaterThan(0);

    for (const [i, value] of coordinates(projector, count).entries()) {
      expect(Number.isFinite(value)).toBe(true);

      expect(value).toBeGreaterThanOrEqual(0);

      expect(value).toBeLessThanOrEqual(i % 2 ? 200 : 300);
    }

    expect(
      projector.project(
        box([-0.05, -0.05, 0.1], [0.05, 0.05, 0.5]),
        perspective,
        300,
        200,
      ),
    ).toBe(0);
  });

  it("omits fully outside, nonfinite, reversed and singular bounds without invalid pixels", () => {
    const projector = new CullingBoundsProjector();

    expect(
      projector.project(box([2, 0, 0.2], [3, 0.2, 0.5]), identity, 100, 100),
    ).toBe(0);

    expect(
      projector.project(box([NaN, 0, 0.2], [3, 0.2, 0.5]), identity, 100, 100),
    ).toBe(0);

    expect(
      projector.project(box([2, 0, 0.2], [1, 0.2, 0.5]), identity, 100, 100),
    ).toBe(0);

    expect(
      projector.project(
        box([0, 0, 0.2], [1, 0.2, 0.5]),
        [...identity.slice(0, 15), Infinity],
        100,
        100,
      ),
    ).toBe(0);

    expect(
      projector.project(
        box([0, 0, 0.2], [1, 0.2, 0.5]),
        identity.slice(1),
        100,
        100,
      ),
    ).toBe(0);

    expect(
      projector.project(
        box([0, 0, 0.2], [1, 0.2, 0.5]),
        Array.from({ length: 16 }, () => 0),
        100,
        100,
      ),
    ).toBe(0);

    expect(
      projector.project(box([0, 0, 0.2], [1, 0.2, 0.5]), identity, 0, 100),
    ).toBe(0);
  });

  it("reuses fixed projection storage between bounds", () => {
    const projector = new CullingBoundsProjector();

    const output = projector.segments;

    projector.project(
      box([-0.4, -0.2, 0.2], [0.2, 0.2, 0.5]),
      identity,
      100,
      100,
    );

    const first = output[0];

    projector.project(
      box([0.2, -0.2, 0.2], [0.4, 0.2, 0.5]),
      identity,
      100,
      100,
    );

    expect(projector.segments).toBe(output);

    expect(output[0]).not.toBe(first);

    expect(output.length).toBe(48);
  });
});

afterEach(() => vi.unstubAllGlobals());

function overlayHost() {
  const context = {
    clearRect: vi.fn<CanvasRenderingContext2D["clearRect"]>(),
    setTransform: vi.fn<CanvasRenderingContext2D["setTransform"]>(),
    beginPath: vi.fn<CanvasRenderingContext2D["beginPath"]>(),
    moveTo: vi.fn<CanvasRenderingContext2D["moveTo"]>(),
    lineTo: vi.fn<CanvasRenderingContext2D["lineTo"]>(),
    stroke: vi.fn<CanvasRenderingContext2D["stroke"]>(),
    lineWidth: 0,
    strokeStyle: "",
  };

  const canvas = {
    className: "",
    width: 300,
    height: 150,
    dataset: {} as Record<string, string>,
    setAttribute: vi.fn<(name: string, value: string) => void>(),
    getContext: vi.fn<() => typeof context>(() => context),
    remove: vi.fn<() => void>(),
  };

  const viewport = {
    clientWidth: 300,
    clientHeight: 200,
    append: vi.fn<(...items: unknown[]) => void>(),
  };

  vi.stubGlobal("document", {
    createElement: vi.fn<() => typeof canvas>(() => canvas),
  });

  vi.stubGlobal("window", { devicePixelRatio: 2 });

  return {
    context,
    canvas,
    viewport,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The overlay reads only client dimensions and calls append on this minimal DOM fixture.
    overlay: createCullingBoundsOverlay(viewport as unknown as HTMLElement),
  };
}

function profile(bounds: readonly CullingBounds[]): CullingDiagnostics {
  return {
    enabled: true,
    debugBounds: true,
    main: { tested: bounds.length, visible: bounds.length, culled: 0 },
    shadow: { tested: 0, visible: 0, culled: 0 },
    reflection: { tested: 0, visible: 0, culled: 0 },
    bounds,
    boundsOmitted: 0,
    viewProjection: identity,
  };
}

describe("host-owned culling bounds overlay", () => {
  it("does no drawing or DOM mounting while debug bounds are off", () => {
    const { overlay, context, viewport, canvas } = overlayHost();

    overlay.refresh(undefined);

    overlay.refresh({ ...profile([]), debugBounds: false });

    overlay.refresh({ ...profile([]), viewProjection: null });

    expect(viewport.append).not.toHaveBeenCalled();

    expect(context.setTransform).not.toHaveBeenCalled();

    expect(context.clearRect).not.toHaveBeenCalled();

    expect(canvas.remove).not.toHaveBeenCalled();

    overlay.dispose();

    expect(canvas.remove).not.toHaveBeenCalled();
  });

  it("clears and unmounts on disable, remounts safely, and ignores refresh after disposal", () => {
    const { overlay, context, viewport, canvas } = overlayHost();

    const current = profile([box([-0.2, -0.2, 0.2], [0.2, 0.2, 0.5])]);

    overlay.refresh(current);

    expect(viewport.append).toHaveBeenCalledOnce();

    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);

    expect(canvas.width).toBe(600);

    expect(canvas.height).toBe(400);

    expect(canvas.dataset).toMatchObject({
      renderedBounds: "1",
      segments: "12",
    });

    overlay.refresh(undefined);

    expect(canvas.remove).toHaveBeenCalledOnce();

    const cleared = context.clearRect.mock.calls.length;

    overlay.refresh(undefined);

    expect(context.clearRect).toHaveBeenCalledTimes(cleared);

    overlay.refresh(current);

    expect(viewport.append).toHaveBeenCalledTimes(2);

    overlay.dispose();

    overlay.dispose();

    overlay.refresh(current);

    expect(canvas.remove).toHaveBeenCalledTimes(2);

    expect(viewport.append).toHaveBeenCalledTimes(2);
  });

  it("bounds projection work to 128 entries and omits invalid geometry", () => {
    const { overlay, context, canvas } = overlayHost();

    const current = box([-0.2, -0.2, 0.2], [0.2, 0.2, 0.5]);

    overlay.refresh(profile(Array.from({ length: 129 }, () => current)));

    expect(context.stroke).toHaveBeenCalledTimes(128);

    expect(canvas.dataset).toMatchObject({
      renderedBounds: "128",
      segments: "1536",
    });

    context.stroke.mockClear();

    overlay.refresh(profile([box([NaN, 0, 0], [1, 1, 1])]));

    expect(context.stroke).not.toHaveBeenCalled();

    expect(canvas.dataset).toMatchObject({
      renderedBounds: "0",
      segments: "0",
    });

    overlay.dispose();
  });
});
