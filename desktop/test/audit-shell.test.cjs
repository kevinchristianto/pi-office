"use strict";
// Independent shell/preload audit using Electron-shaped fakes, not native-runtime claims.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { pathToFileURL } = require("node:url");
const { createCompanion, IPC, RESTORE_SHORTCUT } = require("../main.cjs");

function fakeElectron({
  trayFails = false,
  shortcutsWork = true,
  singleInstance = true,
} = {}) {
  const state = {
    opened: [],
    handlers: new Map(),
    shortcuts: new Map(),
    sessions: [],
    windows: [],
    registered: true,
  };
  const app = new EventEmitter();
  Object.assign(app, {
    setName(name) {
      state.name = name;
    },
    enableSandbox() {
      state.sandbox = true;
    },
    requestSingleInstanceLock: () => singleInstance,
    whenReady: async () => {},
    quit() {
      state.quit = true;
    },
  });
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      state.windows.push(this);
      this.options = options;
      this.visible = false;
      this.minimized = false;
      this.destroyed = false;
      this.bounds = {
        x: 0,
        y: 0,
        width: options.width,
        height: options.height,
      };
      this.loadCount = 0;
      this.ignore = false;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        mainFrame: { url: "" },
        isDestroyed: () => false,
        getURL: () => this.webContents.mainFrame.url,
        setWindowOpenHandler: (fn) => {
          this.popup = fn;
        },
        send: (...args) => {
          this.lastSend = args;
        },
      });
    }
    isDestroyed() {
      return this.destroyed;
    }
    isVisible() {
      return this.visible;
    }
    isMinimized() {
      return this.minimized;
    }
    getBounds() {
      return this.bounds;
    }
    setMenu(value) {
      this.menu = value;
    }
    setIgnoreMouseEvents(value, options) {
      this.ignore = value;
      this.ignoreOptions = options;
    }
    setFocusable(value) {
      this.focusable = value;
    }
    setMovable(value) {
      this.movable = value;
    }
    setAlwaysOnTop(value) {
      this.top = value;
    }
    setSize(width, height) {
      Object.assign(this.bounds, { width, height });
    }
    setBounds(bounds) {
      this.bounds = { ...bounds };
    }
    setPosition(x, y) {
      Object.assign(this.bounds, { x, y });
    }
    show() {
      this.visible = true;
      this.emit("show");
    }
    hide() {
      this.visible = false;
      this.emit("hide");
    }
    restore() {
      this.minimized = false;
      this.emit("restore");
    }
    focus() {
      this.focused = true;
    }
    blur() {
      this.focused = false;
    }
    async loadURL(url) {
      this.loadCount++;
      this.webContents.mainFrame.url = url;
    }
  }
  class Tray extends EventEmitter {
    constructor() {
      super();
      if (trayFails) throw new Error("No OS tray");
      this.destroyed = false;
    }
    isDestroyed() {
      return this.destroyed;
    }
    setContextMenu(menu) {
      this.menu = menu;
    }
    setToolTip() {}
    destroy() {
      this.destroyed = true;
    }
  }
  const companionSession = new EventEmitter();
  Object.assign(companionSession, {
    setPermissionRequestHandler(fn) {
      state.permissionRequest = fn;
    },
    setPermissionCheckHandler(fn) {
      state.permissionCheck = fn;
    },
    setDevicePermissionHandler(fn) {
      state.devicePermission = fn;
    },
    webRequest: {
      onBeforeRequest(filter, fn) {
        state.filter = filter;
        state.beforeRequest = fn;
      },
    },
  });
  const electron = {
    app,
    BrowserWindow,
    Tray,
    Menu: { buildFromTemplate: (menu) => menu },
    nativeImage: { createFromBitmap: () => ({}) },
    globalShortcut: {
      register(key, callback) {
        if (!shortcutsWork) return false;
        state.shortcuts.set(key, callback);
        return true;
      },
      isRegistered: (key) => state.registered && state.shortcuts.has(key),
      unregisterAll() {
        state.shortcuts.clear();
      },
    },
    ipcMain: {
      handle(name, handler) {
        state.handlers.set(name, handler);
      },
      removeHandler(name) {
        state.handlers.delete(name);
      },
    },
    session: {
      fromPartition(name, options) {
        state.sessions.push({ name, options });
        return companionSession;
      },
    },
    shell: {
      async openExternal(url) {
        state.opened.push(url);
      },
    },
    screen: {
      getDisplayMatching: () => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
    },
  };
  return { electron, state, companionSession };
}
async function setup(options = {}) {
  const h = fakeElectron(options);
  const requests = [];
  const baseDirectory = path.resolve(__dirname, "..");
  const companion = createCompanion(h.electron, {
    platform: "linux",
    baseDirectory,
    env: { PI_OFFICE_PORT: "4321" },
    fetchSnapshot: ({ signal }) =>
      new Promise((resolve, reject) =>
        requests.push({ signal, resolve, reject }),
      ),
  });
  await companion.start();
  const window = companion.getWindow();
  return {
    ...h,
    companion,
    window,
    requests,
    event: {
      sender: window?.webContents,
      senderFrame: window?.webContents.mainFrame,
    },
  };
}

