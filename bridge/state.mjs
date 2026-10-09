/** Bounded, in-memory observer state. No prompts or logs are persisted to disk. */
export const PROTOCOL_VERSION = 1;
export const STATES = new Set([
  "idle",
  "thinking",
  "working",
  "waiting",
  "completed",
  "error",
  "stale",
  "offline",
]);
export const LIMITS = Object.freeze({
  sessions: 24,
  agents: 64,
  logs: 60,
  payloadBytes: 512 * 1024,
});
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const isRecord = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, max = 240) =>
  typeof v === "string"
    ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max)
    : "";
const number = (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.min(v, Number.MAX_SAFE_INTEGER)
    : null;
const iso = (v, fallback) =>
  (typeof v === "string" || typeof v === "number") &&
  Number.isFinite(new Date(v).getTime())
    ? new Date(v).toISOString()
    : fallback;

export function createStateStore({
  now = Date.now,
  staleAfterMs = 35_000,
  offlineAfterMs = 120_000,
} = {}) {
  const sessions = new Map();
  let updatedAt = new Date(now()).toISOString();
  let revision = 0;
  function upsert(payload) {
    if (
      !isRecord(payload) ||
      (payload.version !== undefined && payload.version !== PROTOCOL_VERSION)
    )
      throw new Error("Unsupported observer protocol");
    if (!isRecord(payload.session)) throw new Error("session is required");
    const src = payload.session;
    const id = text(src.id, 240);
    if (!id.trim()) throw new Error("session.id is required");
    if (src.agents !== undefined && !Array.isArray(src.agents))
      throw new Error("session.agents must be an array");
    const stamp = new Date(now()).toISOString();
    let session = sessions.get(id);
    if (!session) {
      if (sessions.size >= LIMITS.sessions) {
        const oldest = [...sessions.values()].sort((a, b) =>
          a.lastSeen.localeCompare(b.lastSeen),
        )[0];
        sessions.delete(oldest.id);
      }
      session = {
        id,
        name: "Pi session",
        cwd: "",
        model: null,
        agents: new Map(),
        lastSeen: stamp,
        connected: true,
        capabilities: {},
      };
      sessions.set(id, session);
    }
    for (const key of ["name", "cwd", "model"]) {
      if (own(src, key))
        session[key] =
          key === "model" && src[key] === null
            ? null
            : text(src[key], key === "cwd" ? 1000 : 240);
    }
    session.lastSeen = stamp;
    session.connected = src.connected !== false;
    if (isRecord(payload.capabilities)) {
      for (const key of [
        "pi",
        "subagents",
        "fleet",
        "childStatus",
        "usage",
        "logs",
      ]) {
        if (typeof payload.capabilities[key] === "boolean")
          session.capabilities[key] = payload.capabilities[key];
      }
    }
    for (const raw of (src.agents || []).slice(0, LIMITS.agents)) {
      if (!isRecord(raw)) continue;
      const agentId = text(raw.id, 240);
      if (!agentId.trim()) continue;
      let agent = session.agents.get(agentId);
      if (!agent) {
        if (session.agents.size >= LIMITS.agents) {
          const retired = [...session.agents.values()]
            .filter((a) => a.role !== "orchestrator")
            .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
          if (!retired) continue;
          session.agents.delete(retired.id);
        }
        agent = {
          id: agentId,
          name: "Agent",
          role: "subagent",
          task: "",
          state: "idle",
          tool: null,
          model: null,
          inputTokens: null,
          outputTokens: null,
          cost: null,
          updatedAt: stamp,
          logs: [],
        };
        session.agents.set(agentId, agent);
      }
      for (const key of ["name", "role", "task", "tool", "model"]) {
        if (own(raw, key))
          agent[key] =
            ["tool", "model"].includes(key) && raw[key] === null
              ? null
              : text(raw[key], key === "task" ? 2000 : 240);
      }
      if (STATES.has(raw.state)) agent.state = raw.state;
      for (const key of ["inputTokens", "outputTokens", "cost"])
        if (own(raw, key)) agent[key] = number(raw[key]);
      agent.updatedAt = iso(raw.updatedAt, stamp);
      if (Array.isArray(raw.logs))
        agent.logs = raw.logs
          .slice(-LIMITS.logs)
          .filter(isRecord)
          .map((log) => ({
            time: iso(log.time, stamp),
            level: ["info", "warn", "error", "success"].includes(log.level)
              ? log.level
              : "info",
            message: text(log.message, 1000),
          }))
          .filter((log) => log.message);
    }
    updatedAt = stamp;
    revision++;
    return { revision, sessionId: id };
  }
  function snapshot() {
    const time = now();
    return {
      version: PROTOCOL_VERSION,
      revision,
      updatedAt,
      sessions: [...sessions.values()].map((session) => {
        const age = time - Date.parse(session.lastSeen);
        const connectionState =
          !session.connected || age > offlineAfterMs
            ? "offline"
            : age > staleAfterMs
              ? "stale"
              : "live";
        return {
          ...session,
          connected: connectionState === "live",
          connectionState,
          agents: [...session.agents.values()].map((agent) => ({
            ...agent,
            rawState: agent.state,
            state:
              connectionState === "live" ||
              ["completed", "error", "offline"].includes(agent.state)
                ? agent.state
                : connectionState,
          })),
        };
      }),
    };
  }
  return {
    upsert,
    snapshot,
    get revision() {
      return revision;
    },
  };
}
