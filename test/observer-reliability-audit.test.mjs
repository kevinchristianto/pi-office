import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";
const source = await fs.readFile(
  process.env.PI_OFFICE_AUDIT_OBSERVER ||
    new URL("../extension/pi-office.ts", import.meta.url),
  "utf8",
);
const { default: piOffice } = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: "strip" })).toString("base64")}`
);
const pause = (ms = 140) => new Promise((r) => setTimeout(r, ms));
async function until(check, timeout = 2500) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    assert.ok(Date.now() < end, "condition did not become true");
    await pause(10);
  }
}
function fixture(t, options = {}) {
  const saved = {
    fetch: globalThis.fetch,
    token: process.env.PI_OFFICE_TOKEN,
    url: process.env.PI_OFFICE_URL,
    file: process.env.PI_OFFICE_TOKEN_FILE,
  };
  process.env.PI_OFFICE_TOKEN = "observer-audit-token-0123456789abcdef";
  process.env.PI_OFFICE_URL = "http://127.0.0.1:4317";
  process.env.PI_OFFICE_TOKEN_FILE = "/not-read-env-token";
  const handlers = new Map(),
    bus = new Map(),
    requests = [],
    payloads = [];
  const emit = (name, data) => {
    for (const cb of bus.get(name) || []) cb(data);
  };
  const respond = (request, data) =>
    emit(`subagents:rpc:v1:reply:${request.requestId}`, {
      version: 1,
      requestId: request.requestId,
      success: true,
      data,
    });
  const pi = {
    on(name, cb) {
      handlers.set(name, cb);
    },
    events: {
      on(name, cb) {
        if (options.failListen?.(name))
          throw new Error("optional bus unavailable");
        if (!bus.has(name)) bus.set(name, new Set());
        bus.get(name).add(cb);
        return () => {
          bus.get(name)?.delete(cb);
        };
      },
      emit(name, data) {
        if (name === "subagents:rpc:v1:request") {
          requests.push(data);
          const result = options.reply
            ? options.reply(data.method, data)
            : data.method === "ping"
              ? {
                  capabilities: {},
                  events: { childStatus: "subagent:child-status" },
                }
              : {};
          if (result !== undefined) queueMicrotask(() => respond(data, result));
        }
        emit(name, data);
      },
    },
  };
  globalThis.fetch = async (url, request) => {
    const body = JSON.parse(request.body);
    if (url.endsWith("/api/ingest")) payloads.push(body);
    await options.fetch?.(url, body);
    return {
      ok: true,
      json: async () => ({ version: 1, capabilities: { readOnly: true } }),
    };
  };
  piOffice(pi);
  const event = (name, data = {}, context = {}) =>
    handlers.get(name)?.(data, {
      cwd: "/not-a-real-office-audit-directory",
      isIdle: () => true,
      sessionManager: {
        getSessionId: () => "audit-session",
        getBranch: () => [],
      },
      ...context,
    });
  t.after(async () => {
    options.release?.();
    await event("session_shutdown");
    globalThis.fetch = saved.fetch;
    for (const [name, value] of [
      ["PI_OFFICE_TOKEN", saved.token],
      ["PI_OFFICE_URL", saved.url],
      ["PI_OFFICE_TOKEN_FILE", saved.file],
    ])
      value === undefined
        ? delete process.env[name]
        : (process.env[name] = value);
  });
  return {
    event,
    emit,
    requests,
    respond,
    payloads,
    rows: () => payloads.at(-1)?.session.agents || [],
  };
}
const session = (id) => ({
  sessionManager: { getSessionId: () => id, getBranch: () => [] },
});
const childEvent = (patch = {}) => ({
  type: "subagent.child-status",
  version: 1,
  runId: "run",
  childId: "child",
  agent: "Scout",
  status: "started",
  ts: Date.now(),
  ...patch,
});

test("fleet overflow retains every known entry until a complete absence snapshot", async (t) => {
  let fleet = {
    version: 1,
    entries: [
      { key: "A", agent: "A" },
      { key: "B", agent: "B" },
    ],
    omitted: 0,
  };
  const f = fixture(t, {
    reply: (method) =>
      method === "ping"
        ? { capabilities: { fleetStatus: { version: 1 } } }
        : { fleet },
  });
  await f.event("session_start");
  await pause();
  fleet = { version: 1, entries: [{ key: "A", agent: "A" }], omitted: 1 };
  await f.event("agent_settled");
  await pause();
  fleet = { version: 1, entries: [], omitted: 0 };
  await f.event("agent_settled");
  await pause();
  assert.equal(f.rows().find((a) => a.name === "B").state, "stale");
});

test("old child lifecycle replay cannot change a stopped child back to working", async (t) => {
  const f = fixture(t);
  await f.event("session_start");
  await pause();
  const start = childEvent();
  f.emit("subagent:child-status", start);
  await pause();
  f.emit("subagent:child-status", {
    ...start,
    status: "stopped",
    ts: Date.now(),
  });
  await pause();
  const stopped = f.rows().find((a) => a.role !== "orchestrator");
  f.emit("subagent:child-status", start);
  await pause();
  assert.deepEqual(
    f.rows().find((a) => a.id === stopped.id),
    stopped,
  );
});

test("sparse child stop preserves already-known metadata", async (t) => {
  const f = fixture(t);
  await f.event("session_start");
  await pause();
  f.emit(
    "subagent:child-status",
    childEvent({ task: "Review docs", model: "model-one" }),
  );
  await pause();
  f.emit(
    "subagent:child-status",
    childEvent({ status: "stopped", agent: undefined, model: undefined }),
  );
  await pause();
  const child = f.rows().find((a) => a.role !== "orchestrator");
  assert.equal(child.name, "Scout");
  assert.equal(child.task, "Review docs");
  assert.equal(child.model, "model-one");
});

test("structured child identities cannot collide through component separators", async (t) => {
  const f = fixture(t);
  await f.event("session_start");
  await pause();
  f.emit(
    "subagent:child-status",
    childEvent({ runId: "a:b", childId: "c", agent: "One" }),
  );
  f.emit(
    "subagent:child-status",
    childEvent({ runId: "a", childId: "b:c", agent: "Two" }),
  );
  await pause();
  assert.equal(f.rows().filter((a) => a.role !== "orchestrator").length, 2);
});

test("opaque fleet identity is not truncated to its common prefix", async (t) => {
  const prefix = "x".repeat(190);
  const f = fixture(t, {
    reply: (method) =>
      method === "ping"
        ? { capabilities: { fleetStatus: { version: 1 } } }
        : {
            fleet: {
              version: 1,
              entries: [
                { key: prefix + "a", agent: "One" },
                { key: prefix + "b", agent: "Two" },
              ],
              omitted: 0,
            },
          },
  });
  await f.event("session_start");
  await pause();
  assert.equal(f.rows().filter((a) => a.role !== "orchestrator").length, 2);
});

test("legacy numeric step zero and result index zero retain one display identity", async (t) => {
  const f = fixture(t);
  await f.event("session_start");
  await pause();
  f.emit("subagent:async-started", {
    runId: "r",
    stepIndex: 0,
    agent: "Scout",
  });
  await f.event("tool_execution_update", {
    toolCallId: "tool",
    toolName: "subagent",
    partialResult: {
      details: { runId: "r", results: [{ index: 0, agent: "Scout" }] },
    },
  });
  await pause();
  assert.equal(f.rows().filter((a) => a.role !== "orchestrator").length, 1);
});

test("turn-boundary cost request is retained while status is in flight", async (t) => {
  const f = fixture(t, {
    reply: (method) =>
      method === "ping"
        ? { capabilities: { cost: { version: 1 } } }
        : undefined,
  });
  await f.event("session_start");
  await until(() => f.requests.some((r) => r.method === "status"));
  await f.event("agent_settled");
  f.respond(
    f.requests.find((r) => r.method === "status"),
    {},
  );
  await until(() => f.requests.some((r) => r.method === "cost"));
  assert.equal(f.requests.filter((r) => r.method === "cost").length, 1);
  f.respond(
    f.requests.find((r) => r.method === "cost"),
    { parent: { input: 42 } },
  );
});

test("a failed optional bus subscription cannot disable root-session observation", async (t) => {
  const f = fixture(t, {
    failListen: (name) => name === "subagents:rpc:v1:ready",
  });
  await f.event("session_start");
  await pause();
  assert.equal(f.rows().filter((a) => a.role === "orchestrator").length, 1);
});

test("newest session start wins when an older start is still draining a send", async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  let block = true;
  const f = fixture(t, {
    release,
    fetch: async (url, body) => {
      if (url.endsWith("/api/ingest") && body.session.connected && block) {
        block = false;
        await gate;
      }
    },
  });
  await f.event("session_start", {}, session("original"));
  await until(() => f.payloads.length > 0);
  const earlier = f.event("session_start", {}, session("superseded"));
  const latest = f.event("session_start", {}, session("newest"));
  await pause(30);
  release();
  await Promise.all([earlier, latest]);
  await pause();
  assert.equal(f.payloads.at(-1).session.id, "newest");
  assert.ok(f.rows().every((a) => a.id.startsWith("newest:")));
});

test("shutdown also cancels a start waiting for the previous send to drain", async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  let block = true;
  const f = fixture(t, {
    release,
    fetch: async (url, body) => {
      if (url.endsWith("/api/ingest") && body.session.connected && block) {
        block = false;
        await gate;
      }
    },
  });
  await f.event("session_start", {}, session("original"));
  await until(() => f.payloads.length > 0);
  const starting = f.event("session_start", {}, session("cancelled"));
  const stopping = f.event("session_shutdown", { reason: "quit" });
  release();
  await Promise.all([starting, stopping]);
  await pause();
  assert.ok(f.payloads.every((p) => p.session.id !== "cancelled"));
});

test(
  "events during replacement discovery never resurrect the previous session identity",
  { skip: process.platform === "win32" },
  async (t) => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "office-observer-audit-"),
    );
    const bin = path.join(dir, "bin");
    await fs.mkdir(bin);
    const begun = path.join(dir, "begun");
    await fs.writeFile(
      path.join(bin, "git"),
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(begun)},'1');setTimeout(()=>console.log(process.argv[3]),250);`,
      { mode: 0o700 },
    );
    const oldPath = process.env.PATH;
    process.env.PATH = bin;
    t.after(async () => {
      process.env.PATH = oldPath;
      await fs.rm(dir, { recursive: true, force: true });
    });
    const f = fixture(t);
    await f.event("session_start", {}, session("original"));
    await pause();
    const starting = f.event(
      "session_start",
      {},
      { ...session("replacement"), cwd: dir },
    );
    await until(() =>
      fs.access(begun).then(
        () => true,
        () => false,
      ),
    );
    await pause(80);
    await f.event("agent_start");
    await starting;
    await pause();
    assert.equal(f.payloads.at(-1).session.id, "replacement");
    assert.deepEqual(
      f.rows().map((a) => a.id),
      ["replacement:main"],
    );
  },
);

