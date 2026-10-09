import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
// Exercise the actual extension, without a paid model or a Pi installation.
const source = await fs.readFile(
  new URL("../extension/pi-office.ts", import.meta.url),
  "utf8",
);
const js = stripTypeScriptTypes(source, { mode: "strip" });
const { default: piOffice } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function fakePi(reply) {
  const handlers = new Map();
  const bus = new Map();
  const methods = [];
  return {
    handlers,
    methods,
    on(name, handler) {
      handlers.set(name, handler);
    },
    getSessionName: () => "Test session",
    events: {
      on(name, handler) {
        if (!bus.has(name)) bus.set(name, new Set());
        bus.get(name).add(handler);
        return () => bus.get(name)?.delete(handler);
      },
      emit(name, payload) {
        if (name === "subagents:rpc:v1:request") {
          methods.push(payload.method);
          if (reply) {
            const data = reply(payload.method);
            queueMicrotask(() => {
              for (const fn of bus.get(
                `subagents:rpc:v1:reply:${payload.requestId}`,
              ) || [])
                fn({ version: 1, success: true, data });
            });
          }
        }
        for (const fn of bus.get(name) || []) fn(payload);
      },
    },
    async event(name, payload = {}, ctx = {}) {
      return handlers.get(name)?.(payload, ctx);
    },
  };
}
function setup(t) {
  const old = {
    token: process.env.PI_OFFICE_TOKEN,
    url: process.env.PI_OFFICE_URL,
    file: process.env.PI_OFFICE_TOKEN_FILE,
    fetch: globalThis.fetch,
  };
  process.env.PI_OFFICE_TOKEN = "observer-tests-only-0123456789abcdef";
  process.env.PI_OFFICE_URL = "http://127.0.0.1:4317";
  process.env.PI_OFFICE_TOKEN_FILE = "/not-read-because-token-in-env";
  const payloads = [];
  globalThis.fetch = async (url, options) => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:4317\/api\/(hello|ingest)$/);
    assert.equal(options.redirect, "error");
    if (url.endsWith("/api/ingest")) payloads.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({ version: 1, capabilities: { readOnly: true } }),
    };
  };
  t.after(() => {
    globalThis.fetch = old.fetch;
    for (const [key, value] of [
      ["PI_OFFICE_TOKEN", old.token],
      ["PI_OFFICE_URL", old.url],
      ["PI_OFFICE_TOKEN_FILE", old.file],
    ])
      value === undefined
        ? delete process.env[key]
        : (process.env[key] = value);
  });
  return payloads;
}
const ctx = {
  cwd: "C:\\work\\demo",
  model: { id: "test-model" },
  isIdle: () => true,
  sessionManager: { getSessionId: () => "session-test", getBranch: () => [] },
};
test("Pi observer registers only observers and sends root task/tool/usage state", async (t) => {
  const payloads = setup(t);
  const pi = fakePi();
  piOffice(pi);
  assert.equal(
    payloads.length,
    0,
    "no network or timers in the extension factory",
  );
  await pi.event("session_start", {}, ctx);
  await pi.event("before_agent_start", {
    prompt: "Review docs token=hidden-value",
  });
  await pi.event("tool_execution_start", {
    toolCallId: "tool-1",
    toolName: "read",
    args: { password: "PRIVATE_TOOL_INPUT" },
  });
  await pause(180);
  let root = payloads.at(-1).session.agents[0];
  assert.equal(root.id, "session-test:main");
  assert.equal(root.state, "working");
  assert.equal(root.tool, "read");
  assert.match(root.task, /token=\[redacted\]/);
  const message = {
    role: "assistant",
    model: "test-model",
    usage: { input: 100, output: 50, cost: { total: 0.003 } },
    content: [
      { type: "thinking", thinking: "PRIVATE_THINKING" },
      { type: "text", text: "PRIVATE_RESPONSE" },
    ],
  };
  await pi.event("message_end", { message });
  await pi.event("tool_execution_end", {
    toolCallId: "tool-1",
    toolName: "read",
    result: { content: [{ text: "PRIVATE_OUTPUT" }] },
    isError: false,
  });
  await pi.event("agent_end", { messages: [message] });
  await pi.event("agent_settled", { aborted: false });
  await pause(180);
  root = payloads.at(-1).session.agents[0];
  assert.equal(root.state, "idle");
  assert.equal(root.inputTokens, 100);
  assert.equal(root.outputTokens, 50);
  assert.equal(root.cost, 0.003);
  assert.doesNotMatch(JSON.stringify(payloads), /PRIVATE_|hidden-value/);
  await pi.event("session_shutdown");
  assert.equal(payloads.at(-1).session.connected, false);
  assert.equal(payloads.at(-1).session.agents[0].state, "offline");
  assert.ok(pi.methods.every((m) => ["ping", "status", "cost"].includes(m)));
});
test("fleet capability tolerates unknown fields and marks disappearance as stale", async (t) => {
  const payloads = setup(t);
  let present = true;
  const pi = fakePi((method) =>
    method === "ping"
      ? {
          capabilities: { fleetStatus: { version: 1 }, cost: { version: 1 } },
          events: { childStatus: "subagent:child-status" },
        }
      : method === "cost"
        ? { parent: { input: 10, output: 2, cost: 0.001 } }
        : {
            fleet: {
              version: 1,
              entries: present
                ? [
                    {
                      key: "opaque-1",
                      agent: "Scout",
                      model: null,
                      tokens: { input: 12, output: 4 },
                      newFutureField: { anything: true },
                    },
                  ]
                : [],
              omitted: 0,
            },
          },
  );
  piOffice(pi);
  await pi.event("session_start", {}, ctx);
  await pause(180);
  let data = payloads.at(-1);
  assert.equal(data.capabilities.subagents, true);
  assert.equal(data.capabilities.childStatus, true);
  assert.equal(data.session.agents.length, 2);
  let child = data.session.agents.find((a) => a.name === "Scout");
  assert.ok(child.id.startsWith("session-test:"));
  assert.equal(child.inputTokens, 12);
  assert.equal(child.model, null);
  present = false;
  await pi.event("agent_settled", { aborted: false });
  await pause(180);
  child = payloads.at(-1).session.agents.find((a) => a.name === "Scout");
  assert.equal(child.state, "stale");
  assert.equal(child.cost, null);
  assert.equal(
    payloads.at(-1).session.agents.find((a) => a.role === "orchestrator")
      .inputTokens,
    10,
  );
  assert.ok(pi.methods.includes("cost"));
  assert.ok(pi.methods.every((m) => ["ping", "status", "cost"].includes(m)));
  await pi.event("session_shutdown");
});
test("non-loopback configuration is refused and never fetched", async (t) => {
  const payloads = setup(t);
  process.env.PI_OFFICE_URL = "https://outside.example";
  const pi = fakePi();
  piOffice(pi);
  await pi.event("session_start", {}, ctx);
  await pause(150);
  assert.equal(payloads.length, 0);
  await pi.event("session_shutdown");
});

test("non-fleet async tree exposes known activity without fabricating metrics", async (t) => {
  const payloads = setup(t);
  const pi = fakePi((method) =>
    method === "ping"
      ? { capabilities: { status: true } }
      : {
          asyncSnapshot: {
            kind: "pi-subagents.async-status-snapshot",
            version: 1,
            runs: [
              {
                id: "run-1",
                kind: "workflow",
                label: "Plan",
                state: "running",
                children: [
                  {
                    id: "child-1",
                    kind: "step",
                    label: "Reviewer",
                    state: "paused",
                    activity: { currentTool: "read" },
                  },
                  {
                    id: "host-check",
                    kind: "host-step",
                    label: "CI",
                    state: "running",
                  },
                ],
              },
            ],
          },
        },
  );
  piOffice(pi);
  await pi.event("session_start", {}, ctx);
  await pause(180);
  const rows = payloads.at(-1).session.agents;
  assert.equal(rows.length, 2);
  const child = rows.find((a) => a.name === "Reviewer");
  assert.equal(child.state, "waiting");
  assert.equal(child.tool, "read");
  assert.equal(child.inputTokens, null);
  assert.equal(child.cost, null);
  await pi.event("session_shutdown");
});
