import { describe, expect, it } from "vitest";
import {
  normalizeAbsoluteCwd,
  projectOffices,
  residentIdentity,
  visualAgentId,
} from "../src/projectProjection";
import { residentModel } from "../src/appearance";
import { visibleAgents } from "../src/useResidentLifecycle";
import type { Session, SessionProject } from "../src/types";

const project = (
  root = "/work/app",
  id = `project:${root}`,
): SessionProject => ({
  id,
  root,
  name: "app",
  kind: "git",
  platform: "linux",
});
const session = (id: string, patch: Partial<Session> = {}): Session => ({
  id,
  name: `Session ${id}`,
  cwd: "/work/app",
  project: project(),
  agents: [
    { id: "main", name: `Root ${id}`, state: "working", role: "orchestrator" },
  ],
  ...patch,
});

describe("pure project office projection", () => {
  it("combines source sessions while leaving all transport data unchanged", () => {
    const sources = [session("a"), session("b", { cwd: "/work/app/src" })];
    const before = JSON.stringify(sources);
    const [office] = projectOffices(sources);
    expect(office.sourceSessions).toEqual(sources);
    expect(office.agents).toHaveLength(2);
    expect(office.agents.map((agent) => agent.id)).toEqual([
      visualAgentId("a", "main"),
      visualAgentId("b", "main"),
    ]);
    expect(office.agents[1].source).toMatchObject({
      sessionId: "b",
      agentId: "main",
      cwd: "/work/app/src",
    });
    expect(JSON.stringify(sources)).toBe(before);
    expect(office.agents[0]).not.toBe(sources[0].agents[0]);
  });

  it("keeps same-basename repos and individual worktrees distinct", () => {
    const offices = projectOffices([
      session("a"),
      session("b", { project: project("/other/app") }),
      session("c", { project: project("/work/app-feature") }),
    ]);
    expect(offices).toHaveLength(3);
    expect(new Set(offices.map((office) => office.id)).size).toBe(3);
  });

  it("preserves visual and raw lifecycle identities across collisions and reorder", () => {
    const a = session("a");
    const first = projectOffices([a])[0].agents[0];
    const together = projectOffices([session("b"), a])[0].agents.find(
      (agent) => agent.source!.sessionId === "a",
    )!;
    expect(first.id).toBe(together.id);
    expect(residentIdentity("any-room", together)).toBe(
      JSON.stringify(["a", "main"]),
    );
    expect(residentModel(together.source!.agentId)).toBe(
      residentModel(a.agents[0].id),
    );
    expect(visualAgentId('a","b', "c")).not.toBe(visualAgentId("a", 'b","c'));
  });

  it("only aliases exact legacy root paths during a mixed observer upgrade", () => {
    const known = session("a");
    const legacy = session("b", { project: undefined, cwd: "/work/app/./" });
    const nested = session("c", { project: undefined, cwd: "/work/app/src" });
    const offices = projectOffices([known, legacy, nested]);
    expect(offices).toHaveLength(2);
    expect(
      offices
        .find((office) => office.id === known.project!.id)!
        .sourceSessions.map((source) => source.id),
    ).toEqual(["a", "b"]);
  });

  it("does not alias ambiguous same-path metadata with distinct authoritative IDs", () => {
    const offices = projectOffices([
      session("a"),
      session("b", { project: project("/work/app", "project:other") }),
      session("c", { project: undefined }),
    ]);
    expect(offices).toHaveLength(3);
  });

  it("isolates unknown, explicitly unresolved and relative paths", () => {
    const offices = projectOffices([
      session("a", { project: null }),
      session("b", { project: null }),
      session("c", { project: undefined, cwd: "relative/app" }),
      session("d", { project: undefined, cwd: "relative/app" }),
    ]);
    expect(offices).toHaveLength(4);
  });

  it("normalizes exact legacy paths without guessing roots or folding case", () => {
    expect(normalizeAbsoluteCwd("/work//app/./")).toBe("/work/app");
    expect(normalizeAbsoluteCwd("C:\\work\\app\\.\\")).toBe("C:/work/app");
    expect(normalizeAbsoluteCwd("\\\\server\\share\\.")).toBe("//server/share");
    expect(normalizeAbsoluteCwd("/work/a\\b")).toBe("/work/a\\b");
    expect(normalizeAbsoluteCwd("C:relative")).toBeNull();
    expect(normalizeAbsoluteCwd("/work/link/../app")).toBeNull();
    expect(normalizeAbsoluteCwd("/work/app\u007f")).toBeNull();
    expect(
      projectOffices([
        session("a", { project: undefined, cwd: "C:\\Work\\App" }),
        session("b", { project: undefined, cwd: "C:\\work\\app" }),
      ]),
    ).toHaveLength(2);
  });

  it("prioritizes live projects and live roots over old observations and six-desk limits", () => {
    const history = session("old", {
      connectionState: "offline",
      agents: Array.from({ length: 8 }, (_, i) => ({
        id: `old-${i}`,
        name: "Old",
        state: "error",
      })),
    });
    const live = session("new", {
      agents: [
        ...Array.from({ length: 7 }, (_, i) => ({
          id: `child-${i}`,
          name: "Child",
          state: "working",
        })),
        {
          id: "root",
          name: "Live root",
          state: "working",
          role: "orchestrator",
        },
      ],
    });
    const otherOld = session("old-project", {
      project: project("/aaa/app"),
      connectionState: "offline",
    });
    const offices = projectOffices([otherOld, history, live]);
    expect(offices[0].id).toBe(live.project!.id);
    expect(offices[0].liveAgentCount).toBe(8);
    expect(offices[0].historyAgentCount).toBe(8);
    const shown = visibleAgents(offices[0], null);
    expect(shown).toHaveLength(6);
    expect(shown[0].name).toBe("Live root");
    expect(shown.every((agent) => !agent.source!.historical)).toBe(true);
    const selected = visualAgentId("old", "old-7");
    expect(visibleAgents(offices[0], selected)).toEqual(shown);
  });

  it("does not mistake an idle live root for historical work", () => {
    const [office] = projectOffices([
      session("a", { agents: [{ id: "root", name: "Root", state: "idle" }] }),
    ]);
    expect(office.liveAgentCount).toBe(1);
    expect(office.historyAgentCount).toBe(0);
  });

  it("isolates legacy cwd values at the bridge truncation boundary", () => {
    const cwd = "/" + "a".repeat(999);
    expect(
      projectOffices([
        session("a", { project: undefined, cwd }),
        session("b", { project: undefined, cwd }),
      ]),
    ).toHaveLength(2);
  });
});
