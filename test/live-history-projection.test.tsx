import { describe, expect, it } from "vitest";
import { isHistoricalAgent, projectOffices } from "../src/projectProjection";
import type { Agent, Session } from "../src/types";
const agent: Agent = { id: "root", name: "Root", state: "idle" };
const session = (patch: Partial<Session> = {}): Session => ({
  id: "a",
  name: "A",
  cwd: "/work/app",
  agents: [agent],
  ...patch,
});
describe("current office versus retained history", () => {
  it("keeps stale residents current until the bridge offline threshold", () => {
    expect(
      isHistoricalAgent(
        session({ connectionState: "stale", connected: false }),
        { ...agent, state: "stale" },
      ),
    ).toBe(false);
    expect(
      isHistoricalAgent(session({ connectionState: "offline" }), agent),
    ).toBe(true);
    expect(isHistoricalAgent(session({ connected: false }), agent)).toBe(true);
  });
  it("treats stops as historical even when reported state is idle, but task completion is current", () => {
    const lifecycle = {
      version: 1 as const,
      kind: "stop" as const,
      eventId: "stop",
      source: "pi:session_shutdown" as const,
      at: new Date().toISOString(),
    };
    expect(isHistoricalAgent(session(), { ...agent, lifecycle })).toBe(true);
    expect(
      isHistoricalAgent(session(), {
        ...agent,
        lifecycle: { ...lifecycle, kind: "start", source: "pi:session_start" },
      }),
    ).toBe(false);
    expect(isHistoricalAgent(session(), { ...agent, state: "completed" })).toBe(
      false,
    );
    expect(isHistoricalAgent(session(), { ...agent, state: "error" })).toBe(
      false,
    );
  });
  it("retains offline source history without letting a live grouped session mask it", () => {
    const sources = [
      session({ id: "old", connectionState: "offline" }),
      session({ id: "new", connectionState: "live" }),
    ];
    const unchanged = JSON.stringify(sources);
    const [office] = projectOffices(sources);
    expect(office.connectionState).toBe("live");
    expect(office.liveAgentCount).toBe(1);
    expect(office.historyAgentCount).toBe(1);
    expect(
      office.agents.map((item) => isHistoricalAgent(office, item)),
    ).toEqual([false, true]);
    expect(JSON.stringify(sources)).toBe(unchanged);
  });
  it("keeps a history-only project inspectable with zero current residents", () => {
    const [office] = projectOffices([session({ connectionState: "offline" })]);
    expect(office.agents).toHaveLength(1);
    expect(office.liveAgentCount).toBe(0);
    expect(office.historyAgentCount).toBe(1);
    expect(isHistoricalAgent(office, office.agents[0])).toBe(true);
  });
});
