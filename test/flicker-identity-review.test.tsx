import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLifecycleGate } from "../src/lifecycle";
import { visualAgentId } from "../src/projectProjection";
import type { Agent, Session } from "../src/types";

const world = vi.hoisted(() => ({
  props: {} as any,
  lifecycle: {} as any,
  renders: [] as string[][],
}));
// The real App, SSE transport, lifecycle gate, projection and resident hook run.
// Only the WebGL scene is replaced; scope is also the real Office Room key suffix.
vi.mock("../src/Office", async () => {
  const { useResidentLifecycle } = await import("../src/useResidentLifecycle");
  return {
    default: (props: any) => {
      world.props = props;
      world.renders.push(
        props.sessions.flatMap((room: Session) =>
          room.agents.map((agent) => agent.id),
        ),
      );
      world.lifecycle = useResidentLifecycle({
        sessions: props.sessions,
        selected: props.selected,
        events: props.lifecycleEvents,
        epoch: props.lifecycleEpoch,
        enabled: props.lifecycleEnabled,
        reduced: false,
        connection: props.connection,
      });
      return <div data-testid="identity-scene" />;
    },
  };
});
import App from "../src/App";

class FakeEvents {
  static current: FakeEvents;
  listeners: Record<string, (event: { data: string }) => void> = {};
  onopen?: () => void;
  onerror?: () => void;
  constructor() {
    FakeEvents.current = this;
  }
  addEventListener(name: string, listener: (event: { data: string }) => void) {
    this.listeners[name] = listener;
  }
  close() {}
  publish(data: unknown) {
    this.listeners.snapshot?.({ data: JSON.stringify(data) });
  }
}
const person = (id: string, state = "working"): Agent => ({
  id,
  name: id,
  state,
});
const session = (id: string, agents = [person("a")]): Session => ({
  id,
  name: id,
  cwd: `/work/${id}`,
  agents,
  project: { id: `project:${id}`, root: `/work/${id}`, name: id, kind: "git" },
});
const marker = (eventId: string, kind: "start" | "stop") => ({
  version: 1 as const,
  eventId,
  kind,
  at: new Date().toISOString(),
  source: "pi-subagents:child-status" as const,
});
let revision = 0;
function publish(sessions: Session[], legacy = false) {
  act(() =>
    FakeEvents.current.publish({
      ...(legacy ? {} : { streamId: "review", revision: ++revision }),
      sessions,
      updatedAt: Date.now(),
    }),
  );
}
async function open(sessions: Session[], legacy = false) {
  render(<App />);
  await waitFor(() =>
    expect(screen.getByTestId("identity-scene")).toBeTruthy(),
  );
  publish(sessions, legacy);
}
beforeEach(() => {
  revision = 0;
  world.props = {};
  world.lifecycle = {};
  world.renders = [];
  vi.stubGlobal("EventSource", FakeEvents);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessions: [], updatedAt: Date.now() }),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("actual App resident identity continuity", () => {
  it("does not repeatedly reset resident scope on legacy unversioned heartbeats", async () => {
    await open([session("project")], true);
    const scope = world.lifecycle.scope;
    const epoch = world.props.lifecycleEpoch;
    const key = world.lifecycle.residents[0].key;
    for (const state of ["thinking", "working", "idle", "working"]) {
      publish([session("project", [person("a", state)])], true);
      expect(world.props.lifecycleEpoch).toBe(epoch);
      expect(world.lifecycle.scope).toBe(scope);
      expect(world.lifecycle.residents[0].key).toBe(key);
      expect(world.lifecycle.residents[0].agent.state).toBe(state);
      expect(world.lifecycle.residents[0].transition).toBeUndefined();
      expect(world.props.lifecycleEvents).toEqual([]);
    }
  });

  it("keeps scope, seats and an active arrival through ordinary metadata and priority changes", async () => {
    const source = session("project", [person("a"), person("b")]);
    await open([source]);
    publish([
      {
        ...source,
        agents: [
          person("a"),
          { ...person("b"), lifecycle: marker("b-start", "start") },
        ],
      },
    ]);
    const before = world.lifecycle.residents.find(
      (entry: any) => entry.agent.name === "b",
    );
    const scope = world.lifecycle.scope;
    for (let i = 0; i < 4; i++) {
      publish([
        {
          ...source,
          name: `Renamed ${i}`,
          agents: [
            {
              ...person("b", "thinking"),
              task: `Task ${i}`,
              lifecycle: marker("b-start", "start"),
            },
            person("a", "offline"),
          ],
        },
      ]);
      const after = world.lifecycle.residents.find(
        (entry: any) => entry.agent.name === "b",
      );
      expect(world.lifecycle.scope).toBe(scope);
      expect(after.key).toBe(before.key);
      expect(after.deskIndex).toBe(before.deskIndex);
      expect(after.transition).toEqual(before.transition);
      expect(after.agent.task).toBe(`Task ${i}`);
    }
  });

  it("retains an active arrival when an unrelated overview project is replaced in the same physical slot", async () => {
    const source = ["a", "b", "c", "d", "e"].map((id) =>
      session(id, [person(`${id}-agent`)]),
    );
    source[4] = { ...source[4], connectionState: "offline" };
    await open(source);
    const started = source.map((room) =>
      room.id === "b"
        ? {
            ...room,
            agents: [
              { ...room.agents[0], lifecycle: marker("b-start", "start") },
            ],
          }
        : room,
    );
    publish(started);
    const before = world.lifecycle.residents.find(
      (entry: any) => entry.agent.name === "b-agent",
    );
    expect(before.transition?.direction).toBe("arriving");
    publish(
      started.map((room) =>
        room.id === "d"
          ? { ...room, connectionState: "offline" }
          : room.id === "e"
            ? { ...room, connectionState: "live" }
            : room,
      ),
    );
    expect(world.props.sessions.map((room: Session) => room.id)).toEqual([
      "project:a",
      "project:b",
      "project:c",
      "project:e",
    ]);
    const after = world.lifecycle.residents.find(
      (entry: any) => entry.agent.name === "b-agent",
    );
    expect(after.transition).toEqual(before.transition);
    expect(after.deskIndex).toBe(before.deskIndex);
  });

  it("keeps the focused selected and followed resident visible while legacy project metadata upgrades", async () => {
    const others = ["a", "b", "c", "d"].map((id) =>
      session(id, [person(`${id}-agent`)]),
    );
    const target = {
      ...session("target", [person("target-agent")]),
      cwd: "/work/z",
      project: undefined,
    };
    await open([...others, target]);
    const selected = visualAgentId("target", "target-agent");
    act(() =>
      screen.getByRole("button", { name: "Choose project office" }).click(),
    );
    act(() => screen.getByRole("option", { name: "z" }).click());
    act(() => world.props.onSelect(selected));
    act(() =>
      screen.getByRole("button", { name: "Follow", exact: true }).click(),
    );
    act(() =>
      screen.getByRole("button", { name: "Inspect", exact: true }).click(),
    );
    expect(world.props.sessions).toHaveLength(1);
    expect(world.props.follow).toBe(selected);
    world.renders = [];
    publish([
      ...others,
      {
        ...target,
        project: {
          id: "project:target",
          name: "Target",
          root: "/work/z",
          kind: "git",
        },
      },
    ]);
    expect(world.props.sessions).toHaveLength(1);
    expect(world.props.sessions[0].id).toBe("project:target");
    expect(world.props.selected).toBe(selected);
    expect(world.props.follow).toBe(selected);
    expect(screen.getByText("AGENT DETAILS")).toBeTruthy();
    expect(world.renders.every((ids) => ids.includes(selected))).toBe(true);
  });

  it("migrates an unselected focused room by raw source identity and falls back when it is actually removed", async () => {
    const target = { ...session("target"), cwd: "/work/z", project: undefined };
    await open([session("other", [person("other-agent")]), target]);
    act(() =>
      screen.getByRole("button", { name: "Choose project office" }).click(),
    );
    act(() => screen.getByRole("option", { name: "z" }).click());
    const key = world.lifecycle.residents[0].key;
    publish([
      session("other", [person("other-agent")]),
      {
        ...target,
        project: {
          id: "project:target",
          name: "Target",
          root: "/work/z",
          kind: "git",
        },
      },
    ]);
    expect(world.props.sessions.map((room: Session) => room.id)).toEqual([
      "project:target",
    ]);
    expect(world.lifecycle.residents[0].key).toBe(key);
    expect(world.props.selected).toBeNull();
    publish([session("other", [person("other-agent")])]);
    expect(world.props.sessions.map((room: Session) => room.id)).toEqual([
      "project:other",
    ]);
  });

  it("processes a selected agent stop when historical priority moves it beyond the six-desk window", async () => {
    const source = session(
      "project",
      "abcdefg".split("").map((id) => person(id)),
    );
    await open([source]);
    const chosen = world.props.sessions[0].agents.find(
      (agent: Agent) => agent.name === "f",
    );
    act(() => world.props.onSelect(chosen.id));
    const scope = world.lifecycle.scope;
    const before = world.lifecycle.residents.find(
      (entry: any) => entry.agent.name === "f",
    );
    publish([
      {
        ...source,
        agents: source.agents.map((agent) =>
          agent.id === "f"
            ? {
                ...agent,
                state: "offline",
                lifecycle: marker("f-stop", "stop"),
              }
            : agent,
        ),
      },
    ]);
    const after = world.lifecycle.residents.find(
      (entry: any) => entry.agent.name === "f",
    );
    expect(world.lifecycle.scope).toBe(scope);
    expect(after.deskIndex).toBe(before.deskIndex);
    expect(after.transition?.direction).toBe("exiting");
    expect(after.transition?.token).toBe("f-stop");
    act(() => world.lifecycle.complete(after.key, "f-stop", "exiting"));
    expect(
      world.lifecycle.residents.some((entry: any) => entry.agent.name === "f"),
    ).toBe(false);
  });
});

