/** Bounded, in-memory observer state. No prompts or logs are persisted to disk. */
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
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

// Project identity is display metadata, never a replacement session/agent key.
// Validate without touching the observer's filesystem (it may be another OS).
function project(value) {
  if (
    !isRecord(value) ||
    !["git", "directory"].includes(value.kind) ||
    ![
      "aix",
      "android",
      "darwin",
      "freebsd",
      "haiku",
      "linux",
      "openbsd",
      "sunos",
      "win32",
      "cygwin",
      "netbsd",
    ].includes(value.platform) ||
    typeof value.root !== "string" ||
    !value.root.length ||
    value.root.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(value.root) ||
    typeof value.id !== "string" ||
    !/^project:[a-f0-9]{64}$/.test(value.id)
  )
    return null;
  const windows = value.platform === "win32";
  const paths = windows ? path.win32 : path.posix;
  if (!paths.isAbsolute(value.root)) return null;
  if (
    windows &&
    !/^(?:[a-z]:\/|\/\/[^/.][^/]*\/[^/.][^/]*(?:\/|$))/i.test(value.root)
  )
    return null;
  const normalized = windows
    ? paths.normalize(value.root).replace(/\\/g, "/")
    : paths.normalize(value.root);
  const canonical =
    windows && /^[a-z]:\/$/i.test(normalized)
      ? normalized
      : normalized.replace(/\/+$/, "") || "/";
  if (canonical !== value.root) return null;
  const fileId = value.filesystemId;
  if (
    fileId !== undefined &&
    (!windows ||
      typeof fileId !== "string" ||
      !/^\d{1,24}:[1-9]\d{0,23}$/.test(fileId))
  )
    return null;
  const identityRoot = fileId ? canonical.toLowerCase() : canonical;
  const id = `project:${createHash("sha256")
    .update(`${value.platform}\0${identityRoot}${fileId ? `\0${fileId}` : ""}`)
    .digest("hex")}`;
  if (value.id !== id) return null;
  return {
    id,
    root: canonical,
    name: text(paths.basename(canonical) || canonical, 240),
    kind: value.kind,
    platform: value.platform,
    ...(fileId ? { filesystemId: fileId } : {}),
  };
}

// Lifecycle is optional protocol-v1 metadata. Never synthesize it from state.
function lifecycle(value) {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.eventId !== "string" ||
    !/^[A-Za-z0-9:_-]{1,160}$/.test(value.eventId) ||
    !["start", "stop"].includes(value.kind)
  )
    return null;
  const source = value.source;
  if (!(
    (source === "pi:session_start" && value.kind === "start") ||
    (source === "pi:session_shutdown" && value.kind === "stop") ||
    source === "pi-subagents:child-status"
  ))
    return null;
  const at = iso(value.at, null);
  return at
    ? { version: 1, eventId: value.eventId, kind: value.kind, source, at }
    : null;
}

export function createStateStore({
  now = Date.now,
  staleAfterMs = 35_000,
  offlineAfterMs = 120_000,
} = {}) {
  const sessions = new Map();
  const streamId = randomUUID();
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
    // Omission preserves legacy/partial updates. Explicit null or malformed
    // metadata clears any previous identity and must not trigger cwd guessing.
    if (own(src, "project")) session.project = project(src.project);
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
      if (own(raw, "lifecycle")) {
        const marker = lifecycle(raw.lifecycle);
        if (raw.lifecycle === null) delete agent.lifecycle;
        else if (
          marker &&
          (!agent.lifecycle ||
            Date.parse(marker.at) >= Date.parse(agent.lifecycle.at))
        )
          agent.lifecycle = marker;
      }
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
      streamId,
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