test("supported session IDs remain exact and malformed IDs never collapse to a prefix", async (t) => {
  const f = fixture(t);
  const ids = ["x".repeat(180) + "a", "x".repeat(180) + "b", "x".repeat(215)];
  for (const id of ids) {
    await f.event("session_start", {}, session(id));
    await pause();
    assert.equal(f.payloads.at(-1).session.id, id);
    f.emit("subagent:child-status", childEvent());
    await pause();
    assert.ok(f.rows().every((a) => a.id.length <= 240));
  }
  for (const id of ["x".repeat(216), "a\nb", "a\0b", " "]) {
    await f.event("session_start", {}, session(id));
    await pause();
    assert.match(f.payloads.at(-1).session.id, /^[a-f0-9-]{36}$/);
  }
});

test("unrelated tool result arrays never become child task metadata", async (t) => {
  const f = fixture(t);
  await f.event("session_start");
  await pause();
  const result = {
    details: {
      results: [
        {
          name: "PRIVATE_RESULT_NAME",
          task: "PRIVATE_TOOL_RESULT_TEXT",
          state: "running",
        },
      ],
    },
  };
  for (const toolName of ["grep", "not_a_subagent", undefined]) {
    await f.event("tool_execution_update", {
      toolCallId: "tool",
      toolName,
      partialResult: result,
    });
    await f.event("tool_execution_end", {
      toolCallId: "tool",
      toolName,
      result,
      isError: false,
    });
  }
  await pause();
  assert.equal(f.rows().length, 1);
  assert.doesNotMatch(JSON.stringify(f.payloads), /PRIVATE_(?:RESULT|TOOL)/);
});

