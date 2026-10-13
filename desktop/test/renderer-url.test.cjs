"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { EventEmitter } = require("node:events");
const url = require("node:url");

// Real application modules with explicit Windows or POSIX semantics on every CI host.
// Never let a POSIX fixture inherit the Windows runner's URL decoder.
// This is not a native Windows/Electron launch.
const windowsUrl = {
  ...url,
  fileURLToPath: (value) => url.fileURLToPath(value, { windows: true }),
  pathToFileURL: (value) => url.pathToFileURL(value, { windows: true }),
};
function platformModule(name, windows, overrides = {}) {
  const filename = path.resolve(__dirname, "..", name);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  const require = (id) => {
    if (id === "node:path") return windows ? path.win32 : path.posix;
    if (id === "node:url")
      return {
        ...url,
        fileURLToPath: (value) => url.fileURLToPath(value, { windows }),
        pathToFileURL: (value) => url.pathToFileURL(value, { windows }),
      };
    if (Object.hasOwn(overrides, id)) return overrides[id];
    return nativeRequire(id);
  };
  vm.runInThisContext(
    "(function(require, module, exports, __dirname) {\n" +
      fs.readFileSync(filename, "utf8") +
      "\n})",
    { filename },
  )(require, module, module.exports, path.dirname(filename));
  return module.exports;
}
const windowsCore = platformModule("core.cjs", true);
const posixCore = platformModule("core.cjs", false);
const { createCompanion, IPC } = platformModule("main.cjs", true, {
  "./core.cjs": windowsCore,
});

// Pinned source evidence: loadFile uses legacy url.format, not pathToFileURL.
// https://github.com/electron/electron/blob/v44.7.0/lib/browser/api/web-contents.ts#L279-L295
// Its Chromium uppercases Windows drive letters.
// https://github.com/chromium/chromium/blob/152.0.7977.130/url/url_canon_fileurl.cc#L52-L89
// These cases model only that drive rule plus standard URL serialization.
const chromiumWindowsUrl = (value) =>
  new URL(value).href.replace(
    /^file:\/\/\/([a-z]):/,
    (_match, drive) => "file:///" + drive.toUpperCase() + ":",
  );
const legacyLoadFileUrl = (filename) =>
  chromiumWindowsUrl(
    url.format({ protocol: "file", slashes: true, pathname: filename }),
  );

function senderFixture(actualUrl) {
  const frame = { url: actualUrl };
  const contents = {
    mainFrame: frame,
    getURL: () => actualUrl,
    isDestroyed: () => false,
  };
  return {
    event: { sender: contents, senderFrame: frame },
    window: { webContents: contents, isDestroyed: () => false },
    frame,
    contents,
  };
}

test("Windows loadFile serialization can reject the legitimate exact renderer", () => {
  const filename =
    "c:\\Users\\Alice [Work]\\AppData\\Local\\Temp\\nsa123.tmp\\resources\\app.asar\\dist\\index.html";
  const expected = windowsUrl.pathToFileURL(filename).href;
  const actual = legacyLoadFileUrl(filename);
  assert.notEqual(actual, expected);
  assert.match(expected, /^file:\/\/\/c:.*%5BWork%5D/);
  assert.match(actual, /^file:\/\/\/C:.*\[Work\]/);
  const { event, window } = senderFixture(actual);
  assert.equal(windowsCore.isTrustedSender(event, window, expected), true);
});

test("legacy loadFile misinterprets a literal percent escape in the directory", () => {
  const filename =
    "C:\\Users\\Alice%20Work\\AppData\\Local\\Temp\\nsa123.tmp\\resources\\app.asar\\dist\\index.html";
  const expected = windowsUrl.pathToFileURL(filename).href;
  const legacy = legacyLoadFileUrl(filename);
  assert.equal(windowsUrl.fileURLToPath(expected), filename);
  assert.notEqual(windowsUrl.fileURLToPath(legacy), filename);
  const { event, window } = senderFixture(legacy);
  assert.equal(windowsCore.isTrustedSender(event, window, expected), false);
});

