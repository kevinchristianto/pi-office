import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useResidentLifecycle } from "../src/useResidentLifecycle";
import type { AgentLifecycleEvent, Session } from "../src/types";
const agent = (id = "a", state = "working") => ({ id, name: id, state });
const session = (agents = [agent()]): Session => ({
  id: "s",
  name: "Project",
  agents,
});
const event = (
  kind: "start" | "stop",
  id = "1",
  agentId = "a",
): AgentLifecycleEvent => ({
  version: 1,
  kind,
  eventId: id,
  agentId,
  sessionId: "s",
  source: "session_start",
  at: new Date().toISOString(),
});
const initial = () => ({
  sessions: [session()],
  selected: null as string | null,
  events: [] as AgentLifecycleEvent[],
  epoch: 1,
  enabled: true,
  reduced: false,
  connection: "connected" as const,
});
const setup = () => {
  let props = initial();
  const hook = renderHook((input) => useResidentLifecycle(input), {
    initialProps: props,
  });
  return {
    ...hook,
    update: (changes: Partial<typeof props>) => {
      props = { ...props, ...changes };
      hook.rerender(props);
    },
  };
};
describe("marker-driven rendered resident lifetimes", () => {
  it("renders every initial state statically and never infers lifecycle from status", () => {
    const hook = setup();
    for (const state of ["offline", "stale", "idle", "working"]) {
      hook.update({ sessions: [session([agent("a", state)])] });
      expect(hook.result.current.residents).toHaveLength(1);
      expect(hook.result.current.residents[0].transition).toBeUndefined();
    }
  });
  it("consumes initial markers without animation", () => {
    const props = { ...initial(), events: [event("start")] };
    const hook = renderHook(() => useResidentLifecycle(props));
    expect(hook.result.current.residents[0].transition).toBeUndefined();
  });
  it("retains a stopped idle child until route completion then stays absent on fresh snapshots", () => {
    const hook = setup();
    hook.update({
      events: [event("stop")],
      sessions: [session([agent("a", "idle")])],
    });
    const resident = hook.result.current.residents[0];
    expect(resident.transition?.direction).toBe("exiting");
    hook.update({ sessions: [session([agent("a", "working")])], events: [] });
    expect(hook.result.current.residents[0].transition?.direction).toBe(
      "exiting",
    );
    act(() => hook.result.current.complete(resident.key, "1", "exiting"));
    expect(hook.result.current.residents).toHaveLength(0);
    hook.update({ sessions: [session([agent()])] });
    expect(hook.result.current.residents).toHaveLength(0);
  });
  it("retains removed payload and original desk throughout a marked departure", () => {
    const hook = setup();
    hook.update({ sessions: [session([])], events: [event("stop")] });
    expect(hook.result.current.residents[0].agent.id).toBe("a");
    expect(hook.result.current.residents[0].deskIndex).toBe(0);
    hook.update({ sessions: [session([])], events: [] });
    expect(hook.result.current.residents).toHaveLength(1);
  });
  it("starts real arrivals, ignores duplicate markers and accepts only current completion tokens", () => {
    const hook = setup();
    hook.update({ events: [event("stop", "stop")] });
    let resident = hook.result.current.residents[0];
    const slot = resident.transition?.queueIndex;
    hook.update({ events: [event("start", "restart")] });
    resident = hook.result.current.residents[0];
    expect(resident.transition).toEqual({
      token: "restart",
      direction: "arriving",
      queueIndex: slot,
    });
    act(() => hook.result.current.complete(resident.key, "stop", "exiting"));
    expect(hook.result.current.residents[0].transition?.direction).toBe(
      "arriving",
    );
    act(() =>
      hook.result.current.complete(resident.key, "restart", "arriving"),
    );
    hook.update({
      events: [event("start", "restart")],
      sessions: [session([agent("a", "thinking")])],
    });
    expect(hook.result.current.residents[0].transition).toBeUndefined();
  });
  it("keeps stopped disposition through focus changes but resets on a new epoch", () => {
    const hook = setup();
    hook.update({ events: [event("stop")] });
    hook.update({
      sessions: [{ id: "other", name: "Other", agents: [agent("b")] }],
    });
    hook.update({ sessions: [session()] });
    expect(hook.result.current.residents).toHaveLength(0);
    hook.update({ epoch: 2 });
    expect(hook.result.current.residents[0].transition).toBeUndefined();
  });
  it("settles immediately when reduced motion is enabled and ignores stale callbacks after scope change", () => {
    const hook = setup();
    hook.update({ events: [event("stop")] });
    const complete = hook.result.current.complete;
    const resident = hook.result.current.residents[0];
    hook.update({ reduced: true });
    expect(hook.result.current.residents).toHaveLength(0);
    hook.update({ epoch: 2, reduced: false, events: [] });
    act(() => complete(resident.key, "1", "exiting"));
    expect(hook.result.current.residents).toHaveLength(1);
  });
  it("uses distinct stable queue slots for simultaneous starts and stops", () => {
    const hook = setup();
    hook.update({ sessions: [session([agent("a"), agent("b"), agent("c")])] });
    hook.update({
      events: [
        event("stop", "stop", "a"),
        event("start", "b", "b"),
        event("start", "c", "c"),
      ],
    });
    const entries = hook.result.current.residents;
    expect(entries).toHaveLength(3);
    expect(
      new Set(entries.map((entry) => entry.transition!.queueIndex)).size,
    ).toBe(3);
    const a = entries.find((entry) => entry.agent.id === "a")!;
    const before = entries.find((entry) => entry.agent.id === "c")!.transition!
      .queueIndex;
    act(() => hook.result.current.complete(a.key, "stop", "exiting"));
    expect(
      hook.result.current.residents.find((entry) => entry.agent.id === "c")!
        .transition!.queueIndex,
    ).toBe(before);
  });
  it("does not replay offscreen events when selecting an overflow resident", () => {
    const hook = setup();
    const agents = Array.from({ length: 8 }, (_, index) =>
      agent(String(index)),
    );
    hook.update({
      sessions: [session(agents)],
      events: [event("start", "hidden", "7")],
    });
    hook.update({ selected: "7" });
    expect(
      hook.result.current.residents.find((entry) => entry.agent.id === "7")!
        .transition,
    ).toBeUndefined();
  });
  it("preserves both desks when A exits and a surviving B moves earlier in the roster", () => {
    const hook = setup();
    hook.update({ sessions: [session([agent("a"), agent("b")])] });
    hook.update({
      sessions: [session([agent("b")])],
      events: [event("stop", "stop-a", "a")],
    });
    const outgoing = hook.result.current.residents.find(
      (entry) => entry.agent.id === "a",
    )!;
    expect(outgoing.deskIndex).toBe(0);
    expect(
      hook.result.current.residents.find((entry) => entry.agent.id === "b")!
        .deskIndex,
    ).toBe(1);
    hook.update({ sessions: [session([agent("b", "thinking")])] });
    expect(
      hook.result.current.residents.find((entry) => entry.agent.id === "a")!
        .transition?.direction,
    ).toBe("exiting");
    act(() => hook.result.current.complete(outgoing.key, "stop-a", "exiting"));
    expect(
      hook.result.current.residents.map((entry) => [
        entry.agent.id,
        entry.deskIndex,
      ]),
    ).toEqual([["b", 1]]);
  });
  it("keeps active arrival targets stable under roster reorder", () => {
    const hook = setup();
    hook.update({
      sessions: [session([agent("a"), agent("b")])],
      events: [event("start", "b-start", "b")],
    });
    hook.update({ sessions: [session([agent("b"), agent("a")])] });
    expect(
      hook.result.current.residents.find((entry) => entry.agent.id === "b")!
        .deskIndex,
    ).toBe(1);
    expect(
      hook.result.current.residents.find((entry) => entry.agent.id === "a")!
        .deskIndex,
    ).toBe(0);
  });
  it("bounds remembered stops while prioritizing current residents over old offscreen history", () => {
    const hook = setup();
    hook.update({
      events: [
        event("stop", "stop-a"),
        ...Array.from({ length: 600 }, (_, index) =>
          event("stop", `hidden-${index}`, `hidden-${index}`),
        ),
      ],
    });
    const outgoing = hook.result.current.residents[0];
    act(() => hook.result.current.complete(outgoing.key, "stop-a", "exiting"));
    hook.update({
      events: [],
      sessions: [session([agent("a"), agent("hidden-0"), agent("hidden-599")])],
    });
    expect(
      hook.result.current.residents.map((entry) => entry.agent.id),
    ).toEqual(["hidden-0"]);
  });
});

it("cancels only an unrendered departure when stop and restart share a render", () => {
  const hook = setup();
  hook.update({
    events: [event("stop", "brief-stop"), event("start", "brief-start")],
  });
  expect(hook.result.current.residents).toHaveLength(1);
  expect(hook.result.current.residents[0].transition).toBeUndefined();
  hook.update({ events: [event("stop", "real-stop")] });
  const outgoing = hook.result.current.residents[0];
  act(() => hook.result.current.complete(outgoing.key, "real-stop", "exiting"));
  expect(hook.result.current.residents).toHaveLength(0);
  hook.update({
    events: [event("stop", "offsite-stop"), event("start", "new-arrival")],
  });
  expect(hook.result.current.residents[0].transition).toMatchObject({
    direction: "arriving",
    token: "new-arrival",
  });
});

it("does not show a new resident whose arrival and stop share a render", () => {
  const hook = setup();
  hook.update({
    sessions: [session([agent(), agent("b")])],
    events: [
      event("start", "brief-start", "b"),
      event("stop", "brief-stop", "b"),
    ],
  });
  expect(hook.result.current.residents.map((entry) => entry.agent.id)).toEqual([
    "a",
  ]);
});
