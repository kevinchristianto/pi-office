const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const http = require("node:http");
const { createBridgeWorker, validConfig } = require("../bridge-worker.cjs");
const {
  createBridgeRuntime,
  requestBridgeHealth,
} = require("../bridge-runtime.cjs");

const token = "test-only-observer-token-0123456789abcdef";
const flush = () => new Promise((resolve) => setImmediate(resolve));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const config = () => ({
  port: 4317,
  officeDirectory: path.resolve("/tmp/resources/office"),
  tokenFile: path.resolve("/tmp/pi-office-user-data/.pi-office-token"),
  createTokenDirectory: true,
  shutdownGraceMs: 1_000,
});

function harness(options = {}) {
  const parent = new EventEmitter();
  const messages = [];
  const calls = [];
  const exits = [];
  parent.postMessage = (value) => messages.push(value);
  const bridge = {
    listen: async () => {
      calls.push(["listen"]);
      return "http://127.0.0.1:4317";
    },
    close: async () => {
      calls.push(["close"]);
    },
  };
  const worker = createBridgeWorker({
    parentPort: parent,
    loadBridge: async (filename) => {
      calls.push(["import", filename]);
      return {
        createBridge: async (value) => {
          calls.push(["create", value]);
          return bridge;
        },
      };
    },
    mkdir: async (...args) => calls.push(["mkdir", ...args]),
    stat: async (filename) => {
      calls.push(["stat", filename]);
      return { isFile: () => true };
    },
    exit: (code) => exits.push(code),
    ...options,
  });
  return {
    parent,
    messages,
    calls,
    exits,
    worker,
    bridge,
    send: (value) => parent.emit("message", { data: value }),
  };
}

test("worker imports only packaged bridge and supplies explicit dist and stable token paths", async () => {
  const h = harness();
  h.send({ type: "start", config: config() });
  await flush();
  assert.deepEqual(
    h.calls.map((call) => call[0]),
    ["stat", "import", "mkdir", "create", "listen"],
  );
  assert.equal(
    h.calls[0][1],
    path.resolve("/tmp/resources/office/dist/index.html"),
  );
  assert.equal(
    h.calls[1][1],
    path.resolve("/tmp/resources/office/bridge/server.mjs"),
  );
  assert.deepEqual(h.calls[3][1], {
    port: 4317,
    distDir: path.resolve("/tmp/resources/office/dist"),
    tokenFile: path.resolve("/tmp/pi-office-user-data/.pi-office-token"),
    shutdownGraceMs: 1_000,
  });
  assert.deepEqual(h.messages, [{ type: "ready", port: 4317 }]);
  await h.worker.stop();
  assert.deepEqual(h.exits, [0]);
});

test("explicit credentials stay parent-to-worker only and do not create or copy files", async () => {
  const h = harness();
  h.send({
    type: "start",
    config: { ...config(), token, createTokenDirectory: false },
  });
  await flush();
  assert.equal(h.calls.find((call) => call[0] === "create")[1].token, token);
  assert.equal(
    h.calls.some((call) => call[0] === "mkdir"),
    false,
  );
  assert.equal(JSON.stringify(h.messages).includes(token), false);
  await h.worker.stop();
});

test("duplicate start and repeated stop cannot register or spawn a second bridge", async () => {
  const h = harness();
  h.send({ type: "start", config: config() });
  h.send({ type: "start", config: config() });
  await flush();
  await Promise.all([h.worker.stop(), h.worker.stop()]);
  h.send({ type: "start", config: config() });
  assert.equal(h.calls.filter((call) => call[0] === "create").length, 1);
  assert.equal(h.calls.filter((call) => call[0] === "close").length, 1);
  assert.deepEqual(h.exits, [0]);
  assert.equal(h.parent.listenerCount("message"), 0);
  assert.equal(h.parent.listenerCount("close"), 0);
});

test("stop before start never creates an observer credential or bridge", async () => {
  const h = harness();
  h.send({ type: "stop" });
  h.send({ type: "start", config: config() });
  await flush();
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.exits, [0]);
});

