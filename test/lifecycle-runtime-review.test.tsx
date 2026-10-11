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

const asset = vi.hoisted(() => ({ current: null as GLTF | null }));
// Exercise the real hook, reconciler, useFrame subscribers, rig and mixer.
// Only browser asset delivery and DOM labels are replaced.
vi.mock("@react-three/drei", () => ({
  useGLTF: () => asset.current,
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
  const life = useResidentLifecycle({
    ...input,
    selected: null,
    enabled: true,
    reduced,
  });
  entries = life.residents;
  const layouts = createOfficeLayout(
    input.sessions.map((session) => ({
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
const session = (...ids: string[]): Session => ({
  id: "room",
  name: "Project",
  agents: ids.map((id) => ({ id, name: id, state: "working" })),
});
const marker = (
  id: string,
  kind: "start" | "stop",
  eventId: string,
): AgentLifecycleEvent => ({
  version: 1,
  sessionId: "room",
  agentId: id,
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
function actor(id: string) {
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
  const bytes = fs.readFileSync(`public${residentModel("A")}`);
  asset.current = await new GLTFLoader().parseAsync(
    Uint8Array.from(bytes).buffer,
    "",
  );
  positions = { current: new Map() };
  reservations = { current: new Map() };
  entries = [];
  props = {
    sessions: [session("A", "B", "C")],
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

describe("independent multi-resident lifecycle integration", () => {
  it("reclaims a departure seat on restart without leaving its queued successor assigned to the same chair", async () => {
    await render({ sessions: [session("A", "B", "C", "D", "E", "F")] });
    await render({
      sessions: [session("X", "B", "C", "D", "E", "F")],
      events: [marker("A", "stop", "A-stop"), marker("X", "start", "X-start")],
    });
    await tick(60);
    expect(entries.find((entry) => entry.agent.id === "A")!.deskIndex).toBe(0);
    expect(entries.find((entry) => entry.agent.id === "X")!.deskIndex).toBe(0);
    await render({
      sessions: [session("A", "X", "B", "C", "D", "E", "F")],
      events: [marker("A", "start", "A-restart")],
    });
    await tick(3000);
    await tick(1);
    expect(entries.every((entry) => !entry.transition)).toBe(true);
    expect(new Set(entries.map((entry) => entry.deskIndex)).size).toBe(
      entries.length,
    );
  });

  it("returns a strolling restart safely and unblocks the arrival queued ahead of it", async () => {
    await render({ command: { id: "A", type: "walk", serial: 1 } });
    await tick(100);
    const strolling = actor("A")!.position.clone();
    expect(reservations.current.get("room")).toBe(
      JSON.stringify(["room", "A"]),
    );
    await render({ events: [marker("B", "start", "B-start")] });
    await tick(10);
    expect(actor("B")!.visible).toBe(false);
    expect(actor("B")!.userData.lifecycle.phase).toBe("waiting");
    const beforeRestart = actor("A")!.position.clone();
    await render({
      events: [
        marker("B", "start", "B-start"),
        marker("A", "start", "A-start"),
      ],
    });
    await tick(1);
    expect(actor("A")!.visible).toBe(true);
    expect(actor("A")!.position.distanceTo(beforeRestart)).toBeLessThan(0.04);
    expect(actor("A")!.position.distanceTo(strolling)).toBeLessThan(0.3);
    await tick(3000);
    await tick(1);
    expect(entries.every((entry) => !entry.transition)).toBe(true);
    expect(reservations.current.size).toBe(0);
    expect(lifecycleTrafficFor(reservations.current).queue).toEqual([]);
    expect(actor("A")!.visible && actor("B")!.visible).toBe(true);
    expect(actor("A")!.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("restarts a stopped stroller at its current return position and leaves no reservation behind", async () => {
    await render({ command: { id: "A", type: "walk", serial: 1 } });
    await tick(120);
    await render({ events: [marker("A", "stop", "A-stop")] });
    await tick(20);
    const before = actor("A")!.position.clone();
    await render({ events: [marker("A", "start", "A-restart")] });
    await tick(1);
    expect(actor("A")!.position.distanceTo(before)).toBeLessThan(0.04);
    expect(actor("A")!.visible).toBe(true);
    await tick(400);
    await tick(1);
    expect(
      entries.find((entry) => entry.agent.id === "A")!.transition,
    ).toBeUndefined();
    expect(reservations.current.size).toBe(0);
    expect(lifecycleTrafficFor(reservations.current).queue).toEqual([]);
  });

  it("retains a removed departure while the surviving roster shifts and never double-books a seat", async () => {
    const oldA = actor("A")!;
    const oldB = actor("B")!.position.clone();
    await render({
      sessions: [session("B", "C")],
      events: [marker("A", "stop", "A-stop")],
    });
    await tick(60);
    expect(actor("A")).toBe(oldA);
    expect(actor("A")!.userData.lifecycle.direction).toBe("exiting");
    expect(xz(actor("B")!.position)).toEqual(xz(oldB));
    expect(new Set(entries.map((entry) => entry.deskIndex)).size).toBe(
      entries.length,
    );
    await render({ sessions: [session("C", "B")], events: [] });
    await tick(1);
    expect(actor("A")).toBe(oldA);
    expect(xz(actor("B")!.position)).toEqual(xz(oldB));
    await tick(2400);
    await tick(1);
    expect(actor("A")).toBeUndefined();
    expect(entries.map((entry) => entry.agent.id).sort()).toEqual(["B", "C"]);
    expect(reservations.current.size).toBe(0);
  });

  it("serializes simultaneous arrivals and departures without showing queued exterior actors", async () => {
    await render({
      events: [
        marker("A", "stop", "A-stop"),
        marker("B", "start", "B-start"),
        marker("C", "start", "C-start"),
      ],
    });
    await tick(1);
    expect(actor("A")!.visible).toBe(true);
    expect(actor("B")!.visible).toBe(false);
    expect(actor("C")!.visible).toBe(false);
    expect(reservations.current.get(LIFECYCLE_CORRIDOR_KEY)).toBe(
      JSON.stringify(["room", "A"]),
    );
    const admissions = new Set<string>();
    for (let index = 0; index < 80; index++) {
      await tick(60);
      const moving = ["A", "B", "C"].filter((id) => {
        const group = actor(id);
        return group?.visible && group.userData.lifecycle?.phase === "walking";
      });
      expect(moving.length).toBeLessThanOrEqual(1);
      moving.forEach((id) => admissions.add(id));
      for (const id of ["A", "B", "C"])
        if (actor(id)) expect(actor(id)!.scale.toArray()).toEqual([1, 1, 1]);
    }
    expect(admissions).toEqual(new Set(["A", "B", "C"]));
    expect(actor("A")).toBeUndefined();
    expect(entries.every((entry) => !entry.transition)).toBe(true);
    expect(reservations.current.size).toBe(0);
  });

  it("clears active and queued ownership at a transport boundary and consumes old markers", async () => {
    const events = [
      marker("A", "stop", "A-stop"),
      marker("B", "start", "B-start"),
    ];
    await render({ events });
    await tick(60);
    expect(reservations.current.has(LIFECYCLE_CORRIDOR_KEY)).toBe(true);
    await render({ connection: "disconnected" });
    await tick(1);
    expect(reservations.current.size).toBe(0);
    expect(lifecycleTrafficFor(reservations.current).queue).toEqual([]);
    expect(entries.every((entry) => !entry.transition)).toBe(true);
    await render({ connection: "connected", epoch: 2 });
    await tick(120);
    expect(entries.every((entry) => !entry.transition)).toBe(true);
    expect(reservations.current.size).toBe(0);
  });

  it("does not replay an already consumed stroll command after a scope remount", async () => {
    await render({ command: { id: "A", type: "walk", serial: 1 } });
    await tick(3200);
    const seated = actor("A")!.position.clone();
    expect(reservations.current.size).toBe(0);
    await render({ connection: "disconnected" });
    await tick(10);
    expect(actor("A")!.position.distanceTo(seated)).toBeLessThan(0.001);
    expect(reservations.current.size).toBe(0);
  });
});
