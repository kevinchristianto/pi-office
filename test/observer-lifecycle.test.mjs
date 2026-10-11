import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { createStateStore } from "../bridge/state.mjs";
const source = await fs.readFile(
  new URL("../extension/pi-office.ts", import.meta.url),
  "utf8",
);
const { default: piOffice } = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: "strip" })).toString("base64")}`
);
const pause = () => new Promise((resolve) => setTimeout(resolve, 150));
const context = {
  cwd: "/test",
  isIdle: () => true,
  sessionManager: { getSessionId: () => "s", getBranch: () => [] },
};
function fixture(t, { fleet = false } = {}) {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.PI_OFFICE_TOKEN;
  const originalUrl = process.env.PI_OFFICE_URL;
  const originalFile = process.env.PI_OFFICE_TOKEN_FILE;
  process.env.PI_OFFICE_TOKEN_FILE = "/not-read-test-token-from-env";
  process.env.PI_OFFICE_TOKEN = "lifecycle-tests-only-token-0123456789";
  process.env.PI_OFFICE_URL = "http://127.0.0.1:4317";
  const payloads = [];
  const handlers = new Map(),
    bus = new Map();
  const emit = (name, data) => {
    for (const callback of bus.get(name) || []) callback(data);
  };
  const pi = {
    on(name, handler) {
      handlers.set(name, handler);
    },
    events: {
      on(name, callback) {
        if (!bus.has(name)) bus.set(name, new Set());
        bus.get(name).add(callback);
        return () => bus.get(name)?.delete(callback);
      },
      emit(name, value) {
        if (name === "subagents:rpc:v1:request")
          queueMicrotask(() =>
            emit(`subagents:rpc:v1:reply:${value.requestId}`, {
              version: 1,
              success: true,
              data:
                value.method === "ping"
                  ? {
                      capabilities: fleet
                        ? { fleetStatus: { version: 1 } }
                        : {},
                      events: { childStatus: "subagent:child-status" },
                    }
                  : fleet
                    ? {
                        fleet: {
                          version: 1,
                          entries: [
                            { key: "opaque-child", agent: "Fleet child" },
                          ],
                          omitted: 0,
                        },
                      }
                    : {},
            }),
          );
        emit(name, value);
      },
    },
  };
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/api/ingest")) payloads.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({ version: 1, capabilities: { readOnly: true } }),
    };
  };
  piOffice(pi);
  const event = (name, data = {}) => handlers.get(name)?.(data, context);
  t.after(async () => {
    await event("session_shutdown");
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.PI_OFFICE_TOKEN;
    else process.env.PI_OFFICE_TOKEN = originalToken;
    if (originalFile === undefined) delete process.env.PI_OFFICE_TOKEN_FILE;
    else process.env.PI_OFFICE_TOKEN_FILE = originalFile;
    if (originalUrl === undefined) delete process.env.PI_OFFICE_URL;
    else process.env.PI_OFFICE_URL = originalUrl;
  });
  return {
    event,
    emit,
    payloads,
    root: () =>
      payloads.at(-1).session.agents.find((row) => row.role === "orchestrator"),
    child: () =>
      payloads.at(-1).session.agents.find((row) => row.role !== "orchestrator"),
  };
}
test("observer marks real root starts/quits, never agent task turns", async (t) => {
  const f = fixture(t);
  await f.event("session_start", { reason: "startup" });
  await pause();
  const birth = f.root().lifecycle;
  assert.equal(birth.kind, "start");
  assert.equal(birth.source, "pi:session_start");
  await f.event("agent_start");
  await f.event("agent_end", { messages: [] });
  await f.event("agent_settled", { aborted: false });
  await pause();
  assert.deepEqual(f.root().lifecycle, birth);
  await f.event("session_shutdown", { reason: "quit" });
  assert.equal(f.root().lifecycle.kind, "stop");
  assert.notEqual(f.root().lifecycle.eventId, birth.eventId);
  assert.equal(f.root().state, "offline");
  assert.equal(f.payloads.at(-1).session.connected, false);
});
test("unknown reasons, reload/resume and internal session replacement mint no fake lifecycle", async (t) => {
  const f = fixture(t);
  for (const reason of [undefined, "reload", "resume"]) {
    await f.event("session_start", { reason });
    await pause();
    assert.equal(f.root().lifecycle, null);
    await f.event("session_shutdown", { reason: reason || "unknown" });
    assert.equal(f.root().lifecycle, null);
  }
  for (const reason of ["new", "fork"]) {
    await f.event("session_start", { reason });
    await pause();
    assert.equal(f.root().lifecycle.kind, "start");
  }
  const before = f.payloads.length;
  await f.event("session_start", { reason: "reload" });
  await pause();
  assert.ok(
    f.payloads
      .slice(before)
      .every((data) => data.session.agents[0].lifecycle?.kind !== "stop"),
  );
  assert.equal(f.root().lifecycle, null);
});
test("non-fleet exact timestamped child events dedupe, reject replay and distinguish stop from completion hints", async (t) => {
  const f = fixture(t);
  await f.event("session_start", { reason: "startup" });
  await pause();
  const data = {
    type: "subagent.child-status",
    version: 1,
    runId: "run",
    childId: "child",
    agent: "Scout",
    status: "started",
    ts: Date.now(),
  };
  f.emit("subagent:child-status", data);
  await pause();
  const born = f.child().lifecycle;
  assert.equal(born.kind, "start");
  assert.equal(born.source, "pi-subagents:child-status");
  f.emit("subagent:child-status", data);
  await pause();
  assert.deepEqual(f.child().lifecycle, born);
  f.emit("subagent:child-status", { ...data, ts: Date.now() });
  await pause();
  assert.deepEqual(
    f.child().lifecycle,
    born,
    "repeated started state cannot invent another birth",
  );
  f.emit("subagent:async-complete", {
    runId: "run",
    childId: "child",
    success: true,
  });
  await pause();
  assert.deepEqual(
    f.child().lifecycle,
    born,
    "task result is not a child-stop observation",
  );
  f.emit("subagent:child-status", {
    ...data,
    status: "stopped",
    ts: Date.now(),
  });
  await pause();
  const stopped = f.child().lifecycle;
  assert.equal(stopped.kind, "stop");
  f.emit("subagent:child-status", data);
  await pause();
  assert.deepEqual(
    f.child().lifecycle,
    stopped,
    "older replay cannot revive the resident",
  );
  for (const invalid of [
    { ...data, ts: 1 },
    { ...data, ts: "invalid" },
    { ...data, ts: Date.now() + 60_000 },
    { ...data, ts: Date.now(), type: "unknown" },
    { ...data, ts: Date.now(), status: "stopping" },
  ]) {
    f.emit("subagent:child-status", invalid);
    await pause();
    assert.deepEqual(f.child().lifecycle, stopped);
  }
});
test("opaque fleet snapshots and uncorrelatable child events never get lifecycle markers", async (t) => {
  const f = fixture(t, { fleet: true });
  await f.event("session_start", { reason: "startup" });
  await pause();
  assert.equal(f.child().lifecycle, null);
  f.emit("subagent:child-status", {
    type: "subagent.child-status",
    version: 1,
    runId: "unknown",
    childId: "unknown",
    status: "stopped",
    ts: Date.now(),
  });
  await pause();
  assert.equal(f.payloads.at(-1).session.agents.length, 2);
  assert.equal(f.child().lifecycle, null);
});
test("bridge validates optional lifecycle metadata, preserves markers on partial updates and clears explicit baselines", () => {
  const store = createStateStore({ now: () => 1000 });
  const ingest = (patch) =>
    store.upsert({
      version: 1,
      session: { id: "s", agents: [{ id: "a", ...patch }] },
    });
  const marker = {
    version: 1,
    eventId: "event-one",
    kind: "start",
    source: "pi:session_start",
    at: new Date(1000).toISOString(),
  };
  ingest({ state: "working", lifecycle: marker });
  const streamId = store.snapshot().streamId;
  ingest({ state: "completed" });
  assert.deepEqual(store.snapshot().sessions[0].agents[0].lifecycle, marker);
  for (const lifecycle of [
    { ...marker, source: "task:start" },
    { ...marker, kind: "stop" },
    { ...marker, at: "bad" },
    { ...marker, eventId: "x".repeat(161) },
    { ...marker, version: 2 },
    { ...marker, eventId: "older", at: new Date(999).toISOString() },
  ])
    ingest({ lifecycle });
  assert.deepEqual(store.snapshot().sessions[0].agents[0].lifecycle, marker);
  assert.equal(store.snapshot().streamId, streamId);
  assert.notEqual(createStateStore().snapshot().streamId, streamId);
  ingest({ lifecycle: null });
  assert.equal(store.snapshot().sessions[0].agents[0].lifecycle, undefined);
  ingest({ state: "offline" });
  assert.equal(store.snapshot().sessions[0].agents[0].lifecycle, undefined);
});
