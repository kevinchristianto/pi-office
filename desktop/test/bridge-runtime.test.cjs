const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const path = require("node:path");
const {
  BridgeRuntimeError,
  requestBridgeHealth,
  workerEnvironment,
  resolveWorkerConfig,
  createBridgeRuntime,
  MAX_HEALTH_BYTES,
} = require("../bridge-runtime.cjs");

const healthy = { ok: true, service: "pi-office", version: 1, readOnly: true };
const token = "test-only-observer-token-0123456789abcdef";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

function harness(overrides = {}) {
  const messages = [];
  const forks = [];
  const states = [];
  const child = new EventEmitter();
  child.kills = 0;
  child.postMessage = (message) => {
    messages.push(message);
    if (message.type === "start" && overrides.autoReady !== false)
      queueMicrotask(() =>
        child.emit("message", { type: "ready", port: 4317 }),
      );
    if (message.type === "stop" && overrides.autoExit !== false)
      queueMicrotask(() => child.emit("exit", 0));
  };
  child.kill = () => {
    child.kills++;
    if (overrides.killExit !== false)
      queueMicrotask(() => child.emit("exit", 1));
    return true;
  };
  let probes = 0;
  const app = {
    isReady: () => true,
    isPackaged: true,
    getPath: () => path.resolve("/tmp/pi-office-user-data"),
  };
  const manager = createBridgeRuntime({
    app,
    utilityProcess: {
      fork: (...args) => {
        forks.push(args);
        return child;
      },
    },
    env: {},
    baseDirectory: path.resolve("/tmp/application"),
    resourcesPath: path.resolve("/tmp/resources"),
    onState: (state) => states.push(state),
    probeHealth: async () => ({
      status: ++probes === 1 ? "absent" : "healthy",
    }),
    startupTimeoutMs: 50,
    shutdownGraceMs: 20,
    killWaitMs: 10,
    ...overrides,
  });
  return { manager, child, messages, forks, states, app };
}

async function server(t, handler) {
  const instance = http.createServer(handler);
  await new Promise((resolve, reject) => {
    instance.once("error", reject);
    instance.listen(0, "127.0.0.1", resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        instance.close(resolve);
        instance.closeAllConnections();
      }),
  );
  return instance.address().port;
}
const json = (res, value) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
};

test("health uses only bounded GET to fixed IPv4 loopback with no credential", async (t) => {
  let requests = 0;
  const port = await server(t, (req, res) => {
    requests++;
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/api/health");
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.host, `127.0.0.1:${port}`);
    json(res, healthy);
  });
  assert.deepEqual(await requestBridgeHealth({ port }), { status: "healthy" });
  assert.equal(requests, 1);
});

test("health requires exact service, version, readonly and ok values", async (t) => {
  for (const change of [
    { service: "other" },
    { version: "1" },
    { version: 2 },
    { readOnly: false },
    { readOnly: "true" },
    { ok: 1 },
  ]) {
    const port = await server(t, (_req, res) =>
      json(res, { ...healthy, ...change }),
    );
    await assert.rejects(requestBridgeHealth({ port }), { code: "HEALTH" });
  }
});

test("health rejects redirects without following or writing", async (t) => {
  let requests = 0;
  const port = await server(t, (_req, res) => {
    requests++;
    res.writeHead(302, { location: "http://example.com/api/health" });
    res.end();
  });
  await assert.rejects(requestBridgeHealth({ port }), { code: "HEALTH" });
  assert.equal(requests, 1);
});

test("health bounds malformed, oversized and non-JSON responses", async (t) => {
  for (const [type, body] of [
    ["application/json", "{"],
    ["text/html", JSON.stringify(healthy)],
    ["application/json", "x".repeat(MAX_HEALTH_BYTES + 1)],
  ]) {
    const port = await server(t, (_req, res) => {
      res.writeHead(200, { "content-type": type });
      res.end(body);
    });
    await assert.rejects(requestBridgeHealth({ port }), { code: "HEALTH" });
  }
});

test("health has an absolute deadline including a stalled response body", async (t) => {
  const port = await server(t, (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write("{");
  });
  await assert.rejects(requestBridgeHealth({ port, timeoutMs: 25 }), {
    code: "HEALTH_TIMEOUT",
  });
});

test("health can be cancelled, and only connection refusal is absent", async () => {
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    requestBridgeHealth({ port: 4317, signal: abort.signal }),
    { code: "STOPPED" },
  );
  for (const code of ["ECONNREFUSED", "ECONNRESET", "EACCES", "ETIMEDOUT"]) {
    const request = (options) => {
      assert.equal(options.hostname, "127.0.0.1");
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = () => queueMicrotask(() => req.emit("error", { code }));
      return req;
    };
    if (code === "ECONNREFUSED")
      assert.deepEqual(await requestBridgeHealth({ port: 4317, request }), {
        status: "absent",
      });
    else
      await assert.rejects(requestBridgeHealth({ port: 4317, request }), {
        code: "HEALTH",
      });
  }
});

