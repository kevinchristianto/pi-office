import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLifecycleGate,
  LIFECYCLE_EVENT_MAX_AGE_MS,
} from "../src/lifecycle";
import { useOfficeData } from "../src/useOfficeData";
import type { Agent, AgentLifecycleMarker, Snapshot } from "../src/types";
const agent = (id = "a", marker?: AgentLifecycleMarker): Agent => ({
  id,
  name: id,
  state: "idle",
  lifecycle: marker,
});
const marker = (
  eventId: string,
  kind: "start" | "stop",
  at = 1100,
): AgentLifecycleMarker => ({
  version: 1,
  eventId,
  kind,
  at: new Date(at).toISOString(),
  source: kind === "start" ? "pi:session_start" : "pi:session_shutdown",
});
const snapshot = (
  revision: number,
  agents: Agent[] = [],
  streamId = "bridge-one",
): Snapshot => ({
  revision,
  streamId,
  updatedAt: 1000,
  sessions: [{ id: "s", name: "Session", agents }],
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("explicit lifecycle stream gate", () => {
  it("baselines initial load and emits only fresh exact events during continuity", () => {
    let now = 1000;
    const gate = createLifecycleGate(() => now);
    expect(
      gate.read(snapshot(1, [agent("old", marker("initial", "start", 900))]))
        .events,
    ).toEqual([]);
    now = 1200;
    expect(
      gate
        .read(snapshot(2, [agent("old"), agent("a", marker("birth", "start"))]))
        .events.map((e) => e.eventId),
    ).toEqual(["birth"]);
    now = 1300;
    expect(
      gate.read(
        snapshot(3, [agent("a", marker("birth", "start")), agent("old")]),
      ).events,
    ).toEqual([]);
    expect(
      gate
        .read(snapshot(4, [agent("a", marker("stop", "stop", 1250))]))
        .events.map((e) => e.kind),
    ).toEqual(["stop"]);
  });
  it("never treats membership, reorder, task completion, stale, offline or recovery as lifecycle", () => {
    const gate = createLifecycleGate(() => 1200);
    gate.read(snapshot(0));
    expect(gate.read(snapshot(1, [agent("a"), agent("b")])).events).toEqual([]);
    expect(gate.read(snapshot(2, [agent("b"), agent("a")])).events).toEqual([]);
    for (const [index, state] of [
      "working",
      "completed",
      "stale",
      "offline",
      "idle",
    ].entries())
      expect(
        gate.read(snapshot(index + 3, [{ ...agent("a"), state }])).events,
      ).toEqual([]);
    expect(gate.read(snapshot(9))).toMatchObject({ events: [] });
  });
  it("baselines reconnect, bridge replacement, and old clients without identity/revisions", () => {
    let now = 1000;
    const gate = createLifecycleGate(() => now);
    gate.read(snapshot(1, [agent()]));
    gate.reset();
    now = 1200;
    expect(
      gate.read(snapshot(3, [agent("a", marker("during-gap", "stop"))])).events,
    ).toEqual([]);
    expect(
      gate.read(
        snapshot(
          0,
          [agent("a", marker("restart", "start", 1200))],
          "bridge-two",
        ),
      ).events,
    ).toEqual([]);
    expect(
      gate.read({
        sessions: snapshot(1, [agent("a", marker("legacy", "start", 1200))])
          .sessions,
        updatedAt: 1200,
      }).events,
    ).toEqual([]);
  });
  it("rejects reordered revisions and baseline-aged, late, future, malformed or unknown-row stop markers", () => {
    let now = 1000;
    const gate = createLifecycleGate(() => now);
    gate.read(snapshot(10, [agent()]));
    now = 1200;
    expect(
      gate.read(snapshot(9, [agent("a", marker("old-frame", "stop"))]))
        .accepted,
    ).toBe(false);
    expect(
      gate.read(snapshot(11, [agent("a", marker("old-event", "stop", 999))]))
        .events,
    ).toEqual([]);
    expect(
      gate.read(snapshot(12, [agent("new", marker("never-seen", "stop"))]))
        .events,
    ).toEqual([]);
    expect(
      gate.read(snapshot(13, [agent("new", marker("future", "start", 1201))]))
        .events,
    ).toEqual([]);
    expect(
      gate.read(
        snapshot(14, [
          agent("new", {
            ...marker("bad", "start"),
            source: "task:start",
          } as any),
        ]),
      ).events,
    ).toEqual([]);
    now += LIFECYCLE_EVENT_MAX_AGE_MS + 1;
    expect(
      gate.read(snapshot(15, [agent("new", marker("late", "start"))])).events,
    ).toEqual([]);
  });
  it("does not replay a marker after a field reset or repeated heartbeat", () => {
    let now = 1000;
    const gate = createLifecycleGate(() => now);
    gate.read(snapshot(0));
    now = 1200;
    const birth = marker("once", "start");
    expect(gate.read(snapshot(1, [agent("a", birth)])).events).toHaveLength(1);
    expect(gate.read(snapshot(1, [agent("a", birth)])).events).toEqual([]);
    gate.read(snapshot(2, [agent("a")]));
    expect(gate.read(snapshot(3, [agent("a", birth)])).events).toEqual([]);
  });
});
class FakeEvents {
  static current: FakeEvents;
  listeners: Record<string, (event: any) => void> = {};
  onopen?: () => void;
  onerror?: () => void;
  close = vi.fn();
  constructor() {
    FakeEvents.current = this;
  }
  addEventListener(name: string, callback: (event: any) => void) {
    this.listeners[name] = callback;
  }
  publish(data: Snapshot) {
    this.listeners.snapshot({ data: JSON.stringify(data) });
  }
}
describe("office transport lifecycle gating", () => {
  it("ignores a late HTTP response and clears lifecycle effects on reconnect with an epoch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    vi.stubGlobal("EventSource", FakeEvents);
    const { result, unmount } = renderHook(useOfficeData);
    act(() => {
      FakeEvents.current.onopen?.();
      FakeEvents.current.publish(snapshot(1, [agent()]));
    });
    await act(async () => {
      resolveFetch({ ok: true, json: async () => snapshot(0) });
    });
    expect(result.current.snapshot.revision).toBe(1);
    vi.setSystemTime(1200);
    act(() =>
      FakeEvents.current.publish(
        snapshot(2, [agent("a", marker("birth", "start"))]),
      ),
    );
    expect(result.current.lifecycleEvents).toHaveLength(1);
    const oldEpoch = result.current.lifecycleEpoch;
    act(() => FakeEvents.current.onerror?.());
    expect(result.current.connection).toBe("disconnected");
    expect(result.current.lifecycleEvents).toEqual([]);
    act(() => {
      FakeEvents.current.onopen?.();
      FakeEvents.current.publish(
        snapshot(3, [agent("a", marker("gap-stop", "stop"))]),
      );
    });
    expect(result.current.connection).toBe("connected");
    expect(result.current.lifecycleEvents).toEqual([]);
    expect(result.current.lifecycleEpoch).toBeGreaterThan(oldEpoch);
    unmount();
    expect(FakeEvents.current.close).toHaveBeenCalledOnce();
  });
  it("changes epoch even when disconnect and reconnect are batched into one connected render", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => snapshot(0) })),
    );
    vi.stubGlobal("EventSource", FakeEvents);
    const { result } = renderHook(useOfficeData);
    await act(async () => {
      FakeEvents.current.onopen?.();
      FakeEvents.current.publish(snapshot(1, [agent()]));
    });
    const oldEpoch = result.current.lifecycleEpoch;
    act(() => {
      FakeEvents.current.onerror?.();
      FakeEvents.current.onopen?.();
      FakeEvents.current.publish(snapshot(2, [agent()]));
    });
    expect(result.current.connection).toBe("connected");
    expect(result.current.lifecycleEvents).toEqual([]);
    expect(result.current.lifecycleEpoch).toBeGreaterThan(oldEpoch);
  });
});
