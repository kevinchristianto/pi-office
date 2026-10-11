import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOfficeData } from "../src/useOfficeData";
import type { Snapshot } from "../src/types";

class Events {
  static instances: Events[] = [];
  listeners: Record<string, (event: { data: string }) => void> = {};
  onopen?: () => void;
  onerror?: () => void;
  close = vi.fn();
  constructor() {
    Events.instances.push(this);
  }
  addEventListener(name: string, callback: (event: { data: string }) => void) {
    this.listeners[name] = callback;
  }
  publish(snapshot: Snapshot) {
    this.listeners.snapshot({ data: JSON.stringify(snapshot) });
  }
}
const snapshot = (revision: number, name = "Current resident"): Snapshot => ({
  streamId: "frontend-audit",
  revision,
  updatedAt: Date.now(),
  sessions: [
    {
      id: "source",
      name: "Source",
      agents: [{ id: "main", name, state: "working" }],
    },
  ],
});
beforeEach(() => {
  Events.instances = [];
  vi.stubGlobal("EventSource", Events);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("frontend transport audit", () => {
  it("does not let a late HTTP failure undo an accepted live stream", async () => {
    let reject!: (error: Error) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      ),
    );
    const { result } = renderHook(useOfficeData);
    act(() => Events.instances[0].publish(snapshot(5)));
    const epoch = result.current.lifecycleEpoch;
    await act(async () => reject(new Error("Delayed HTTP failure")));
    expect(result.current.connection).toBe("connected");
    expect(result.current.snapshot.revision).toBe(5);
    expect(result.current.lifecycleEpoch).toBe(epoch);
    act(() => Events.instances[0].publish(snapshot(4, "Older resident")));
    expect(result.current.snapshot.revision).toBe(5);
    expect(result.current.snapshot.sessions[0].agents[0].name).toBe(
      "Current resident",
    );
  });

  it("retains the last snapshot after malformed JSON and baselines the next valid message", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const { result } = renderHook(useOfficeData);
    act(() => Events.instances[0].publish(snapshot(1)));
    const epoch = result.current.lifecycleEpoch;
    act(() => Events.instances[0].listeners.snapshot({ data: "{broken" }));
    expect(result.current.connection).toBe("disconnected");
    expect(result.current.lifecycleEpoch).toBeGreaterThan(epoch);
    expect(result.current.snapshot.revision).toBe(1);
    const restarted = snapshot(2);
    restarted.sessions[0].agents[0].lifecycle = {
      version: 1,
      eventId: "gap-start",
      kind: "start",
      source: "pi:session_start",
      at: new Date().toISOString(),
    };
    act(() => Events.instances[0].publish(restarted));
    expect(result.current.connection).toBe("connected");
    expect(result.current.snapshot.revision).toBe(2);
    expect(result.current.lifecycleEvents).toEqual([]);
  });

  it("aborts HTTP and closes SSE on unmount, ignoring late callbacks", async () => {
    let resolve!: (data: unknown) => void;
    const fetch = vi.fn(
      () =>
        new Promise((finish) => {
          resolve = finish;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const { result, unmount } = renderHook(useOfficeData);
    const before = result.current;
    const stream = Events.instances[0];
    const signal = (fetch.mock.calls[0] as any)[1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    expect(stream.close).toHaveBeenCalledOnce();
    await act(async () => {
      resolve({ ok: true, json: async () => snapshot(1) });
      stream.onopen?.();
      stream.publish(snapshot(2));
      stream.onerror?.();
    });
    expect(result.current).toBe(before);
  });

  it("keeps StrictMode's retired connection from updating the current instance", () => {
    const fetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useOfficeData, {
      reactStrictMode: true,
    });
    expect(Events.instances).toHaveLength(2);
    expect(Events.instances[0].close).toHaveBeenCalledOnce();
    expect((fetch.mock.calls[0] as any)[1].signal.aborted).toBe(true);
    act(() => Events.instances[1].publish(snapshot(2)));
    act(() => {
      Events.instances[0].publish(snapshot(99, "Retired connection"));
      Events.instances[0].onerror?.();
    });
    expect(result.current.connection).toBe("connected");
    expect(result.current.snapshot.revision).toBe(2);
  });
});
