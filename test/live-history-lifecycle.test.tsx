import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { projectOffices, visualAgentId } from "../src/projectProjection";
import {
  useResidentLifecycle,
  visibleAgents,
} from "../src/useResidentLifecycle";
import type {
  Agent,
  AgentLifecycleEvent,
  AgentLifecycleMarker,
  Session,
} from "../src/types";

const person = (id: string, overrides: Partial<Agent> = {}): Agent => ({
  id,
  name: id,
  state: "working",
  ...overrides,
});
const session = (
  agents: Agent[],
  overrides: Partial<Session> = {},
): Session => ({
  id: "s",
  name: "Project",
  agents,
  ...overrides,
});
const marker = (
  kind: "start" | "stop",
  eventId: string,
  second: number,
): AgentLifecycleMarker => ({
  version: 1,
  kind,
  eventId,
  at: new Date(Date.UTC(2026, 9, 11, 8, 0, second)).toISOString(),
  source: "pi-subagents:child-status",
});
const event = (
  lifecycle: AgentLifecycleMarker,
  agentId = "a",
  sessionId = "s",
): AgentLifecycleEvent => ({ ...lifecycle, sessionId, agentId });
type Props = Parameters<typeof useResidentLifecycle>[0];
function setup(overrides: Partial<Props> = {}) {
  let props: Props = {
    sessions: [session([person("a")])],
    selected: null,
    events: [],
    epoch: 1,
    enabled: true,
    reduced: false,
    connection: "connected",
    ...overrides,
  };
  const hook = renderHook((input) => useResidentLifecycle(input), {
    initialProps: props,
  });
  return {
    ...hook,
    update(changes: Partial<Props>) {
      props = { ...props, ...changes };
      hook.rerender(props);
    },
  };
}
const ids = (hook: ReturnType<typeof setup>) =>
  hook.result.current.residents.map((entry) => entry.agent.id);

