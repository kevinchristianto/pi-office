import fs from "node:fs";
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { createRoot, extend, _roots } from "@react-three/fiber";
import { residentModel } from "../src/appearance";
import { projectOffices, visualAgentId } from "../src/projectProjection";
import { useOfficeData } from "../src/useOfficeData";
import type { AgentLifecycleMarker, Session, Snapshot } from "../src/types";

const assets = vi.hoisted(() => ({
  resident: null as GLTF | null,
  furniture: null as GLTF | null,
}));
// Keep the actual Office/Room/Character hierarchy, transport and lifecycle hooks,
// R3F reconciler/frame loop, resident GLB and mixer. Only WebGL delivery, static
// scenery and unrelated DOM/camera components are replaced.
vi.mock("@react-three/fiber", async (original) => ({
  ...(await original<typeof import("@react-three/fiber")>()),
  Canvas: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
vi.mock("@react-three/drei", () => ({
  useGLTF: (path: string) =>
    path.includes("/agent-") ? assets.resident : assets.furniture,
  ContactShadows: () => null,
  Html: () => null,
  PerspectiveCamera: () => null,
}));
vi.mock("../src/AgentBubble", () => ({ default: () => null }));
vi.mock("../src/CameraRig", () => ({ default: () => null }));
vi.mock("../src/BuildingEntrance", () => ({ default: () => null }));
import Office from "../src/Office";

class FakeEvents {
  static current: FakeEvents;
  listeners: Record<string, (event: { data: string }) => void> = {};
  onopen?: () => void;
  onerror?: () => void;
  close = vi.fn();
  constructor() {
    FakeEvents.current = this;
  }
  addEventListener(name: string, listener: (event: { data: string }) => void) {
    this.listeners[name] = listener;
  }
  publish(snapshot: Snapshot) {
    this.listeners.snapshot({ data: JSON.stringify(snapshot) });
  }
}
let root: ReturnType<typeof createRoot>;
let canvas: HTMLCanvasElement;
let now: number;
let selected: string | null;
let command: React.ComponentProps<typeof Office>["command"];
let latest: ReturnType<typeof useOfficeData>;
let resets: ReturnType<typeof vi.spyOn>;
let starts: Map<string, THREE.AnimationAction[]>;
let reduced: boolean;
let mediaListeners: Set<() => void>;

function Feed() {
  latest = useOfficeData();
  const sessions = projectOffices(latest.snapshot.sessions)
    .slice(0, 4)
    .sort((a, b) => a.id.localeCompare(b.id));
  return (
    <Office
      sessions={sessions}
      selected={selected}
      onSelect={() => {}}
      reset={0}
      follow={null}
      command={command}
      onStopFollow={() => {}}
      lifecycleEvents={latest.lifecycleEvents}
      lifecycleEpoch={latest.lifecycleEpoch}
      lifecycleEnabled
      connection={latest.connection}
    />
  );
}
const session = (id = "session-one", ids = ["main"]): Session => ({
  id,
  name: id,
  cwd: "/review/shared",
  connectionState: "live",
  project: {
    id: "project-one",
    name: "Project",
    root: "/review/shared",
    kind: "git",
  },
  agents: ids.map((id) => ({ id, name: id, state: "working" })),
});
const marker = (
  eventId: string,
  kind: "start" | "stop",
): AgentLifecycleMarker => ({
  version: 1,
  eventId,
  kind,
  source: "pi-subagents:child-status",
  at: new Date(Date.now()).toISOString(),
});
const snapshot = (sessions = [session()], revision?: number): Snapshot => ({
  sessions,
  updatedAt: Date.now(),
  ...(revision === undefined ? {} : { streamId: "stream", revision }),
});
async function render() {
  await act(async () => {
    root.render(
      <React.StrictMode>
        <Feed />
      </React.StrictMode>,
    );
  });
}
async function publish(data: Snapshot) {
  await act(async () => {
    FakeEvents.current.publish(data);
  });
}
async function tick(frames: number) {
  await act(async () => {
    for (let frame = 0; frame < frames; frame++) {
      now += 1 / 60;
      _roots.get(canvas)!.store.getState().advance(now, true);
    }
  });
}
function actor(sessionId = "session-one", agentId = "main") {
  return _roots
    .get(canvas)!
    .store.getState()
    .scene.getObjectByName(`resident-${visualAgentId(sessionId, agentId)}`);
}
function actionFor(object: THREE.Object3D, clip = "work") {
  const action = starts
    .get(object.uuid)
    ?.find((action) => action.getClip().name.toLowerCase() === clip);
  expect(action).toBeDefined();
  return action!;
}
function pose(object: THREE.Object3D) {
  const values: number[] = [];
  object
    .getObjectByName("Body")!
    .traverse((node) => values.push(...node.position, ...node.quaternion));
  return values;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  vi.stubGlobal("EventSource", FakeEvents);
  now = 0;
  selected = null;
  command = null;
  reduced = false;
  mediaListeners = new Set();
  vi.spyOn(performance, "now").mockImplementation(() => now * 1000);
  vi.spyOn(Date, "now").mockImplementation(() => 1_000_000 + now * 1000);
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, listener: () => void) =>
      mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      mediaListeners.delete(listener),
  }));
  const bytes = fs.readFileSync(`public${residentModel("main")}`);
  assets.resident = await new GLTFLoader().parseAsync(
    Uint8Array.from(bytes).buffer,
    "",
  );
  assets.furniture = {
    ...assets.resident,
    scene: new THREE.Group(),
    animations: [],
  } as unknown as GLTF;
  starts = new Map();
  const originalPlay = THREE.AnimationAction.prototype.play;
  vi.spyOn(THREE.AnimationAction.prototype, "play").mockImplementation(
    function (this: THREE.AnimationAction) {
      let object = this.getRoot();
      while (object.parent && !object.name.startsWith("resident-"))
        object = object.parent;
      starts.set(object.uuid, [...(starts.get(object.uuid) ?? []), this]);
      return originalPlay.call(this);
    },
  );
  resets = vi.spyOn(THREE.AnimationAction.prototype, "reset");
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
  await render();
  await act(async () => FakeEvents.current.onopen?.());
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("independent live Office flicker runtime review", () => {
  it("keeps the same actual resident rig and progressing GLB action through unversioned heartbeats", async () => {
    await publish(snapshot());
    await tick(15);
    const original = actor()!;
    const body = original.getObjectByName("Body")!;
    const action = actionFor(original);
    const resetCount = resets.mock.calls.length;
    const epoch = latest.lifecycleEpoch;
    for (let heartbeat = 0; heartbeat < 12; heartbeat++) {
      const time = action.time;
      const lastPose = pose(original);
      await publish(
        snapshot([
          { ...session(), name: `Updated project session ${heartbeat}` },
        ]),
      );
      expect(latest.lifecycleEpoch).toBe(epoch);
      expect(actor()?.uuid).toBe(original.uuid);
      expect(original.getObjectByName("Body")?.uuid).toBe(body.uuid);
      expect(pose(original)).toEqual(lastPose);
      expect(action.time).toBe(time);
      expect(resets.mock.calls.length).toBe(resetCount);
      await tick(1);
      expect(action.time).not.toBe(time);
    }
  });

  it("preserves both colliding source identities and mixer phase through current-versioned roster and metadata updates", async () => {
    await publish(snapshot([session("left"), session("right")], 1));
    await tick(15);
    const left = actor("left")!,
      right = actor("right")!;
    expect(left).not.toBe(right);
    const actions = [actionFor(left), actionFor(right)];
    const resetCount = resets.mock.calls.length;
    const epoch = latest.lifecycleEpoch;
    for (let revision = 2; revision < 15; revision++) {
      const before = actions.map((action) => action.time);
      const sessions = [session("right"), session("left")].map((source) => ({
        ...source,
        name: `Rename ${revision}`,
        model: `Model ${revision}`,
        project: {
          ...source.project!,
          name: `Project title ${revision}`,
          root: "/renamed/display/path",
        },
        agents: source.agents.map((agent) => ({
          ...agent,
          task: `Task ${revision}`,
          inputTokens: revision * 42,
          logs: [
            { time: Date.now(), level: "info", message: `Tick ${revision}` },
          ],
        })),
      }));
      await publish(snapshot(sessions, revision));
      expect(actor("left")?.uuid).toBe(left.uuid);
      expect(actor("right")?.uuid).toBe(right.uuid);
      expect(latest.lifecycleEpoch).toBe(epoch);
      expect(actions.map((action) => action.time)).toEqual(before);
      expect(resets.mock.calls.length).toBe(resetCount);
      await tick(1);
      expect(
        actions.every((action, index) => action.time !== before[index]),
      ).toBe(true);
    }
  });

  it("retains a true stop and restart in place while the other same-ID source keeps its clip phase", async () => {
    await publish(snapshot([session("left"), session("right")], 1));
    await tick(15);
    const left = actor("left")!,
      right = actor("right")!;
    const rightAction = actionFor(right);
    const stopped = {
      ...session("left"),
      agents: [
        {
          ...session("left").agents[0],
          lifecycle: marker("left-stop", "stop"),
        },
      ],
    };
    await publish(snapshot([stopped, session("right")], 2));
    await tick(90);
    expect(actor("left")?.uuid).toBe(left.uuid);
    expect(actor("right")?.uuid).toBe(right.uuid);
    expect(left.userData.lifecycle?.direction).toBe("exiting");
    const before = left.position.clone();
    const heading = left.rotation.y;
    const visible = left.visible;
    const rightTime = rightAction.time;
    const rightResets = resets.mock.contexts.filter(
      (context) => context === rightAction,
    ).length;
    const restarted = {
      ...session("left"),
      agents: [
        {
          ...session("left").agents[0],
          lifecycle: marker("left-restart", "start"),
        },
      ],
    };
    await publish(snapshot([session("right"), restarted], 3));
    expect(actor("left")?.uuid).toBe(left.uuid);
    expect(actor("right")?.uuid).toBe(right.uuid);
    expect(left.position.distanceTo(before)).toBeLessThan(1e-9);
    expect(left.rotation.y).toBe(heading);
    expect(left.visible).toBe(visible);
    expect(rightAction.time).toBe(rightTime);
    await tick(1);
    expect(left.userData.lifecycle?.direction).toBe("arriving");
    expect(left.position.distanceTo(before)).toBeLessThan(0.04);
    expect(rightAction.time).not.toBe(rightTime);
    expect(
      resets.mock.contexts.filter((context) => context === rightAction).length,
    ).toBe(rightResets);
    await tick(2000);
    await tick(1);
    expect(actor("left")?.uuid).toBe(left.uuid);
    expect(left.visible).toBe(true);
    expect(left.userData.lifecycle).toBeNull();
  });

  it("keeps the rig and animation time when an exact-root legacy project gains canonical metadata", async () => {
    const legacy = { ...session(), project: undefined };
    await publish(snapshot([legacy], 1));
    await tick(15);
    const original = actor()!;
    const body = original.getObjectByName("Body")!;
    const action = actionFor(original);
    const phase = action.time;
    const resetCount = resets.mock.calls.length;
    await publish(snapshot([session()], 2));
    expect(actor()?.uuid).toBe(original.uuid);
    expect(actor()!.getObjectByName("Body")?.uuid).toBe(body.uuid);
    expect(action.time).toBe(phase);
    expect(resets.mock.calls.length).toBe(resetCount);
    await tick(1);
    expect(action.time).not.toBe(phase);
  });

  it("does not respawn surviving residents when an unrelated project arrives or disappears", async () => {
    await publish(snapshot([session()], 1));
    await tick(15);
    const original = actor()!;
    const body = original.getObjectByName("Body")!;
    const action = actionFor(original);
    const unrelated = {
      ...session("unrelated"),
      cwd: "/review/elsewhere",
      project: {
        id: "project-two",
        name: "Unrelated",
        root: "/review/elsewhere",
        kind: "git" as const,
      },
    };
    for (const [offset, sessions] of [
      [session(), unrelated],
      [session()],
    ].entries()) {
      const phase = action.time;
      const resetsBefore = resets.mock.contexts.filter(
        (context) => context === action,
      ).length;
      await publish(snapshot(sessions, offset + 2));
      expect(actor()?.uuid).toBe(original.uuid);
      expect(actor()!.getObjectByName("Body")?.uuid).toBe(body.uuid);
      expect(action.time).toBe(phase);
      expect(
        resets.mock.contexts.filter((context) => context === action).length,
      ).toBe(resetsBefore);
      await tick(1);
      expect(action.time).not.toBe(phase);
    }
  });

  it("continues an in-flight departure when an unrelated same-slot project is replaced", async () => {
    const other = (suffix: string): Session => ({
      ...session(`other-${suffix}`),
      cwd: `/review/${suffix}`,
      project: {
        id: `project-${suffix}`,
        name: suffix,
        root: `/review/${suffix}`,
        kind: "git",
      },
    });
    await publish(snapshot([session(), other("two")], 1));
    await tick(15);
    const stopped = {
      ...session(),
      agents: [
        { ...session().agents[0], lifecycle: marker("stable-stop", "stop") },
      ],
    };
    await publish(snapshot([stopped, other("two")], 2));
    await tick(90);
    const original = actor()!;
    const position = original.position.clone();
    const heading = original.rotation.y;
    const distance = original.userData.lifecycle.distance;
    const walk = actionFor(original, "walk");
    const phase = walk.time;
    expect(original.userData.lifecycle.direction).toBe("exiting");
    await publish(snapshot([stopped, other("z")], 3));
    expect(actor()?.uuid).toBe(original.uuid);
    expect(original.position.distanceTo(position)).toBeLessThan(1e-9);
    expect(original.rotation.y).toBe(heading);
    expect(walk.time).toBe(phase);
    await tick(1);
    expect(original.userData.lifecycle.direction).toBe("exiting");
    expect(original.userData.lifecycle.distance).toBeLessThanOrEqual(distance);
    expect(original.position.distanceTo(position)).toBeLessThan(0.04);
    await tick(1500);
    await tick(1);
    expect(actor()).toBeUndefined();
    expect(actor("other-z")).toBeDefined();
  });

  it("cancels geometry-bound travel without replaying an old command after canonical project migration", async () => {
    const legacy = { ...session(), project: undefined };
    await publish(snapshot([legacy], 1));
    await tick(15);
    const original = actor()!;
    const seat = original.position.clone();
    command = {
      id: visualAgentId("session-one", "main"),
      type: "walk",
      serial: 1,
    };
    await render();
    await tick(90);
    expect(original.position.distanceTo(seat)).toBeGreaterThan(0.1);
    await publish(snapshot([session()], 2));
    expect(actor()?.uuid).toBe(original.uuid);
    await tick(1);
    expect(original.position.distanceTo(seat)).toBeLessThan(1e-9);
    await tick(100);
    expect(original.position.distanceTo(seat)).toBeLessThan(1e-9);
    command = { ...command, serial: 2 };
    await render();
    await tick(90);
    expect(original.position.distanceTo(seat)).toBeGreaterThan(0.1);
  });

  it("preserves an existing resident through reduced-motion freeze and resume", async () => {
    await publish(snapshot([session()], 1));
    await tick(15);
    const original = actor()!;
    const body = original.getObjectByName("Body")!;
    await act(async () => {
      reduced = true;
      mediaListeners.forEach((listener) => listener());
    });
    await tick(1);
    expect(actor()?.uuid).toBe(original.uuid);
    expect(original.getObjectByName("Body")?.uuid).toBe(body.uuid);
    const frozen = pose(original);
    await tick(20);
    expect(pose(original)).toEqual(frozen);
    await act(async () => {
      reduced = false;
      mediaListeners.forEach((listener) => listener());
    });
    await tick(20);
    expect(actor()?.uuid).toBe(original.uuid);
    expect(original.getObjectByName("Body")?.uuid).toBe(body.uuid);
    expect(
      pose(original).some(
        (value, index) => Math.abs(value - frozen[index]) > 1e-6,
      ),
    ).toBe(true);
  });

  it("does not replay legacy lifecycle markers or markers received across an actual reconnect", async () => {
    const companion = session("companion");
    await publish(snapshot([session(), companion]));
    await tick(15);
    const legacy = {
      ...session(),
      agents: [
        { ...session().agents[0], lifecycle: marker("legacy-stop", "stop") },
      ],
    };
    await publish(snapshot([legacy, companion]));
    await tick(1);
    expect(latest.lifecycleEvents).toEqual([]);
    expect(actor()).toBeUndefined();
    expect(actor("companion")!.userData.lifecycle).toBeNull();
    await publish(snapshot([legacy, companion], 1));
    await tick(1);
    expect(latest.lifecycleEvents).toEqual([]);
    const beforeReconnect = latest.lifecycleEpoch;
    const original = actor("companion")!;
    const body = original.getObjectByName("Body")!;
    const action = actionFor(original);
    const mixer = action.getMixer();
    const phase = action.time;
    const resetCount = resets.mock.calls.length;
    await act(async () => {
      FakeEvents.current.onerror?.();
      FakeEvents.current.onopen?.();
      FakeEvents.current.publish(snapshot([legacy, companion], 2));
    });
    await tick(1);
    expect(latest.lifecycleEpoch).toBeGreaterThan(beforeReconnect);
    expect(actor()).toBeUndefined();
    expect(actor("companion")?.uuid).toBe(original.uuid);
    expect(actor("companion")!.getObjectByName("Body")?.uuid).toBe(body.uuid);
    expect(actionFor(original).getMixer()).toBe(mixer);
    expect(action.time).not.toBe(phase);
    expect(resets.mock.calls.length).toBe(resetCount);
    expect(latest.lifecycleEvents).toEqual([]);
    expect(actor("companion")!.visible).toBe(true);
    expect(actor("companion")!.userData.lifecycle).toBeNull();
  });
});

it("coalesces an unrendered stop/restart into the same seated live actor", async () => {
  await publish(snapshot([session()], 1));
  await tick(15);
  const original = actor()!;
  const seated = original.position.clone();
  await act(async () => {
    FakeEvents.current.publish(
      snapshot(
        [
          {
            ...session(),
            agents: [
              {
                ...session().agents[0],
                lifecycle: marker("coalesced-stop", "stop"),
              },
            ],
          },
        ],
        2,
      ),
    );
    FakeEvents.current.publish(
      snapshot(
        [
          {
            ...session(),
            agents: [
              {
                ...session().agents[0],
                lifecycle: marker("coalesced-start", "start"),
              },
            ],
          },
        ],
        3,
      ),
    );
  });
  expect(actor()).toBe(original);
  expect(original.visible).toBe(true);
  expect(original.position.distanceTo(seated)).toBeLessThan(1e-9);
  await tick(1);
  expect(original.visible).toBe(true);
  expect(original.position.distanceTo(seated)).toBeLessThan(1e-9);
  expect(original.userData.lifecycle).toBeNull();
});