test("stop during bridge creation closes exactly the newly owned server without listening", async () => {
  let resolve;
  const pending = new Promise((r) => {
    resolve = r;
  });
  let listens = 0;
  let closes = 0;
  const h = harness({
    loadBridge: async () => ({ createBridge: () => pending }),
  });
  h.send({ type: "start", config: config() });
  await flush();
  const stopping = h.worker.stop();
  resolve({
    listen: async () => {
      listens++;
    },
    close: async () => {
      closes++;
    },
  });
  await stopping;
  assert.equal(listens, 0);
  assert.equal(closes, 1);
  assert.equal(
    h.messages.some((message) => message.type === "ready"),
    false,
  );
});

test("bad resources fail before any credential directory or bridge is created", async () => {
  const h = harness({
    stat: async () => {
      throw new Error("private path");
    },
  });
  h.send({ type: "start", config: config() });
  await flush();
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.messages, [
    { type: "error", code: "RESOURCES" },
    { type: "stopped" },
  ]);
  assert.deepEqual(h.exits, [1]);
});

test("credential failures are actionable but expose neither token nor path", async () => {
  const h = harness({
    loadBridge: async () => ({
      createBridge: async () => {
        throw new Error(`Invalid file ${token}`);
      },
    }),
  });
  h.send({ type: "start", config: config() });
  await flush();
  assert.deepEqual(h.messages, [
    { type: "error", code: "TOKEN" },
    { type: "stopped" },
  ]);
  assert.equal(JSON.stringify(h.messages).includes(token), false);
});

test("port conflict closes only its unbound owned server and reports fixed code", async () => {
  let closes = 0;
  const h = harness({
    loadBridge: async () => ({
      createBridge: async () => ({
        listen: async () => {
          throw Object.assign(new Error(token), { code: "EADDRINUSE" });
        },
        close: async () => {
          closes++;
        },
      }),
    }),
  });
  h.send({ type: "start", config: config() });
  await flush();
  assert.equal(closes, 1);
  assert.deepEqual(h.messages, [
    { type: "error", code: "PORT_IN_USE" },
    { type: "stopped" },
  ]);
});

test("worker accepts no arbitrary URL, source path or executable arguments", () => {
  assert.equal(validConfig(config()), true);
  for (const change of [
    { officeDirectory: "https://example.com" },
    { tokenFile: "relative" },
    { port: 0 },
    { port: "4317" },
    { token: "bad" },
    { shutdownGraceMs: Infinity },
  ])
    assert.equal(Boolean(validConfig({ ...config(), ...change })), false);
});

test("parent close gracefully closes its worker", async () => {
  const h = harness();
  h.send({ type: "start", config: config() });
  await flush();
  h.parent.emit("close");
  await flush();
  assert.equal(h.calls.filter((call) => call[0] === "close").length, 1);
  assert.deepEqual(h.exits, [0]);
});

test("missing parent heartbeat expires and closes worker even without a close event", async () => {
  const h = harness({ parentTimeoutMs: 25 });
  h.send({ type: "start", config: config() });
  await flush();
  await delay(50);
  assert.equal(h.calls.filter((call) => call[0] === "close").length, 1);
  assert.deepEqual(h.exits, [0]);
});

test("private parent heartbeat renews the lease without touching bridge state", async () => {
  const h = harness({ parentTimeoutMs: 80 });
  h.send({ type: "start", config: config() });
  await flush();
  await delay(40);
  h.send({ type: "ping" });
  await delay(50);
  assert.deepEqual(h.exits, []);
  assert.equal(h.calls.filter((call) => call[0] === "listen").length, 1);
  await h.worker.stop();
});

async function freePort() {
  const s = http.createServer();
  await new Promise((resolve, reject) => {
    s.once("error", reject);
    s.listen(0, "127.0.0.1", resolve);
  });
  const port = s.address().port;
  await new Promise((resolve) => s.close(resolve));
  return port;
}

async function makeOfficeFixture(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "pi-office-runtime-test-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const office = path.join(directory, "office");
  await fs.mkdir(path.join(office, "bridge"), { recursive: true });
  await fs.mkdir(path.join(office, "dist"), { recursive: true });
  await fs.mkdir(path.join(directory, "user"));
  for (const filename of ["server.mjs", "state.mjs"])
    await fs.copyFile(
      path.resolve(__dirname, "../../bridge", filename),
      path.join(office, "bridge", filename),
    );
  await fs.writeFile(
    path.join(office, "dist", "index.html"),
    "<!doctype html><title>Test office</title>",
  );
  // This is a fixed synthetic test credential, never a generated/user credential.
  const tokenFile = path.join(directory, "user", ".pi-office-token");
  await fs.writeFile(tokenFile, `${token}\n`, { mode: 0o600 });
  return { directory, office, tokenFile };
}