describe("current office occupants with retained historical observations", () => {
  it("does not carry a live stop into an unrelated demo identity across mode switches", () => {
    const stop = marker("stop", "live-stop", 2);
    const hook = setup();
    hook.update({ events: [event(stop)] });
    expect(hook.result.current.residents[0].transition?.direction).toBe(
      "exiting",
    );
    hook.update({
      enabled: false,
      events: [],
      sessions: [session([person("a")])],
    });
    expect(ids(hook)).toEqual(["a"]);
    expect(hook.result.current.residents[0].transition).toBeUndefined();
    hook.update({
      enabled: true,
      sessions: [session([person("a", { lifecycle: stop })])],
    });
    expect(ids(hook)).toEqual([]);
  });

  it.each([false, true])(
    "excludes initial stops and offline agents with reduced motion %s and keeps nonterminal task states",
    (reduced) => {
      const agents = [
        person("stopped", {
          state: "idle",
          lifecycle: marker("stop", "old", 1),
        }),
        person("offline", { state: "offline" }),
        ...["stale", "idle", "done", "error"].map((state) =>
          person(state, { state }),
        ),
      ];
      const hook = setup({ reduced, sessions: [session(agents)] });
      expect(ids(hook)).toEqual(["stale", "idle", "done", "error"]);
      expect(
        hook.result.current.residents.every((entry) => !entry.transition),
      ).toBe(true);
      hook.update({ epoch: 2, enabled: false });
      expect(ids(hook)).toEqual(["stale", "idle", "done", "error"]);
      expect(agents).toHaveLength(6);
    },
  );

  it("filters history before the desk window and cannot promote selected history into a live seat", () => {
    const agents = [
      person("old", { lifecycle: marker("stop", "old-stop", 1) }),
      ...Array.from({ length: 8 }, (_, index) => person(`current-${index}`)),
      person("offline", { state: "offline" }),
    ];
    const data = session(agents);
    const expected = agents.slice(1, 7);
    expect(visibleAgents(data, null)).toEqual(expected);
    expect(visibleAgents(data, "old")).toEqual(expected);
    expect(visibleAgents(data, "offline")).toEqual(expected);
    expect(visibleAgents(data, "current-7").at(-1)?.id).toBe("current-7");
    expect(agents).toHaveLength(10);
  });

  it("reacts to raw session availability changes without waiting for an agent-field change", () => {
    const agents = [person("a")];
    const hook = setup({
      sessions: [session(agents, { connectionState: "live" })],
    });
    hook.update({
      sessions: [
        session(agents, { connectionState: "stale", connected: false }),
      ],
    });
    expect(ids(hook)).toEqual(["a"]);
    hook.update({
      sessions: [
        session(agents, { connectionState: "offline", connected: false }),
      ],
    });
    expect(ids(hook)).toEqual([]);
    hook.update({
      sessions: [session(agents, { connectionState: "live", connected: true })],
    });
    expect(ids(hook)).toEqual(["a"]);
    expect(hook.result.current.residents[0].transition).toBeUndefined();
  });

  it("keeps a filtered sixth-desk departure and fresh actor fields until it reaches the exit", () => {
    const original = Array.from({ length: 6 }, (_, index) =>
      person(String(index)),
    );
    const hook = setup({ sessions: [session(original)], selected: "5" });
    const before = hook.result.current.residents.find(
      (entry) => entry.agent.id === "5",
    )!;
    const stop = marker("stop", "stop-last", 2);
    const historical = person("5", {
      state: "idle",
      task: "Finished",
      lifecycle: stop,
    });
    hook.update({
      sessions: [session([...original.slice(0, 5), person("6"), historical])],
      selected: null,
      events: [event(stop, "5")],
    });
    const exiting = hook.result.current.residents.find(
      (entry) => entry.agent.id === "5",
    )!;
    expect(exiting.key).toBe(before.key);
    expect(exiting.deskIndex).toBe(before.deskIndex);
    expect(exiting.transition?.direction).toBe("exiting");
    expect(exiting.agent.task).toBe("Finished");
    expect(ids(hook)).not.toContain("6");
    hook.update({
      sessions: [
        session([
          ...original.slice(0, 5),
          person("6"),
          { ...historical, task: "Final log" },
        ]),
      ],
      events: [],
      selected: "5",
    });
    expect(
      hook.result.current.residents.find((entry) => entry.key === before.key)
        ?.agent.task,
    ).toBe("Final log");
    act(() => hook.result.current.complete(before.key, "stop-last", "exiting"));
    expect(ids(hook)).toEqual(["0", "1", "2", "3", "4", "6"]);
    hook.update({ epoch: 2 });
    expect(ids(hook)).toEqual(["0", "1", "2", "3", "4", "6"]);
  });

  it("settles an unfinished confirmed stop absent across repeated reconnects and ignores late completion", () => {
    const stop = marker("stop", "stop-a", 2);
    const hook = setup();
    hook.update({
      sessions: [session([person("a", { lifecycle: stop })])],
      events: [event(stop)],
    });
    const outgoing = hook.result.current.residents[0];
    const complete = hook.result.current.complete;
    expect(outgoing.transition?.direction).toBe("exiting");
    for (let epoch = 2; epoch <= 5; epoch++) {
      hook.update({ connection: "disconnected", epoch, events: [] });
      expect(ids(hook)).toEqual([]);
      hook.update({ connection: "connected" });
      expect(ids(hook)).toEqual([]);
    }
    act(() => complete(outgoing.key, "stop-a", "exiting"));
    expect(ids(hook)).toEqual([]);
    const restart = marker("start", "restart", 3);
    hook.update({
      sessions: [session([person("a", { lifecycle: restart })])],
      events: [event(restart)],
    });
    expect(hook.result.current.residents[0].transition?.direction).toBe(
      "arriving",
    );
    act(() => complete(outgoing.key, "stop-a", "exiting"));
    expect(hook.result.current.residents[0].transition?.token).toBe("restart");
  });

  it("does not revive an event-only stop from an unmarked heartbeat or an older baseline start", () => {
    const start = marker("start", "original-start", 1);
    const stop = marker("stop", "observed-stop", 2);
    const hook = setup({
      sessions: [session([person("a", { lifecycle: start })])],
    });
    hook.update({ events: [event(stop)] });
    hook.update({ epoch: 2, connection: "disconnected", events: [] });
    expect(ids(hook)).toEqual([]);
    hook.update({
      connection: "connected",
      sessions: [session([person("a")])],
    });
    expect(ids(hook)).toEqual([]);
    hook.update({ sessions: [session([person("a", { lifecycle: start })])] });
    expect(ids(hook)).toEqual([]);
    const restart = marker("start", "reconnected-start", 3);
    hook.update({
      epoch: 3,
      sessions: [session([person("a", { lifecycle: restart })])],
    });
    expect(ids(hook)).toEqual(["a"]);
    expect(hook.result.current.residents[0].transition).toBeUndefined();
  });

  it("accepts a newer snapshot restart without a fresh animation event or duplicate exit actor", () => {
    const stop = marker("stop", "stop", 2);
    const hook = setup();
    hook.update({
      sessions: [session([person("a", { lifecycle: stop })])],
      events: [event(stop)],
    });
    expect(hook.result.current.residents[0].transition?.direction).toBe(
      "exiting",
    );
    const restart = marker("start", "late-start", 3);
    hook.update({
      sessions: [session([person("a", { lifecycle: restart })])],
      events: [],
    });
    expect(ids(hook)).toEqual(["a"]);
    expect(hook.result.current.residents[0].transition).toBeUndefined();
  });

  it("does not revive a same-millisecond pre-stop start marker but accepts a distinct restart", () => {
    const start = marker("start", "original", 2);
    const stop = marker("stop", "stop", 2);
    const hook = setup({
      sessions: [session([person("a", { lifecycle: start })])],
    });
    hook.update({
      sessions: [session([person("a", { lifecycle: stop })])],
      events: [event(stop)],
    });
    hook.update({
      epoch: 2,
      events: [],
      sessions: [session([person("a", { lifecycle: start })])],
    });
    expect(ids(hook)).toEqual([]);
    const restart = marker("start", "different", 2);
    hook.update({
      epoch: 3,
      sessions: [session([person("a", { lifecycle: restart })])],
    });
    expect(ids(hook)).toEqual(["a"]);
    expect(hook.result.current.residents[0].transition).toBeUndefined();
  });

  it("settles filtered exits immediately for reduced motion and returns only on a real restart", () => {
    const stop = marker("stop", "stop", 2);
    const hook = setup();
    hook.update({
      sessions: [session([person("a", { lifecycle: stop })])],
      events: [event(stop)],
    });
    hook.update({ reduced: true });
    expect(ids(hook)).toEqual([]);
    hook.update({ reduced: false, epoch: 2, events: [] });
    expect(ids(hook)).toEqual([]);
    const start = marker("start", "new-start", 3);
    hook.update({
      reduced: true,
      sessions: [session([person("a", { lifecycle: start })])],
      events: [event(start)],
    });
    expect(ids(hook)).toEqual(["a"]);
    expect(hook.result.current.residents[0].transition).toBeUndefined();
  });

  it("keeps grouped source identities independent when only one colliding raw agent stops", () => {
    const left = session([person("main", { name: "Left" })], {
      id: "left",
      cwd: "/same/project",
    });
    const right = session([person("main", { name: "Right" })], {
      id: "right",
      cwd: "/same/project",
    });
    const history = session([person("main", { name: "History" })], {
      id: "history",
      cwd: "/same/project",
      connectionState: "offline",
    });
    const hook = setup({ sessions: projectOffices([left, right, history]) });
    const rightEntry = hook.result.current.residents.find(
      (entry) => entry.agent.name === "Right",
    )!;
    expect(ids(hook)).toEqual([
      visualAgentId("left", "main"),
      visualAgentId("right", "main"),
    ]);
    const stop = marker("stop", "left-stop", 2);
    const stoppedLeft = {
      ...left,
      agents: [{ ...left.agents[0], lifecycle: stop }],
    };
    hook.update({
      sessions: projectOffices([stoppedLeft, right, history]),
      events: [event(stop, "main", "left")],
    });
    const outgoing = hook.result.current.residents.find(
      (entry) => entry.agent.name === "Left",
    )!;
    expect(outgoing.key).toBe(JSON.stringify(["left", "main"]));
    expect(outgoing.transition?.direction).toBe("exiting");
    expect(
      hook.result.current.residents.find(
        (entry) => entry.key === rightEntry.key,
      )?.deskIndex,
    ).toBe(rightEntry.deskIndex);
    act(() =>
      hook.result.current.complete(outgoing.key, "left-stop", "exiting"),
    );
    hook.update({ selected: visualAgentId("left", "main"), epoch: 2 });
    expect(ids(hook)).toEqual([visualAgentId("right", "main")]);
    expect(hook.result.current.residents[0].transition).toBeUndefined();
  });
});
