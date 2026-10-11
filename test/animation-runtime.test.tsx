import fs from "node:fs";
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { createRoot, extend, _roots } from "@react-three/fiber";
import {
  createRoomLayout,
  createOfficeLayout,
  routeLength,
} from "../src/world";
import {
  createBuildingEntryRoute,
  LIFECYCLE_WALK_SPEED,
} from "../src/lifecycleRoutes";
import { LIFECYCLE_CORRIDOR_KEY } from "../src/lifecycleWalking";
import { WALK_GAIT_RATE, WALK_SPEED, WALK_TURN_SPEED } from "../src/motion";
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
import { Asset, Character } from "../src/Office";

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
function resident() {
  return _roots
    .get(canvas)!
    .store.getState()
    .scene.getObjectByName(`resident-${props.agent.id}`)!;
}
function lifecycleProps(direction: "arriving" | "exiting", token = "trip") {
  const room = createOfficeLayout([{ id: props.roomId, agentCount: 6 }])[0];
  const desk = room.desks[0];
  const route = createBuildingEntryRoute([room], room, desk);
  return {
    desk,
    lifecycleRoute: route,
    transition: { direction, token, queueIndex: 0 },
  };
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
  it("faces each opposite desk direction while preserving the original rig and materials", async () => {
    const original = body();
    const originalPalette = palette();
    const room = createOfficeLayout([{ id: props.roomId, agentCount: 6 }])[0];
    for (const index of [0, 3, 1, 4, 0]) {
      props = { ...props, desk: room.desks[index] };
      await render();
      await tick(20);
      expect(
        Math.sin((resident().rotation.y - props.desk.orientation) / 2),
      ).toBeCloseTo(0);
      expect(body().uuid).toBe(original.uuid);
      expect(palette()).toEqual(originalPalette);
      expect(resident().position.toArray()).toEqual([
        props.desk.seat[0],
        RESIDENT_SEATED_Y,
        props.desk.seat[1],
      ]);
    }
  });

  it("walks in at full scale with the real GLB walk clip, then sits and works", async () => {
    const complete = vi.fn();
    props = {
      ...props,
      ...lifecycleProps("arriving"),
      onLifecycleComplete: complete,
    };
    await render();
    expect(resident().visible).toBe(false);
    await tick(40);
    expect(resident().visible).toBe(true);
    expect(resident().scale.toArray()).toEqual([1, 1, 1]);
    expect(resident().userData.lifecycle.phase).toBe("walking");
    expect(body().position.y).toBeGreaterThan(0.75);
    const before = pose();
    await tick(17);
    expect(pose()).not.toEqual(before);
    expect(complete).not.toHaveBeenCalled();
    await tick(
      Math.ceil(
        (routeLength(props.lifecycleRoute!) / LIFECYCLE_WALK_SPEED) * 60,
      ) + 30,
    );
    expect(complete).toHaveBeenCalledExactlyOnceWith("trip", "arriving");
    expect(
      resident().position.distanceTo(
        new THREE.Vector3(
          props.desk.seat[0],
          RESIDENT_SEATED_Y,
          props.desk.seat[1],
        ),
      ),
    ).toBeLessThan(1e-8);
    expect(body().position.y).toBeLessThan(0.65);
    props = { ...props, transition: undefined, lifecycleRoute: undefined };
    await render();
    await expectMoving();
    expect(
      Math.sin((resident().rotation.y - props.desk.orientation) / 2),
    ).toBeCloseTo(0);
  });

  it("stands, walks the full departure, then hides only outside, without scaling", async () => {
    const complete = vi.fn();
    props = {
      ...props,
      ...lifecycleProps("exiting"),
      onLifecycleComplete: complete,
    };
    await render();
    await tick(1);
    expect(resident().userData.lifecycle.phase).toBe("standing");
    expect(resident().position.x).toBeCloseTo(props.desk.seat[0]);
    await tick(40);
    expect(resident().userData.lifecycle.phase).toBe("walking");
    expect(resident().visible).toBe(true);
    expect(resident().scale.toArray()).toEqual([1, 1, 1]);
    expect(complete).not.toHaveBeenCalled();
    await tick(
      Math.ceil(
        (routeLength(props.lifecycleRoute!) / LIFECYCLE_WALK_SPEED) * 60,
      ) + 60,
    );
    expect(complete).toHaveBeenCalledExactlyOnceWith("trip", "exiting");
    expect(resident().visible).toBe(false);
    expect(resident().position.x).toBe(props.lifecycleRoute![0][0]);
    expect(resident().position.z).toBe(props.lifecycleRoute![0][1]);
    expect(props.positions.current.has(props.agent.id)).toBe(false);
    expect(props.reservations.current.size).toBe(0);
  });

  it("reverses an interrupted departure in place and ignores the obsolete completion", async () => {
    const complete = vi.fn();
    props = {
      ...props,
      ...lifecycleProps("exiting", "stop"),
      onLifecycleComplete: complete,
    };
    await render();
    await tick(100);
    const position = resident().position.clone();
    props = {
      ...props,
      transition: {
        ...props.transition!,
        direction: "arriving",
        token: "restart",
      },
    };
    await render();
    await tick(1);
    expect(resident().position.distanceTo(position)).toBeLessThanOrEqual(
      WALK_SPEED / 60 + 1e-10,
    );
    await tick(140);
    expect(complete).toHaveBeenCalledExactlyOnceWith("restart", "arriving");
    expect(resident().visible).toBe(true);
    expect(resident().position.x).toBeCloseTo(props.desk.seat[0]);
  });

  it("freezes the active route across unrelated route-prop replacements", async () => {
    const complete = vi.fn();
    props = {
      ...props,
      ...lifecycleProps("arriving"),
      onLifecycleComplete: complete,
    };
    await render();
    await tick(60);
    const before = resident().position.clone();
    const originalEnd = props.lifecycleRoute!.at(-1)!;
    props = {
      ...props,
      lifecycleRoute: props.lifecycleRoute!.map(([x, z]) => [x + 50, z + 50]),
    };
    await render();
    await tick(1);
    expect(resident().position.distanceTo(before)).toBeLessThanOrEqual(
      WALK_SPEED / 60 + 1e-10,
    );
    await tick(2000);
    expect(resident().position.x).toBeCloseTo(originalEnd[0]);
    expect(resident().position.z).toBeCloseTo(originalEnd[1]);
    expect(complete).toHaveBeenCalledExactlyOnceWith("trip", "arriving");
  });

  it("consumes in-flight cosmetic commands without replaying them after arrival", async () => {
    props = { ...props, ...lifecycleProps("arriving") };
    await render();
    await tick(20);
    props = {
      ...props,
      command: { id: props.agent.id, type: "walk", serial: 101 },
    };
    await render();
    await tick(2000);
    props = { ...props, transition: undefined, lifecycleRoute: undefined };
    await render();
    await tick(180);
    expect(
      resident().position.distanceTo(
        new THREE.Vector3(
          props.desk.seat[0],
          RESIDENT_SEATED_Y,
          props.desk.seat[1],
        ),
      ),
    ).toBeLessThan(1e-8);
    expect(props.reservations.current.size).toBe(0);
  });

  it("keeps waiting arrivals offsite and releases shared traffic when their actor unmounts", async () => {
    props.reservations.current.set(LIFECYCLE_CORRIDOR_KEY, "other");
    props = { ...props, ...lifecycleProps("arriving") };
    await render();
    await tick(120);
    expect(resident().visible).toBe(false);
    expect(resident().userData.lifecycle.distance).toBe(0);
    expect(props.positions.current.has(props.agent.id)).toBe(false);
    props.reservations.current.delete(LIFECYCLE_CORRIDOR_KEY);
    await tick(1);
    expect(resident().visible).toBe(true);
    expect(props.reservations.current.get(LIFECYCLE_CORRIDOR_KEY)).toBe(
      JSON.stringify([props.roomId, props.agent.id]),
    );
    await act(async () => root.render(<group />));
    expect(props.reservations.current.size).toBe(0);
  });

  it("settles reduced-motion arrivals without an outdoor seated ghost", async () => {
    const complete = vi.fn();
    props = {
      ...props,
      ...lifecycleProps("arriving"),
      onLifecycleComplete: complete,
    };
    await render();
    await tick(30);
    await act(async () => {
      reduced = true;
      listeners.forEach((listener) => listener());
    });
    await tick(1);
    expect(complete).toHaveBeenCalledExactlyOnceWith("trip", "arriving");
    expect(
      resident().position.distanceTo(
        new THREE.Vector3(
          props.desk.seat[0],
          RESIDENT_SEATED_Y,
          props.desk.seat[1],
        ),
      ),
    ).toBeLessThan(1e-8);
    expect(props.reservations.current.size).toBe(0);
  });

  it("advances real GLB Walk time 1.5x while actual R3F translation moves at the shared brisk speed", async () => {
    const played = vi.spyOn(THREE.AnimationAction.prototype, "play");
    props = { ...props, ...lifecycleProps("arriving") };
    await render();
    await tick(1);
    const walk = played.mock.instances.find(
      (action) => action.getClip().name.toLowerCase() === "walk",
    )!;
    expect(walk).toBeDefined();
    expect(walk.getEffectiveTimeScale()).toBe(WALK_GAIT_RATE);
    const initialDistance = resident().userData.lifecycle.distance;
    const initialTime = walk.time;
    await tick(12);
    expect(
      resident().userData.lifecycle.distance - initialDistance,
    ).toBeCloseTo(WALK_SPEED * 0.2);
    expect(walk.time - initialTime).toBeCloseTo(WALK_GAIT_RATE * 0.2);
    expect(body().position.y).toBeGreaterThan(0.75);
    expect(resident().scale.toArray()).toEqual([1, 1, 1]);
  });

  it("uses the same brisk real-GLB gait for an ordinary stroll without speeding up work", async () => {
    const played = vi.spyOn(THREE.AnimationAction.prototype, "play");
    props = {
      ...props,
      command: { id: props.agent.id, type: "walk", serial: 401 },
    };
    await render();
    await tick(1);
    const walk = played.mock.instances.find(
      (action) => action.getClip().name.toLowerCase() === "walk",
    )!;
    expect(walk.getEffectiveTimeScale()).toBe(WALK_GAIT_RATE);
    const start = resident().position.clone();
    const initialTime = walk.time;
    await tick(6);
    // This short prefix stays on the first clear straight part of the route.
    expect(resident().position.distanceTo(start)).toBeCloseTo(
      WALK_SPEED * 0.1,
      2,
    );
    expect(walk.time - initialTime).toBeCloseTo(WALK_GAIT_RATE * 0.1);
    props = {
      ...props,
      command: { id: props.agent.id, type: "return", serial: 402 },
    };
    await render();
    const turningPosition = resident().position.clone();
    let turningYaw = resident().rotation.y;
    for (let frame = 0; frame < 29; frame++) {
      await tick(1);
      expect(resident().position.toArray()).toEqual(turningPosition.toArray());
      expect(Math.abs(resident().rotation.y - turningYaw)).toBeLessThanOrEqual(
        WALK_TURN_SPEED / 60 + 1e-9,
      );
      turningYaw = resident().rotation.y;
    }
    await tick(120);
    const work = played.mock.instances.find(
      (action) => action.getClip().name.toLowerCase() === "work",
    )!;
    expect(work).toBeDefined();
    expect(work.getEffectiveTimeScale()).toBe(1);
  });

  it("bounds actual heading at every arrival, seating, standing, route turn, and restart frame", async () => {
    props = { ...props, ...lifecycleProps("arriving") };
    await render();
    await tick(1); // The hidden offsite actor can initialize its facing.
    const originalScale = resident().scale.toArray();
    let previousYaw = resident().rotation.y;
    const checkFrames = async (count: number) => {
      for (let frame = 0; frame < count; frame++) {
        await tick(1);
        const heading = resident().rotation.y;
        expect(Math.abs(heading - previousYaw)).toBeLessThanOrEqual(
          WALK_TURN_SPEED / 60 + 1e-9,
        );
        expect(resident().scale.toArray()).toEqual(originalScale);
        previousYaw = heading;
      }
    };
    await checkFrames(
      Math.ceil((routeLength(props.lifecycleRoute!) / WALK_SPEED) * 60) + 30,
    );
    expect(
      Math.sin((resident().rotation.y - props.desk.orientation) / 2),
    ).toBeCloseTo(0);
    props = { ...props, ...lifecycleProps("exiting", "depart") };
    await render();
    await checkFrames(80);
    const beforeReversal = resident().rotation.y;
    props = {
      ...props,
      transition: {
        ...props.transition!,
        direction: "arriving",
        token: "restart",
      },
    };
    await render();
    await checkFrames(1);
    expect(
      Math.abs(resident().rotation.y - beforeReversal),
    ).toBeLessThanOrEqual(WALK_TURN_SPEED / 60 + 1e-9);
    await checkFrames(150);
    props = { ...props, transition: undefined, lifecycleRoute: undefined };
    await render();
    await checkFrames(3);
  });

  it("disposes merged Asset buffers on unmount while preserving cached source geometry", async () => {
    const bytes = fs.readFileSync("public/models/desk.glb");
    const source = await new GLTFLoader().parseAsync(
      Uint8Array.from(bytes).buffer,
      "",
    );
    asset.current = source;
    const originals: ReturnType<typeof vi.spyOn>[] = [];
    source.scene.traverse((node) => {
      if (node instanceof THREE.Mesh)
        originals.push(vi.spyOn(node.geometry, "dispose"));
    });
    await act(async () =>
      root.render(<Asset name="desk" position={[0, 0, 0]} />),
    );
    const merged: ReturnType<typeof vi.spyOn>[] = [];
    _roots
      .get(canvas)!
      .store.getState()
      .scene.traverse((node) => {
        if (node instanceof THREE.Mesh)
          merged.push(vi.spyOn(node.geometry, "dispose"));
      });
    expect(merged.length).toBeGreaterThan(0);
    await act(async () => root.render(<group />));
    merged.forEach((dispose) => expect(dispose).toHaveBeenCalled());
    originals.forEach((dispose) => expect(dispose).not.toHaveBeenCalled());
  });
});

