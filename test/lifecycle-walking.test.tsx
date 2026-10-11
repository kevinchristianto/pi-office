import { describe, expect, it } from "vitest";
import {
  createLifecycleWalk,
  lifecycleTrafficFor,
  LIFECYCLE_CORRIDOR_KEY,
  MAX_LIFECYCLE_QUEUE,
  releaseLifecycleWalk,
  reverseLifecycleWalk,
  stepLifecycleWalk,
  type LifecycleWalk,
} from "../src/lifecycleWalking";
import { WALK_SPEED } from "../src/motion";
const speed = WALK_SPEED;
const total = 8;
function step(
  state: LifecycleWalk,
  reservations: Map<string, string>,
  id = "one",
  room = "room",
) {
  return stepLifecycleWalk(state, 1 / 60, total, speed, room, id, reservations);
}
function finish(
  state: LifecycleWalk,
  reservations: Map<string, string>,
  id = "one",
  room = "room",
) {
  let result = null;
  for (let i = 0; i < 1000 && !result; i++)
    result = step(state, reservations, id, room);
  return result;
}
describe("frame-driven office arrival and departure", () => {
  it("walks the entire arrival route before seating and completing exactly once", () => {
    const reservations = new Map<string, string>();
    const state = createLifecycleWalk("arriving", total);
    expect(state.distance).toBe(0);
    for (let i = 0; i < 200; i++) expect(step(state, reservations)).toBeNull();
    expect(state.phase).toBe("walking");
    expect(state.distance).toBeCloseTo(6);
    expect(finish(state, reservations)).toBe("arriving");
    expect(state.distance).toBe(total);
    expect(state.phase).toBe("settled");
    expect(reservations.size).toBe(0);
    expect(step(state, reservations)).toBeNull();
  });
  it("stands before walking out and persists until the exterior endpoint", () => {
    const reservations = new Map<string, string>();
    const state = createLifecycleWalk("exiting", total);
    step(state, reservations);
    expect(state.phase).toBe("standing");
    expect(state.distance).toBe(total);
    for (let i = 0; i < 80; i++) expect(step(state, reservations)).toBeNull();
    expect(state.distance).toBeGreaterThan(6);
    expect(state.distance).toBeLessThan(total);
    expect(finish(state, reservations)).toBe("exiting");
    expect(state.distance).toBe(0);
  });
  it("serializes different rooms through one global corridor in FIFO order", () => {
    const reservations = new Map<string, string>();
    const first = createLifecycleWalk("arriving", total);
    const second = createLifecycleWalk("exiting", total);
    const third = createLifecycleWalk("arriving", total);
    step(first, reservations, "first", "a");
    for (let i = 0; i < 40; i++) {
      step(second, reservations, "second", "b");
      step(third, reservations, "third", "c");
    }
    expect(second.phase).toBe("waiting");
    expect(second.distance).toBe(total);
    expect(third.distance).toBe(0);
    expect(reservations.get(LIFECYCLE_CORRIDOR_KEY)).toBe("first");
    expect(finish(first, reservations, "first", "a")).toBe("arriving");
    step(third, reservations, "third", "c");
    expect(third.phase).toBe("waiting");
    step(second, reservations, "second", "b");
    expect(second.phase).toBe("standing");
    expect(finish(second, reservations, "second", "b")).toBe("exiting");
    expect(finish(third, reservations, "third", "c")).toBe("arriving");
  });
  it("waits seated/offsite for a strolling resident and releases canceled waiters", () => {
    const reservations = new Map([["room", "stroller"]]);
    const state = createLifecycleWalk("exiting", total);
    for (let i = 0; i < 30; i++) step(state, reservations);
    expect(state.phase).toBe("waiting");
    expect(state.distance).toBe(total);
    releaseLifecycleWalk(reservations, "room", "one");
    expect(reservations.get("room")).toBe("stroller");
    expect(lifecycleTrafficFor(reservations).queue).toEqual([]);
  });
  it("reverses a stop/restart at the same position without teleporting", () => {
    const reservations = new Map<string, string>();
    const state = createLifecycleWalk("exiting", total);
    for (let i = 0; i < 100; i++) step(state, reservations);
    const before = state.distance;
    reverseLifecycleWalk(state, "arriving", total);
    expect(state.distance).toBe(before);
    for (let frame = 0; frame < 30; frame++) {
      expect(step(state, reservations)).toBeNull();
      expect(state.distance).toBe(before);
      expect(reservations.get(LIFECYCLE_CORRIDOR_KEY)).toBe("one");
    }
    step(state, reservations);
    step(state, reservations);
    expect(state.distance).toBeGreaterThan(before);
    expect(finish(state, reservations)).toBe("arriving");
  });
  it("cancels queued arrival offsite and queued departure in its seat", () => {
    const reservations = new Map([[LIFECYCLE_CORRIDOR_KEY, "other"]]);
    const entry = createLifecycleWalk("arriving", total);
    step(entry, reservations);
    reverseLifecycleWalk(entry, "exiting", total);
    expect(step(entry, reservations)).toBe("exiting");
    expect(entry.distance).toBe(0);
    const exit = createLifecycleWalk("exiting", total);
    step(exit, reservations);
    reverseLifecycleWalk(exit, "arriving", total);
    expect(step(exit, reservations)).toBe("arriving");
    expect(exit.distance).toBe(total);
    expect(reservations.get(LIFECYCLE_CORRIDOR_KEY)).toBe("other");
  });
  it("bounds its queue and removes both ownerships on cleanup", () => {
    const reservations = new Map<string, string>();
    const walkers = Array.from({ length: MAX_LIFECYCLE_QUEUE + 10 }, () =>
      createLifecycleWalk("arriving", total),
    );
    walkers.forEach((state, i) =>
      step(state, reservations, String(i), String(i)),
    );
    expect(lifecycleTrafficFor(reservations).queue.length).toBe(
      MAX_LIFECYCLE_QUEUE,
    );
    releaseLifecycleWalk(reservations, "0", "0");
    expect(reservations.has(LIFECYCLE_CORRIDOR_KEY)).toBe(false);
    expect(reservations.has("0")).toBe(false);
    step(walkers[1], reservations, "1", "1");
    expect(reservations.get(LIFECYCLE_CORRIDOR_KEY)).toBe("1");
  });
  it("does not finish because wall-clock time passes or a tab resumes late", () => {
    const reservations = new Map<string, string>();
    const state = createLifecycleWalk("arriving", total);
    expect(
      stepLifecycleWalk(state, 600, total, speed, "room", "one", reservations),
    ).toBeNull();
    expect(state.distance).toBeCloseTo(speed * 0.05);
    expect(
      stepLifecycleWalk(state, -10, total, speed, "room", "one", reservations),
    ).toBeNull();
    expect(state.distance).toBeCloseTo(speed * 0.05);
  });
});
