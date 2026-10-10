import { describe, expect, it } from "vitest";
import {
  residentModel,
  residentVariant,
  RESIDENT_VARIANTS,
} from "../src/appearance";
import { demo } from "../src/demo";

describe("stable resident appearance", () => {
  it("maps every identity to a bounded, local, padded model URL", () => {
    const ids = [
      "",
      "agent-1",
      "PI-1",
      "pi-1",
      "居民",
      "🦊",
      "../other",
      "a".repeat(8192),
    ];
    for (const id of ids) {
      const variant = residentVariant(id);
      expect(Number.isInteger(variant)).toBe(true);
      expect(variant).toBeGreaterThanOrEqual(0);
      expect(variant).toBeLessThan(RESIDENT_VARIANTS);
      expect(residentModel(id)).toBe(
        `/models/agent-${String(variant + 1).padStart(2, "0")}.glb`,
      );
      expect(residentModel(id)).toMatch(/^\/models\/agent-0[1-8]\.glb$/);
    }
  });

  it("preserves appearance when rooms and agents reorder or reported fields change", () => {
    const agents = demo.sessions.flatMap((session) => session.agents);
    const original = new Map(
      agents.map((agent) => [agent.id, residentModel(agent.id)]),
    );
    for (const state of [
      "working",
      "thinking",
      "waiting",
      "error",
      "completed",
      "offline",
    ]) {
      const updated = agents.toReversed().map((agent, index) => ({
        ...agent,
        state,
        name: `Renamed ${index}`,
        role: "Updated role",
        task: "Updated task",
      }));
      for (const agent of updated)
        expect(residentModel(agent.id)).toBe(original.get(agent.id));
    }
  });

  it("exercises every authored variant without depending on array position", () => {
    const variants = new Set(
      Array.from({ length: 256 }, (_, i) => residentVariant(`resident-${i}`)),
    );
    expect([...variants].sort()).toEqual(
      Array.from({ length: RESIDENT_VARIANTS }, (_, i) => i),
    );
    const demoVariants = demo.sessions.flatMap((session) =>
      session.agents.map((agent) => residentVariant(agent.id)),
    );
    expect(new Set(demoVariants).size).toBeGreaterThanOrEqual(4);
  });
});