test("audit: native shell construction enables sandbox/isolation and disables privileged renderer features", async () => {
  const h = await setup();
  try {
    assert.equal(h.state.sandbox, true);
    const prefs = h.window.options.webPreferences;
    for (const key of [
      "nodeIntegration",
      "nodeIntegrationInWorker",
      "nodeIntegrationInSubFrames",
      "allowRunningInsecureContent",
      "webviewTag",
      "devTools",
      "navigateOnDragDrop",
    ]) {
      assert.equal(prefs[key], false, key);
    }
    for (const key of [
      "sandbox",
      "contextIsolation",
      "webSecurity",
      "backgroundThrottling",
    ])
      assert.equal(prefs[key], true, key);
    assert.equal(h.window.options.show, false);
    assert.equal(h.window.options.skipTaskbar, false);
    assert.deepEqual(h.state.sessions, [
      { name: "pi-office-companion", options: { cache: false } },
    ]);
    assert.equal(h.requests.length, 0);
  } finally {
    h.companion.dispose();
  }
});

test("audit: shell denies permissions, downloads, navigation, redirects, child navigation, webviews and popups", async () => {
  const h = await setup();
  try {
    let permission;
    h.state.permissionRequest({}, "camera", (result) => {
      permission = result;
    });
    assert.equal(permission, false);
    assert.equal(h.state.permissionCheck(), false);
    assert.equal(h.state.devicePermission(), false);
    assert.deepEqual(h.window.popup({ url: "https://example.com" }), {
      action: "deny",
    });
    for (const name of [
      "will-navigate",
      "will-frame-navigate",
      "will-redirect",
      "will-attach-webview",
    ]) {
      let blocked = false;
      h.window.webContents.emit(
        name,
        {
          preventDefault() {
            blocked = true;
          },
        },
        "https://example.com",
      );
      assert.equal(blocked, true, name);
    }
    let blocked = false;
    h.companionSession.emit("will-download", {
      preventDefault() {
        blocked = true;
      },
    });
    assert.equal(blocked, true);
    for (const url of [
      "https://example.com/",
      "http://127.0.0.1:4321/api/snapshot",
      pathToFileURL(path.resolve(__dirname, "..", "preload.cjs")).href,
    ]) {
      let result;
      h.state.beforeRequest({ url }, (value) => {
        result = value;
      });
      assert.deepEqual(result, { cancel: true });
    }
  } finally {
    h.companion.dispose();
  }
});

test("audit: live IPC handlers reject URL injection, extra arguments, forged windows and subframes", async () => {
  const h = await setup();
  try {
    const command = h.state.handlers.get(IPC.command);
    const getState = h.state.handlers.get(IPC.state);
    assert.throws(() =>
      command(h.event, "open-office", "https://evil.example/"),
    );
    assert.throws(() => command(h.event, "https://evil.example/"));
    assert.throws(() =>
      command({ sender: {}, senderFrame: h.event.senderFrame }, "open-office"),
    );
    assert.throws(() =>
      command(
        {
          sender: h.event.sender,
          senderFrame: { url: h.event.senderFrame.url },
        },
        "open-office",
      ),
    );
    assert.throws(() => getState(h.event, "unexpected"));
    assert.throws(() =>
      getState({ sender: h.event.sender, senderFrame: null }),
    );
    assert.equal(h.state.opened.length, 0);
    await command(h.event, "open-office");
    assert.deepEqual(h.state.opened, ["http://127.0.0.1:4321/"]);
  } finally {
    h.companion.dispose();
  }
});

