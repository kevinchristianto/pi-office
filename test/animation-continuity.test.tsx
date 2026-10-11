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
import { residentModel } from "../src/appearance";

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
function resident() {
  return _roots
    .get(canvas)!
    .store.getState()
    .scene.getObjectByName(`resident-${props.agent.id}`)!;
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

describe("snapshot animation continuity", () => {
  it("preserves rig, current clip time and transform through repeated metadata updates", async () => {
    const reset = vi.spyOn(THREE.AnimationAction.prototype, "reset");
    const stop = vi.spyOn(THREE.AnimationMixer.prototype, "stopAllAction");
    await tick(31);
    const original = body();
    const resets = reset.mock.calls.length;
    const stops = stop.mock.calls.length;
    for (let frame = 0; frame < 24; frame++) {
      const before = pose();
      const location = resident().position.toArray();
      props = {
        ...props,
        agent: { ...props.agent, task: `Token ${frame}`, outputTokens: frame },
        desk: {
          ...props.desk,
          route: props.desk.route.map((point) => [...point]),
        },
      };
      await render();
      expect(body()).toBe(original);
      expect(pose()).toEqual(before);
      expect(resident().position.toArray()).toEqual(location);
      await tick(1);
      expect(reset.mock.calls.length).toBe(resets);
      expect(stop.mock.calls.length).toBe(stops);
    }
  });

  for (const [intermediate, target] of [
    ["thinking", "waiting"],
    ["thinking", "working"],
    ["idle", "offline"],
    ["offline", "working"],
    ["waiting", "idle"],
  ]) {
    it(`keeps the exact pose through working → ${intermediate} → ${target} with an interrupted blend`, async () => {
      await tick(31);
      props = { ...props, agent: { ...props.agent, state: intermediate } };
      await render();
      await tick(3);
      const before = pose();
      const rotations = new Map<string, THREE.Quaternion>();
      body().traverse((node) =>
        rotations.set(node.uuid, node.quaternion.clone().normalize()),
      );
      props = { ...props, agent: { ...props.agent, state: target } };
      await render();
      await act(async () => {
        _roots.get(canvas)!.store.getState().advance(now, true);
      });
      const maximumJump = Math.max(
        ...pose().map((value, i) => Math.abs(value - before[i])),
      );
      expect(maximumJump).toBeLessThan(1e-6);
      body().traverse((node) =>
        expect(
          node.quaternion
            .clone()
            .normalize()
            .angleTo(rotations.get(node.uuid)!),
        ).toBeLessThan(1e-6),
      );
      await tick(30);
      expect(body().position.y).toBeLessThan(0.65);
    });
  }

  it("retains the phase of an outgoing work clip when a quick update selects it again", async () => {
    const played = vi.spyOn(THREE.AnimationAction.prototype, "play");
    await tick(31);
    const work = played.mock.instances.find(
      (action) => action.getClip().name.toLowerCase() === "work",
    )!;
    props = { ...props, agent: { ...props.agent, state: "thinking" } };
    await render();
    await tick(3);
    const phase = work.time;
    props = { ...props, agent: { ...props.agent, state: "working" } };
    await render();
    await act(async () => {
      _roots.get(canvas)!.store.getState().advance(now, true);
    });
    expect(work.time).toBe(phase);
    await tick(1);
    expect(work.time).toBeCloseTo(phase + 1 / 60);
  });

  it("starts in the authored seated pose without fading through the standing bind pose", async () => {
    await tick(1);
    expect(body().position.y).toBeLessThan(0.65);
  });
});