test("exact-file comparison accepts encoding and drive case, preserving other path case", () => {
  const expected =
    "file:///c:/Users/Alice%20%5BWork%5D/%25%23%C3%A9/dist/index.html";
  for (const actual of [
    expected,
    expected.replace("/c:/", "/C:/"),
    expected.replace("%5BWork%5D", "[Work]"),
    expected.replaceAll(/%[A-F0-9]{2}/g, (escape) => escape.toLowerCase()),
  ]) {
    const { event, window } = senderFixture(actual);
    assert.equal(windowsCore.isTrustedSender(event, window, expected), true);
  }
  const { event, window } = senderFixture(expected.replace("Alice", "ALICE"));
  assert.equal(windowsCore.isTrustedSender(event, window, expected), false);
});

test("normalization denies other files, hosts, query, fragment and encoded separators", () => {
  const expected = "file:///C:/Users/Alice%20%5BWork%5D/app/dist/index.html";
  for (const actual of [
    expected + "?",
    expected + "?extra=1",
    expected + "#",
    expected + "#other",
    expected + "/other.html",
    expected.replace("index.html", "other.html"),
    expected.replace("index.html", "../index.html"),
    expected.replace("/dist/", "/dist-other/"),
    expected.replace("/C:/", "/D:/"),
    expected.replace("file:///", "file://localhost/"),
    expected.replace("file:///", "file://server/"),
    expected.replace("file:///", "https://example.test/"),
    expected.replace("file:///", "file:////server/"),
    expected.replace("/dist/", "%2fdist/"),
    expected.replace("/dist/", "%2Fdist/"),
    expected.replace("/dist/", "%5cdist/"),
    expected.replace("/dist/", "%5Cdist/"),
    expected.replace("/dist/", "\\dist/"),
    expected.replace("%20", "%2520"),
    expected.replace("%20", "%invalid"),
    " " + expected,
    expected + "\n",
    "about:blank",
    "data:text/html,x",
    "",
    null,
  ]) {
    const { event, window } = senderFixture(actual);
    assert.equal(
      windowsCore.isTrustedSender(event, window, expected),
      false,
      String(actual),
    );
  }
});

test("matching URLs require the same live contents and exact main frame", () => {
  const expected = "file:///C:/Users/Alice/app/dist/index.html";
  const { event, window, contents, frame } = senderFixture(expected);
  const trusted = (candidate = event) =>
    windowsCore.isTrustedSender(candidate, window, expected);
  assert.equal(trusted(), true);
  assert.equal(trusted({ ...event, sender: {} }), false);
  assert.equal(trusted({ ...event, senderFrame: { url: expected } }), false);
  assert.equal(trusted({ ...event, senderFrame: null }), false);
  assert.equal(trusted({ sender: contents }), false);
  assert.equal(trusted(null), false);
  contents.mainFrame = { url: expected };
  assert.equal(trusted(), false);
  contents.mainFrame = frame;
  contents.getURL = () => expected.replace("index.html", "other.html");
  assert.equal(trusted(), false);
  contents.getURL = () => expected;
  contents.isDestroyed = () => true;
  assert.equal(trusted(), false);
  contents.isDestroyed = () => false;
  window.isDestroyed = () => true;
  assert.equal(trusted(), false);
  window.isDestroyed = () => {
    throw new Error("Window disposed");
  };
  assert.equal(trusted(), false);
});

test("POSIX comparison preserves case and accepts equivalent bracket encoding", () => {
  const expected = "file:///app/Office%20%5BPreview%5D/dist/index.html";
  const { event, window } = senderFixture(
    expected.replace("%5BPreview%5D", "[Preview]"),
  );
  assert.equal(posixCore.isTrustedSender(event, window, expected), true);
  // The same drive-less fixture is deliberately invalid for Windows. This
  // asserts that the two platform adapters cannot silently use host defaults.
  assert.equal(windowsCore.isTrustedSender(event, window, expected), false);
  assert.equal(
    posixCore.isTrustedSender(
      event,
      window,
      expected.replace("Office", "office"),
    ),
    false,
  );
});

