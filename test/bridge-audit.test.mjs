import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBridge } from "../bridge/server.mjs";
import { createStateStore, LIMITS } from "../bridge/state.mjs";

const token = "bridge-audit-test-only-token-0123456789";
const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
};
async function bridgeFixture(t, options = {}) {
  const bridge = await createBridge({ token, port: 0, ...options });
  const url = await bridge.listen();
  t.after(() => bridge.close());
  return { bridge, url };
}

test("session IDs cannot be truncated or sanitized into another session identity", () => {
  const store = createStateStore({ now: () => 0 });
  for (const id of ["ab", "x".repeat(240)])
    store.upsert({ session: { id, name: "Original" } });
  const before = store.snapshot();
  for (const id of [
    "a\0b",
    "a\nb",
    "a\tb",
    "a\x7fb",
    `${"x".repeat(240)}-different-session`,
    " ",
    123,
    null,
  ]) {
    assert.throws(
      () => store.upsert({ session: { id, name: "Replacement" } }),
      /session.id/,
    );
    assert.deepEqual(store.snapshot(), before);
  }
});

test("invalid agent IDs cannot overwrite a valid resident or lifecycle identity", () => {
  const store = createStateStore({ now: () => 0 });
  const marker = {
    version: 1,
    eventId: "original-start",
    kind: "start",
    source: "pi:session_start",
    at: new Date(0).toISOString(),
  };
  const ids = ["ab", "x".repeat(240)];
  store.upsert({
    session: {
      id: "s",
      agents: ids.map((id) => ({ id, name: "Original", lifecycle: marker })),
    },
  });
  const before = store.snapshot().sessions[0].agents;
  store.upsert({
    session: {
      id: "s",
      agents: ["a\0b", "a\nb", "a\tb", "a\x7fb", `${ids[1]}other`].map(
        (id) => ({ id, name: "Replacement", lifecycle: null }),
      ),
    },
  });
  assert.deepEqual(store.snapshot().sessions[0].agents, before);
});

test("valid opaque and prototype-like identities remain exact and independent", () => {
  const store = createStateStore();
  const ids = [
    "__proto__",
    "constructor",
    "toString",
    "case",
    "Case",
    " case ",
  ];
  for (const id of ids)
    store.upsert(
      JSON.parse(
        JSON.stringify({
          session: { id, agents: ids.map((id) => ({ id, state: "working" })) },
          capabilities: { pi: true, constructor: false },
        }),
      ),
    );
  const snapshot = store.snapshot();
  assert.deepEqual(
    snapshot.sessions.map((session) => session.id),
    ids,
  );
  for (const session of snapshot.sessions) {
    assert.deepEqual(
      session.agents.map((agent) => agent.id),
      ids,
    );
    assert.deepEqual(session.capabilities, { pi: true });
  }
  const payload = JSON.parse(
    '{"__proto__":{"polluted":true},"session":{"id":"safe","__proto__":{"connected":false},"agents":[{"id":"safe","__proto__":{"state":"error"}}]}}',
  );
  store.upsert(payload);
  assert.equal({}.polluted, undefined);
  const safe = store.snapshot().sessions.at(-1);
  assert.equal(safe.connected, true);
  assert.equal(safe.agents[0].rawState, "idle");
});

test(
  "static aliases cannot expose hidden target files or hidden target directories",
  { skip: process.platform === "win32" },
  async (t) => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "office-static-audit-"),
    );
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.mkdir(path.join(dir, ".private"));
    await fs.writeFile(path.join(dir, ".token"), "hidden-file-marker");
    await fs.writeFile(
      path.join(dir, ".private", "data.txt"),
      "hidden-dir-marker",
    );
    await fs.writeFile(path.join(dir, "public.txt"), "public-marker");
    await fs.symlink(".token", path.join(dir, "file-alias.txt"));
    await fs.symlink(".private", path.join(dir, "directory-alias"));
    await fs.symlink("public.txt", path.join(dir, "public-alias.txt"));
    const { url } = await bridgeFixture(t, { distDir: dir });
    for (const suffix of ["/file-alias.txt", "/directory-alias/data.txt"]) {
      const response = await fetch(url + suffix);
      assert.equal(response.status, 404, suffix);
      assert.doesNotMatch(await response.text(), /hidden-(?:file|dir)-marker/);
    }
    const publicResponse = await fetch(`${url}/public-alias.txt`);
    assert.equal(publicResponse.status, 200);
    assert.equal(await publicResponse.text(), "public-marker");
  },
);