function workerAdapter() {
  const children = [];
  return {
    children,
    fork() {
      const child = new EventEmitter();
      const parent = new EventEmitter();
      child.postMessage = (message) =>
        queueMicrotask(() => parent.emit("message", { data: message }));
      parent.postMessage = (message) =>
        queueMicrotask(() => child.emit("message", message));
      const worker = createBridgeWorker({
        parentPort: parent,
        exit: (code) => child.emit("exit", code),
      });
      child.kill = () => {
        void worker.stop();
        return true;
      };
      children.push(child);
      return child;
    },
  };
}

test("real unchanged bridge starts, serves full office, reuses synthetic persistent token and stops without mutation", async (t) => {
  const fixture = await makeOfficeFixture(t);
  const port = await freePort();
  const utilityProcess = workerAdapter();
  const makeRuntime = () =>
    createBridgeRuntime({
      app: {
        isReady: () => true,
        isPackaged: true,
        getPath: () => path.dirname(fixture.tokenFile),
      },
      utilityProcess,
      resourcesPath: fixture.directory,
      port,
      env: {},
    });
  for (let run = 0; run < 2; run++) {
    const manager = makeRuntime();
    t.after(() => manager.stop());
    assert.equal((await manager.start()).mode, "owned");
    assert.equal(manager.getTokenFile(), fixture.tokenFile);
    assert.equal(await fs.readFile(fixture.tokenFile, "utf8"), `${token}\n`);
    const before = await fetch(`http://127.0.0.1:${port}/api/snapshot`).then(
      (res) => res.json(),
    );
    const page = await fetch(`http://127.0.0.1:${port}/`).then((res) =>
      res.text(),
    );
    assert.match(page, /Test office/);
    const after = await fetch(`http://127.0.0.1:${port}/api/snapshot`).then(
      (res) => res.json(),
    );
    assert.deepEqual(after, before);
    const external = makeRuntime();
    assert.equal((await external.start()).mode, "external");
    await external.stop();
    assert.equal((await requestBridgeHealth({ port })).status, "healthy");
    assert.equal(utilityProcess.children.length, run + 1);
    await manager.stop();
    assert.equal((await requestBridgeHealth({ port })).status, "absent");
  }
});

test("real unrelated listener remains running and sees only health GET on conflict", async (t) => {
  const methods = [];
  const s = http.createServer((req, res) => {
    methods.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"service":"something-else"}');
  });
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => s.close(resolve)));
  const utilityProcess = workerAdapter();
  const manager = createBridgeRuntime({
    app: { isReady: () => true },
    utilityProcess,
    env: {},
    port: s.address().port,
  });
  await assert.rejects(manager.start(), { code: "HEALTH" });
  await manager.stop();
  assert.equal(s.listening, true);
  assert.equal(utilityProcess.children.length, 0);
  assert.deepEqual(methods, ["GET /api/health"]);
});

test("orphaned worker self-exits within a bound even if startup never completes", async () => {
  const h = harness({
    parentTimeoutMs: 20,
    shutdownTimeoutMs: 20,
    loadBridge: () => new Promise(() => {}),
  });
  h.send({ type: "start", config: config() });
  await delay(80);
  assert.deepEqual(h.exits, [1]);
  assert.equal(h.parent.listenerCount("message"), 0);
  assert.equal(h.parent.listenerCount("close"), 0);
  assert.equal(
    h.messages.some((message) => message.type === "ready"),
    false,
  );
});

test("worker self-exit also bounds a hung graceful bridge close", async () => {
  const h = harness({ shutdownTimeoutMs: 20 });
  h.bridge.close = () => new Promise(() => {});
  h.send({ type: "start", config: config() });
  await flush();
  h.send({ type: "stop" });
  await delay(60);
  assert.deepEqual(h.exits, [1]);
  assert.equal(
    h.messages.some((message) => message.type === "stopped"),
    false,
  );
});
