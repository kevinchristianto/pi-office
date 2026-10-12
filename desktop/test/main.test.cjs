"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { pathToFileURL } = require("node:url");
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
        x: 50,
        y: 50,
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
    async loadFile(filename) {
      this.loads = (this.loads || 0) + 1;
      this.webContents.mainFrame.url = pathToFileURL(filename).href;
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
    screen: {
      getDisplayMatching: () => ({
        workArea: { x: 0, y: 0, width: 1200, height: 800 },
      }),
    },
  };
  const companion = createCompanion(electron, {
    env: { PI_OFFICE_PORT: "5417" },
    baseDirectory: "/app",
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
  window.loadFile = () =>
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