test("audit: native show/hide/minimize lifecycle aborts polling and each restore creates only one new request", async () => {
  const h = await setup();
  try {
    h.window.emit("ready-to-show");
    assert.equal(h.requests.length, 1);
    h.companion.restore();
    assert.equal(h.requests.length, 1);
    h.companion.hide();
    assert.equal(h.requests[0].signal.aborted, true);
    h.companion.restore();
    assert.equal(h.requests.length, 2);
    h.window.minimized = true;
    h.window.emit("minimize");
    assert.equal(h.requests[1].signal.aborted, true);
    h.companion.restore();
    assert.equal(h.requests.length, 3);
    h.companion.dispose();
    assert.equal(h.requests[2].signal.aborted, true);
    assert.equal(h.state.handlers.size, 0);
    assert.equal(h.state.shortcuts.size, 0);
  } finally {
    h.companion.dispose();
  }
});

test("audit: click-through can only be entered with current recovery shortcut and every restore clears it", async () => {
  const h = await setup();
  try {
    await h.companion.runCommand("lock");
    assert.equal(h.window.ignore, true);
    assert.equal(h.window.focusable, false);
    assert.equal(h.window.movable, false);
    h.state.shortcuts.get(RESTORE_SHORTCUT)();
    assert.equal(h.window.ignore, false);
    assert.equal(h.window.focusable, true);
    assert.equal(h.window.movable, true);
    assert.equal(h.companion.getState().locked, false);
    h.state.registered = false;
    await assert.rejects(h.companion.runCommand("lock"), /unavailable/);
    assert.equal(h.window.ignore, false);
    assert.equal(h.companion.getState().locked, false);
  } finally {
    h.companion.dispose();
  }
});

test("audit: no tray plus failed shortcut registration leaves hide/lock unavailable and Close quits", async () => {
  const h = await setup({ trayFails: true, shortcutsWork: false });
  try {
    h.window.emit("ready-to-show");
    assert.throws(() => h.companion.hide(), /recovery/);
    assert.equal(h.window.visible, true);
    await assert.rejects(h.companion.runCommand("lock"), /unavailable/);
    h.window.emit("close", {
      preventDefault() {
        assert.fail("Unrecoverable close must quit, not hide");
      },
    });
    assert.equal(h.state.quit, true);
    assert.equal(h.requests[0].signal.aborted, true);
  } finally {
    h.companion.dispose();
  }
});

test("audit: renderer crash clears click-through and cancels active polling", async () => {
  const h = await setup();
  try {
    h.window.emit("ready-to-show");
    await h.companion.runCommand("lock");
    h.window.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    assert.equal(h.window.ignore, false);
    assert.equal(h.companion.getState().locked, false);
    assert.equal(h.requests[0].signal.aborted, true);
  } finally {
    h.companion.dispose();
  }
});

test("audit: second launch never creates another renderer or snapshot poller", async () => {
  const h = await setup({ singleInstance: false });
  assert.equal(h.state.quit, true);
  assert.equal(h.state.windows.length, 0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.state.handlers.size, 0);
  h.companion.dispose();
});

