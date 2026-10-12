"use strict";
// Independent adversarial audit: fixed authority, renderer isolation and race recovery.
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  parsePort,
  officeUrl,
  isAllowedCommand,
  isTrustedSender,
  isAllowedRendererRequest,
  projectSnapshot,
  requestSnapshot,
  createSnapshotPoller,
} = require("../core.cjs");

const valid = () => ({
  streamId: "stream",
  revision: 1,
  updatedAt: 1,
  sessions: [
    {
      id: "session",
      name: "Session",
      connected: true,
      agents: [{ id: "agent", name: "Agent", state: "working" }],
    },
  ],
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
function responseHarness({
  status = 200,
  headers = {},
  body,
  emitResponse = true,
} = {}) {
  const request = new EventEmitter();
  const response = new EventEmitter();
  request.destroyed = false;
  response.destroyed = false;
  request.destroy = () => {
    request.destroyed = true;
  };
  response.destroy = () => {
    response.destroyed = true;
  };
  response.statusCode = status;
  response.headers = { "content-type": "application/json", ...headers };
  let options;
  let callback;
  request.end = () =>
    queueMicrotask(() => {
      if (emitResponse) callback(response);
      if (body !== undefined && !response.destroyed) {
        response.emit("data", Buffer.from(body));
        response.emit("end");
      }
    });
  return {
    request,
    response,
    get options() {
      return options;
    },
    transport: (opts, cb) => {
      options = opts;
      callback = cb;
      return request;
    },
    deliverResponse: () => callback(response),
  };
}

for (const value of [
  "https://evil.example/",
  "../4317",
  "4317/path",
  "4317?x",
  "4317#x",
  " 4317 ",
  "1e3",
  "0",
  "-1",
  "65536",
  1.5,
]) {
  test(`audit: port rejects authority/endpoint injection ${JSON.stringify(value)}`, () => {
    assert.throws(() => parsePort(value));
    assert.throws(() => officeUrl(value));
  });
}

test("audit: snapshot GET has fixed IPv4 authority/path, no cookies, token or proxy", async () => {
  const h = responseHarness({ body: JSON.stringify(valid()) });
  await requestSnapshot({ port: 4444, request: h.transport });
  assert.deepEqual(h.options, {
    hostname: "127.0.0.1",
    family: 4,
    port: 4444,
    path: "/api/snapshot",
    method: "GET",
    agent: false,
    headers: { Accept: "application/json", "Accept-Encoding": "identity" },
  });
});

for (const status of [301, 302, 303, 307, 308]) {
  test(`audit: redirect ${status} is rejected without following Location`, async () => {
    let calls = 0;
    const h = responseHarness({
      status,
      headers: { location: "https://evil.example/collect" },
    });
    await assert.rejects(
      requestSnapshot({
        request: (...args) => {
          calls++;
          return h.transport(...args);
        },
      }),
      /HTTP/,
    );
    assert.equal(calls, 1);
    assert.equal(h.request.destroyed, true);
    assert.equal(h.response.destroyed, true);
  });
}

for (const headers of [
  { "content-length": "33" },
  { "content-length": "-1" },
  { "content-length": "1e6" },
  { "content-length": " 8 " },
  { "content-type": "text/html" },
  { "content-type": "application/jsonp" },
  { "content-encoding": "gzip" },
]) {
  test(`audit: disallowed response headers terminate resources ${JSON.stringify(headers)}`, async () => {
    const h = responseHarness({ headers });
    await assert.rejects(
      requestSnapshot({ request: h.transport, maxBytes: 32 }),
    );
    assert.equal(h.request.destroyed, true);
    assert.equal(h.response.destroyed, true);
  });
}

test("audit: streamed overflow is rejected before end even with absent Content-Length", async () => {
  const h = responseHarness();
  const outcome = assert.rejects(
    requestSnapshot({ request: h.transport, maxBytes: 32 }),
    /too large/,
  );
  await flush();
  h.response.emit("data", Buffer.alloc(16));
  h.response.emit("data", Buffer.alloc(17));
  await outcome;
  assert.equal(h.request.destroyed, true);
  assert.equal(h.response.destroyed, true);
  h.response.emit("data", Buffer.alloc(100));
  h.response.emit("end");
});

test("audit: stalled response has bounded total deadline and destroys connection", async () => {
  const h = responseHarness();
  await assert.rejects(
    requestSnapshot({ request: h.transport, timeoutMs: 5 }),
    /timed out/,
  );
  assert.equal(h.request.destroyed, true);
  assert.equal(h.response.destroyed, true);
});

test("audit: pre-aborted fetch makes no request", async () => {
  const signal = AbortSignal.abort();
  let called = false;
  await assert.rejects(
    requestSnapshot({
      signal,
      request() {
        called = true;
      },
    }),
    { name: "AbortError" },
  );
  assert.equal(called, false);
});

test("audit: cancellation before response also destroys a late response", async () => {
  const h = responseHarness({ emitResponse: false });
  const control = new AbortController();
  const outcome = assert.rejects(
    requestSnapshot({ signal: control.signal, request: h.transport }),
    { name: "AbortError" },
  );
  control.abort();
  await outcome;
  h.deliverResponse();
  assert.equal(h.request.destroyed, true);
  assert.equal(h.response.destroyed, true);
});

for (const body of [
  "not json",
  "null",
  "[]",
  "{}",
  '{"sessions":{}}',
  '{"sessions":[null]}',
  '{"sessions":[{"id":"s","agents":{}}]}',
]) {
  test(`audit: malformed shape is rejected ${body}`, async () => {
    const h = responseHarness({ body });
    await assert.rejects(
      requestSnapshot({ request: h.transport }),
      /Invalid bridge snapshot/,
    );
  });
}

test("audit: payload projection strips extra data, clamps text, keeps prototype keys inert", () => {
  const input = valid();
  input.secret = "secret";
  input.sessions[0].token = "token";
  input.sessions[0].agents[0].logs = [{ message: "private log" }];
  input.sessions[0].agents[0].task = "\u0000".repeat(2000);
  input.sessions[0].agents[0].name = "<img src=x onerror=alert(1)>";
  input.sessions[0].agents[0].id = "__proto__";
  const projected = projectSnapshot(input);
  assert.equal(projected.secret, undefined);
  assert.equal(projected.sessions[0].token, undefined);
  assert.equal(projected.sessions[0].agents[0].logs, undefined);
  assert.equal(projected.sessions[0].agents[0].task.length, 1000);
  assert.equal(projected.sessions[0].agents[0].task.includes("\u0000"), false);
  assert.equal(projected.sessions[0].agents[0].id, "__proto__");
  assert.equal({}.polluted, undefined);
  assert.deepEqual(Object.keys(projected).sort(), [
    "revision",
    "sessions",
    "streamId",
    "updatedAt",
    "version",
  ]);
});

test("audit: session and agent identity collisions, controls and population overflow rejected", () => {
  const duplicateSession = valid();
  duplicateSession.sessions.push(duplicateSession.sessions[0]);
  assert.throws(() => projectSnapshot(duplicateSession));
  const duplicateAgent = valid();
  duplicateAgent.sessions[0].agents.push(duplicateAgent.sessions[0].agents[0]);
  assert.throws(() => projectSnapshot(duplicateAgent));
  for (const id of ["", " ", "x\u0000y", "x\u007fy", "x".repeat(241)]) {
    const input = valid();
    input.sessions[0].agents[0].id = id;
    assert.throws(() => projectSnapshot(input));
  }
  assert.throws(() =>
    projectSnapshot({
      sessions: Array.from({ length: 25 }, (_, i) => ({
        id: `${i}`,
        agents: [],
      })),
    }),
  );
  assert.throws(() =>
    projectSnapshot({
      sessions: [
        {
          id: "s",
          agents: Array.from({ length: 65 }, (_, i) => ({ id: `${i}` })),
        },
      ],
    }),
  );
});

test("audit: IPC rejects other windows, child frames, navigated frames and absent frames", () => {
  const url = "file:///test/dist/index.html";
  const mainFrame = { url };
  const contents = { mainFrame, getURL: () => url, isDestroyed: () => false };
  const win = { webContents: contents, isDestroyed: () => false };
  assert.equal(
    isTrustedSender({ sender: contents, senderFrame: mainFrame }, win, url),
    true,
  );
  for (const event of [
    { sender: {}, senderFrame: mainFrame },
    { sender: contents, senderFrame: { url } },
    { sender: contents },
    {},
  ])
    assert.equal(isTrustedSender(event, win, url), false);
  mainFrame.url = "https://evil.example/";
  assert.equal(
    isTrustedSender({ sender: contents, senderFrame: mainFrame }, win, url),
    false,
  );
  mainFrame.url = url;
  contents.getURL = () => "https://evil.example/";
  assert.equal(
    isTrustedSender({ sender: contents, senderFrame: mainFrame }, win, url),
    false,
  );
  contents.getURL = () => {
    throw new Error("destroyed frame");
  };
  assert.equal(
    isTrustedSender({ sender: contents, senderFrame: mainFrame }, win, url),
    false,
  );
});

test("audit: renderer resource boundary rejects external, UNC, query and traversal requests", () => {
  const dir = path.resolve("/audit/desktop/dist");
  for (const url of [
    "https://example.com/",
    "http://127.0.0.1:4317/api/snapshot",
    "file://server/audit/desktop/dist/index.html",
    "data:text/html,x",
    "javascript:alert(1)",
    pathToFileURL(path.join(dir, "..", "token")).href,
    `${pathToFileURL(path.join(dir, "index.html")).href}?outside=1`,
    "file:///audit/desktop/dist/%2e%2e/token",
    "file:///audit/desktop/dist/%2e%2e%2ftoken",
    "file:///audit/desktop/dist-other/index.html",
  ]) {
    assert.equal(isAllowedRendererRequest(url, dir), false, url);
  }
  assert.equal(
    isAllowedRendererRequest(
      pathToFileURL(path.join(dir, "assets", "app.js")).href,
      dir,
    ),
    true,
  );
});

test("audit: command set rejects arbitrary URL, shell, object and prototype commands", () => {
  for (const command of [
    "open:https://evil.example/",
    "https://evil.example/",
    "__proto__",
    "constructor",
    "execute",
    "set-port",
    "toggle-lock",
    {},
    ["hide"],
    null,
    1,
  ]) {
    assert.equal(isAllowedCommand(command), false);
  }
  assert.equal(isAllowedCommand("open-office"), true);
});

function pollHarness() {
  const requests = [];
  const updates = [];
  const timers = new Map();
  let timerId = 0;
  const poller = createSnapshotPoller({
    onUpdate: (value) => updates.push(value),
    now: () => 100,
    fetchSnapshot: ({ signal }) =>
      new Promise((resolve, reject) =>
        requests.push({ signal, resolve, reject }),
      ),
    setTimer: (fn, ms) => {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  return { poller, requests, updates, timers };
}

test("audit: hidden inflight request aborts, repeated visibility does not fork, stale success cannot resurrect", async () => {
  const h = pollHarness();
  h.poller.setVisible(true);
  h.poller.setVisible(true);
  assert.equal(h.requests.length, 1);
  h.poller.setVisible(false);
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].resolve(valid());
  await flush();
  assert.equal(h.poller.getState().snapshot, null);
  assert.equal(h.poller.getState().connection.status, "paused");
  assert.equal(h.timers.size, 0);
});

test("audit: hide/show race drops superseded failures and schedules only current generation", async () => {
  const h = pollHarness();
  h.poller.setVisible(true);
  h.poller.setVisible(false);
  h.poller.setVisible(true);
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve({ ...valid(), revision: 2 });
  await flush();
  h.requests[0].reject(new Error("old failure"));
  await flush();
  assert.equal(h.poller.getState().snapshot.revision, 2);
  assert.equal(h.poller.getState().connection.status, "live");
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].ms, 2000);
  h.poller.setVisible(false);
  assert.equal(h.timers.size, 0);
});

test("audit: stale success cannot overwrite current generation or clear its abort controller", async () => {
  const h = pollHarness();
  h.poller.setVisible(true);
  h.poller.setVisible(false);
  h.poller.setVisible(true);
  h.requests[0].resolve({ ...valid(), revision: 999 });
  await flush();
  assert.equal(h.poller.getState().snapshot, null);
  h.poller.dispose();
  assert.equal(h.requests[1].signal.aborted, true);
  h.requests[1].resolve(valid());
  await flush();
  assert.equal(h.poller.getState().snapshot, null);
  assert.equal(h.timers.size, 0);
  h.poller.setVisible(true);
  assert.equal(h.requests.length, 2);
});

test("audit: offline preserves last success without marking data live and recovers on next poll", async () => {
  const h = pollHarness();
  h.poller.setVisible(true);
  h.requests[0].resolve(valid());
  await flush();
  let timer = [...h.timers.entries()][0];
  h.timers.delete(timer[0]);
  timer[1].fn();
  h.requests[1].reject(new Error("gone"));
  await flush();
  assert.equal(h.poller.getState().snapshot.revision, 1);
  assert.equal(h.poller.getState().connection.status, "offline");
  assert.equal(h.poller.getState().connection.lastSuccessAt, 100);
  timer = [...h.timers.entries()][0];
  h.timers.delete(timer[0]);
  timer[1].fn();
  h.requests[2].resolve({ ...valid(), revision: 2 });
  await flush();
  assert.equal(h.poller.getState().snapshot.revision, 2);
  assert.equal(h.poller.getState().connection.status, "live");
  h.poller.dispose();
});

test("audit: omitted legacy project metadata remains omitted; explicit null remains null", () => {
  const input = valid();
  input.sessions[0].cwd = "/project/legacy";
  assert.equal(
    Object.hasOwn(projectSnapshot(input).sessions[0], "project"),
    false,
  );
  input.sessions[0].project = null;
  assert.equal(projectSnapshot(input).sessions[0].project, null);
});
