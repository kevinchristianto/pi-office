import fs from "node:fs";
import React, { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { createRoot, extend, _roots } from "@react-three/fiber";
import { residentModel } from "../src/appearance";
import { createOfficeLayout } from "../src/world";
import { createBuildingEntryRoute } from "../src/lifecycleRoutes";
import { LIFECYCLE_CORRIDOR_KEY } from "../src/lifecycleWalking";

const asset = vi.hoisted(() => ({ current: null as GLTF | null }));
// Preserve the actual DOM portal, resident GLB, React reconciler and frame loop.
// Only asset transport, renderer output and unrelated scene components are stubbed.
vi.mock("@react-three/drei", async () => ({
  Html: (await import("@react-three/drei/web/Html.js")).Html,
  useGLTF: () => asset.current,
  ContactShadows: () => null,
  PerspectiveCamera: () => null,
  OrbitControls: () => null,
}));
import { Character } from "../src/Office";

type Props = React.ComponentProps<typeof Character>;
let root: ReturnType<typeof createRoot>;
let canvas: HTMLCanvasElement;
let host: HTMLDivElement;
let props: Props;
let now: number;
async function render() {
  await act(async () => {
    root.render(<Character {...props} />);
  });
}
async function tick(frames = 1) {
  await act(async () => {
    for (let index = 0; index < frames; index++) {
      now += 1 / 60;
      _roots.get(canvas)!.store.getState().advance(now, true);
    }
  });
}
function actor() {
  return _roots
    .get(canvas)!
    .store.getState()
    .scene.getObjectByName("resident-bubble-review")!;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now * 1000);
  const bytes = fs.readFileSync(`public${residentModel("bubble-review")}`);
  asset.current = await new GLTFLoader().parseAsync(
    Uint8Array.from(bytes).buffer,
    "",
  );
  extend(THREE);
  host = document.createElement("div");
  canvas = document.createElement("canvas");
  host.append(canvas);
  document.body.append(host);
  root = createRoot(canvas);
  const renderer = {
    render() {},
    setSize() {},
    setPixelRatio() {},
    domElement: canvas,
    shadowMap: {},
    xr: { addEventListener() {}, removeEventListener() {} },
  };
  await root.configure({
    gl: renderer as unknown as THREE.WebGLRenderer,
    frameloop: "never",
    camera: new THREE.PerspectiveCamera(42, 800 / 600, 0.1, 250),
    size: { width: 800, height: 600, top: 0, left: 0 },
  });
  const camera = _roots.get(canvas)!.store.getState().camera;
  camera.position.set(0, 14, 25);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const room = createOfficeLayout([{ id: "room", agentCount: 1 }])[0];
  props = {
    agent: { id: "bubble-review", name: "Visible resident", state: "working" },
    desk: room.desks[0],
    roomId: room.id,
    selected: true,
    onSelect() {},
    command: null,
    positions: { current: new Map() },
    reservations: { current: new Map() },
    index: 0,
    lifecycleRoute: createBuildingEntryRoute([room], room, room.desks[0]),
  };
  await render();
  await tick(1);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.style.cursor = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("removes the real HTML bubble while a selected arrival is hidden outside", async () => {
  expect(host.querySelector(".bubble-trigger")).not.toBeNull();
  props.reservations.current.set(LIFECYCLE_CORRIDOR_KEY, "other");
  props = {
    ...props,
    transition: { direction: "arriving", token: "start", queueIndex: 0 },
  };
  await render();
  expect(actor().visible).toBe(false);
  expect(host.querySelector(".bubble-trigger")).toBeNull();
  await tick(30);
  expect(host.querySelector(".bubble-trigger")).toBeNull();
  props.reservations.current.delete(LIFECYCLE_CORRIDOR_KEY);
  await tick(1);
  expect(actor().visible).toBe(true);
  expect(host.querySelector(".bubble-trigger")).not.toBeNull();
});

it("removes the real HTML bubble after a departure reaches the exterior", async () => {
  const completed = vi.fn();
  props = {
    ...props,
    transition: { direction: "exiting", token: "stop", queueIndex: 0 },
    onLifecycleComplete: completed,
  };
  await render();
  await tick(1);
  expect(actor().visible).toBe(true);
  expect(host.querySelector(".bubble-trigger")).not.toBeNull();
  await tick(2000);
  expect(completed).toHaveBeenCalledExactlyOnceWith("stop", "exiting");
  expect(actor().visible).toBe(false);
  expect(host.querySelector(".bubble-trigger")).toBeNull();
});

it("preserves the same HTML bubble when an unrendered seated stop is canceled", async () => {
  const trigger = host.querySelector(".bubble-trigger");
  props = {
    ...props,
    transition: { direction: "exiting", token: "stop", queueIndex: 0 },
  };
  await render();
  props = {
    ...props,
    transition: { direction: "arriving", token: "restart", queueIndex: 0 },
  };
  await render();
  await tick(1);
  expect(actor().visible).toBe(true);
  expect(host.querySelector(".bubble-trigger")).toBe(trigger);
});

it("does not select or intercept pointer events for an invisible queued rig", async () => {
  const selected = vi.fn();
  props.reservations.current.set(LIFECYCLE_CORRIDOR_KEY, "other");
  props = {
    ...props,
    onSelect: selected,
    transition: { direction: "arriving", token: "start", queueIndex: 0 },
  };
  await render();
  await tick(30);
  expect(actor().visible).toBe(false);
  actor().updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(actor());
  const center = bounds.getCenter(new THREE.Vector3());
  const ray = new THREE.Raycaster(
    center.clone().add(new THREE.Vector3(0, 0, 10)),
    new THREE.Vector3(0, 0, -1),
  );
  // Three's raycaster still intersects an invisible parent and its geometry.
  expect(ray.intersectObject(actor(), true).length).toBeGreaterThan(0);
  const interaction = actor().children[0] as THREE.Object3D & {
    __r3f: { handlers: Record<string, (event: any) => void> };
  };
  const event = { delta: 0, stopPropagation: vi.fn() };
  interaction.__r3f.handlers.onClick(event);
  expect(selected).not.toHaveBeenCalled();
  expect(event.stopPropagation).not.toHaveBeenCalled();
  document.body.style.cursor = "auto";
  interaction.__r3f.handlers.onPointerOver(event);
  expect(document.body.style.cursor).toBe("auto");
  expect(event.stopPropagation).not.toHaveBeenCalled();
  props.reservations.current.delete(LIFECYCLE_CORRIDOR_KEY);
  await tick(1);
  expect(actor().visible).toBe(true);
  interaction.__r3f.handlers.onClick(event);
  expect(selected).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
});

it("restores the body's previous cursor when a hovered actor is hidden or unmounted", async () => {
  const hover = () =>
    act(() => {
      const interaction = actor().children[0] as THREE.Object3D & {
        __r3f: { handlers: Record<string, (event: any) => void> };
      };
      interaction.__r3f.handlers.onPointerOver({ stopPropagation() {} });
    });
  document.body.style.cursor = "crosshair";
  hover();
  expect(document.body.style.cursor).toBe("pointer");
  props.reservations.current.set(LIFECYCLE_CORRIDOR_KEY, "other");
  props = {
    ...props,
    transition: { direction: "arriving", token: "start", queueIndex: 0 },
  };
  await render();
  expect(actor().visible).toBe(false);
  expect(document.body.style.cursor).toBe("crosshair");
  props.reservations.current.delete(LIFECYCLE_CORRIDOR_KEY);
  await tick(1);
  hover();
  expect(document.body.style.cursor).toBe("pointer");
  await act(async () => root.render(<group />));
  expect(document.body.style.cursor).toBe("crosshair");
});

it("keeps the new hovered actor's cursor when the previous owner unmounts", async () => {
  const second = { ...props, agent: { ...props.agent, id: "second" } };
  await act(async () =>
    root.render(
      <>
        <Character key="first" {...props} />
        <Character key="second" {...second} />
      </>,
    ),
  );
  const scene = _roots.get(canvas)!.store.getState().scene;
  const handlers = (name: string) =>
    (
      scene.getObjectByName(name)!.children[0] as THREE.Object3D & {
        __r3f: { handlers: Record<string, (event: any) => void> };
      }
    ).__r3f.handlers;
  document.body.style.cursor = "crosshair";
  act(() => {
    handlers("resident-bubble-review").onPointerOver({ stopPropagation() {} });
    handlers("resident-second").onPointerOver({ stopPropagation() {} });
  });
  expect(document.body.style.cursor).toBe("pointer");
  await act(async () =>
    root.render(
      <>
        <Character key="second" {...second} />
      </>,
    ),
  );
  expect(document.body.style.cursor).toBe("pointer");
  await act(async () => root.render(<group />));
  expect(document.body.style.cursor).toBe("crosshair");
});