it("cancels a stop/restart before the first travel frame without hiding or moving a seated resident", async () => {
  const complete = vi.fn();
  const trip = lifecycleProps("exiting", "rapid-stop");
  props = { ...props, desk: trip.desk, onLifecycleComplete: complete };
  await render();
  await tick(1);
  const original = resident();
  const seated = original.position.clone();
  props = { ...props, ...trip };
  await render();
  props = {
    ...props,
    transition: {
      ...trip.transition,
      direction: "arriving",
      token: "rapid-restart",
    },
  };
  await render();
  expect(resident()).toBe(original);
  expect(resident().visible).toBe(true);
  expect(resident().position.distanceTo(seated)).toBeLessThan(1e-9);
  await tick(1);
  expect(resident().position.distanceTo(seated)).toBeLessThan(1e-9);
  expect(complete).toHaveBeenCalledExactlyOnceWith("rapid-restart", "arriving");
  expect(props.reservations.current.size).toBe(0);
});

it("cancels an unrendered arrival offsite when a stop arrives before the first travel frame", async () => {
  const complete = vi.fn();
  props = {
    ...props,
    ...lifecycleProps("arriving", "rapid-start"),
    onLifecycleComplete: complete,
  };
  await render();
  expect(resident().visible).toBe(false);
  props = {
    ...props,
    transition: {
      ...props.transition!,
      direction: "exiting",
      token: "rapid-stop",
    },
  };
  await render();
  await tick(1);
  expect(resident().visible).toBe(false);
  expect(complete).toHaveBeenCalledExactlyOnceWith("rapid-stop", "exiting");
  expect(props.reservations.current.size).toBe(0);
});
