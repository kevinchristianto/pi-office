import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { createBridge, getToken } from "../bridge/server.mjs";
import { createStateStore, LIMITS } from "../bridge/state.mjs";
const TOKEN = "test-only-observer-token-0123456789abcdef";
const ingest = (session) => ({ version: 1, session });
const jsonHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${TOKEN}`,
};
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-office-test-"));
  await fs.writeFile(
    path.join(dir, "index.html"),
    "<!doctype html><h1>Pi Office</h1>",
  );
  const bridge = await createBridge({
    token: TOKEN,
    port: 0,
    distDir: dir,
    heartbeatMs: 20,
  });
  const url = await bridge.listen();
  t.after(async () => {
    await bridge.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { bridge, url, dir };
}
function request(url, { headers = {}, method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (x) => chunks.push(x));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: Buffer.concat(chunks).toString(),
        }),
      );
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
test("state sanitizes partial events, null metrics, invalid rows and bounds logs", () => {
  const store = createStateStore({ now: () => 0 });
  store.upsert(
    ingest({
      id: "s",
      name: "Test",
      agents: [
        null,
        {},
        {
          id: "s:main",
          name: "Pi",
          state: "working",
          inputTokens: NaN,
          outputTokens: 4,
          cost: null,
          logs: Array.from({ length: 100 }, (_, i) => ({
            message: `log ${i}`,
          })),
        },
      ],
    }),
  );
  store.upsert(
    ingest({
      id: "s",
      agents: [{ id: "s:main", tool: "read", state: "nonsense" }],
    }),
  );
  const row = store.snapshot().sessions[0].agents[0];
  assert.equal(row.state, "working");
  assert.equal(row.name, "Pi");
  assert.equal(row.inputTokens, null);
  assert.equal(row.outputTokens, 4);
  assert.equal(row.logs.length, LIMITS.logs);
  assert.equal(row.tool, "read");
  assert.throws(() => store.upsert(null));
  assert.throws(() => store.upsert({ version: 2, session: { id: "s" } }));
  assert.throws(() => store.upsert(ingest({ id: "x", agents: {} })));
});
test("connection staleness never claims active agents completed", () => {
  let now = 0;
  const store = createStateStore({
    now: () => now,
    staleAfterMs: 50,
    offlineAfterMs: 100,
  });
  store.upsert(
    ingest({
      id: "s",
      agents: [
        { id: "s:main", state: "working" },
        { id: "s:done", state: "completed" },
      ],
    }),
  );
  now = 60;
  let s = store.snapshot().sessions[0];
  assert.equal(s.connectionState, "stale");
  assert.equal(s.agents[0].state, "stale");
  assert.equal(s.agents[0].rawState, "working");
  assert.equal(s.agents[1].state, "completed");
  now = 120;
  assert.equal(store.snapshot().sessions[0].agents[0].state, "offline");
  store.upsert(ingest({ id: "s" }));
  assert.equal(store.snapshot().sessions[0].agents[0].state, "working");
});
test("state caps session and agent histories", () => {
  const store = createStateStore();
  for (let i = 0; i < 40; i++)
    store.upsert(
      ingest({
        id: `s${i}`,
        agents: Array.from({ length: 100 }, (_, j) => ({ id: `a${j}` })),
      }),
    );
  assert.equal(store.snapshot().sessions.length, LIMITS.sessions);
  assert.equal(store.snapshot().sessions[0].agents.length, LIMITS.agents);
});
test("bridge exposes read-only health, static UI, and empty snapshot without leaking secret", async (t) => {
  const { url } = await fixture(t);
  const health = await fetch(`${url}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).readOnly, true);
  const snapshot = await fetch(`${url}/api/snapshot`);
  assert.equal(snapshot.headers.get("access-control-allow-origin"), null);
  assert.deepEqual((await snapshot.json()).sessions, []);
  const page = await fetch(url);
  assert.match(await page.text(), /Pi Office/);
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  const missing = await fetch(`${url}/api/stop`, { method: "POST" });
  assert.equal(missing.status, 404);
});
test("ingest and capability negotiation require secret, JSON and v1", async (t) => {
  const { url } = await fixture(t);
  assert.equal(
    (
      await fetch(`${url}/api/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${url}/api/hello`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}` },
        body: "{}",
      })
    ).status,
    415,
  );
  const hello = await fetch(`${url}/api/hello`, {
    method: "POST",
    headers: jsonHeaders,
    body: '{"version":1}',
  });
  assert.equal(hello.status, 200);
  assert.equal((await hello.json()).capabilities.readOnly, true);
  assert.equal(
    (
      await fetch(`${url}/api/hello`, {
        method: "POST",
        headers: jsonHeaders,
        body: '{"version":2}',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${url}/api/ingest`, {
        method: "POST",
        headers: jsonHeaders,
        body: "broken",
      })
    ).status,
    400,
  );
  const accepted = await fetch(`${url}/api/ingest`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(
      ingest({
        id: "real",
        name: "Work",
        agents: [{ id: "real:main", state: "thinking" }],
      }),
    ),
  });
  assert.equal(accepted.status, 202);
  const snapshot = await (await fetch(`${url}/api/snapshot`)).text();
  assert.match(snapshot, /real:main/);
  assert.ok(!snapshot.includes(TOKEN));
});
test("rejects hostile Host, cross-origin requests, null Origin and cross-site browser fetches", async (t) => {
  const { url } = await fixture(t);
  assert.equal(
    (
      await request(`${url}/api/snapshot`, {
        headers: { Host: "evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${url}/api/snapshot`, {
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(`${url}/api/snapshot`, { headers: { Origin: "null" } }))
      .status,
    403,
  );
  assert.equal(
    (
      await request(`${url}/api/snapshot`, {
        headers: { "Sec-Fetch-Site": "cross-site" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(`${url}/api/snapshot`, { headers: { Origin: url } })).status,
    200,
  );
});
test("oversized payload and hidden files are rejected", async (t) => {
  const { url, dir } = await fixture(t);
  const huge = JSON.stringify({ padding: "x".repeat(LIMITS.payloadBytes) });
  assert.equal(
    (
      await fetch(`${url}/api/ingest`, {
        method: "POST",
        headers: jsonHeaders,
        body: huge,
      })
    ).status,
    413,
  );
  await fs.writeFile(path.join(dir, ".private"), "do not expose");
  assert.equal((await fetch(`${url}/.private`)).status, 404);
  assert.equal((await fetch(`${url}/%2eprivate`)).status, 404);
  assert.equal((await fetch(`${url}/extension/pi-office.ts`)).status, 404);
});
test("SSE opens with snapshot and receives live ingest updates", async (t) => {
  const { url } = await fixture(t);
  const abort = new AbortController();
  t.after(() => abort.abort());
  const response = await fetch(`${url}/api/events`, { signal: abort.signal });
  assert.equal(
    response.headers.get("content-type"),
    "text/event-stream; charset=utf-8",
  );
  const reader = response.body.getReader();
  const initial = new TextDecoder().decode((await reader.read()).value);
  assert.match(initial, /event: snapshot/);
  await fetch(`${url}/api/ingest`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(ingest({ id: "sse-session" })),
  });
  let result = "";
  for (let n = 0; n < 10 && !result.includes("sse-session"); n++)
    result += new TextDecoder().decode((await reader.read()).value);
  assert.match(result, /sse-session/);
  await reader.cancel();
});
test("token configuration validates without exposing values", async () => {
  assert.equal(await getToken({ token: TOKEN }), TOKEN);
  await assert.rejects(getToken({ token: "short" }), /32/);
  await assert.rejects(getToken({ token: "\n".repeat(40) }), /URL-safe/);
});