test("health rejects invalid ports before issuing any request", () => {
  for (const port of [
    "http://127.0.0.1:4317",
    "4317/path",
    0,
    65536,
    -1,
    "localhost",
  ])
    assert.throws(() => requestBridgeHealth({ port }));
});

test("healthy external bridge is reused without loading credentials or spawning", async () => {
  const h = harness({
    env: { PI_OFFICE_TOKEN: "intentionally-invalid-but-unused" },
    app: {
      isReady: () => true,
      getPath: () => {
        throw new Error("must not read app data");
      },
    },
    probeHealth: async () => ({ status: "healthy" }),
  });
  assert.deepEqual(await h.manager.start(), { mode: "external", error: null });
  assert.equal(h.manager.getTokenFile(), null);
  await h.manager.stop();
  assert.equal(h.forks.length, 0);
  assert.equal(h.child.kills, 0);
});

test("unhealthy existing bridge receives no spawn, stop or token configuration", async () => {
  const h = harness({
    probeHealth: async () => {
      throw new BridgeRuntimeError("HEALTH", "Safe health error");
    },
  });
  await assert.rejects(h.manager.start(), { code: "HEALTH" });
  await h.manager.stop();
  assert.equal(h.manager.getState().mode, "error");
  assert.equal(h.forks.length, 0);
  assert.equal(h.messages.length, 0);
});

test("owned startup has one fork, immutable paths, sanitized env, no execArgv, and no renderer secrets", async () => {
  const h = harness({
    env: {
      PI_OFFICE_TOKEN: token,
      PI_OFFICE_PORT: "4317",
      NODE_OPTIONS: "--require bad.cjs",
      NODE_PATH: "/bad",
      ELECTRON_RUN_AS_NODE: "1",
      PATH: "/bin",
      OTHER_SECRET: "private",
    },
  });
  const first = h.manager.start();
  assert.equal(h.manager.start(), first);
  assert.equal((await first).mode, "owned");
  const [worker, args, options] = h.forks[0];
  assert.equal(worker, path.resolve("/tmp/application/bridge-worker.cjs"));
  assert.deepEqual(args, []);
  assert.deepEqual(options.execArgv, []);
  assert.deepEqual(options.env, { PATH: "/bin" });
  assert.equal(options.stdio, "ignore");
  assert.equal(
    h.messages[0].config.officeDirectory,
    path.resolve("/tmp/resources/office"),
  );
  assert.equal(h.messages[0].config.token, token);
  assert.equal(h.manager.getTokenFile(), null);
  assert.equal(JSON.stringify(h.states).includes(token), false);
  await h.manager.stop();
  assert.equal(h.forks.length, 1);
  assert.equal(h.child.kills, 0);
});

test("default owned token file is stable userData, explicit file is honored with no silent copying", async () => {
  for (const env of [
    {},
    { PI_OFFICE_TOKEN_FILE: "existing/.pi-office-token" },
  ]) {
    const h = harness({ env, cwd: path.resolve("/tmp/project") });
    await h.manager.start();
    const config = h.messages[0].config;
    assert.equal(
      config.tokenFile,
      env.PI_OFFICE_TOKEN_FILE
        ? path.resolve("/tmp/project/existing/.pi-office-token")
        : path.resolve("/tmp/pi-office-user-data/.pi-office-token"),
    );
    assert.equal(config.createTokenDirectory, !env.PI_OFFICE_TOKEN_FILE);
    assert.equal(h.manager.getTokenFile(), config.tokenFile);
    assert.equal("token" in config, false);
    assert.equal(JSON.stringify(h.states).includes("token"), false);
    await h.manager.stop();
  }
});

test("token overrides reject unsafe values but a valid explicit token takes precedence over file", () => {
  const options = {
    app: { isPackaged: false, getPath: () => path.resolve("/tmp/user-data") },
    port: 4317,
    baseDirectory: path.resolve("/tmp/project/desktop"),
    cwd: path.resolve("/tmp/project"),
    shutdownGraceMs: 1_000,
  };
  for (const env of [
    { PI_OFFICE_TOKEN: "bad" },
    { PI_OFFICE_TOKEN_FILE: "\0bad" },
    { PI_OFFICE_TOKEN_FILE: " " },
  ])
    assert.throws(
      () => resolveWorkerConfig({ ...options, env }),
      BridgeRuntimeError,
    );
  const config = resolveWorkerConfig({
    ...options,
    env: { PI_OFFICE_TOKEN: token, PI_OFFICE_TOKEN_FILE: "\0unused" },
  });
  assert.equal(config.token, token);
  assert.equal(config.officeDirectory, path.resolve("/tmp/project"));
});

