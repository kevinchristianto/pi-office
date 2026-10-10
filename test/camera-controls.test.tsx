import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createRoot, _roots } from "@react-three/fiber";
// Use Drei’s ESM entry so its real controls and the test camera share one Three runtime.
vi.mock(
  "@react-three/drei",
  () => import("@react-three/drei/core/OrbitControls.js"),
);
import CameraRig, { type CameraRigProps } from "../src/CameraRig";
import {
  CAMERA_MIN_DISTANCE,
  CAMERA_MAX_POLAR,
  CAMERA_MIN_POLAR,
  cameraEase,
  cameraKey,
  cameraPan,
  cameraWheelScale,
  constrainCameraTarget,
  fitOfficeCamera,
  officeCameraBounds,
} from "../src/camera";

describe("bounded camera math", () => {
  it("clamps the camera and target together without changing the view direction", () => {
    const target = new THREE.Vector3(200, 0.85, -200);
    const position = target.clone().add(new THREE.Vector3(4, 5, 6));
    constrainCameraTarget(position, target, officeCameraBounds(2));
    expect(target.toArray()).toEqual([20.5, 0.85, -5.5]);
    expect(position.clone().sub(target).toArray()).toEqual([4, 5, 6]);
  });
  it("normalizes diagonal pan, cancels opposites, and bounds hidden-tab delta", () => {
    const backward = new THREE.Vector3(3, 4, 5);
    const straight = cameraPan(new Set(["w"]), backward, 10, 1 / 60);
    const diagonal = cameraPan(new Set(["w", "d"]), backward, 10, 1 / 60);
    expect(diagonal.length()).toBeCloseTo(straight.length());
    expect(cameraPan(new Set(["w", "s"]), backward, 10, 1).length()).toBe(0);
    expect(
      cameraPan(new Set(["w"]), backward, 100, 100).length(),
    ).toBeLessThanOrEqual(1.200001);
    expect(diagonal.y).toBe(0);
  });
  it("eases consistently across frame rates and honors reduced motion", () => {
    expect(1 - Math.pow(1 - cameraEase(1 / 60), 60)).toBeCloseTo(
      1 - Math.pow(1 - cameraEase(1 / 30), 30),
    );
    expect(cameraEase(200)).toBe(cameraEase(0.1));
    expect(cameraEase(-1)).toBe(0);
    expect(cameraEase(0.016, true)).toBe(1);
  });
  it("normalizes fine trackpad, line and page wheel events with bounded steps", () => {
    expect(cameraWheelScale(16, 0, 600)).toBeCloseTo(
      cameraWheelScale(1, 1, 600),
    );
    expect(cameraWheelScale(1, 0, 600)).toBeLessThan(
      cameraWheelScale(20, 0, 600),
    );
    expect(cameraWheelScale(1, 2, 600)).toBeLessThan(1.55);
    expect(cameraWheelScale(-100000, 0, 600)).toBeGreaterThan(0.64);
    expect(cameraWheelScale(NaN, 0, 600)).toBe(1);
  });
  it("handles uppercase pan keys while leaving other page shortcuts alone", () => {
    expect(cameraKey("W")).toBe("pan");
    expect(cameraKey("ArrowUp")).toBe("pan");
    expect(cameraKey("+")).toBe("zoom-in");
    expect(cameraKey("_")).toBe("zoom-out");
    expect(cameraKey("Home")).toBe("reset");
    for (const key of ["Tab", "Escape", "f", "Enter", " "])
      expect(cameraKey(key)).toBeNull();
  });
  it("produces finite safe fits for missing dimensions and invalid counts", () => {
    for (const count of [0, -1, NaN, Infinity, 100]) {
      const fit = fitOfficeCamera(NaN, 0, count);
      expect(fit.position.every(Number.isFinite)).toBe(true);
      expect(fit.target.every(Number.isFinite)).toBe(true);
    }
  });
});

