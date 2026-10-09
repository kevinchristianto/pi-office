import fs from "node:fs";
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { createRoot, extend, _roots } from "@react-three/fiber";
import { createRoomLayout } from "../src/world";

const asset = vi.hoisted(() => ({ current: null as GLTF | null }));
// Keep the actual GLTF, React reconciler, useFrame and AnimationMixer. Only
// replace browser asset delivery and DOM labels; rendering pixels needs WebGL.
vi.mock("@react-three/drei", () => ({
  useGLTF: () => asset.current,
  ContactShadows: () => null,
  Html: () => null,
  OrbitControls: () => null,
  PerspectiveCamera: () => null,
}));
vi.mock("../src/AgentBubble", () => ({ default: () => null }));
import { Character } from "../src/Office";

type Props = React.ComponentProps<typeof Character>;
let root: ReturnType<typeof createRoot>;
let canvas: HTMLCanvasElement;
let props: Props;
let now: number;
let reduced: boolean;
let listeners: Set<() => void>;
let loaded: GLTF;

async function render() {
  await act(async () => {
    root.render(
      <React.StrictMode>
        <Character {...props} />
      </React.StrictMode>,
    );
  });
}
async function tick(frames: number) {
  await act(async () => {
    for (let i = 0; i < frames; i++) {
      now += 1 / 60;
      _roots.get(canvas)!.store.getState().advance(now, true);
    }
  });
}
function body() {
  return _roots.get(canvas)!.store.getState().scene.getObjectByName("Body")!;
}
function pose() {
  const values: number[] = [];
  body().traverse((node) => values.push(...node.position, ...node.quaternion));
  return values;
}
async function expectMoving() {
  await tick(30);
  const before = pose();
  await tick(21); // Avoid equal phases of a one-second looping clip.
  expect(pose().some((n, i) => Math.abs(n - before[i]) > 1e-6)).toBe(true);
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  now = 0;
  reduced = false;
  listeners = new Set();
  vi.spyOn(performance, "now").mockImplementation(() => now * 1000);
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  }));
  const bytes = fs.readFileSync("public/models/agent.glb");
  loaded = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, "");
  asset.current = loaded;
  extend(THREE);
  canvas = document.createElement("canvas");
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
    size: { width: 800, height: 600, top: 0, left: 0 },
  });
  props = {
    agent: { id: "agent1", name: "Test", state: "working" },
    desk: createRoomLayout("second-room", 1, 1).desks[0],
    roomId: "second-room",
    selected: false,
    onSelect() {},
    command: null,
    positions: { current: new Map() },
    reservations: { current: new Map() },
    index: 3,
  };
  await render();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("real character animation runtime", () => {
  it("keeps playing through focus, return to all rooms, and repeated reindexing", async () => {
    await expectMoving();
    const original = body();
    for (const index of [0, 3, 0, 3, 1, 0]) {
      props = {
        ...props,
        index,
        desk: createRoomLayout("second-room", index === 3 ? 1 : 0, 1).desks[0],
      };
      await render();
      expect(body().uuid).toBe(original.uuid);
      await expectMoving();
      expect(body().position.y).toBeLessThan(0.56);
    }
  });

  it("starts the same clip when a genuinely new rig replaces the loaded scene", async () => {
    await expectMoving();
    const original = body();
    asset.current = { ...loaded, scene: loaded.scene.clone(true) };
    await render();
    expect(body().uuid).not.toBe(original.uuid);
    await expectMoving();
    expect(body().position.y).toBeLessThan(0.56);
  });

  it("restarts the current action after effect cleanup stops the mixer", async () => {
    await expectMoving();
    props = { ...props, positions: { current: new Map() } };
    await render();
    await expectMoving();
    expect(body().position.y).toBeLessThan(0.56);
  });

  it("plays state changes, freezes reduced motion, and resumes", async () => {
    for (const state of [
      "working",
      "thinking",
      "waiting",
      "idle",
      "error",
      "completed",
      "working",
    ]) {
      props = { ...props, agent: { ...props.agent, state } };
      await render();
      await expectMoving();
    }
    await act(async () => {
      reduced = true;
      listeners.forEach((f) => f());
    });
    await tick(30);
    const frozen = pose();
    await tick(21);
    expect(pose()).toEqual(frozen);
    await act(async () => {
      reduced = false;
      listeners.forEach((f) => f());
    });
    await expectMoving();
    props = { ...props, agent: { ...props.agent, state: "offline" } };
    await render();
    await tick(30);
    const offline = pose();
    await tick(21);
    expect(pose()).toEqual(offline);
  });
});
