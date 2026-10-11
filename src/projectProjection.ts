import type { Agent, Session, SessionProject } from "./types";

export interface ProjectOffice extends Session {
  sourceSessions: readonly Session[];
  liveAgentCount: number;
  historyAgentCount: number;
}

/** Stable even when another session with the same raw agent ID comes or goes. */
export const visualAgentId = (sessionId: string, agentId: string) =>
  `resident:${JSON.stringify([sessionId, agentId])}`;
export const isolatedOfficeId = (sessionId: string) =>
  `session:${JSON.stringify(sessionId)}`;

/** Lifecycle identities remain raw, independent of the display room and ID. */
export const residentIdentity = (roomId: string, agent: Agent) =>
  JSON.stringify([
    agent.source?.sessionId ?? roomId,
    agent.source?.agentId ?? agent.id,
  ]);

/** A lexical fallback only. It cannot infer Git roots, symlinks or parents. */
export function normalizeAbsoluteCwd(cwd: string | undefined): string | null {
  if (!cwd || /[\u0000-\u001f\u007f]/.test(cwd)) return null;
  const windows = /^[a-z]:[\\/]/i.test(cwd) || /^\\\\[^\\]+\\[^\\]+/.test(cwd);
  if (!windows && !cwd.startsWith("/")) return null;
  // A leading // is ambiguous between POSIX and a Windows UNC spelling.
  // Preserve it rather than accidentally merging two unrelated roots.
  // Case is significant unless the observer has verified filesystem identity.
  const path = windows ? cwd.replace(/\\/g, "/") : cwd;
  const prefix = windows
    ? path.startsWith("//")
      ? "//"
      : path.slice(0, 3)
    : path.startsWith("//")
      ? "//"
      : "/";
  const parts: string[] = [];
  for (const part of path.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    // Parent traversal is not lexically safe in the presence of symlinks.
    // Only a filesystem-aware observer can resolve it to a canonical root.
    if (part === "..") return null;
    parts.push(part);
  }
  return prefix + parts.join("/");
}

const availability = (session: Session) => {
  if (session.connectionState === "offline") return 2;
  if (session.connectionState === "stale") return 1;
  if (session.connectionState === "live") return 0;
  if (session.connected === false) return 2;
  return session.agents.length &&
    session.agents.every((agent) => agent.state === "offline")
    ? 2
    : 0;
};
/** History stays inspectable, but must not occupy a live-office desk.
 * A grouped office can be live while this resident belongs to an offline source.
 * Stale contact remains current during the bridge's existing grace period. */
export const isHistoricalAgent = (session: Session, agent: Agent): boolean =>
  agent.source?.historical === true ||
  availability(session) === 2 ||
  agent.state === "offline" ||
  agent.lifecycle?.kind === "stop";
const rootAgent = (session: Session, agent: Agent) =>
  agent.role === "orchestrator" || agent.id === `${session.id}:main`;

function identity(
  session: Session,
  roots: Map<string, SessionProject | null>,
): { key: string; id: string; project?: SessionProject } {
  if (session.project) {
    return {
      key: `project:${session.project.id}`,
      id: session.project.id,
      project: session.project,
    };
  }
  // The legacy bridge truncates cwd at 1,000 characters. A full-length value
  // may be only a shared prefix of distinct directories, so do not group it.
  const root =
    session.project === undefined && (session.cwd?.length ?? 0) < 1000
      ? normalizeAbsoluteCwd(session.cwd)
      : null;
  if (root) {
    const resolved = roots.get(root);
    if (resolved)
      return {
        key: `project:${resolved.id}`,
        id: resolved.id,
        project: resolved,
      };
    const id = `directory:${JSON.stringify(root)}`;
    return {
      key: id,
      id,
      project: {
        id,
        root,
        name: root.split("/").filter(Boolean).at(-1) || root,
        kind: "directory",
      },
    };
  }
  // Missing or unresolved paths cannot establish a shared physical project.
  return {
    key: isolatedOfficeId(session.id),
    id: isolatedOfficeId(session.id),
  };
}

/**
 * Pure presentation projection. The raw stream and lifecycle gate never see
 * these objects. Different worktrees are different roots, even in one repo.
 */
export function projectOffices(sessions: readonly Session[]): ProjectOffice[] {
  // During upgrades a legacy session may report the exact known root. Alias
  // only an unambiguous exact path; never infer membership from a parent path.
  const roots = new Map<string, SessionProject | null>();
  for (const { project } of sessions) {
    if (!project) continue;
    const root = normalizeAbsoluteCwd(project.root);
    if (!root) continue;
    if (roots.has(root) && roots.get(root)?.id !== project.id)
      roots.set(root, null);
    else if (!roots.has(root)) roots.set(root, project);
  }
  const groups = new Map<
    string,
    { id: string; project?: SessionProject; sessions: Session[] }
  >();
  for (const session of sessions) {
    const { key, id, project } = identity(session, roots);
    const group = groups.get(key);
    if (group) group.sessions.push(session);
    else groups.set(key, { id, project, sessions: [session] });
  }
  return [...groups.values()]
    .map((group): ProjectOffice => {
      const sources = [...group.sessions].sort(
        (a, b) => availability(a) - availability(b) || a.id.localeCompare(b.id),
      );
      const roster = sources.flatMap((session) =>
        session.agents.map((agent) => ({ session, agent })),
      );
      roster.sort(
        (a, b) =>
          Number(isHistoricalAgent(a.session, a.agent)) -
            Number(isHistoricalAgent(b.session, b.agent)) ||
          availability(a.session) - availability(b.session) ||
          Number(rootAgent(b.session, b.agent)) -
            Number(rootAgent(a.session, a.agent)) ||
          a.session.id.localeCompare(b.session.id) ||
          a.agent.id.localeCompare(b.agent.id),
      );
      const agents = roster.map(({ session, agent }) => ({
        ...agent,
        id: visualAgentId(session.id, agent.id),
        source: {
          sessionId: session.id,
          sessionName: session.name,
          agentId: agent.id,
          cwd: session.cwd,
          model: session.model,
          historical: isHistoricalAgent(session, agent),
        },
      }));
      const historyAgentCount = agents.filter(
        (agent) => agent.source.historical,
      ).length;
      return {
        id: group.id,
        name: group.project?.name || sources[0].name,
        cwd: group.project?.root || sources[0].cwd,
        project: group.project,
        agents,
        sourceSessions: sources,
        liveAgentCount: agents.length - historyAgentCount,
        historyAgentCount,
        connectionState: sources.some((session) => availability(session) === 0)
          ? "live"
          : sources.some((session) => availability(session) === 1)
            ? "stale"
            : "offline",
      };
    })
    .sort(
      (a, b) => availability(a) - availability(b) || a.id.localeCompare(b.id),
    );
}

export function projectRosterSummary(session: Session): string {
  if (!session.sourceSessions)
    return `${session.agents.length} ${session.agents.length === 1 ? "agent" : "agents"}`;
  return `${session.liveAgentCount} current${session.historyAgentCount ? ` · ${session.historyAgentCount} historical` : ""} · ${session.sourceSessions.length} ${session.sourceSessions.length === 1 ? "session" : "sessions"}`;
}
