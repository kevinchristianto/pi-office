import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBridge, getToken } from "../bridge/server.mjs";
import { LIMITS } from "../bridge/state.mjs";
const token = "runtime-test-only-token-0123456789abcdef";
async function fixture(t, options = {}) {
  const bridge = await createBridge({
    token,
    port: 0,
    shutdownGraceMs: 60,
    ...options,
  });
  const url = await bridge.listen();
  t.after(() => bridge.close());
  return { bridge, url, port: Number(new URL(url).port) };
}
async function socket(t, port) {
  const client = net.connect(port, "127.0.0.1");
  client.on("error", () => {});
  t.after(() => client.destroy());
  await once(client, "connect");
  return client;
}
function upload(port, extra = "Content-Length: 100") {
  return `POST /api/hello HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\n${extra}\r\n\r\n{`;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test(
  "shutdown bounds unfinished POST, SSE and incomplete headers; repeated closes share a drain",
  { timeout: 3000 },
  async (t) => {
    const { bridge, port } = await fixture(t);
    const clients = await Promise.all([
      socket(t, port),
      socket(t, port),
      socket(t, port),
    ]);
    clients[0].write(upload(port));
    clients[1].write(
      `GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`,
    );
    clients[2].write("GET / HTTP/1.1\r\n");
    for (const client of clients) client.resume();
    await delay(30);
    const start = performance.now();
    const first = bridge.close();
    assert.equal(bridge.close(), first);
    await first;
    assert.ok(performance.now() - start < 1000);
    assert.equal(bridge.server.listening, false);
    await bridge.close();
    await assert.rejects(bridge.listen(), /stopping/);
  },
);
test("close before listen is safe and repeatable", async () => {
  const bridge = await createBridge({ token, port: 0 });
  await bridge.close();
  await bridge.close();
});
test(
  "incomplete upload receives a bounded 408 response",
  { timeout: 3000 },
  async (t) => {
    const { port } = await fixture(t, { bodyTimeoutMs: 75 });
    const client = await socket(t, port);
    let data = "";
    client.on("data", (chunk) => (data += chunk));
    const closed = once(client, "close");
    client.write(upload(port));
    await closed;
    assert.match(data, /HTTP\/1.1 408/);
    assert.match(data, /Request body timed out/);
  },
);
test(
  "chunked oversized uploads receive 413 and the bridge remains usable",
  { timeout: 3000 },
  async (t) => {
    const { port, url } = await fixture(t);
    const client = await socket(t, port);
    let data = "";
    client.on("data", (chunk) => (data += chunk));
    const closed = once(client, "close");
    const prefix = upload(port, "Transfer-Encoding: chunked").slice(0, -1);
    const body = "x".repeat(LIMITS.payloadBytes + 1);
    client.write(
      `${prefix}${body.length.toString(16)}\r\n${body}\r\n0\r\n\r\n`,
    );
    await closed;
    assert.match(data, /HTTP\/1.1 413/);
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
  },
);
test("aborted uploads do not crash or poison subsequent requests", async (t) => {
  const { port, url } = await fixture(t);
  const client = await socket(t, port);
  client.write(upload(port));
  await delay(20);
  client.destroy();
  await delay(20);
  assert.equal((await fetch(`${url}/api/health`)).status, 200);
});
test(
  "SSE enforces its limit and releases slots after disconnect",
  { timeout: 5000 },
  async (t) => {
    const { url } = await fixture(t);
    const readers = [];
    t.after(async () => {
      await Promise.all(readers.map((r) => r.cancel()));
    });
    for (let i = 0; i < 32; i++) {
      const response = await fetch(`${url}/api/events`);
      assert.equal(response.status, 200);
      readers.push(response.body.getReader());
    }
    assert.equal((await fetch(`${url}/api/events`)).status, 503);
    await readers.pop().cancel();
    await delay(50);
    const replacement = await fetch(`${url}/api/events`);
    assert.equal(replacement.status, 200);
    await replacement.body.cancel();
  },
);
test("configuration rejects invalid bounds without creating credentials", async () => {
  for (const port of [-1, 65536, NaN, 1.5])
    await assert.rejects(createBridge({ token, port }), /PI_OFFICE_PORT/);
  for (const option of ["heartbeatMs", "bodyTimeoutMs", "shutdownGraceMs"])
    await assert.rejects(
      createBridge({ token, [option]: 0 }),
      /positive timer/,
    );
});
test("token files are bounded, reused and never followed through symlinks", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "office-token-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const tokenFile = path.join(dir, "token");
  const first = await getToken({ token: "", tokenFile });
  assert.equal(await getToken({ token: "", tokenFile }), first);
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(tokenFile)).mode & 0o777, 0o600);
    const link = path.join(dir, "link");
    await fs.symlink(tokenFile, link);
    await assert.rejects(
      getToken({ token: "", tokenFile: link }),
      /regular local file/,
    );
  }
  await fs.writeFile(tokenFile, "x".repeat(4096));
  await assert.rejects(
    getToken({ token: "", tokenFile }),
    /regular local file/,
  );
});
test(
  "CLI handles repeated mixed signals during stalled upload",
  { timeout: 5000, skip: process.platform === "win32" },
  async (t) => {
    const child = spawn(process.execPath, ["bridge/server.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, PI_OFFICE_TOKEN: token, PI_OFFICE_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    });
    let output = "";
    const ready = new Promise((resolve) =>
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/ready at http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) resolve(Number(match[1]));
      }),
    );
    const port = await ready;
    const client = await socket(t, port);
    client.write(upload(port));
    await delay(25);
    const exit = once(child, "exit");
    child.kill("SIGTERM");
    await delay(60);
    child.kill("SIGINT");
    const [code, signal] = await exit;
    assert.equal(code, 0);
    assert.equal(signal, null);
    assert.equal((output.match(/received SIG/g) || []).length, 1);
    assert.match(output, /Pi sessions keep running/);
    assert.match(output, /Pi Office stopped/);
  },
);
test("listen is repeatable and shutdown cancels pending startup", async () => {
  const bridge = await createBridge({ token, port: 0 });
  const startup = bridge.listen();
  assert.equal(bridge.listen(), startup);
  const rejected = assert.rejects(startup, /stopped before listening/);
  await bridge.close();
  await rejected;
  assert.equal(bridge.server.listening, false);
});
test("static serving rejects traversal and escaping symlinks without exposing app files", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "office-static-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const distDir = path.join(dir, "dist");
  await fs.mkdir(distDir);
  await fs.writeFile(path.join(distDir, "index.html"), "<h1>local</h1>");
  await fs.writeFile(path.join(dir, "private.txt"), "secret-test-value");
  if (process.platform !== "win32")
    await fs.symlink(
      path.join(dir, "private.txt"),
      path.join(distDir, "escape.txt"),
    );
  const { url } = await fixture(t, { distDir });
  for (const suffix of [
    "/..%2fprivate.txt",
    "/%5cprivate.txt",
    "/%00",
    "/%zz",
    "/escape.txt",
  ]) {
    const response = await fetch(url + suffix);
    assert.ok([400, 404].includes(response.status), suffix);
    assert.ok(!(await response.text()).includes("secret-test-value"));
  }
  const response = await fetch(url, { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "14");
  assert.equal(await response.text(), "");
});
test("credentials in query strings or malformed bearer headers never authorize ingestion", async (t) => {
  const { url } = await fixture(t);
  for (const authorization of ["", `Basic ${token}`, `Bearer ${token}extra`]) {
    const response = await fetch(`${url}/api/hello?token=${token}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: "{}",
    });
    assert.equal(response.status, 401);
    assert.ok(!(await response.text()).includes(token));
  }
});