test("parallel authenticated ingests preserve every source session and revision", async (t) => {
  const { url } = await bridgeFixture(t);
  const responses = await Promise.all(
    Array.from({ length: LIMITS.sessions }, (_, i) =>
      fetch(`${url}/api/ingest`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          session: {
            id: `source-${i}`,
            agents: [{ id: "same-raw-agent-id", task: `Task ${i}` }],
          },
        }),
      }),
    ),
  );
  const results = await Promise.all(
    responses.map((response) => {
      assert.equal(response.status, 202);
      return response.json();
    }),
  );
  assert.equal(
    new Set(results.map((result) => result.revision)).size,
    LIMITS.sessions,
  );
  const snapshot = await (await fetch(`${url}/api/snapshot`)).json();
  assert.equal(snapshot.sessions.length, LIMITS.sessions);
  assert.equal(snapshot.revision, LIMITS.sessions);
  for (const session of snapshot.sessions)
    assert.equal(session.agents[0].task, `Task ${session.id.slice(7)}`);
});

test("absolute-form request targets cannot bypass the loopback origin boundary", async (t) => {
  const { url } = await bridgeFixture(t);
  const target = new URL(url);
  const status = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: target.port,
        path: "http://outside.example/api/snapshot",
        headers: { Host: target.host },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 400);
  assert.equal((await fetch(`${url}/api/health`)).status, 200);
});

test("JSON upload limit is measured in bytes including non-ASCII content", async (t) => {
  const { url } = await bridgeFixture(t);
  const skeleton = JSON.stringify({ padding: "" });
  const exact = JSON.stringify({
    padding: "x".repeat(LIMITS.payloadBytes - Buffer.byteLength(skeleton)),
  });
  assert.equal(Buffer.byteLength(exact), LIMITS.payloadBytes);
  const accepted = await fetch(`${url}/api/hello`, {
    method: "POST",
    headers,
    body: exact,
  });
  assert.equal(accepted.status, 200);
  const unicode = JSON.stringify({
    padding: "é".repeat(LIMITS.payloadBytes / 2),
  });
  assert.ok(unicode.length < LIMITS.payloadBytes);
  const rejected = await fetch(`${url}/api/hello`, {
    method: "POST",
    headers,
    body: unicode,
  });
  assert.equal(rejected.status, 413);
});

test("default HTTP port uses the same canonical origin as browsers", async (t) => {
  // Exercise the real handler without requiring privileged port-80 access.
  const bridge = await createBridge({ token, port: 80 });
  t.after(() => bridge.close());
  const handler = bridge.server.listeners("request")[0];
  for (const host of ["127.0.0.1", "127.0.0.1:80", "localhost", "localhost:80"])
    for (const suffix of ["", ":80", ":81"]) {
      const response = {
        setHeader() {},
        writeHead(status) {
          this.status = status;
        },
        end() {},
      };
      await handler(
        {
          method: "GET",
          url: "/api/health",
          headers: {
            host,
            origin: `${new URL(`http://${host}`).origin}${suffix}`,
          },
          socket: { remoteAddress: "127.0.0.1" },
        },
        response,
      );
      assert.equal(
        response.status,
        suffix === ":81" ? 403 : 200,
        `${host} / ${suffix}`,
      );
    }
  for (const host of ["127.0.0.1:81", "localhost:4317", "outside.example"]) {
    const response = {
      setHeader() {},
      writeHead(status) {
        this.status = status;
      },
      end() {},
    };
    await handler(
      {
        method: "GET",
        url: "/api/health",
        headers: { host },
        socket: { remoteAddress: "127.0.0.1" },
      },
      response,
    );
    assert.equal(response.status, 403, host);
  }
});