let root: ReturnType<typeof createRoot>;
let canvas: HTMLCanvasElement;
let props: CameraRigProps;
let now: number;
let reduced: boolean;
let mediaListeners: Set<() => void>;
function state() {
  return _roots.get(canvas)!.store.getState();
}
function camera() {
  return state().camera;
}
function controls() {
  return state().controls as any;
}
async function render() {
  await act(async () => {
    root.render(
      <React.StrictMode>
        <CameraRig {...props} />
      </React.StrictMode>,
    );
  });
}
async function tick(frames = 1, delta = 1 / 60) {
  await act(async () => {
    for (let i = 0; i < frames; i++) {
      now += delta;
      state().advance(now, true);
    }
  });
}
function key(
  key: string,
  extra: KeyboardEventInit = {},
  target: EventTarget = canvas,
) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
function pose() {
  return [...camera().position, ...controls().target];
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  now = 0;
  reduced = false;
  mediaListeners = new Set();
  vi.spyOn(performance, "now").mockImplementation(() => now * 1000);
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, listener: () => void) =>
      mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      mediaListeners.delete(listener),
  }));
  canvas = document.createElement("canvas");
  document.body.append(canvas);
  Object.defineProperties(canvas, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  });
  canvas.releasePointerCapture = vi.fn();
  const renderer = {
    render() {},
    setSize() {},
    setPixelRatio() {},
    domElement: canvas,
    shadowMap: {},
    xr: { addEventListener() {}, removeEventListener() {} },
  };
  root = createRoot(canvas);
  await root.configure({
    gl: renderer as unknown as THREE.WebGLRenderer,
    frameloop: "never",
    camera: new THREE.PerspectiveCamera(42, 800 / 600, 0.1, 250),
    size: { width: 800, height: 600, top: 0, left: 0 },
  });
  props = {
    count: 2,
    reset: 0,
    follow: null,
    cameraAction: null,
    positions: { current: new Map([["nova", new THREE.Vector3(-2, 0, 2)]]) },
    onStopFollow: vi.fn(),
  };
  await render();
  await tick();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  canvas?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("camera rig with real R3F and OrbitControls (renderer stubbed)", () => {
  it("starts with a full fit and explicit keyboard/accessibility entry", () => {
    const fit = fitOfficeCamera(800, 600, 2);
    expect(
      camera().position.distanceTo(new THREE.Vector3(...fit.position)),
    ).toBeLessThan(0.0001);
    expect(controls().target.toArray()).toEqual(fit.target);
    expect(canvas.tabIndex).toBe(0);
    expect(canvas.getAttribute("aria-label")).toBe("Office camera");
    expect(canvas.getAttribute("aria-describedby")).toBe("camera-instructions");
    expect(controls().screenSpacePanning).toBe(false);
    expect(controls().minDistance).toBe(CAMERA_MIN_DISTANCE);
    expect(controls().minPolarAngle).toBe(CAMERA_MIN_POLAR);
    expect(controls().maxPolarAngle).toBe(CAMERA_MAX_POLAR);
  });
  it("does not reframe on resize, count changes, or new live callback identities", async () => {
    camera().position.add(new THREE.Vector3(2, 0, 1));
    controls().target.add(new THREE.Vector3(2, 0, 1));
    controls().update();
    const before = pose();
    await act(async () => {
      state().setSize(390, 844);
    });
    props = { ...props, count: 4, onStopFollow: vi.fn() };
    await render();
    await tick(10);
    expect(pose()).toEqual(before);
    props = { ...props, count: 1 };
    await render();
    await tick(10);
    expect(pose()).toEqual(before);
    props = { ...props, reset: 1 };
    await render();
    await tick(120);
    expect(controls().target.x).toBeCloseTo(0, 2);
    expect(
      camera().position.distanceTo(
        new THREE.Vector3(...fitOfficeCamera(390, 844, 1).position),
      ),
    ).toBeLessThan(0.01);
  });
  it("keeps a four-section portrait fit clear of fog and the far clipping plane", async () => {
    state().scene.fog = new THREE.Fog("#a5b5a0", 48, 115);
    await act(async () => {
      state().setSize(390, 844);
    });
    props = { ...props, count: 4, reset: 1 };
    await render();
    await tick(150);
    const distance = camera().position.distanceTo(controls().target);
    expect(distance).toBeGreaterThan(180);
    expect((state().scene.fog as THREE.Fog).near).toBeGreaterThan(
      distance + 15,
    );
    expect((camera() as THREE.PerspectiveCamera).far).toBeGreaterThan(
      distance + 80,
    );
  });
  it("scopes keys to canvas, prevents page scroll, and clears held keys on blur", async () => {
    const start = pose();
    key("w", {}, window);
    await tick(10);
    expect(pose()).toEqual(start);
    canvas.focus();
    expect(key("W").defaultPrevented).toBe(true);
    await tick(10);
    expect(pose()).not.toEqual(start);
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const stopped = pose();
    expect(key("ArrowDown", {}, button).defaultPrevented).toBe(false);
    await tick(10);
    expect(pose()).toEqual(stopped);
    button.remove();
    expect(key("+", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("Tab").defaultPrevented).toBe(false);
  });
  it("stays within world bounds after keyboard pan and orbital damping", async () => {
    canvas.focus();
    key("d");
    await tick(1800);
    expect(controls().target.x).toBeLessThanOrEqual(20.5);
    expect(controls().target.z).toBeGreaterThanOrEqual(-5.5);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "d" }));
    controls().target.set(500, 0.95, -100);
    camera().position.set(504, 5.95, -94);
    await tick(5);
    expect(controls().target.x).toBeLessThanOrEqual(20.5);
    expect(controls().target.z).toBeGreaterThanOrEqual(-5.5);
    expect(
      camera()
        .position.clone()
        .sub(controls().target)
        .distanceTo(new THREE.Vector3(4, 5, 6)),
    ).toBeLessThan(0.000001);
  });
  it("frames once, then follows only after an explicit follow request", async () => {
    props = {
      ...props,
      cameraAction: { type: "focus", id: "nova", serial: 1 },
    };
    await render();
    await tick(140);
    expect(controls().target.toArray()).toEqual([-2, 0.85, 2]);
    expect(camera().position.distanceTo(controls().target)).toBeCloseTo(9);
    props.positions.current.set("nova", new THREE.Vector3(1, 0, 3));
    await tick(30);
    expect(controls().target.toArray()).toEqual([-2, 0.85, 2]);
    props = { ...props, follow: "nova" };
    await render();
    await tick(140);
    expect(controls().target.x).toBeCloseTo(1);
    expect(controls().target.z).toBeCloseTo(3);
    const beforeWheelDistance = camera().position.distanceTo(controls().target);
    const wheel = new WheelEvent("wheel", { deltaY: 50, cancelable: true });
    canvas.dispatchEvent(wheel);
    expect(props.onStopFollow).toHaveBeenCalledTimes(1);
    expect(wheel.defaultPrevented).toBe(true);
    expect(camera().position.distanceTo(controls().target)).toBeCloseTo(
      beforeWheelDistance,
    );
    await tick(5);
    expect(camera().position.distanceTo(controls().target)).toBeGreaterThan(
      beforeWheelDistance,
    );
    const afterManual = controls().target.clone();
    props.positions.current.set("nova", new THREE.Vector3(-4, 0, -3));
    await tick(30);
    expect(controls().target.distanceTo(afterManual)).toBeLessThan(0.001);
  });
  it("interrupts an unfinished focus with manual input without a delayed snap", async () => {
    props = {
      ...props,
      cameraAction: { type: "focus", id: "nova", serial: 1 },
    };
    await render();
    await tick(2);
    canvas.focus();
    key("w");
    await tick(5);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
    const stopped = pose();
    await tick(180);
    pose().forEach((value, index) =>
      expect(value).toBeCloseTo(stopped[index], 8),
    );
  });
  it("accumulates repeated zoom buttons, bounds distance, and fits with Home", async () => {
    const distance = camera().position.distanceTo(controls().target);
    for (let serial = 1; serial <= 2; serial++) {
      props = { ...props, cameraAction: { type: "zoom-in", serial } };
      await render();
    }
    await tick(140);
    expect(camera().position.distanceTo(controls().target)).toBeCloseTo(
      distance * 0.78 ** 2,
    );
    for (let serial = 3; serial <= 20; serial++) {
      props = { ...props, cameraAction: { type: "zoom-in", serial } };
      await render();
    }
    await tick(140);
    expect(camera().position.distanceTo(controls().target)).toBeCloseTo(
      CAMERA_MIN_DISTANCE,
    );
    canvas.focus();
    expect(key("Home").defaultPrevented).toBe(true);
    await tick(140);
    expect(camera().position.distanceTo(controls().target)).toBeCloseTo(
      distance,
    );
  });
  it("removes easing/inertia for reduced motion and handles preference changes", async () => {
    reduced = true;
    await act(async () => {
      mediaListeners.forEach((listener) => listener());
    });
    expect(controls().enableDamping).toBe(false);
    props = {
      ...props,
      cameraAction: { type: "focus", id: "nova", serial: 1 },
    };
    await render();
    await tick();
    expect(controls().target.toArray()).toEqual([-2, 0.85, 2]);
    reduced = false;
    await act(async () => {
      mediaListeners.forEach((listener) => listener());
    });
    expect(controls().enableDamping).toBe(true);
  });
  it("wheel zoom interrupts focus at the current target and accumulates smoothly", async () => {
    props = {
      ...props,
      cameraAction: { type: "focus", id: "nova", serial: 1 },
    };
    await render();
    await tick(3);
    const target = controls().target.clone();
    const distance = camera().position.distanceTo(target);
    for (let i = 0; i < 3; i++)
      canvas.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -30, cancelable: true }),
      );
    expect(camera().position.distanceTo(target)).toBeCloseTo(distance);
    await tick(140);
    expect(controls().target.distanceTo(target)).toBeLessThan(0.000001);
    expect(camera().position.distanceTo(target)).toBeCloseTo(
      distance * cameraWheelScale(-30, 0, 600) ** 3,
    );
  });
  it("leaves modified wheel browser zoom and panel scrolling untouched", async () => {
    const before = pose();
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const event = new WheelEvent("wheel", {
        deltaY: -100,
        cancelable: true,
        ...modifier,
      });
      canvas.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    const panel = document.createElement("div");
    document.body.append(panel);
    const scroll = new WheelEvent("wheel", {
      deltaY: 100,
      bubbles: true,
      cancelable: true,
    });
    panel.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);
    await tick(60);
    pose().forEach((value, index) =>
      expect(value).toBeCloseTo(before[index], 8),
    );
    panel.remove();
  });
  it("real pointer orbit/pan stays bounded through release, damping, and cancellation", async () => {
    const pointer = (
      type: string,
      x: number,
      y: number,
      button = 0,
      target: EventTarget = canvas,
    ) => {
      const event = new MouseEvent(type, {
        clientX: x,
        clientY: y,
        button,
        bubbles: true,
      });
      Object.defineProperties(event, {
        pointerId: { value: 1 },
        pointerType: { value: "mouse" },
      });
      act(() => {
        target.dispatchEvent(event);
      });
    };
    expect(controls().domElement).toBe(canvas);
    const initialAngle = controls().getAzimuthalAngle();
    pointer("pointerdown", 200, 200);
    expect(document.activeElement).toBe(canvas);
    pointer("pointermove", 430, 100, 0, document);
    pointer("pointerup", 430, 100, 0, document);
    await tick(60);
    expect(controls().getAzimuthalAngle()).not.toBeCloseTo(initialAngle);
    expect(controls().getPolarAngle()).toBeGreaterThanOrEqual(CAMERA_MIN_POLAR);
    expect(controls().getPolarAngle()).toBeLessThanOrEqual(CAMERA_MAX_POLAR);
    pointer("pointerdown", 200, 200, 2);
    pointer("pointermove", -100000, 100000, 2, document);
    pointer("pointercancel", -100000, 100000, 2);
    for (let i = 0; i < 30; i++) {
      await tick();
      expect(controls().target.x).toBeGreaterThanOrEqual(-6.5);
      expect(controls().target.x).toBeLessThanOrEqual(20.5);
      expect(controls().target.z).toBeGreaterThanOrEqual(-5.5);
      expect(controls().target.z).toBeLessThanOrEqual(6);
    }
    const target = controls().target.clone();
    pointer("pointermove", 400, 200, 2, document);
    await tick(20);
    expect(controls().target.distanceTo(target)).toBeLessThan(0.001);
  });
  it("cleans up focus attributes and keyboard listeners on unmount", async () => {
    await act(async () => root.unmount());
    expect(canvas.hasAttribute("tabindex")).toBe(false);
    expect(canvas.hasAttribute("aria-label")).toBe(false);
    expect(key("ArrowUp").defaultPrevented).toBe(false);
  });
});
