"use strict";

const http = require("node:http");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const DEFAULT_PORT = 4317;
const POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 4_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const COMMANDS = Object.freeze([
  "toggle-top",
  "lock",
  "hide",
  "restore",
  "open-office",
  "compact",
  "roomy",
  "quit",
]);
const PRESETS = Object.freeze({
  compact: Object.freeze({ width: 440, height: 260 }),
  roomy: Object.freeze({ width: 640, height: 380 }),
});

function parsePort(value) {
  if (value === undefined || value === "") return DEFAULT_PORT;
  if (!/^[0-9]{1,5}$/.test(String(value))) {
    throw new Error("PI_OFFICE_PORT must be an integer from 1 to 65535");
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new Error("PI_OFFICE_PORT must be an integer from 1 to 65535");
  }
  return port;
}

function officeUrl(port) {
  return `http://127.0.0.1:${parsePort(port)}/`;
}

function isAllowedCommand(value) {
  return typeof value === "string" && COMMANDS.includes(value);
}

function isTrustedSender(event, window, rendererUrl) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed())
    return false;
  const contents = window.webContents;
  try {
    return (
      event.sender === contents &&
      event.senderFrame === contents.mainFrame &&
      event.senderFrame?.url === rendererUrl &&
      contents.getURL() === rendererUrl
    );
  } catch {
    return false;
  }
}

// Every renderer request stays inside its built, packaged resource directory.
// In particular, the renderer cannot read a token, contact the bridge, or fetch URLs.
function isAllowedRendererRequest(url, distDirectory) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:" || parsed.host || parsed.search)
      return false;
    const filename = fileURLToPath(parsed);
    const relative = path.relative(distDirectory, filename);
    return (
      relative.length > 0 &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative)
    );
  } catch {
    return false;
  }
}

const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 240) =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max)
    : "";
const stamp = (value) =>
  (typeof value === "string" && value.length <= 64) ||
  (typeof value === "number" && Number.isFinite(value))
    ? value
    : null;

// Explicit display projection: no logs, filesystem operations, capabilities, or
// control payloads ever cross the preload bridge. IDs are not rewritten or joined.
function projectSnapshot(value) {
  if (
    !record(value) ||
    (value.version !== undefined && value.version !== 1) ||
    !Array.isArray(value.sessions) ||
    value.sessions.length > 24
  ) {
    throw new Error("Invalid bridge snapshot");
  }
  const identity = (value) => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 240 ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      throw new Error("Invalid bridge snapshot");
    }
    return value;
  };
  const seenSessions = new Set();
  const sessions = value.sessions.map((session) => {
    if (
      !record(session) ||
      !Array.isArray(session.agents) ||
      session.agents.length > 64
    ) {
      throw new Error("Invalid bridge snapshot");
    }
    const id = identity(session.id);
    if (seenSessions.has(id)) throw new Error("Invalid bridge snapshot");
    seenSessions.add(id);
    const seenAgents = new Set();
    const agents = session.agents.map((agent) => {
      if (!record(agent)) throw new Error("Invalid bridge snapshot");
      const agentId = identity(agent.id);
      if (seenAgents.has(agentId)) throw new Error("Invalid bridge snapshot");
      seenAgents.add(agentId);
      const lifecycle =
        record(agent.lifecycle) &&
        agent.lifecycle.version === 1 &&
        ["start", "stop"].includes(agent.lifecycle.kind)
          ? {
              version: 1,
              kind: agent.lifecycle.kind,
              eventId: text(agent.lifecycle.eventId, 160),
              source: text(agent.lifecycle.source),
              at: stamp(agent.lifecycle.at),
            }
          : null;
      return {
        id: agentId,
        name: text(agent.name),
        state: text(agent.state, 64),
        rawState: text(agent.rawState, 64),
        role: text(agent.role),
        task: text(agent.task, 1_000),
        tool: text(agent.tool),
        model: text(agent.model),
        updatedAt: stamp(agent.updatedAt),
        lifecycle,
      };
    });
    const project =
      record(session.project) &&
      typeof session.project.id === "string" &&
      typeof session.project.root === "string"
        ? {
            id: text(session.project.id),
            name: text(session.project.name),
            root: text(session.project.root, 4096),
            kind: text(session.project.kind, 32),
            platform: text(session.project.platform, 32),
            filesystemId: text(session.project.filesystemId, 64),
          }
        : null;
    return {
      id,
      name: text(session.name),
      cwd: text(session.cwd, 4096),
      model: text(session.model),
      connected: session.connected === true,
      connectionState: ["live", "stale", "offline"].includes(
        session.connectionState,
      )
        ? session.connectionState
        : session.connected === true
          ? "live"
          : "offline",
      lastSeen: stamp(session.lastSeen),
      ...(session.project === undefined ? {} : { project }),
      agents,
    };
  });
  return {
    version: 1,
    streamId: text(value.streamId),
    revision:
      Number.isSafeInteger(value.revision) && value.revision >= 0
        ? value.revision
        : 0,
    updatedAt: stamp(value.updatedAt),
    sessions,
  };
}