async function startWindowsCompanion(t, baseDirectory) {
  const handlers = new Map();
  const shortcuts = new Map();
  const loads = [];
  const external = [];
  const dialogs = [];
  const requests = [];
  const companionSession = new EventEmitter();
  Object.assign(companionSession, {
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    setDevicePermissionHandler() {},
    webRequest: { onBeforeRequest() {} },
  });
  const app = new EventEmitter();
  Object.assign(app, {
    setName() {},
    enableSandbox() {},
    requestSingleInstanceLock: () => true,
    whenReady: async () => {},
    quit() {
      this.quitCalls = (this.quitCalls || 0) + 1;
    },
  });
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.visible = false;
      this.destroyed = false;
      this.bounds = {
        x: 10,
        y: 10,
        width: options.width,
        height: options.height,
      };
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        mainFrame: { url: "" },
        getURL: () => this.webContents.mainFrame.url,
        isDestroyed: () => this.destroyed,
        setWindowOpenHandler() {},
        send: (_channel, state) => structuredClone(state),
      });
    }
    isDestroyed() {
      return this.destroyed;
    }
    isVisible() {
      return this.visible;
    }
    isMinimized() {
      return false;
    }
    setMenu() {}
    setIgnoreMouseEvents(ignore) {
      this.ignore = ignore;
    }
    setFocusable(focusable) {
      this.focusable = focusable;
    }
    setMovable(movable) {
      this.movable = movable;
    }
    setAlwaysOnTop(top) {
      this.top = top;
    }
    focus() {}
    blur() {}
    getBounds() {
      return this.bounds;
    }
    setPosition(x, y) {
      Object.assign(this.bounds, { x, y });
    }
    setSize(width, height) {
      // Reproduce Electron 44.7's public setSize minimum-size clamp and its
      // non-resizable NativeWindowViews updating constraints after each resize.
      // https://github.com/electron/electron/blob/v44.7.0/shell/browser/api/electron_api_base_window.cc#L465-L470
      // https://github.com/electron/electron/blob/v44.7.0/shell/browser/native_window_views.cc#L831-L846
      this.setBounds({
        ...this.bounds,
        width: Math.max(width, this.bounds.width),
        height: Math.max(height, this.bounds.height),
      });
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
    async loadURL(value) {
      loads.push(value);
      this.webContents.mainFrame = { url: chromiumWindowsUrl(value) };
      this.webContents.emit("did-finish-load");
      this.emit("ready-to-show");
    }
    async loadFile() {
      assert.fail(
        "The fixed renderer must load its encoded URL on startup and recovery",
      );
    }
  }
  class Tray extends EventEmitter {
    isDestroyed() {
      return Boolean(this.destroyed);
    }
    setContextMenu(menu) {
      this.menu = menu;
    }
    setToolTip() {}
    destroy() {
      this.destroyed = true;
    }
  }
  const electron = {
    app,
    BrowserWindow: Window,
    Tray,
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromBitmap: () => ({}) },
    globalShortcut: {
      register(key, fn) {
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
    session: { fromPartition: () => companionSession },
    shell: { openExternal: async (value) => external.push(value) },
    screen: {
      getDisplayMatching: () => ({
        workArea: { x: 0, y: 0, width: 1200, height: 800 },
      }),
    },
    dialog: {
      showMessageBox: async (_window, options) => {
        dialogs.push(options);
        return { response: 0 };
      },
    },
  };
  const companion = createCompanion(electron, {
    baseDirectory,
    env: {},
    fetchSnapshot: ({ signal }) => new Promise(() => requests.push({ signal })),
  });
  t.after(() => companion.dispose());
  await companion.start();
  const window = companion.getWindow();
  const event = () => ({
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  });
  const command = (name) => handlers.get(IPC.command)(event(), name);
  return {
    companion,
    window,
    event,
    command,
    handlers,
    loads,
    external,
    dialogs,
    requests,
    app,
    electron,
  };
}

for (const directory of [
  "C:\\Users\\Alice Smith\\AppData\\Local\\Temp\\nsa123.tmp\\resources\\app.asar",
  "c:\\Users\\Alice [Work]\\AppData\\Local\\Temp\\nsa123.tmp\\resources\\app.asar",
  "C:\\Users\\Alice%20#O'Brien\\AppData\\Local\\Temp\\nsa123.tmp\\resources\\app.asar",
  "C:\\Users\\Alïce [100%]\\AppData\\Local\\Temp\\nsa123.tmp\\resources\\app.asar",
]) {
  test(
    "encoded Windows renderer loads and every command crosses IPC: " +
      directory,
    async (t) => {
      const f = await startWindowsCompanion(t, directory);
      const expectedPath = path.win32.join(directory, "dist", "index.html");
      assert.equal(windowsUrl.fileURLToPath(f.loads[0]), expectedPath);
      assert.equal(f.window.options.webPreferences.contextIsolation, true);
      assert.equal(f.window.options.webPreferences.sandbox, true);
      assert.equal(f.handlers.get(IPC.state)(f.event()).visible, true);
      for (const name of [
        "toggle-top",
        "roomy",
        "compact",
        "lock",
        "restore",
        "hide",
        "restore",
        "open-office",
        "connect-pi",
      ]) {
        const state = await f.command(name);
        assert.deepEqual(structuredClone(state), state, name);
      }
      assert.deepEqual(f.external, ["http://127.0.0.1:4317/"]);
      assert.equal(f.dialogs.length, 1);
      assert.equal(f.companion.getState().locked, false);
      assert.equal(f.companion.getState().visible, true);
      await f.command("quit");
      assert.equal(f.app.quitCalls, 1);
      assert.equal(f.handlers.size, 0);
    },
  );
}