test("an old status reply cannot request cost against a replacement session", async (t) => {
  const f = fixture(t, {
    reply: (method) =>
      method === "ping"
        ? { capabilities: { cost: { version: 1 } } }
        : undefined,
  });
  await f.event("session_start", {}, session("old"));
  await until(() => f.requests.some((r) => r.method === "status"));
  await f.event("agent_settled");
  const oldStatus = f.requests.find((r) => r.method === "status");
  await f.event("session_start", {}, session("new"));
  await until(
    () => f.requests.filter((r) => r.method === "status").length === 2,
  );
  f.respond(oldStatus, {
    details: { runId: "old", results: [{ agent: "Old child" }] },
  });
  f.respond(f.requests.filter((r) => r.method === "status").at(-1), {});
  await pause();
  assert.equal(f.requests.filter((r) => r.method === "cost").length, 0);
  assert.ok(f.rows().every((a) => a.id.startsWith("new:")));
});

test("RPC registration exceptions remain contained and normal Pi still updates", async (t) => {
  const f = fixture(t, {
    failListen: (name) => name.startsWith("subagents:rpc:v1:reply:"),
  });
  await f.event("session_start");
  await f.event("before_agent_start", { prompt: "Allowed task" });
  await pause();
  assert.equal(f.rows()[0].task, "Allowed task");
  assert.equal(f.requests.length, 0);
});

