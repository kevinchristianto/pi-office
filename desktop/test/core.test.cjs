"use strict";
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

const snapshot = () => ({
  version: 1,
  streamId: "stream",
  revision: 2,
  updatedAt: 100,
  sessions: [
    {
      id: "s",
      name: "Office",
      connected: true,
      connectionState: "live",
      agents: [
        {
          id: "a",
          name: "Pi",
          state: "working",
          task: "Read tests",
          logs: [{ message: "private" }],
        },
      ],
    },
  ],
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
function transport({
  body = JSON.stringify(snapshot()),
  status = 200,
  headers = {},
  chunks,
  fail,
  stalled = false,
} = {}) {
  let options;
  const req = new EventEmitter();
  const res = new EventEmitter();
  req.destroyed = res.destroyed = false;
  req.destroy = () => {
    req.destroyed = true;
  };
  res.destroy = () => {
    res.destroyed = true;
  };
  const request = (nextOptions, callback) => {
    options = nextOptions;
    req.end = () =>
      queueMicrotask(() => {
        if (fail) return req.emit("error", new Error(fail));
        if (stalled) return;
        res.statusCode = status;
        res.headers = {
          "content-type": "application/json; charset=utf-8",
          ...headers,
        };
        callback(res);
        for (const chunk of chunks || [body])
          res.emit("data", Buffer.from(chunk));
        res.emit("end");
      });
    return req;
  };
  return { request, req, res, options: () => options };
}

test("port parsing fixes loopback destination and rejects hostile or ambiguous values", () => {
  assert.equal(parsePort(), 4317);
  assert.equal(parsePort(""), 4317);
  assert.equal(parsePort("65432"), 65432);
  assert.equal(officeUrl(4317), "http://127.0.0.1:4317/");
  for (const value of [
    "-1",
    "0",
    65536,
    "4317/x",
    " 4317",
    "1e3",
    "1.2",
    "localhost",
    "http://evil",
    {},
    null,
  ]) {
    assert.throws(() => parsePort(value));
  }
});

test("commands are finite literals, not URL or IPC forwarding", () => {
  for (const name of [
    "lock",
    "restore",
    "hide",
    "compact",
    "roomy",
    "toggle-top",
    "open-office",
    "quit",
  ])
    assert.equal(isAllowedCommand(name), true);
  for (const value of [
    "execute",
    "open-office http://evil",
    "toString",
    "__proto__",
    null,
    {},
    ["hide"],
  ])
    assert.equal(isAllowedCommand(value), false);
});

test("IPC requires exact window, main frame and built file with no alternate URL", () => {
  const url = "file:///app/dist/index.html";
  const frame = { url };
  const contents = {
    mainFrame: frame,
    isDestroyed: () => false,
    getURL: () => url,
  };
  const win = { webContents: contents, isDestroyed: () => false };
  assert.equal(
    isTrustedSender({ sender: contents, senderFrame: frame }, win, url),
    true,
  );
  assert.equal(
    isTrustedSender({ sender: {}, senderFrame: frame }, win, url),
    false,
  );
  assert.equal(
    isTrustedSender({ sender: contents, senderFrame: { url } }, win, url),
    false,
  );
  assert.equal(
    isTrustedSender(
      { sender: contents, senderFrame: frame },
      win,
      `${url}#other`,
    ),
    false,
  );
  assert.equal(isTrustedSender({ sender: contents }, win, url), false);
  frame.url = "http://127.0.0.1:4317/";
  assert.equal(
    isTrustedSender({ sender: contents, senderFrame: frame }, win, url),
    false,
  );
});

test("renderer requests stay in dist and cannot contact bridge or read token", () => {
  const dist = path.resolve("/app/dist");
  const url = (name) => pathToFileURL(path.join(dist, name)).href;
  for (const name of ["index.html", "assets/main.js", "assets/style.css"])
    assert.equal(isAllowedRendererRequest(url(name), dist), true);
  for (const value of [
    "http://127.0.0.1:4317/api/snapshot",
    "https://evil.test",
    "data:text/html,Hi",
    "file:///app/.pi-office-token",
    "file:///app/dist2/a",
    `${url("index.html")}?x`,
    "file://host/app/dist/x",
    "file:///app/dist/../../etc/passwd",
  ])
    assert.equal(isAllowedRendererRequest(value, dist), false);
});

test("snapshot projection bounds text and omits logs, capabilities and hostile fields", () => {
  const value = snapshot();
  value.secret = "never expose";
  value.sessions[0].agents[0].task = "a".repeat(2000);
  value.sessions[0].agents[0].capabilities = ["shell"];
  value.sessions[0].agents[0].name = "Pi\0<script>";
  const projected = projectSnapshot(value);
  assert.equal(projected.sessions[0].agents[0].task.length, 1000);
  assert.equal(projected.sessions[0].agents[0].name, "Pi <script>");
  assert.equal(projected.sessions[0].agents[0].logs, undefined);
  assert.equal(projected.sessions[0].agents[0].capabilities, undefined);
  assert.equal(projected.secret, undefined);
});

test("snapshot rejects invalid identity, duplicate same-source ids and oversized rosters", () => {
  for (const value of [
    null,
    [],
    {},
    { version: 2, sessions: [] },
    { sessions: {} },
    { sessions: Array(25).fill({}) },
  ])
    assert.throws(() => projectSnapshot(value));
  const value = snapshot();
  value.sessions.push(value.sessions[0]);
  assert.throws(() => projectSnapshot(value));
  value.sessions.pop();
  value.sessions[0].agents.push(value.sessions[0].agents[0]);
  assert.throws(() => projectSnapshot(value));
  value.sessions[0].agents.pop();
  value.sessions[0].agents[0].id = "bad\nidentity";
  assert.throws(() => projectSnapshot(value));
  value.sessions[0].agents = Array(65).fill({});
  assert.throws(() => projectSnapshot(value));
});

test("same raw agent ID in different sessions remains distinct", () => {
  const value = snapshot();
  value.sessions.push({ ...value.sessions[0], id: "another-session" });
  const projected = projectSnapshot(value);
  assert.equal(projected.sessions.length, 2);
  assert.equal(
    projected.sessions[0].agents[0].id,
    projected.sessions[1].agents[0].id,
  );
});

test("HTTP transport sends a single fixed IPv4 GET without auth or proxy", async () => {
  const mock = transport();
  const result = await requestSnapshot({ port: 5432, request: mock.request });
  assert.equal(result.sessions[0].id, "s");
  assert.deepEqual(mock.options(), {
    hostname: "127.0.0.1",
    family: 4,
    port: 5432,
    path: "/api/snapshot",
    method: "GET",
    agent: false,
    headers: { Accept: "application/json", "Accept-Encoding": "identity" },
  });
});

for (const status of [301, 302, 307, 308, 401, 404, 500]) {
  test(`HTTP ${status} is rejected, including redirects`, async () => {
    const mock = transport({
      status,
      headers: { location: "https://evil.test" },
    });
    await assert.rejects(
      requestSnapshot({ request: mock.request }),
      new RegExp(`HTTP ${status}`),
    );
    assert.equal(mock.req.destroyed, true);
    assert.equal(mock.res.destroyed, true);
  });
}

test("malformed JSON, wrong type and compressed responses are rejected", async () => {
  for (const options of [
    { body: "<html>" },
    { body: "{}" },
    { headers: { "content-type": "text/html" } },
    { headers: { "content-encoding": "gzip" } },
  ]) {
    const mock = transport(options);
    await assert.rejects(requestSnapshot({ request: mock.request }));
  }
});

test("response byte cap applies both to declared and streaming length", async () => {
  for (const options of [
    { headers: { "content-length": "100" } },
    { headers: { "content-length": "NaN" } },
    { chunks: ["123456", "789012"] },
  ]) {
    const mock = transport(options);
    await assert.rejects(
      requestSnapshot({ request: mock.request, maxBytes: 10 }),
      /too large/,
    );
    assert.equal(mock.req.destroyed, true);
  }
});

test("transport deadline aborts stalled request", async () => {
  const mock = transport({ stalled: true });
  await assert.rejects(
    requestSnapshot({ request: mock.request, timeoutMs: 5 }),
    /timed out/,
  );
  assert.equal(mock.req.destroyed, true);
});

test("abort closes active request and pre-abort performs no request", async () => {
  const controller = new AbortController();
  const mock = transport({ stalled: true });
  const promise = requestSnapshot({
    request: mock.request,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(promise, { name: "AbortError" });
  assert.equal(mock.req.destroyed, true);
  await assert.rejects(
    requestSnapshot({
      request: () => {
        assert.fail("called after abort");
      },
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
});

function pollingFixture() {
  const updates = [];
  const requests = [];
  const scheduled = new Map();
  let timerId = 0;
  const poller = createSnapshotPoller({
    onUpdate: (value) => updates.push(value),
    now: () => 123,
    fetchSnapshot: ({ signal }) =>
      new Promise((resolve, reject) =>
        requests.push({ signal, resolve, reject }),
      ),
    setTimer: (fn, ms) => {
      const id = ++timerId;
      scheduled.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => scheduled.delete(id),
  });
  return { poller, updates, requests, scheduled };
}

test("polling starts only visible, schedules one sequential refresh and pauses hidden", async () => {
  const { poller, requests, updates, scheduled } = pollingFixture();
  assert.equal(requests.length, 0);
  poller.setVisible(true);
  poller.setVisible(true);
  assert.equal(requests.length, 1);
  assert.equal(updates.at(-1).connection.status, "connecting");
  requests[0].resolve(snapshot());
  await flush();
  assert.equal(updates.at(-1).connection.status, "live");
  assert.equal(updates.at(-1).connection.lastSuccessAt, 123);
  assert.equal(scheduled.size, 1);
  assert.equal([...scheduled.values()][0].ms, 2000);
  poller.setVisible(false);
  assert.equal(scheduled.size, 0);
  assert.equal(updates.at(-1).connection.status, "paused");
  assert.equal(updates.at(-1).snapshot.sessions[0].id, "s");
  poller.dispose();
});

test("hide aborts pending request; late result cannot overwrite a resumed newer request", async () => {
  const { poller, requests, updates, scheduled } = pollingFixture();
  poller.setVisible(true);
  poller.setVisible(false);
  assert.equal(requests[0].signal.aborted, true);
  poller.setVisible(true);
  requests[1].resolve({ sessions: [], revision: 10 });
  await flush();
  requests[0].resolve({ sessions: [], revision: 1 });
  await flush();
  assert.equal(updates.at(-1).snapshot.revision, 10);
  assert.equal(scheduled.size, 1);
  poller.dispose();
});

test("offline retains last success, resumes next poll, and dispose prevents stale notifications", async () => {
  const { poller, requests, updates, scheduled } = pollingFixture();
  poller.setVisible(true);
  requests[0].resolve(snapshot());
  await flush();
  const next = [...scheduled.values()][0];
  scheduled.clear();
  next.fn();
  requests[1].reject(new Error("Bridge unavailable"));
  await flush();
  assert.equal(updates.at(-1).connection.status, "offline");
  assert.equal(updates.at(-1).connection.lastSuccessAt, 123);
  assert.equal(updates.at(-1).snapshot.sessions.length, 1);
  poller.setVisible(false);
  poller.setVisible(true);
  const before = updates.length;
  poller.dispose();
  assert.equal(requests[2].signal.aborted, true);
  requests[2].resolve(snapshot());
  await flush();
  assert.equal(updates.length, before);
  assert.equal(scheduled.size, 0);
  poller.setVisible(true);
  assert.equal(requests.length, 3);
});