test("special-path recovery reloads only the controlled URL and rejects the old frame", async (t) => {
  const f = await startWindowsCompanion(
    t,
    "c:\\Users\\A [B]%20#C\\AppData\\Local\\Temp\\nsa123.tmp\\resources\\app.asar",
  );
  const oldEvent = f.event();
  await f.command("lock");
  f.window.webContents.emit("render-process-gone");
  f.companion.restore();
  f.companion.restore();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.loads, [f.loads[0], f.loads[0]]);
  assert.throws(
    () => f.handlers.get(IPC.command)(oldEvent, "toggle-top"),
    /Untrusted/,
  );
  assert.equal((await f.command("toggle-top")).locked, false);
  assert.equal(f.window.ignore, false);
  assert.equal(f.window.focusable, true);
});

test("rapid repeated IPC commands preserve state, recovery and cloneable replies", async (t) => {
  const f = await startWindowsCompanion(
    t,
    "c:\\Users\\A [B]\\AppData\\Local\\Temp\\nsa123.tmp\\resources\\app.asar",
  );
  const commands = Array.from({ length: 20 }, () => [
    "toggle-top",
    "roomy",
    "compact",
    "hide",
    "restore",
    "lock",
    "restore",
  ]).flat();
  const replies = await Promise.all(commands.map(f.command));
  for (const reply of replies) assert.deepEqual(structuredClone(reply), reply);
  assert.equal(f.companion.getState().alwaysOnTop, true);
  assert.equal(f.companion.getState().locked, false);
  assert.equal(f.companion.getState().visible, true);
  assert.equal(f.window.bounds.width, 440);
  assert.equal(f.loads.length, 1);
  await f.command("quit");
  assert.ok(f.requests.every(({ signal }) => signal.aborted));
  await assert.rejects(f.companion.runCommand("restore"), /unavailable/);
});

const sizeItems = (f) =>
  f.companion.getTray().menu.find((item) => item.label === "Size").submenu;
const selectedSize = (f) =>
  sizeItems(f)
    .find((item) => item.checked)
    .label.split(" ")[0];
const windowSize = (f) => {
  const { width, height } = f.window.getBounds();
  return { width, height };
};

test("Roomy then Compact bypasses the pinned Electron fixed-minimum clamp through IPC and tray", async (t) => {
  const f = await startWindowsCompanion(t, "C:\\App");
  // The old implementation used this public API. Model its proven clamp.
  f.window.setSize(640, 380);
  f.window.setSize(440, 260);
  assert.deepEqual(windowSize(f), { width: 640, height: 380 });
  f.window.setBounds({ ...f.window.getBounds(), width: 440, height: 260 });
  for (let round = 0; round < 4; round++) {
    await f.command("roomy");
    assert.deepEqual(windowSize(f), { width: 640, height: 380 });
    assert.equal(selectedSize(f), "Roomy");
    for (let click = 0; click < 3; click++) {
      await f.command("compact");
      assert.deepEqual(windowSize(f), { width: 440, height: 260 });
      assert.equal(selectedSize(f), "Compact");
    }
    sizeItems(f)
      .find((item) => item.label.startsWith("Roomy"))
      .click();
    assert.deepEqual(windowSize(f), { width: 640, height: 380 });
    for (let click = 0; click < 3; click++) {
      sizeItems(f)
        .find((item) => item.label.startsWith("Compact"))
        .click();
      assert.deepEqual(windowSize(f), { width: 440, height: 260 });
      assert.equal(selectedSize(f), "Compact");
    }
  }
  assert.equal(f.window.options.resizable, false);
  assert.equal(f.window.options.transparent, true);
});