test("ready during an old ping re-negotiates rather than restoring stale capabilities", async (t) => {
  const f = fixture(t, { reply: () => undefined });
  await f.event("session_start");
  await until(() => f.requests.length === 1);
  f.emit("subagents:rpc:v1:ready", {});
  f.respond(f.requests[0], { capabilities: { fleetStatus: { version: 1 } } });
  await until(() => f.requests.length === 2);
  assert.equal(f.requests[1].method, "ping");
  f.respond(f.requests[1], { capabilities: {} });
  await until(() => f.requests.length === 3);
  f.respond(f.requests[2], {});
  await pause();
  assert.equal(f.payloads.at(-1).capabilities.fleet, false);
});

test("coalesced sends preserve an immutable pre-handshake snapshot and serialize final shutdown", async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  let block = true;
  let handshaking = false;
  const f = fixture(t, {
    release,
    fetch: async (url) => {
      if (url.endsWith("/api/hello") && block) {
        block = false;
        handshaking = true;
        await gate;
      }
    },
  });
  await f.event("session_start");
  await until(() => handshaking);
  await f.event("before_agent_start", { prompt: "Newer task" });
  const stopping = f.event("session_shutdown");
  release();
  await stopping;
  assert.equal(f.payloads.length, 2);
  assert.equal(f.payloads[0].session.connected, true);
  assert.equal(f.payloads[0].session.agents[0].state, "idle");
  assert.equal(f.payloads[0].session.agents[0].task, "");
  assert.equal(f.payloads[1].session.connected, false);
  assert.equal(f.payloads[1].session.agents[0].state, "offline");
});