describe("unversioned stream baseline versus visual resets", () => {
  it("keeps every legacy snapshot marker-ineligible without treating every heartbeat as a reconnect", () => {
    const gate = createLifecycleGate();
    const data = { sessions: [session("project")], updatedAt: Date.now() };
    expect(gate.read(data)).toMatchObject({
      accepted: true,
      reset: true,
      events: [],
    });
    for (const [index, kind] of (
      ["start", "stop", "start"] as const
    ).entries()) {
      expect(
        gate.read({
          ...data,
          sessions: [
            session("project", [
              { ...person("a"), lifecycle: marker(`${kind}-${index}`, kind) },
            ]),
          ],
        }),
      ).toMatchObject({ accepted: true, reset: false, events: [] });
    }
    gate.reset();
    expect(gate.read(data)).toMatchObject({ reset: true, events: [] });
  });
  it("baselines versioned and unversioned mode changes once and never replays markers across the boundary", () => {
    const gate = createLifecycleGate();
    const legacy = { sessions: [session("project")], updatedAt: Date.now() };
    const versioned = { ...legacy, streamId: "current", revision: 1 };
    expect(gate.read(versioned).reset).toBe(true);
    expect(gate.read({ ...versioned, revision: 2 }).reset).toBe(false);
    expect(gate.read(legacy)).toMatchObject({ reset: true, events: [] });
    expect(gate.read(legacy)).toMatchObject({ reset: false, events: [] });
    const currentMarker = marker("during-upgrade", "start");
    const current = {
      ...versioned,
      revision: 3,
      sessions: [
        session("project", [{ ...person("a"), lifecycle: currentMarker }]),
      ],
    };
    expect(gate.read(current)).toMatchObject({ reset: true, events: [] });
    expect(gate.read({ ...current, revision: 4 })).toMatchObject({
      reset: false,
      events: [],
    });
    expect(
      gate.read({ ...current, revision: 0, streamId: "replacement" }),
    ).toMatchObject({ reset: true, events: [] });
  });
});