test("preset bounds stay on the matching display, including negative monitor origins", async (t) => {
  const f = await startWindowsCompanion(t, "C:\\App");
  f.electron.screen.getDisplayMatching = () => ({
    workArea: { x: -1920, y: -100, width: 1920, height: 1040 },
  });
  Object.assign(f.window.bounds, { x: 9000, y: -9000 });
  await f.command("roomy");
  assert.deepEqual(f.window.getBounds(), {
    x: -640,
    y: -100,
    width: 640,
    height: 380,
  });
  await f.command("compact");
  assert.deepEqual(f.window.getBounds(), {
    x: -640,
    y: -100,
    width: 440,
    height: 260,
  });
});

for (const failure of ["throw", "ignore", "partial"]) {
  test(
    "failed resize rolls back bounds and preset selection: " + failure,
    async (t) => {
      const f = await startWindowsCompanion(t, "C:\\App");
      await f.command("roomy");
      const previous = { ...f.window.getBounds() };
      const setBounds = f.window.setBounds.bind(f.window);
      let attempts = 0;
      f.window.setBounds = (bounds) => {
        if (attempts++ === 0) {
          if (failure === "throw") throw new Error("Native resize failed");
          if (failure === "ignore") return;
          return setBounds({ ...bounds, width: 500 });
        }
        setBounds(bounds);
      };
      await assert.rejects(f.command("compact"), /requested window size/);
      assert.deepEqual(f.window.getBounds(), previous);
      assert.equal(selectedSize(f), "Roomy");
      await f.command("compact");
      assert.deepEqual(windowSize(f), { width: 440, height: 260 });
      assert.equal(selectedSize(f), "Compact");
    },
  );
}

test("a failed native tray resize restores its optimistic radio selection", async (t) => {
  const f = await startWindowsCompanion(t, "C:\\App");
  await f.command("roomy");
  const previous = { ...f.window.getBounds() };
  f.window.setBounds = () => {};
  const items = sizeItems(f);
  for (const item of items) item.checked = item.label.startsWith("Compact");
  items.find((item) => item.label.startsWith("Compact")).click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.window.getBounds(), previous);
  assert.equal(selectedSize(f), "Roomy");
});

test("one-DIP display rounding is accepted without misclassifying a completed resize", async (t) => {
  const f = await startWindowsCompanion(t, "C:\\App");
  f.window.setBounds = (bounds) => {
    f.window.bounds = {
      ...bounds,
      width: bounds.width + 1,
      height: bounds.height - 1,
    };
  };
  await f.command("roomy");
  assert.deepEqual(windowSize(f), { width: 641, height: 379 });
  assert.equal(selectedSize(f), "Roomy");
});

test("free sizes and repeated presets share the checked Windows fixed-minimum bounds path", async (t) => {
  const f = await startWindowsCompanion(t, "c:\\Users\\A [B]%20#C\\App");
  const resize = (width, height) =>
    f.handlers.get(IPC.resize)(f.event(), { width, height });
  for (let i = 0; i < 4; i++) {
    await resize(850 + i, 550 + i);
    assert.deepEqual(windowSize(f), { width: 850 + i, height: 550 + i });
    assert.equal(
      sizeItems(f).some((item) => item.checked),
      false,
    );
    await f.command("compact");
    assert.deepEqual(windowSize(f), { width: 440, height: 260 });
    assert.equal(selectedSize(f), "Compact");
    await f.command("roomy");
    assert.deepEqual(windowSize(f), { width: 640, height: 380 });
  }
  assert.equal(f.window.options.resizable, false);
});

test("native preset menus still work while hidden or locked and free resize remains unavailable", async (t) => {
  const f = await startWindowsCompanion(t, "C:\\App");
  const resize = () =>
    f.handlers.get(IPC.resize)(f.event(), { width: 800, height: 500 });
  for (const mode of ["hide", "lock"]) {
    await f.command(mode);
    assert.throws(resize, /unavailable/);
    sizeItems(f)
      .find((item) => item.label.startsWith("Roomy"))
      .click();
    assert.deepEqual(windowSize(f), { width: 640, height: 380 });
    sizeItems(f)
      .find((item) => item.label.startsWith("Compact"))
      .click();
    assert.deepEqual(windowSize(f), { width: 440, height: 260 });
    assert.equal(f.companion.getState().locked, mode === "lock");
    assert.equal(f.companion.getState().visible, mode !== "hide");
    await f.command("restore");
    assert.deepEqual(f.companion.getState().windowSize, {
      width: 440,
      height: 260,
    });
    assert.equal(f.companion.getState().locked, false);
    assert.equal(f.window.ignore, false);
  }
});
