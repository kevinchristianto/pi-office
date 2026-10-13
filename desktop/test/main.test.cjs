"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  createCompanion,
  IPC,
  RESTORE_SHORTCUT,
  HIDE_SHORTCUT,
} = require("../main.cjs");

function fixture({
  shortcut = true,
  trayFails = false,
  singleton = true,
  geometryStore = null,
  resizeClock,
} = {}) {
  const app = new EventEmitter();
  app.setName = (name) => {
    app.name = name;
  };
  app.enableSandbox = () => {
    app.sandbox = true;
  };
  app.requestSingleInstanceLock = () => singleton;
  app.whenReady = async () => {};
  app.quit = () => {
    app.quitCalls = (app.quitCalls || 0) + 1;
  };
  const handlers = new Map();
  const shortcuts = new Map();
  const calls = [];
  const requests = [];
  const companionSession = new EventEmitter();
  companionSession.setPermissionRequestHandler = (fn) => {
    companionSession.requestPermission = fn;
  };
  companionSession.setPermissionCheckHandler = (fn) => {
    companionSession.checkPermission = fn;
  };
  companionSession.setDevicePermissionHandler = (fn) => {
    companionSession.checkDevice = fn;
  };
  companionSession.webRequest = {
    onBeforeRequest: (filter, fn) => {
      companionSession.filter = filter;
      companionSession.beforeRequest = fn;
    },
  };
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.bounds = {
        x: options.x ?? 50,
        y: options.y ?? 50,
        width: options.width,
        height: options.height,
      };
      this.visible = false;
      this.minimized = false;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.isDestroyed = () => false;
      this.webContents.mainFrame = { url: "" };
      this.webContents.getURL = () => this.webContents.mainFrame.url;
      this.webContents.send = (channel, state) =>
        calls.push({ channel, state });
      this.webContents.setWindowOpenHandler = (fn) => {
        this.webContents.openWindow = fn;
      };
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
    setMenu(value) {
      this.menu = value;
    }
    setIgnoreMouseEvents(value, options) {
      this.ignoresMouse = value;
      this.mouseOptions = options;
    }
    setFocusable(value) {
      this.focusable = value;
    }
    setMovable(value) {
      this.movable = value;
    }
    setAlwaysOnTop(value) {
      this.onTop = value;
    }
    blur() {
      this.focused = false;
    }
    focus() {
      this.focused = true;
    }
    getBounds() {
      return this.bounds;
    }
    setPosition(x, y) {
      this.bounds.x = x;
      this.bounds.y = y;
    }
    setSize(width, height) {
      this.bounds.width = width;
      this.bounds.height = height;
    }
    setBounds(bounds) {
      this.bounds = { ...bounds };
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
    async loadURL(url) {
      this.loads = (this.loads || 0) + 1;
      this.webContents.mainFrame.url = url;
      this.webContents.emit("did-finish-load");
      this.emit("ready-to-show");
    }
  }
  class Tray extends EventEmitter {
    constructor(icon) {
      super();
      if (trayFails) throw new Error("No tray");
      this.icon = icon;
    }
    setContextMenu(menu) {
      this.menu = menu;
    }
    setToolTip(text) {
      this.tooltip = text;
    }
    isDestroyed() {
      return Boolean(this.destroyed);
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const external = [];
  const electron = {
    app,
    BrowserWindow: Window,
    Tray,
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: {
      createFromBitmap: (pixels, options) => ({ pixels, options }),
    },
    globalShortcut: {
      register(key, fn) {
        if (key === RESTORE_SHORTCUT && !shortcut) return false;
        shortcuts.set(key, fn);
        return true;
      },
      isRegistered: (key) => shortcuts.has(key),
      unregisterAll: () => shortcuts.clear(),
    },
    ipcMain: {
      handle: (key, fn) => handlers.set(key, fn),
      removeHandler: (key) => handlers.delete(key),
    },
    session: {
      fromPartition: (partition, options) => {
        companionSession.partition = partition;
        companionSession.options = options;
        return companionSession;
      },
    },
    shell: {
      openExternal: async (url) => {
        external.push(url);
      },
    },
    screen: Object.assign(new EventEmitter(), {
      getDisplayMatching: () => ({
        workArea: { x: 0, y: 0, width: 1200, height: 800 },
      }),
    }),
  };
  const companion = createCompanion(electron, {
    env: { PI_OFFICE_PORT: "5417" },
    baseDirectory: "/app",
    geometryStore,
    ...(resizeClock ? { resizeClock } : {}),
    fetchSnapshot: ({ signal }) =>
      new Promise((resolve, reject) =>
        requests.push({ signal, resolve, reject }),
      ),
  });
  return {
    companion,
    electron,
    companionSession,
    handlers,
    shortcuts,
    calls,
    requests,
    external,
    app,
  };
}
async function started(t, options) {
  const f = fixture(options);
  t.after(() => f.companion.dispose());
  await f.companion.start();
  f.window = f.companion.getWindow();
  f.event = {
    sender: f.window.webContents,
    senderFrame: f.window.webContents.mainFrame,
  };
  return f;
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("window uses transparent fixed presets and a sandboxed isolated local renderer", async (t) => {
  const { window, companionSession, app } = await started(t);
  assert.equal(window.options.width, 440);
  assert.equal(window.options.height, 260);
  assert.equal(window.options.transparent, true);
  assert.equal(window.options.resizable, false);
  assert.equal(window.options.alwaysOnTop, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.nodeIntegrationInSubFrames, false);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.webSecurity, true);
  assert.equal(window.options.webPreferences.webviewTag, false);
  assert.equal(window.options.webPreferences.devTools, false);
  assert.equal(window.options.webPreferences.preload, "/app/preload.cjs");
  assert.equal(window.webContents.getURL(), "file:///app/dist/index.html");
  assert.equal(companionSession.partition.startsWith("persist:"), false);
  assert.equal(app.sandbox, true);
});

test("all permissions, navigation, new windows, webviews and downloads are denied", async (t) => {
  const { window, companionSession } = await started(t);
  assert.equal(companionSession.checkPermission(), false);
  assert.equal(companionSession.checkDevice(), false);
  companionSession.requestPermission(null, "camera", (allowed) =>
    assert.equal(allowed, false),
  );
  assert.deepEqual(
    window.webContents.openWindow({ url: "https://evil.test" }),
    { action: "deny" },
  );
  for (const name of [
    "will-navigate",
    "will-frame-navigate",
    "will-redirect",
    "will-attach-webview",
  ]) {
    let prevented = false;
    window.webContents.emit(name, {
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true, name);
  }
  let prevented = false;
  companionSession.emit("will-download", {
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  companionSession.beforeRequest(
    { url: "http://127.0.0.1:5417/api/snapshot" },
    (result) => assert.equal(result.cancel, true),
  );
  companionSession.beforeRequest(
    { url: "file:///app/dist/assets/main.js" },
    (result) => assert.equal(result.cancel, false),
  );
});

test("IPC validates sender/main frame/exact file and rejects extra payload arguments", async (t) => {
  const { handlers, event, window } = await started(t);
  const state = handlers.get(IPC.state);
  const command = handlers.get(IPC.command);
  assert.equal(state(event).visible, true);
  assert.throws(() => state({ ...event, sender: {} }));
  assert.throws(() =>
    state({ ...event, senderFrame: { url: event.senderFrame.url } }),
  );
  assert.throws(() => state(event, "extra"));
  assert.throws(() => command(event, "open-office", "https://evil.test"));
  assert.throws(() => command(event, { name: "quit" }));
  assert.throws(() => command(event, "run-shell"));
  window.webContents.mainFrame.url += "#fragment";
  assert.throws(() => state(event));
});

test("only fixed office URL opens externally; every state command publishes", async (t) => {
  const { companion, external, calls, window } = await started(t);
  const before = calls.length;
  await companion.runCommand("open-office");
  assert.deepEqual(external, ["http://127.0.0.1:5417/"]);
  await companion.runCommand("toggle-top");
  assert.equal(window.onTop, false);
  assert.equal(calls.at(-1).state.alwaysOnTop, false);
  await companion.runCommand("roomy");
  assert.equal(window.bounds.width, 640);
  assert.equal(window.bounds.height, 380);
  await companion.runCommand("compact");
  assert.equal(window.bounds.width, 440);
  assert.ok(calls.length >= before + 4);
});

test("lock passes clicks through and recovery shortcut restores input and focus", async (t) => {
  const { companion, shortcuts, window, calls } = await started(t);
  await companion.runCommand("lock");
  assert.equal(window.ignoresMouse, true);
  assert.equal(window.focusable, false);
  assert.equal(window.movable, false);
  assert.equal(calls.at(-1).state.locked, true);
  shortcuts.get(RESTORE_SHORTCUT)();
  assert.equal(window.ignoresMouse, false);
  assert.equal(window.focusable, true);
  assert.equal(window.movable, true);
  assert.equal(window.focused, true);
  assert.equal(companion.getState().locked, false);
});

test("shortcut failure disables lock even with a tray", async (t) => {
  const { companion, window } = await started(t, { shortcut: false });
  assert.equal(companion.getState().shortcutAvailable, false);
  await assert.rejects(companion.runCommand("lock"), /disabled/);
  assert.notEqual(window.ignoresMouse, true);
});

test("hidden and minimized windows pause and abort polling; restore resumes immediately", async (t) => {
  const { companion, shortcuts, requests, window } = await started(t);
  assert.equal(requests.length, 1);
  shortcuts.get(HIDE_SHORTCUT)();
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(companion.getState().visible, false);
  assert.equal(companion.getState().connection.status, "paused");
  shortcuts.get(RESTORE_SHORTCUT)();
  assert.equal(requests.length, 2);
  window.minimized = true;
  window.emit("minimize");
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(companion.getState().connection.status, "paused");
  companion.restore();
  assert.equal(requests.length, 3);
});

test("hide refuses when no recovery exists; close quits instead", async (t) => {
  const { companion, window, app } = await started(t, {
    shortcut: false,
    trayFails: true,
  });
  await assert.rejects(companion.runCommand("hide"), /recovery/);
  assert.equal(window.visible, true);
  let prevented = false;
  window.emit("close", {
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
  assert.equal(app.quitCalls, 1);
});

test("lost recovery shortcut is rechecked before lock and hide when tray is absent", async (t) => {
  const { companion, shortcuts, window } = await started(t, {
    trayFails: true,
  });
  shortcuts.delete(RESTORE_SHORTCUT);
  await assert.rejects(companion.runCommand("hide"), /recovery/);
  assert.equal(window.visible, true);
  await assert.rejects(companion.runCommand("lock"), /disabled/);
});

test("close hides with recovery, second launch restores and unlocks", async (t) => {
  const { companion, window, app } = await started(t);
  await companion.runCommand("lock");
  let prevented = false;
  window.emit("close", {
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(window.visible, false);
  app.emit("second-instance");
  assert.equal(window.visible, true);
  assert.equal(companion.getState().locked, false);
});

test("restore clamps moved or off-screen window onto current display work area", async (t) => {
  const { companion, window } = await started(t);
  window.bounds.x = 9000;
  window.bounds.y = -9000;
  companion.restore();
  assert.equal(window.bounds.x, 760);
  assert.equal(window.bounds.y, 0);
});

test("renderer crash unlocks, aborts poll and explicit restore reloads local UI", async (t) => {
  const { companion, window, requests } = await started(t);
  await companion.runCommand("lock");
  window.webContents.emit("render-process-gone", {}, { reason: "crashed" });
  assert.equal(companion.getState().locked, false);
  assert.equal(requests[0].signal.aborted, true);
  companion.restore();
  await flush();
  assert.equal(window.loads, 2);
  assert.equal(window.ignoresMouse, false);
  assert.equal(window.visible, true);
  assert.equal(requests.length, 2);
});

test("quit cleans shortcuts, tray, handlers and pending requests exactly once", async (t) => {
  const { companion, shortcuts, handlers, requests, app } = await started(t);
  const tray = companion.getTray();
  await companion.runCommand("quit");
  assert.equal(app.quitCalls, 1);
  assert.equal(shortcuts.size, 0);
  assert.equal(handlers.size, 0);
  assert.equal(tray.destroyed, true);
  assert.equal(requests[0].signal.aborted, true);
  companion.dispose();
});

test("second instance exits without creating window, IPC or bridge requests", async (t) => {
  const { companion, handlers, requests, app } = fixture({ singleton: false });
  t.after(() => companion.dispose());
  assert.equal(await companion.start(), false);
  assert.equal(companion.getWindow(), null);
  assert.equal(handlers.size, 0);
  assert.equal(requests.length, 0);
  assert.equal(app.quitCalls, 1);
});

test("old crash-recovery result cannot resume polling after a newer renderer crash", async (t) => {
  const { companion, window, requests } = await started(t);
  const reloads = [];
  window.loadURL = () =>
    new Promise((resolve, reject) => reloads.push({ resolve, reject }));
  window.webContents.emit("render-process-gone");
  companion.restore();
  companion.restore();
  assert.equal(reloads.length, 1);
  window.webContents.emit("render-process-gone");
  reloads[0].resolve();
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(companion.getState().connection.status, "paused");
  companion.restore();
  assert.equal(reloads.length, 2);
  reloads[1].resolve();
  await flush();
  assert.equal(requests.length, 2);
});

test("tray handles a registration lost since menu construction without rejected native callback", async (t) => {
  const { companion, shortcuts } = await started(t);
  const menu = companion.getTray().menu;
  const lockItem = menu.find((item) => item.label === "Click-through lock");
  shortcuts.delete(RESTORE_SHORTCUT);
  assert.doesNotThrow(() => lockItem.click());
  await flush();
  assert.equal(companion.getState().locked, false);
});

test("a disappeared IPC frame cannot break native recovery or state transitions", async (t) => {
  const { companion, window } = await started(t);
  window.webContents.send = () => {
    throw new Error("Render frame disposed");
  };
  await assert.doesNotReject(companion.runCommand("toggle-top"));
  assert.doesNotThrow(() => window.webContents.emit("render-process-gone"));
  assert.doesNotThrow(() => companion.restore());
  await flush();
  assert.equal(window.loads, 2);
  assert.equal(window.ignoresMouse, false);
});

function resizeClockFixture() {
  let at = 1000;
  let id = 0;
  const timers = new Map();
  return {
    now: () => at,
    setTimer(fn, ms) {
      const key = ++id;
      timers.set(key, { fn, at: at + ms });
      return key;
    },
    clearTimer: (key) => timers.delete(key),
    timers,
    advance(ms) {
      at += ms;
      for (const [key, timer] of [...timers])
        if (timer.at <= at) {
          timers.delete(key);
          timer.fn();
        }
    },
  };
}

test("resize IPC validates one integer size-only payload and exact top-frame sender", async (t) => {
  const f = await started(t);
  const resize = f.handlers.get(IPC.resize);
  for (const payload of [
    null,
    [],
    {},
    { width: 440 },
    { width: 440, height: 260, x: 0 },
    { width: NaN, height: 300 },
    { width: Infinity, height: 300 },
    { width: -1, height: 300 },
    { width: 0, height: 300 },
    { width: 440.5, height: 300 },
    { width: "500", height: 300 },
    { width: Number.MAX_SAFE_INTEGER + 1, height: 300 },
  ])
    assert.throws(() => resize(f.event, payload), /Untrusted/);
  const size = { width: 700, height: 400 };
  assert.throws(() => resize(f.event, size, "extra"), /Untrusted/);
  assert.throws(() => resize({ ...f.event, sender: {} }, size), /Untrusted/);
  assert.throws(
    () => resize({ ...f.event, senderFrame: { ...f.event.senderFrame } }, size),
    /Untrusted/,
  );
  const result = await resize(f.event, size);
  assert.deepEqual(result.windowSize, size);
  assert.deepEqual(structuredClone(result), result);
  assert.equal(f.window.options.resizable, false);
  const items = f.companion
    .getTray()
    .menu.find((item) => item.label === "Size").submenu;
  assert(
    items.every((item) => !item.checked),
    "Custom geometry unchecks preset radios",
  );
});

test("resize coalescing bounds native work to 20 Hz and applies the final size", async (t) => {
  const clock = resizeClockFixture();
  const f = await started(t, { resizeClock: clock });
  const resize = f.handlers.get(IPC.resize);
  await resize(f.event, { width: 500, height: 300 });
  const first = resize(f.event, { width: 600, height: 350 });
  const last = resize(f.event, { width: 900, height: 500 });
  assert.equal(first, last, "Only one pending main-process promise is kept");
  assert.equal(clock.timers.size, 1);
  assert.equal(f.window.bounds.width, 500);
  clock.advance(49);
  assert.equal(f.window.bounds.width, 500);
  clock.advance(1);
  assert.deepEqual((await last).windowSize, { width: 900, height: 500 });
  assert.equal(clock.timers.size, 0);
});

for (const action of [
  "hide",
  "lock",
  "minimize",
  "crash",
  "close",
  "quit",
  "dispose",
  "compact",
]) {
  test(`queued resize settles without late native work after ${action}`, async (t) => {
    const clock = resizeClockFixture();
    const f = await started(t, { resizeClock: clock });
    const resize = f.handlers.get(IPC.resize);
    await resize(f.event, { width: 500, height: 300 });
    const rejected = assert.rejects(
      resize(f.event, { width: 900, height: 500 }),
      /cancelled/,
    );
    if (action === "minimize") {
      f.window.minimized = true;
      f.window.emit("minimize");
    } else if (action === "crash")
      f.window.webContents.emit("render-process-gone");
    else if (action === "close")
      f.window.emit("close", { preventDefault() {} });
    else if (action === "dispose") f.companion.dispose();
    else await f.companion.runCommand(action);
    await rejected;
    const bounds = { ...f.window.bounds };
    clock.advance(100);
    assert.deepEqual(f.window.bounds, bounds);
    assert.equal(clock.timers.size, 0);
    if (
      [
        "hide",
        "lock",
        "minimize",
        "crash",
        "close",
        "quit",
        "dispose",
      ].includes(action)
    )
      assert.throws(
        () => resize(f.event, { width: 600, height: 350 }),
        /unavailable|Untrusted/,
      );
  });
}

for (const change of ["frame", "url"]) {
  test(`queued resize rechecks the current ${change} before applying`, async (t) => {
    const clock = resizeClockFixture();
    const f = await started(t, { resizeClock: clock });
    const resize = f.handlers.get(IPC.resize);
    await resize(f.event, { width: 500, height: 300 });
    const rejected = assert.rejects(
      resize(f.event, { width: 900, height: 500 }),
      /Untrusted/,
    );
    if (change === "frame")
      f.window.webContents.mainFrame = { ...f.event.senderFrame };
    else f.window.webContents.mainFrame.url += "#untrusted";
    clock.advance(50);
    await rejected;
    assert.equal(f.window.bounds.width, 500);
  });
}

test("resize clamps global/work-area limits with negative origins without applying scaleFactor", async (t) => {
  const clock = resizeClockFixture();
  const f = await started(t, { resizeClock: clock });
  const resize = f.handlers.get(IPC.resize);
  f.electron.screen.getDisplayMatching = () => ({
    scaleFactor: 2,
    workArea: { x: -6000, y: -500, width: 6000, height: 3000 },
  });
  await resize(f.event, {
    width: Number.MAX_SAFE_INTEGER,
    height: Number.MAX_SAFE_INTEGER,
  });
  assert.deepEqual(f.window.bounds, {
    x: -4096,
    y: 50,
    width: 4096,
    height: 2160,
  });
  clock.advance(50);
  await resize(f.event, { width: 1, height: 1 });
  assert.deepEqual(f.companion.getState().windowSize, {
    width: 440,
    height: 260,
  });
  f.electron.screen.getDisplayMatching = () => ({
    scaleFactor: 1.25,
    workArea: { x: -300, y: -200, width: 300, height: 200 },
  });
  clock.advance(50);
  await resize(f.event, { width: 900, height: 700 });
  assert.deepEqual(f.window.bounds, {
    x: -300,
    y: -200,
    width: 300,
    height: 200,
  });
  await f.companion.runCommand("roomy");
  assert.deepEqual(f.window.bounds, {
    x: -300,
    y: -200,
    width: 300,
    height: 200,
  });
});

test("geometry restore uses current work area and saves actual moved/rounded bounds on close", async (t) => {
  const saved = [];
  let flushes = 0,
    disposals = 0;
  const geometryStore = {
    load: () => ({ x: 9000, y: -9000, width: 900, height: 500 }),
    save: (bounds) => saved.push({ ...bounds }),
    flush: () => {
      flushes++;
    },
    dispose: () => {
      disposals++;
    },
  };
  const f = await started(t, { geometryStore });
  assert.deepEqual(f.window.bounds, { x: 300, y: 0, width: 900, height: 500 });
  Object.assign(f.window.bounds, { x: 100, y: 70 });
  f.window.emit("move");
  assert.deepEqual(saved.at(-1), f.window.bounds);
  f.window.setBounds = (bounds) => {
    f.window.bounds = { ...bounds, width: bounds.width + 1 };
  };
  await f.companion.runCommand("roomy");
  assert.deepEqual(saved.at(-1), { x: 100, y: 70, width: 641, height: 380 });
  assert.deepEqual(f.companion.getState().windowSize, {
    width: 641,
    height: 380,
  });
  f.window.emit("close", { preventDefault() {} });
  assert.equal(flushes, 1);
  f.companion.dispose();
  f.companion.dispose();
  assert.equal(disposals, 1);
});

test("screen changes resize and reposition to current DIP work area and listeners are removed on teardown", async (t) => {
  const clock = resizeClockFixture();
  const f = await started(t, { resizeClock: clock });
  const resize = f.handlers.get(IPC.resize);
  await resize(f.event, { width: 1100, height: 700 });
  const rejected = assert.rejects(
    resize(f.event, { width: 1000, height: 600 }),
    /cancelled/,
  );
  f.electron.screen.getDisplayMatching = () => ({
    scaleFactor: 2,
    workArea: { x: -800, y: 20, width: 800, height: 500 },
  });
  f.electron.screen.emit("display-removed", {}, {});
  await rejected;
  assert.deepEqual(f.window.bounds, {
    x: -800,
    y: 20,
    width: 800,
    height: 500,
  });
  f.electron.screen.getDisplayMatching = () => ({
    scaleFactor: 1.25,
    workArea: { x: 10, y: -20, width: 300, height: 200 },
  });
  f.electron.screen.emit("display-metrics-changed", {}, {}, [
    "workArea",
    "scaleFactor",
  ]);
  assert.deepEqual(f.window.bounds, { x: 10, y: -20, width: 300, height: 200 });
  f.companion.dispose();
  for (const event of [
    "display-added",
    "display-removed",
    "display-metrics-changed",
  ])
    assert.equal(f.electron.screen.listenerCount(event), 0);
});