test("explicitly stopped children can retire from the bounded roster for newer children", async (t) => {
  const f = fixture(t);
  await f.event("session_start");
  await pause();
  for (let i = 0; i < 60; i++) {
    const data = childEvent({ childId: `child-${i}`, agent: `Child ${i}` });
    f.emit("subagent:child-status", data);
    f.emit("subagent:child-status", { ...data, status: "stopped" });
  }
  f.emit(
    "subagent:child-status",
    childEvent({ childId: "latest", agent: "Latest active" }),
  );
  await pause();
  assert.ok(f.rows().length <= 48);
  assert.ok(f.rows().some((a) => a.name === "Latest active"));
  assert.equal(f.rows().filter((a) => a.role === "orchestrator").length, 1);
});

test("negative process exit codes report an error instead of an unknown terminal outcome", async (t) => {
  const f = fixture(t);
  await f.event("session_start");
  await f.event("tool_execution_end", {
    toolCallId: "t",
    toolName: "subagent",
    result: {
      details: {
        runId: "r",
        results: [{ index: 0, agent: "Terminated", exitCode: -1 }],
      },
    },
  });
  await pause();
  assert.equal(f.rows().find((a) => a.name === "Terminated").state, "error");
});

test(
  "bridge failures back off, coalesce new state, and negotiate again before retry",
  { timeout: 8000 },
  async (t) => {
    let broken = true;
    let hello = 0;
    const f = fixture(t, {
      fetch: async (url) => {
        if (url.endsWith("/api/hello")) {
          hello++;
          if (broken) throw new Error("offline");
        }
      },
    });
    await f.event("session_start");
    await until(() => hello === 1);
    for (let i = 0; i < 50; i++)
      await f.event("before_agent_start", { prompt: `Latest task ${i}` });
    await pause(250);
    assert.equal(hello, 1);
    assert.equal(f.payloads.length, 0);
    broken = false;
    await until(() => f.payloads.length > 0, 6000);
    assert.equal(hello, 2);
    assert.equal(f.payloads.length, 1);
    assert.equal(f.rows()[0].task, "Latest task 49");
  },
);

test("opaque async tree node paths cannot alias by slash-containing components", async (t) => {
  const f = fixture(t, {
    reply: (method) =>
      method === "ping"
        ? { capabilities: {} }
        : {
            asyncSnapshot: {
              kind: "pi-subagents.async-status-snapshot",
              version: 1,
              runs: [
                {
                  id: "a/b",
                  children: [{ id: "c", label: "One", state: "running" }],
                },
                {
                  id: "a",
                  children: [{ id: "b/c", label: "Two", state: "running" }],
                },
              ],
            },
          },
  });
  await f.event("session_start");
  await pause();
  assert.equal(f.rows().filter((a) => a.role !== "orchestrator").length, 2);
});

test("late root events after shutdown and foreign-session child events cannot alter observation", async (t) => {
  const f = fixture(t);
  await f.event("session_start");
  await pause();
  f.emit(
    "subagent:child-status",
    childEvent({ sessionId: "some-other-session" }),
  );
  await f.event("session_shutdown", { reason: "quit" });
  const final = structuredClone(f.payloads.at(-1));
  const count = f.payloads.length;
  await f.event("before_agent_start", { prompt: "Should be ignored" });
  await f.event("message_end", {
    message: { role: "assistant", usage: { input: 999 } },
  });
  await pause();
  assert.equal(f.payloads.length, count);
  assert.deepEqual(f.payloads.at(-1), final);
  assert.equal(final.session.agents.length, 1);
});

test("unknown child-event capability is not permission to mint known lifecycle markers", async (t) => {
  const f = fixture(t, {
    reply: (method) =>
      method === "ping"
        ? {
            capabilities: {},
            events: { childStatus: "future:different-child-event" },
          }
        : {},
  });
  await f.event("session_start");
  await pause();
  f.emit("subagent:child-status", childEvent());
  await pause();
  assert.equal(f.rows().find((a) => a.role !== "orchestrator").lifecycle, null);
});