test("worker environment excludes injected loaders, debugging options and unrelated secrets case-insensitively", () => {
  assert.deepEqual(
    workerEnvironment({
      SystemRoot: "C:\\Windows",
      TEMP: "tmp",
      LANG: "C",
      NODE_OPTIONS: "--inspect",
      node_options: "--require",
      ELECTRON_RUN_AS_NODE: "1",
      PI_OFFICE_TOKEN: token,
      AWS_SECRET_ACCESS_KEY: "no",
    }),
    { SystemRoot: "C:\\Windows", TEMP: "tmp", LANG: "C" },
  );
});

test("runtime refuses to fork before app ready", async () => {
  const h = harness({ app: { isReady: () => false } });
  await assert.rejects(h.manager.start(), { code: "NOT_READY" });
  assert.equal(h.forks.length, 0);
});

test("stop during initial probe cannot spawn a worker after quit", async () => {
  const pending = deferred();
  const h = harness({ probeHealth: () => pending.promise });
  const start = h.manager.start();
  await h.manager.stop();
  pending.resolve({ status: "absent" });
  await assert.rejects(start, { code: "STOPPED" });
  assert.equal(h.forks.length, 0);
});

test("stop before start prevents all work", async () => {
  const h = harness();
  await h.manager.stop();
  await assert.rejects(h.manager.start(), { code: "STOPPED" });
  assert.equal(h.forks.length, 0);
});

test("quit during worker startup sends graceful stop only to owned child", async () => {
  const h = harness({ autoReady: false });
  const start = h.manager.start();
  const rejection = assert.rejects(start, { code: "STOPPED" });
  await flush();
  await h.manager.stop();
  await rejection;
  assert.deepEqual(
    h.messages.map((m) => m.type),
    ["start", "stop"],
  );
  assert.equal(h.child.kills, 0);
});

test("missing worker ready is bounded and kills only its own hung handle", async () => {
  const h = harness({
    autoReady: false,
    autoExit: false,
    startupTimeoutMs: 15,
  });
  await assert.rejects(h.manager.start(), { code: "STARTUP_TIMEOUT" });
  assert.equal(h.child.kills, 1);
  assert.equal(h.manager.getState().mode, "error");
  await h.manager.stop();
  assert.equal(h.child.kills, 1);
});

test("graceful shutdown fallback remains bounded if owned kill never emits exit", async () => {
  const h = harness({ autoExit: false, killExit: false });
  await h.manager.start();
  const stopped = h.manager.stop();
  assert.equal(h.manager.stop(), stopped);
  await Promise.race([
    stopped,
    delay(500).then(() => {
      throw new Error("Shutdown was unbounded");
    }),
  ]);
  assert.equal(h.child.kills, 1);
});

test("conflict during bind is actionable and does not send HTTP writes", async () => {
  const h = harness({ autoReady: false });
  const start = h.manager.start();
  const rejection = assert.rejects(start, { code: "PORT_IN_USE" });
  await flush();
  h.child.emit("message", {
    type: "error",
    code: "PORT_IN_USE",
    message: token,
  });
  await rejection;
  assert.equal(h.child.kills, 0);
  assert.match(h.manager.getState().error, /free PI_OFFICE_PORT/);
  assert.equal(JSON.stringify(h.states).includes(token), false);
});

test("unexpected owned exit surfaces safe error without restart or arbitrary process cleanup", async () => {
  const h = harness();
  await h.manager.start();
  h.child.emit("exit", 7);
  assert.equal(h.manager.getState().mode, "error");
  assert.match(h.manager.getState().error, /Pi sessions have not been stopped/);
  await h.manager.stop();
  assert.equal(h.forks.length, 1);
  assert.equal(h.child.kills, 0);
});

test("worker failure and diagnostic report never leak into runtime state", async () => {
  const h = harness({ autoReady: false });
  const start = h.manager.start();
  const rejection = assert.rejects(start, { code: "WORKER" });
  await flush();
  h.child.emit(
    "error",
    "FatalError",
    "/private/location",
    JSON.stringify({ token }),
  );
  await rejection;
  assert.equal(JSON.stringify(h.states).includes(token), false);
});

test("post-ready health must still succeed before publishing owned", async () => {
  let n = 0;
  const h = harness({
    probeHealth: async () => ({ status: ++n === 1 ? "absent" : "bad" }),
  });
  await assert.rejects(h.manager.start(), { code: "WORKER" });
  assert.equal(
    h.states.some((state) => state.mode === "owned"),
    false,
  );
  assert.equal(h.messages.at(-1).type, "stop");
});
