import { describe, it, expect } from "vitest";
import {
  animationPlaybackRate,
  createMotion,
  motionFrameDelta,
  requestMotion,
  stepHeading,
  stepMotion,
  WALK_GAIT_RATE,
  WALK_SPEED,
  WALK_TURN_SPEED,
} from "../src/motion";
describe("visual movement reservations", () => {
  it("queues another character until the first round trip finishes", () => {
    const a = createMotion(),
      b = createMotion(),
      rooms = new Map<string, string>();
    requestMotion(a, "walk", 0);
    requestMotion(b, "walk", 0);
    stepMotion(a, 0.05, 1, "room", "a", rooms);
    stepMotion(b, 0.05, 1, "room", "b", rooms);
    expect(a.mode).toBe("outbound");
    expect(b.mode).toBe("seated");
    expect(b.pending).toBe(true);
    for (let i = 0; i < 160; i++) {
      stepMotion(a, 0.05, 1, "room", "a", rooms);
      stepMotion(b, 0.05, 1, "room", "b", rooms);
      expect(!(a.mode !== "seated" && b.mode !== "seated")).toBe(true);
    }
    expect(a.mode).toBe("seated");
    expect(b.mode).not.toBe("seated");
  });
  it("return interrupts outbound movement without teleporting and releases the aisle", () => {
    const s = createMotion(),
      r = new Map<string, string>();
    requestMotion(s, "walk", 0);
    for (let i = 0; i < 10; i++) stepMotion(s, 0.05, 8, "r", "a", r);
    const distance = s.distance;
    requestMotion(s, "return", 1);
    expect(s.distance).toBe(distance);
    for (let i = 0; i < 9; i++) {
      stepMotion(s, 0.05, 8, "r", "a", r);
      expect(s.distance).toBe(distance);
      expect(r.get("r")).toBe("a");
    }
    for (let i = 0; i < 40; i++) stepMotion(s, 0.05, 8, "r", "a", r);
    expect(s.mode).toBe("seated");
    expect(s.distance).toBe(0);
    expect(r.size).toBe(0);
  });
  it("wave has a time bound and does not change the route or acquire a room", () => {
    const s = createMotion();
    requestMotion(s, "wave", 10);
    expect(s.waveUntil).toBe(12.6);
    expect(s.mode).toBe("seated");
    expect(s.pending).toBe(false);
  });
  it("cancels a waiting request and allows independent rooms to move", () => {
    const a = createMotion(),
      b = createMotion(),
      r = new Map<string, string>();
    requestMotion(a, "walk", 0);
    requestMotion(b, "walk", 0);
    stepMotion(a, 0.05, 3, "a", "1", r);
    stepMotion(b, 0.05, 3, "b", "2", r);
    expect(r.size).toBe(2);
    const c = createMotion();
    requestMotion(c, "walk", 0);
    requestMotion(c, "return", 0);
    expect(c.pending).toBe(false);
  });
  it("large interrupted frame does not teleport and repeated cycles finish cleanly", () => {
    const s = createMotion(),
      r = new Map<string, string>();
    for (let cycle = 0; cycle < 10; cycle++) {
      requestMotion(s, "walk", 0);
      stepMotion(s, 100, 1, "r", "a", r);
      expect(s.distance).toBeLessThanOrEqual(WALK_SPEED * 0.05);
      for (let i = 0; i < 160; i++) stepMotion(s, 0.05, 1, "r", "a", r);
      expect(s.mode).toBe("seated");
      expect(r.size).toBe(0);
    }
  });
});

describe("shared brisk travel and heading clock", () => {
  it("walks fifty percent faster with the same distance per authored gait cycle", () => {
    expect(WALK_SPEED).toBe(1.8);
    expect(WALK_GAIT_RATE).toBe(1.5);
    expect(WALK_SPEED / WALK_GAIT_RATE).toBeCloseTo(1.2);
    expect(animationPlaybackRate("Walk")).toBe(1.5);
    expect(animationPlaybackRate("work")).toBe(1);
    expect(animationPlaybackRate("idleseated")).toBe(1);
    const state = createMotion();
    const reservations = new Map<string, string>();
    requestMotion(state, "walk", 0);
    for (let i = 0; i < 60; i++)
      stepMotion(state, 1 / 60, 8, "room", "actor", reservations);
    expect(state.distance).toBeCloseTo(WALK_SPEED);
  });

  it("bounds every visible turn, takes the short wraparound, and finishes exactly", () => {
    for (const target of [Math.PI / 2, -Math.PI / 2, Math.PI, -Math.PI]) {
      let heading = 0;
      for (let frame = 0; frame < 60; frame++) {
        const next = stepHeading(heading, target, 1 / 60);
        expect(Math.abs(next - heading)).toBeLessThanOrEqual(
          WALK_TURN_SPEED / 60 + 1e-12,
        );
        heading = next;
      }
      expect(Math.cos(heading)).toBeCloseTo(Math.cos(target));
      expect(Math.sin(heading)).toBeCloseTo(Math.sin(target));
    }
    const acrossWrap = stepHeading(Math.PI - 0.02, -Math.PI + 0.02, 1 / 60);
    expect(acrossWrap).toBeCloseTo(Math.PI + 0.02);
    expect(stepHeading(0, Math.PI, 600)).toBeCloseTo(-WALK_TURN_SPEED * 0.05);
    expect(stepHeading(0, Math.PI, -1)).toBe(0);
  });

  it("uses the same paused and resumed frame budget for travel, gait, and turns", () => {
    expect(motionFrameDelta(600)).toBe(0.05);
    expect(motionFrameDelta(-1)).toBe(0);
    expect(motionFrameDelta(NaN)).toBe(0);
    expect(motionFrameDelta(1 / 60)).toBe(1 / 60);
  });
});
