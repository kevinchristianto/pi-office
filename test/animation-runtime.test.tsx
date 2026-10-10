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
import {
  residentModel,
  residentVariant,
  RESIDENT_SEATED_Y,
  RESIDENT_STANDING_Y,
} from "../src/appearance";

const asset = vi.hoisted(() => ({
  current: null as GLTF | null,
  paths: [] as string[],
}));
// Keep the actual GLTF, React reconciler, useFrame and AnimationMixer. Only
// replace browser asset delivery and DOM labels; rendering pixels needs WebGL.
vi.mock("@react-three/drei", () => ({
  useGLTF: (path: string) => {
    asset.paths.push(path);
    return asset.current;
  },
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
function palette() {
  const colors: string[] = [];
  body().traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial)
        colors.push(`${material.name}:${material.color.getHexString()}`);
    }
  });
  return colors;
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
  asset.paths = [];
  const bytes = fs.readFileSync(`public${residentModel("agent1")}`);
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
    const originalPalette = palette();
    expect(originalPalette.length).toBeGreaterThan(0);
    for (const index of [0, 3, 0, 3, 1, 0]) {
      props = {
        ...props,
        index,
        desk: createRoomLayout("second-room", index === 3 ? 1 : 0, 1).desks[0],
      };
      await render();
      expect(body().uuid).toBe(original.uuid);
      expect(palette()).toEqual(originalPalette);
      expect(new Set(asset.paths)).toEqual(
        new Set([residentModel(props.agent.id)]),
      );
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

  it("keeps its rig and model through repeated live field updates", async () => {
    const original = body();
    for (const state of ["thinking", "working", "waiting", "working"]) {
      props = {
        ...props,
        agent: {
          ...props.agent,
          state,
          name: "A newly reported display name",
          task: `Live ${state} update`,
          model: "updated-model",
          inputTokens: 4000,
        },
      };
      await render();
      expect(body().uuid).toBe(original.uuid);
      expect(new Set(asset.paths)).toEqual(
        new Set([residentModel(props.agent.id)]),
      );
      await expectMoving();
    }
  });

  it("evaluates wave, standing and walking commands without changing the reported task", async () => {
    const reported = { ...props.agent };
    props = {
      ...props,
      command: { id: props.agent.id, type: "wave", serial: 1 },
    };
    await render();
    await expectMoving();
    expect(body().position.y).toBeLessThan(0.65);
    expect(props.positions.current.get(props.agent.id)!.y).toBe(
      RESIDENT_SEATED_Y,
    );
    props = {
      ...props,
      command: { id: props.agent.id, type: "walk", serial: 2 },
    };
    await render();
    await expectMoving();
    expect(body().position.y).toBeGreaterThan(0.75);
    expect(props.positions.current.get(props.agent.id)).toBeDefined();
    expect(props.positions.current.get(props.agent.id)!.y).toBe(
      RESIDENT_STANDING_Y,
    );
    props = {
      ...props,
      command: { id: props.agent.id, type: "return", serial: 3 },
    };
    await render();
    await tick(180);
    expect(body().position.y).toBeLessThan(0.65);
    expect(props.positions.current.get(props.agent.id)!.y).toBe(
      RESIDENT_SEATED_Y,
    );
    expect(props.agent).toEqual(reported);
  });

  for (let variant = 0; variant < 8; variant++) {
    it(`plays resident variant ${variant + 1} after rig replacement and reduced-motion interruption`, async () => {
      const id = Array.from({ length: 256 }, (_, i) => `resident-${i}`).find(
        (id) => residentVariant(id) === variant,
      )!;
      const bytes = fs.readFileSync(`public${residentModel(id)}`);
      asset.current = await new GLTFLoader().parseAsync(
        Uint8Array.from(bytes).buffer,
        "",
      );
      props = { ...props, agent: { ...props.agent, id } };
      await render();
      expect(asset.paths.at(-1)).toBe(residentModel(id));
      await expectMoving();
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
      expect(pose().every(Number.isFinite)).toBe(true);
    });
  }
});