test("malformed child identities never fall back to another resident identity", async (t) => {
  const f = fixture(t);
  await f.event("session_start");
  await pause();
  for (const childId of ["bad\nchild", "", "x".repeat(4097), undefined])
    f.emit("subagent:child-status", childEvent({ childId }));
  for (const runId of ["bad\nrun", "", "x".repeat(4097), undefined])
    f.emit("subagent:child-status", childEvent({ runId, id: "fallback-id" }));
  await pause();
  assert.equal(f.rows().length, 1);
});

test("invalid or future child hints cannot mutate a stopped resident", async (t) => {
  const f = fixture(t);
  await f.event("session_start");
  await pause();
  f.emit("subagent:child-status", childEvent());
  await pause();
  f.emit("subagent:child-status", childEvent({ status: "stopped" }));
  await pause();
  const stopped = f.rows().find((a) => a.role !== "orchestrator");
  for (const patch of [
    { ts: undefined },
    { ts: "invalid" },
    { ts: 1 },
    { ts: Date.now() + 60000 },
    { type: "unknown" },
    { status: "unknown" },
  ])
    f.emit("subagent:child-status", childEvent(patch));
  await pause();
  assert.deepEqual(
    f.rows().find((a) => a.id === stopped.id),
    stopped,
  );
});

test("evicted child lifecycle watermarks reject replay but allow a genuinely newer restart", async (t) => {
  const f = fixture(t);
  await f.event("session_start");
  await pause();
  const original = childEvent({ childId: "original", agent: "Original" });
  f.emit("subagent:child-status", original);
  await pause();
  f.emit("subagent:child-status", {
    ...original,
    status: "stopped",
    ts: Date.now(),
  });
  f.emit("subagent:async-complete", {
    runId: "run",
    childId: "original",
    success: true,
  });
  for (let i = 0; i < 60; i++) {
    const data = childEvent({ childId: `filler-${i}`, agent: `Filler ${i}` });
    f.emit("subagent:child-status", data);
    f.emit("subagent:async-complete", {
      runId: "run",
      childId: data.childId,
      success: true,
    });
  }
  await pause();
  assert.ok(!f.rows().some((a) => a.name === "Original"));
  f.emit("subagent:child-status", original);
  await pause();
  assert.ok(!f.rows().some((a) => a.name === "Original"));
  f.emit("subagent:child-status", { ...original, ts: Date.now() });
  await pause();
  assert.equal(
    f.rows().find((a) => a.name === "Original").lifecycle.kind,
    "start",
  );
});

test("512-child replay cap suppresses only new markers and resets on observer reload", async (t) => {
  const f = fixture(t);
  await f.event("session_start");
  await pause();
  for (let i = 0; i < 512; i++) {
    const data = childEvent({ childId: `child-${i}`, agent: `Child ${i}` });
    f.emit("subagent:child-status", data);
    f.emit("subagent:child-status", { ...data, status: "stopped" });
  }
  await pause();
  assert.equal(
    f.rows().find((a) => a.name === "Child 511").lifecycle.kind,
    "stop",
  );
  for (let i = 512; i < 572; i++) {
    const data = childEvent({ childId: `child-${i}`, agent: `Child ${i}` });
    f.emit("subagent:child-status", data);
    f.emit("subagent:child-status", { ...data, status: "stopped" });
  }
  await pause();
  const newest = f.rows().find((a) => a.name === "Child 571");
  assert.ok(newest);
  assert.equal(newest.state, "idle");
  assert.equal(newest.lifecycle, null);
  assert.ok(f.rows().length <= 48);
  await f.event("session_shutdown", { reason: "quit" });
  assert.equal(
    f.rows().find((a) => a.role === "orchestrator").lifecycle.kind,
    "stop",
  );
  await f.event("session_start", { reason: "reload" });
  await pause();
  f.emit("subagent:child-status", childEvent({ childId: "after-reload" }));
  await pause();
  assert.equal(
    f.rows().find((a) => a.role !== "orchestrator").lifecycle.kind,
    "start",
  );
});

