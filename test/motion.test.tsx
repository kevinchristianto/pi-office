import { describe, it, expect } from "vitest";
import { createMotion, requestMotion, stepMotion } from "../src/motion";
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
    for (let i = 0; i < 20; i++) stepMotion(s, 0.05, 8, "r", "a", r);
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
      expect(s.distance).toBeLessThanOrEqual(0.06);
      for (let i = 0; i < 160; i++) stepMotion(s, 0.05, 1, "r", "a", r);
      expect(s.mode).toBe("seated");
      expect(r.size).toBe(0);
    }
  });
});