function abortedError() {
  const error = new Error("Request cancelled");
  error.name = "AbortError";
  return error;
}

// Node HTTP does not follow redirects, consult browser proxy settings, use a
// cookie jar, or open a listener. Both host and endpoint are compile-time fixed.
function requestSnapshot({
  port = DEFAULT_PORT,
  signal,
  request = http.request,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxBytes = MAX_RESPONSE_BYTES,
} = {}) {
  port = parsePort(port);
  return new Promise((resolve, reject) => {
    let req;
    let res;
    let done = false;
    let timer;
    const settle = (error, snapshot) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) {
        req?.destroy();
        res?.destroy();
        reject(error);
      } else resolve(snapshot);
    };
    const abort = () => settle(abortedError());
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(
      () => settle(new Error("Bridge request timed out")),
      timeoutMs,
    );
    try {
      req = request(
        {
          hostname: "127.0.0.1",
          family: 4,
          port,
          path: "/api/snapshot",
          method: "GET",
          agent: false,
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "identity",
          },
        },
        (response) => {
          res = response;
          if (done) {
            res.destroy();
            return;
          }
          res.on("error", () =>
            settle(new Error("Bridge response interrupted")),
          );
          res.on("aborted", () =>
            settle(new Error("Bridge response interrupted")),
          );
          if (res.statusCode !== 200)
            return settle(new Error(`Bridge returned HTTP ${res.statusCode}`));
          if (
            !/^application\/json(?:\s*;|$)/i.test(
              String(res.headers["content-type"] || ""),
            )
          ) {
            return settle(new Error("Bridge did not return JSON"));
          }
          if (
            res.headers["content-encoding"] &&
            res.headers["content-encoding"] !== "identity"
          ) {
            return settle(new Error("Unsupported bridge encoding"));
          }
          const declaredLength = res.headers["content-length"];
          if (
            declaredLength !== undefined &&
            (!/^\d+$/.test(String(declaredLength)) ||
              Number(declaredLength) > maxBytes)
          ) {
            return settle(new Error("Bridge snapshot too large"));
          }
          let bytes = 0;
          const chunks = [];
          res.on("data", (chunk) => {
            if (done) return;
            bytes += chunk.length;
            if (bytes > maxBytes)
              return settle(new Error("Bridge snapshot too large"));
            chunks.push(Buffer.from(chunk));
          });
          res.on("end", () => {
            if (done) return;
            try {
              settle(
                null,
                projectSnapshot(
                  JSON.parse(Buffer.concat(chunks).toString("utf8")),
                ),
              );
            } catch {
              settle(new Error("Invalid bridge snapshot"));
            }
          });
        },
      );
      req.on("error", () => settle(new Error("Bridge unavailable")));
      req.end();
    } catch {
      settle(new Error("Bridge unavailable"));
    }
  });
}

function createSnapshotPoller({
  port = DEFAULT_PORT,
  onUpdate = () => {},
  fetchSnapshot = requestSnapshot,
  intervalMs = POLL_INTERVAL_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let active = false;
  let disposed = false;
  let generation = 0;
  let timer = null;
  let controller = null;
  let snapshot = null;
  let lastSuccessAt = null;
  let connection = { status: "paused", lastSuccessAt, error: null };
  const publish = (status, error = null) => {
    connection = { status, lastSuccessAt, error };
    onUpdate({ snapshot, connection });
  };
  const poll = async () => {
    const turn = generation;
    const current = new AbortController();
    controller = current;
    try {
      const next = await fetchSnapshot({ port, signal: current.signal });
      if (!active || disposed || turn !== generation) return;
      snapshot = next;
      lastSuccessAt = now();
      publish("live");
    } catch (error) {
      if (!active || disposed || turn !== generation) return;
      publish("offline", error?.message || "Bridge unavailable");
    } finally {
      if (controller === current) controller = null;
      if (active && !disposed && turn === generation)
        timer = setTimer(() => {
          timer = null;
          void poll();
        }, intervalMs);
    }
  };
  return {
    getState: () => ({ snapshot, connection }),
    setVisible(visible) {
      if (disposed || Boolean(visible) === active) return;
      active = Boolean(visible);
      generation++;
      if (timer !== null) clearTimer(timer);
      timer = null;
      controller?.abort();
      controller = null;
      if (active) {
        publish("connecting");
        void poll();
      } else publish("paused");
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      generation++;
      if (timer !== null) clearTimer(timer);
      controller?.abort();
      controller = null;
      timer = null;
    },
  };
}

module.exports = {
  DEFAULT_PORT,
  POLL_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  COMMANDS,
  PRESETS,
  parsePort,
  officeUrl,
  isAllowedCommand,
  isTrustedSender,
  isAllowedRendererRequest,
  projectSnapshot,
  requestSnapshot,
  createSnapshotPoller,
};