test("task opt-out hides root, tool, lifecycle and fleet previews without exposing raw tool data", async (t) => {
  const old = process.env.PI_OFFICE_INCLUDE_TASKS;
  process.env.PI_OFFICE_INCLUDE_TASKS = "0";
  t.after(() =>
    old === undefined
      ? delete process.env.PI_OFFICE_INCLUDE_TASKS
      : (process.env.PI_OFFICE_INCLUDE_TASKS = old),
  );
  let fleet = false;
  const f = fixture(t, {
    reply: (method) =>
      method === "ping"
        ? {
            capabilities: fleet ? { fleetStatus: { version: 1 } } : {},
            events: { childStatus: "subagent:child-status" },
          }
        : fleet
          ? {
              fleet: {
                version: 1,
                entries: [
                  {
                    key: "fleet",
                    agent: "Fleet child",
                    goal: "PRIVATE_FLEET_TASK",
                  },
                ],
                omitted: 0,
              },
            }
          : {},
  });
  await f.event("session_start");
  await pause();
  await f.event("before_agent_start", { prompt: "PRIVATE_ROOT_TASK" });
  await f.event("tool_execution_start", {
    toolCallId: "tool",
    toolName: "subagent",
    args: { task: "PRIVATE_TOOL_ARGUMENT" },
  });
  await f.event("tool_execution_update", {
    toolCallId: "tool",
    toolName: "subagent",
    partialResult: {
      content: [{ text: "PRIVATE_TOOL_OUTPUT" }],
      details: {
        runId: "tool-run",
        results: [{ index: 0, agent: "Tool child", task: "PRIVATE_TOOL_TASK" }],
      },
    },
  });
  f.emit(
    "subagent:child-status",
    childEvent({ task: "PRIVATE_LIFECYCLE_TASK" }),
  );
  await pause();
  assert.equal(f.rows().length, 3);
  assert.ok(f.rows().every((a) => a.task === "Task details hidden"));
  fleet = true;
  f.emit("subagents:rpc:v1:ready", {});
  await pause();
  assert.equal(
    f.rows().find((a) => a.name === "Fleet child").task,
    "Task details hidden",
  );
  assert.doesNotMatch(JSON.stringify(f.payloads), /PRIVATE_/);
});

test("later duplicate starts establish a state-ordering watermark", async (t) => {
  const f = fixture(t);
  await f.event("session_start");
  await pause();
  const initial = childEvent();
  f.emit("subagent:child-status", initial);
  await pause();
  const first = f.rows().find((a) => a.role !== "orchestrator");
  const latest = Date.now();
  f.emit("subagent:child-status", { ...initial, ts: latest });
  await pause();
  f.emit("subagent:child-status", {
    ...initial,
    status: "stopped",
    ts: initial.ts + 1,
  });
  await pause();
  const actual = f.rows().find((a) => a.id === first.id);
  assert.equal(actual.state, "working");
  assert.deepEqual(actual.lifecycle, first.lifecycle);
});

test("stopping hints advance ordering without inventing a lifecycle marker", async (t) => {
  const f = fixture(t);
  await f.event("session_start");
  await pause();
  const initial = childEvent();
  f.emit("subagent:child-status", initial);
  await pause();
  const first = f.rows().find((a) => a.role !== "orchestrator");
  f.emit("subagent:child-status", {
    ...initial,
    status: "stopping",
    ts: Date.now(),
  });
  await pause();
  f.emit("subagent:child-status", { ...initial, ts: initial.ts + 1 });
  await pause();
  const actual = f.rows().find((a) => a.id === first.id);
  assert.equal(actual.state, "waiting");
  assert.deepEqual(actual.lifecycle, first.lifecycle);
});
