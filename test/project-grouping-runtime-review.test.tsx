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
import { projectOffices } from "../src/projectProjection";
import { createOfficeLayout } from "../src/world";
import { createBuildingEntryRoute } from "../src/lifecycleRoutes";
import {
  lifecycleTrafficFor,
  LIFECYCLE_CORRIDOR_KEY,
} from "../src/lifecycleWalking";
import {
  useResidentLifecycle,
  type ResidentEntry,
} from "../src/useResidentLifecycle";
import type { AgentLifecycleEvent, Session } from "../src/types";

const asset = vi.hoisted(() => ({
  current: null as GLTF | null,
  requested: [] as string[],
}));
// Exercise the real hook, reconciler, useFrame subscribers, rig and mixer.
// Only browser asset delivery and DOM labels are replaced.
vi.mock("@react-three/drei", () => ({
  useGLTF: (url: string) => {
    asset.requested.push(url);
    return asset.current;
  },
  ContactShadows: () => null,
  Html: () => null,
  OrbitControls: () => null,
  PerspectiveCamera: () => null,
}));
vi.mock("../src/AgentBubble", () => ({ default: () => null }));
import { Character } from "../src/Office";

type CharacterProps = React.ComponentProps<typeof Character>;
type SimulationProps = {
  sessions: Session[];
  events: AgentLifecycleEvent[];
  command: CharacterProps["command"];
  epoch: number;
  connection: "connecting" | "connected" | "disconnected";
};
let root: ReturnType<typeof createRoot>;
let canvas: HTMLCanvasElement;
let props: SimulationProps;
let now: number;
let reduced: boolean;
let listeners: Set<() => void>;
let entries: ResidentEntry[];
let positions: CharacterProps["positions"];
let reservations: CharacterProps["reservations"];