test("audit: preload exposes only narrow frozen methods and strips privileged event objects", async () => {
  let exposed;
  const calls = [];
  const listeners = new Map();
  const ipcRenderer = {
    invoke: (...args) => {
      calls.push(args);
      return Promise.resolve({});
    },
    on: (name, callback) => listeners.set(name, callback),
    removeListener: (name, callback) => {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, "..", "preload.cjs"), "utf8"),
    {
      require(name) {
        assert.equal(name, "electron");
        return {
          ipcRenderer,
          contextBridge: {
            exposeInMainWorld(name, api) {
              assert.equal(name, "companion");
              exposed = api;
            },
          },
        };
      },
    },
  );
  assert.deepEqual(Object.keys(exposed).sort(), [
    "command",
    "getState",
    "onState",
    "resize",
  ]);
  assert.equal(Object.isFrozen(exposed), true);
  await exposed.getState("ignored malicious argument");
  await exposed.command("open-office", "https://evil.example/");
  await assert.rejects(exposed.command("https://evil.example/"));
  assert.deepEqual(calls, [[IPC.state], [IPC.command, "open-office"]]);
  await exposed.resize(750, 420, "ignored extra renderer argument");
  assert.deepEqual(structuredClone(calls.at(-1)), [
    IPC.resize,
    { width: 750, height: 420 },
  ]);
  for (const value of [
    NaN,
    Infinity,
    -1,
    0,
    440.5,
    "440",
    {},
    Number.MAX_SAFE_INTEGER + 1,
  ])
    await assert.rejects(exposed.resize(value, 300), /positive integer/);
  assert.equal(calls.length, 3);
  const received = [];
  const unsubscribe = exposed.onState((...args) => received.push(args));
  const privileged = { sender: { executeJavaScript() {} } };
  const snapshot = { connection: { status: "live" } };
  listeners.get(IPC.update)(privileged, snapshot);
  assert.deepEqual(received, [[snapshot]]);
  unsubscribe();
  assert.equal(listeners.size, 0);
  assert.throws(() => exposed.onState("not a function"));
});

test("audit: renderer CSP has no network, eval, inline-script or object capability", () => {
  const html = fs.readFileSync(
    path.resolve(__dirname, "..", "index.html"),
    "utf8",
  );
  const match = html.match(
    /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  );
  assert.ok(match, "Expected the renderer's Content-Security-Policy meta tag");
  const policy = match[1];
  assert.match(policy, /(?:^|;)\s*connect-src 'none'(?:;|$)/);
  assert.match(policy, /(?:^|;)\s*script-src 'self'(?:;|$)/);
  assert.match(policy, /(?:^|;)\s*object-src 'none'(?:;|$)/);
  assert.match(policy, /(?:^|;)\s*base-uri 'none'(?:;|$)/);
  assert.match(policy, /(?:^|;)\s*form-action 'none'(?:;|$)/);
  assert.equal(policy.includes("unsafe-eval"), false);
  assert.equal(policy.includes("unsafe-inline"), false);
});

test("audit: lost recovery registration cannot hide a trayless window", async () => {
  const h = await setup({ trayFails: true });
  try {
    h.window.emit("ready-to-show");
    h.state.registered = false;
    assert.throws(() => h.companion.hide(), /recovery/);
    assert.equal(h.window.visible, true);
    assert.equal(h.requests[0].signal.aborted, false);
  } finally {
    h.companion.dispose();
  }
});

test("audit: explicit restore reloads a crashed renderer once and restores interaction", async () => {
  const h = await setup();
  try {
    h.window.emit("ready-to-show");
    await h.companion.runCommand("lock");
    h.window.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    assert.equal(h.window.loadCount, 1);
    await h.companion.restore();
    assert.equal(h.window.loadCount, 2);
    await h.companion.restore();
    assert.equal(h.window.loadCount, 2);
    assert.equal(h.window.ignore, false);
    assert.equal(h.window.visible, true);
  } finally {
    h.companion.dispose();
  }
});

test("audit: a vanished renderer frame cannot make crash cleanup throw", async () => {
  const h = await setup();
  try {
    h.window.emit("ready-to-show");
    await h.companion.runCommand("lock");
    h.window.webContents.send = () => {
      throw new Error("Render frame was disposed before delivery");
    };
    assert.doesNotThrow(() =>
      h.window.webContents.emit(
        "render-process-gone",
        {},
        { reason: "crashed" },
      ),
    );
    assert.equal(h.window.ignore, false);
    assert.equal(h.requests[0].signal.aborted, true);
  } finally {
    h.companion.dispose();
  }
});