function Simulation(input: SimulationProps) {
  const sessions = projectOffices(input.sessions);
  const life = useResidentLifecycle({
    ...input,
    sessions,
    selected: null,
    enabled: true,
    reduced,
  });
  entries = life.residents;
  const layouts = createOfficeLayout(
    sessions.map((session) => ({
      id: session.id,
      agentCount: Math.max(
        session.agents.length,
        ...entries
          .filter((entry) => entry.roomId === session.id)
          .map((entry) => entry.deskIndex + 1),
      ),
    })),
  );
  return (
    <group key={life.scope}>
      {entries.map((entry) => {
        const room = layouts.find((layout) => layout.id === entry.roomId)!;
        const desk = room.desks[entry.deskIndex];
        return (
          <Character
            key={entry.key}
            agent={entry.agent}
            desk={desk}
            roomId={entry.roomId}
            selected={false}
            onSelect={() => {}}
            command={input.command}
            positions={positions}
            reservations={reservations}
            index={entry.deskIndex}
            transition={entry.transition}
            lifecycleRoute={
              entry.transition
                ? createBuildingEntryRoute(
                    layouts,
                    room,
                    desk,
                    entry.transition.queueIndex,
                  )
                : undefined
            }
            onLifecycleComplete={(token, direction) =>
              life.complete(entry.key, token, direction)
            }
          />
        );
      })}
    </group>
  );
}
const session = (
  id: string,
  name: string,
  root = "/review/shared",
): Session => ({
  id,
  name: `Session ${name}`,
  cwd: root,
  agents: [{ id: "main", name, state: "working" }],
});
const marker = (
  sessionId: string,
  kind: "start" | "stop",
  eventId: string,
): AgentLifecycleEvent => ({
  version: 1,
  sessionId,
  agentId: "main",
  kind,
  eventId,
  source: "pi-subagents:child-status",
  at: "2026-10-11T08:00:00.000Z",
});
async function render(changes: Partial<SimulationProps> = {}) {
  props = { ...props, ...changes };
  await act(async () => {
    root.render(
      <React.StrictMode>
        <Simulation {...props} />
      </React.StrictMode>,
    );
  });
}
async function tick(frames: number) {
  await act(async () => {
    for (let index = 0; index < frames; index++) {
      now += 1 / 60;
      _roots.get(canvas)!.store.getState().advance(now, true);
    }
  });
}
function actor(name: string) {
  const id = entries.find((entry) => entry.agent.name === name)?.agent.id;
  return _roots
    .get(canvas)!
    .store.getState()
    .scene.getObjectByName(`resident-${id}`);
}
const xz = (point: THREE.Vector3) => [point.x, point.z];

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
  asset.requested = [];
  const bytes = fs.readFileSync(`public${residentModel("main")}`);
  asset.current = await new GLTFLoader().parseAsync(
    Uint8Array.from(bytes).buffer,
    "",
  );
  positions = { current: new Map() };
  reservations = { current: new Map() };
  entries = [];
  props = {
    sessions: [session("left", "Left"), session("right", "Right")],
    events: [],
    command: null,
    epoch: 1,
    connection: "connected",
  };
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
  await tick(1);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("independent grouped-project R3F runtime review", () => {
  it("preserves raw-ID appearance while giving colliding identities separate actors, desks and position registry keys", async () => {
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.agent.id)).size).toBe(2);
    expect(new Set(entries.map((entry) => entry.roomId)).size).toBe(1);
    expect(new Set(entries.map((entry) => entry.deskIndex)).size).toBe(2);
    expect(asset.requested.length).toBeGreaterThan(0);
    expect(new Set(asset.requested)).toEqual(new Set([residentModel("main")]));
    const left = actor("Left")!,
      right = actor("Right")!;
    expect(left).not.toBe(right);
    expect(left.position.distanceTo(right.position)).toBeGreaterThan(1);
    for (const entry of entries)
      expect(positions.current.has(entry.agent.id)).toBe(true);
    const before = new Map(
      entries.map((entry) => [
        entry.agent.name,
        {
          id: entry.agent.id,
          actor: actor(entry.agent.name),
          desk: entry.deskIndex,
        },
      ]),
    );
    await render({
      sessions: [session("right", "Right"), session("left", "Left")],
    });
    await tick(1);
    for (const entry of entries) {
      expect(entry.agent.id).toBe(before.get(entry.agent.name)!.id);
      expect(actor(entry.agent.name)).toBe(before.get(entry.agent.name)!.actor);
      expect(entry.deskIndex).toBe(before.get(entry.agent.name)!.desk);
    }
  });

  it("a stroll reserves the shared physical project aisle, blocking another source session's arrival until clear", async () => {
    const left = entries.find((entry) => entry.agent.name === "Left")!;
    const right = entries.find((entry) => entry.agent.name === "Right")!;
    await render({ command: { id: left.agent.id, type: "walk", serial: 1 } });
    await tick(90);
    expect(reservations.current.get(left.roomId)).toBe(
      JSON.stringify([left.roomId, left.agent.id]),
    );
    expect(reservations.current.has("left")).toBe(false);
    await render({ events: [marker("right", "start", "right-start")] });
    await tick(10);
    expect(actor("Right")!.visible).toBe(false);
    expect(actor("Right")!.userData.lifecycle.phase).toBe("waiting");
    expect(
      entries.find((entry) => entry.agent.id === left.agent.id)?.transition,
    ).toBeUndefined();
    expect(
      entries.find((entry) => entry.agent.id === right.agent.id)?.transition
        ?.direction,
    ).toBe("arriving");
    await tick(3500);
    await tick(1);
    expect(actor("Right")!.visible).toBe(true);
    expect(entries.every((entry) => !entry.transition)).toBe(true);
    expect(reservations.current.size).toBe(0);
    expect(lifecycleTrafficFor(reservations.current).queue).toEqual([]);
  });

  it("retains one source session's confirmed departure after transport removal without remounting the sibling or reusing its desk", async () => {
    const oldLeft = actor("Left")!,
      oldRight = actor("Right")!;
    const rightPosition = oldRight.position.clone();
    await render({ events: [marker("left", "stop", "left-stop")] });
    await tick(40);
    expect(actor("Left")!.userData.lifecycle.direction).toBe("exiting");
    await render({ sessions: [session("right", "Right")] });
    await tick(1);
    expect(actor("Left")).toBe(oldLeft);
    expect(actor("Right")).toBe(oldRight);
    expect(xz(actor("Right")!.position)).toEqual(xz(rightPosition));
    expect(new Set(entries.map((entry) => entry.deskIndex)).size).toBe(2);
    await tick(2500);
    await tick(1);
    expect(actor("Left")).toBeUndefined();
    expect(actor("Right")).toBe(oldRight);
    expect(entries).toHaveLength(1);
    expect(reservations.current.size).toBe(0);
    expect(lifecycleTrafficFor(reservations.current).queue).toEqual([]);
  });

  it("clears composite traffic ownership at reconnect and does not replay raw-session events", async () => {
    await render({
      events: [
        marker("left", "stop", "left-stop"),
        marker("right", "start", "right-start"),
      ],
    });
    await tick(40);
    expect(reservations.current.has(LIFECYCLE_CORRIDOR_KEY)).toBe(true);
    await render({ connection: "disconnected" });
    await tick(1);
    expect(reservations.current.size).toBe(0);
    expect(lifecycleTrafficFor(reservations.current).queue).toEqual([]);
    await render({ connection: "connected", epoch: 2 });
    await tick(120);
    expect(entries.every((entry) => !entry.transition)).toBe(true);
    expect(actor("Left")!.visible && actor("Right")!.visible).toBe(true);
    expect(reservations.current.size).toBe(0);
  });
});
