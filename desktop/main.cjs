"use strict";

const path = require("node:path");
const { createBridgeRuntime } = require("./bridge-runtime.cjs");
const { prepareObserverConnection } = require("./observer-connect.cjs");
const { pathToFileURL } = require("node:url");
const {
  clampBounds,
  isResizePayload,
  createGeometryStore,
  RESIZE_INTERVAL_MS,
} = require("./window-geometry.cjs");
const {
  PRESETS,
  parsePort,
  officeUrl,
  isAllowedCommand,
  isTrustedSender,
  isAllowedRendererRequest,
  createSnapshotPoller,
} = require("./core.cjs");

const IPC = Object.freeze({
  state: "companion:get-state",
  command: "companion:command",
  resize: "companion:resize",
  update: "companion:state",
});
const RESTORE_SHORTCUT = "Control+Shift+Space";
const HIDE_SHORTCUT = "Control+Shift+H";

// Dependencies are injectable for lifecycle/security tests without launching Electron.
function createCompanion(
  electron,
  {
    env = process.env,
    baseDirectory = __dirname,
    fetchSnapshot,
    bridgeFactory = createBridgeRuntime,
    resourcesPath = process.resourcesPath,
    geometryStore,
    resizeClock = {
      now: () => performance.now(),
      setTimer: setTimeout,
      clearTimer: clearTimeout,
    },
  } = {},
) {
  const {
    app,
    BrowserWindow,
    Menu,
    Tray,
    nativeImage,
    globalShortcut,
    ipcMain,
    session,
    shell,
    screen,
  } = electron;
  const port = parsePort(env.PI_OFFICE_PORT);
  const distDirectory = path.resolve(baseDirectory, "dist");
  const rendererPath = path.join(distDirectory, "index.html");
  const rendererUrl = pathToFileURL(rendererPath).href;
  const externalUrl = officeUrl(port);
  let window = null;
  let tray = null;
  let quitting = false;
  let bridgeRuntime = null;
  let bridgeState = null;
  let shutdownPromise = null;
  let shutdownFinished = false;
  let connectDialogOpen = false;
  let disposed = false;
  let locked = false;
  let rendererFailed = false;
  let rendererGeneration = 0;
  let reloadPending = false;
  let alwaysOnTop = true;
  let shortcutAvailable = false;
  let hideShortcutAvailable = false;
  let preset = "compact";
  let pendingResize = null;
  let resizeTimer = null;
  let lastResizeAt = -Infinity;
  let pollState = {
    snapshot: null,
    connection: { status: "paused", lastSuccessAt: null, error: null },
  };

  const isWindow = () => window && !window.isDestroyed();
  const getState = () => ({
    ...pollState,
    ...(bridgeState ? { bridge: bridgeState } : {}),
    ...(bridgeState && !["owned", "external"].includes(bridgeState.mode)
      ? {
          connection: {
            status: bridgeState.mode === "error" ? "offline" : "connecting",
            lastSuccessAt: null,
            error: bridgeState.error,
          },
        }
      : {}),
    visible: Boolean(isWindow() && window.isVisible() && !window.isMinimized()),
    alwaysOnTop,
    locked,
    shortcutAvailable,
    ...(isWindow() ? { windowSize: windowSize() } : {}),
  });
  function windowSize() {
    const { width, height } = window.getBounds();
    return { width, height };
  }
  const rememberGeometry = () => {
    if (isWindow() && !disposed) geometryStore?.save(window.getBounds());
  };
  const cancelResize = () => {
    if (resizeTimer !== null) resizeClock.clearTimer(resizeTimer);
    resizeTimer = null;
    const pending = pendingResize;
    pendingResize = null;
    pending?.reject(new Error("Window resize cancelled"));
  };
  const refreshMenu = () => {
    if (!tray || tray.isDestroyed()) return;
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Show and unlock",
          accelerator: RESTORE_SHORTCUT,
          click: () => restore(),
        },
        {
          label: "Hide companion",
          accelerator: hideShortcutAvailable ? HIDE_SHORTCUT : undefined,
          click: () => hide(),
        },
        { type: "separator" },
        {
          label: "Always on top",
          type: "checkbox",
          checked: alwaysOnTop,
          click: () => void runCommand("toggle-top").catch(() => {}),
        },
        {
          label: "Click-through lock",
          type: "checkbox",
          checked: locked,
          enabled: shortcutAvailable,
          click: () =>
            void runCommand(locked ? "restore" : "lock").catch(() => {}),
        },
        {
          label: "Size",
          submenu: [
            {
              label: "Compact · 440 × 260",
              type: "radio",
              checked: preset === "compact",
              click: () => void runCommand("compact").catch(() => {}),
            },
            {
              label: "Roomy · 640 × 380",
              type: "radio",
              checked: preset === "roomy",
              click: () => void runCommand("roomy").catch(() => {}),
            },
          ],
        },
        {
          label: "Open full office",
          click: () => void runCommand("open-office").catch(() => {}),
        },
        { label: "Connect Pi…", click: () => void connectPi().catch(() => {}) },
        { type: "separator" },
        { label: "Quit companion", click: () => quit() },
      ]),
    );
  };
  const publish = () => {
    if (
      isWindow() &&
      !window.webContents.isDestroyed() &&
      !rendererFailed &&
      !reloadPending
    ) {
      // A process can disappear between the liveness check and the send.
      try {
        window.webContents.send(IPC.update, getState());
      } catch {
        /* Recovery remains native. */
      }
    }
    refreshMenu();
  };
  const poller = createSnapshotPoller({
    port,
    ...(fetchSnapshot ? { fetchSnapshot } : {}),
    onUpdate(next) {
      pollState = next;
      publish();
    },
  });
  const syncVisibility = () => {
    if (!isWindow() || !window.isVisible() || window.isMinimized())
      cancelResize();
    poller.setVisible(
      Boolean(
        isWindow() &&
        window.isVisible() &&
        !window.isMinimized() &&
        !rendererFailed &&
        !reloadPending &&
        (!app.isPackaged || ["owned", "external"].includes(bridgeState?.mode)),
      ),
    );
    publish();
  };
  const unlock = () => {
    if (!isWindow()) return;
    window.setIgnoreMouseEvents(false);
    window.setFocusable(true);
    window.setMovable(true);
    locked = false;
  };
  const ensureOnScreen = () => {
    if (!isWindow()) return;
    const bounds = window.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    const next = clampBounds(bounds, workArea);
    if (Object.keys(next).some((key) => next[key] !== bounds[key]))
      applyBounds(next, preset);
  };
  const onDisplayChange = () => {
    if (!isWindow() || quitting || disposed) return;
    cancelResize();
    try {
      ensureOnScreen();
      publish();
    } catch {
      /* A display can disappear again before the OS applies bounds. */
    }
  };
  function applyBounds(requested, nextPreset = "custom") {
    const target = window;
    const previous = { ...target.getBounds() };
    try {
      const { workArea } = screen.getDisplayMatching(previous);
      const bounds = clampBounds(requested, workArea);
      // setSize clamps to the previous fixed window's minimum on Windows.
      // setBounds updates those fixed-size constraints before resizing, without
      // enabling manual resizing (which can break transparent windows).
      target.setBounds(bounds);
      const actual = target.getBounds();
      // Fractional display scaling can round logical bounds by one DIP.
      if (
        ["x", "y", "width", "height"].some(
          (key) =>
            !Number.isSafeInteger(actual[key]) ||
            Math.abs(actual[key] - bounds[key]) > 1,
        )
      )
        throw new Error("Requested window size was not applied");
      preset = nextPreset;
      rememberGeometry();
    } catch {
      try {
        if (!target.isDestroyed()) target.setBounds(previous);
      } catch {
        /* Native recovery remains available even if restoring bounds fails. */
      }
      // In particular, undo the tray radio item's optimistic native selection.
      publish();
      throw new Error("Could not apply the requested window size");
    }
  }
  function canResize() {
    if (
      !isWindow() ||
      quitting ||
      disposed ||
      locked ||
      !window.isVisible() ||
      window.isMinimized() ||
      rendererFailed ||
      reloadPending
    )
      throw new Error("Companion window unavailable for resizing");
  }
  function requestResize(event, size) {
    canResize();
    if (pendingResize) {
      pendingResize.event = event;
      pendingResize.size = { ...size };
      return pendingResize.promise;
    }
    const apply = () => {
      canResize();
      if (!isTrustedSender(event, window, rendererUrl))
        throw new Error("Untrusted companion resize");
      lastResizeAt = resizeClock.now();
      applyBounds({ ...window.getBounds(), ...size });
      publish();
      return getState();
    };
    const wait = RESIZE_INTERVAL_MS - (resizeClock.now() - lastResizeAt);
    if (wait <= 0) return Promise.resolve(apply());
    let resolve, reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    pendingResize = { event, size: { ...size }, promise, resolve, reject };
    resizeTimer = resizeClock.setTimer(() => {
      const pending = pendingResize;
      pendingResize = null;
      resizeTimer = null;
      if (!pending) return;
      try {
        canResize();
        if (!isTrustedSender(pending.event, window, rendererUrl))
          throw new Error("Untrusted companion resize");
        lastResizeAt = resizeClock.now();
        applyBounds({ ...window.getBounds(), ...pending.size });
        publish();
        pending.resolve(getState());
      } catch (error) {
        pending.reject(error);
      }
    }, wait);
    return promise;
  }
  function restore() {
    if (!isWindow() || quitting || disposed) return;
    unlock();
    if (rendererFailed && !reloadPending) {
      reloadPending = true;
      const target = window;
      const generation = rendererGeneration;
      void target.loadURL(rendererUrl).then(
        () => {
          if (
            !isWindow() ||
            target !== window ||
            generation !== rendererGeneration
          )
            return;
          rendererFailed = false;
          reloadPending = false;
          syncVisibility();
        },
        () => {
          if (
            !isWindow() ||
            target !== window ||
            generation !== rendererGeneration
          )
            return;
          reloadPending = false;
          publish();
        },
      );
    }
    if (window.isMinimized()) window.restore();
    ensureOnScreen();
    window.show();
    window.focus();
    syncVisibility();
  }
  function hide() {
    if (!isWindow() || quitting || disposed) return;
    // A visible taskbar window alone is not sufficient recovery after hide().
    shortcutAvailable =
      shortcutAvailable && globalShortcut.isRegistered(RESTORE_SHORTCUT);
    if (!shortcutAvailable && (!tray || tray.isDestroyed())) {
      throw new Error(
        "Hide requires the recovery shortcut or tray. Quit remains available.",
      );
    }
    unlock();
    cancelResize();
    window.hide();
    syncVisibility();
  }
  function quit() {
    quitting = true;
    dispose();
    if (!bridgeRuntime) {
      app.quit();
      return;
    }
    if (!shutdownPromise)
      shutdownPromise = bridgeRuntime
        .stop()
        .catch(() => {})
        .finally(() => {
          shutdownFinished = true;
          app.quit();
        });
  }
  async function connectPi() {
    if (connectDialogOpen || quitting) return;
    connectDialogOpen = true;
    try {
      if (!bridgeRuntime || bridgeState?.mode === "external") {
        await electron.dialog.showMessageBox(window, {
          type: "info",
          title: "Connect Pi",
          message: "Use your existing Pi Office observer connection.",
          detail:
            "The existing bridge is managed separately. Continue using its CONNECT-PI.cmd or configured observer. The companion does not replace its token or register another observer.",
          buttons: ["Close"],
        });
        return;
      }
      if (bridgeState?.mode !== "owned") {
        await electron.dialog.showMessageBox(window, {
          type: "warning",
          title: "Connect Pi",
          message: "The local bridge is not ready.",
          detail: bridgeState?.error || "Wait for startup, or quit and retry.",
          buttons: ["Close"],
        });
        return;
      }
      const tokenFile = bridgeRuntime.getTokenFile();
      const { command } = await prepareObserverConnection({
        officeDirectory: path.join(resourcesPath, "office"),
        userData: app.getPath("userData"),
        tokenFile,
        port,
      });
      const { response } = await electron.dialog.showMessageBox(window, {
        type: "info",
        title: "Connect Pi",
        message: "Start Pi with the bundled observer",
        detail: `Run the command in PowerShell from your project folder. Pi must already be installed. This starts a new Pi session; it does not modify existing sessions or persistent settings. Do not also load a second Pi Office observer. Keep this app running.

${tokenFile ? "Only a local token-file path is used; no token is copied." : "Use the same terminal environment that supplied PI_OFFICE_TOKEN when launching this app."}

${command}`,
        buttons: ["Copy PowerShell command", "Close"],
        defaultId: 1,
        cancelId: 1,
      });
      if (response === 0) electron.clipboard.writeText(command);
    } catch {
      if (!quitting)
        await electron.dialog.showMessageBox(window, {
          type: "error",
          title: "Connect Pi",
          message: "Could not prepare the observer connection.",
          detail: "Check that the app data folder is writable, then try again.",
          buttons: ["Close"],
        });
    } finally {
      connectDialogOpen = false;
    }
  }
  async function runCommand(command) {
    if (!isAllowedCommand(command))
      throw new Error("Unknown companion command");
    if (!isWindow() || quitting || disposed)
      throw new Error("Companion window unavailable");
    switch (command) {
      case "toggle-top":
        alwaysOnTop = !alwaysOnTop;
        window.setAlwaysOnTop(alwaysOnTop);
        break;
      case "lock":
        // A tray may be absent from the OS shell. Lock requires a successfully
        // registered, currently owned keyboard recovery path on every attempt.
        shortcutAvailable =
          shortcutAvailable && globalShortcut.isRegistered(RESTORE_SHORTCUT);
        if (!shortcutAvailable) {
          publish();
          throw new Error(
            "Click-through is disabled: Ctrl+Shift+Space is unavailable",
          );
        }
        locked = true;
        cancelResize();
        window.setMovable(false);
        window.setFocusable(false);
        window.setIgnoreMouseEvents(true, { forward: true });
        window.blur();
        break;
      case "hide":
        hide();
        break;
      case "restore":
        restore();
        break;
      case "open-office":
        await shell.openExternal(externalUrl);
        break;
      case "compact":
      case "roomy":
        cancelResize();
        applyBounds({ ...window.getBounds(), ...PRESETS[command] }, command);
        break;
      case "connect-pi":
        await connectPi();
        break;
      case "quit":
        quit();
        break;
    }
    publish();
    return getState();
  }
  function dispose() {
    if (disposed) return;
    cancelResize();
    rememberGeometry();
    geometryStore?.dispose();
    for (const event of [
      "display-added",
      "display-removed",
      "display-metrics-changed",
    ])
      screen.removeListener?.(event, onDisplayChange);
    disposed = true;
    poller.dispose();
    globalShortcut.unregisterAll();
    shortcutAvailable = false;
    if (tray && !tray.isDestroyed()) tray.destroy();
    tray = null;
    ipcMain.removeHandler(IPC.state);
    ipcMain.removeHandler(IPC.command);
    ipcMain.removeHandler(IPC.resize);
  }

  const deny = (event) => event.preventDefault();
  function secureSession(companionSession) {
    companionSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    companionSession.setPermissionCheckHandler(() => false);
    companionSession.setDevicePermissionHandler(() => false);
    companionSession.on("will-download", deny);
    companionSession.webRequest.onBeforeRequest(
      { urls: ["<all_urls>"] },
      (details, callback) => {
        callback({
          cancel: !isAllowedRendererRequest(details.url, distDirectory),
        });
      },
    );
  }
  function secureContents(contents) {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", deny);
    contents.on("will-frame-navigate", deny);
    contents.on("will-redirect", deny);
    contents.on("will-attach-webview", deny);
    contents.on("select-bluetooth-device", (event, _devices, callback) => {
      event.preventDefault();
      callback("");
    });
    contents.on("render-process-gone", () => {
      cancelResize();
      rendererFailed = true;
      rendererGeneration++;
      reloadPending = false;
      unlock();
      poller.setVisible(false);
      publish();
    });
  }
  function createTray() {
    try {
      // A self-contained opaque bitmap avoids remote images and filesystem reads.
      const size = 32;
      const pixels = Buffer.alloc(size * size * 4);
      for (let y = 3; y < 29; y++) {
        for (let x = 3; x < 29; x++) {
          const offset = (y * size + x) * 4;
          const pane =
            y >= 9 && y <= 23 && ((x >= 8 && x <= 12) || (x >= 19 && x <= 23));
          pixels.set(pane ? [35, 35, 39, 255] : [247, 188, 89, 255], offset);
        }
      }
      const icon = nativeImage.createFromBitmap(pixels, {
        width: size,
        height: size,
        scaleFactor: 1,
      });
      tray = new Tray(icon);
      tray.setToolTip(
        "Pi Office Companion · Ctrl+Shift+Space to show and unlock",
      );
      tray.on("click", restore);
      tray.on("double-click", restore);
      refreshMenu();
    } catch {
      if (tray && !tray.isDestroyed()) tray.destroy();
      tray = null;
    }
  }
  async function start() {
    app.setName("Pi Office Companion");
    app.enableSandbox();
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return false;
    }
    app.on("second-instance", restore);
    app.on("activate", restore);
    app.on("before-quit", (event) => {
      if (bridgeRuntime && !shutdownFinished) {
        event.preventDefault();
        quit();
      } else {
        quitting = true;
        dispose();
      }
    });
    app.on("will-quit", dispose);
    app.on("window-all-closed", () => {
      if (!quitting) quit();
    });
    await app.whenReady();
    if (quitting) return false;
    if (geometryStore === undefined && typeof app.getPath === "function") {
      try {
        geometryStore = createGeometryStore({
          directory: app.getPath("userData"),
        });
      } catch {
        geometryStore = null;
      }
    }
    let restoredBounds = null;
    try {
      const saved = geometryStore?.load();
      if (saved)
        restoredBounds = clampBounds(
          saved,
          screen.getDisplayMatching(saved).workArea,
        );
    } catch {
      /* Malformed or inaccessible preferences fall back to Compact. */
    }
    if (app.isPackaged) {
      bridgeRuntime = bridgeFactory({
        app,
        utilityProcess: electron.utilityProcess,
        env,
        baseDirectory,
        resourcesPath,
        port,
        onState(next) {
          bridgeState = next;
          syncVisibility();
        },
      });
      bridgeState = bridgeRuntime.getState();
      // The UI remains available even if a conflicting listener prevents startup.
      void bridgeRuntime.start().catch(() => {});
    }
    const companionSession = session.fromPartition("pi-office-companion", {
      cache: false,
    });
    secureSession(companionSession);
    window = new BrowserWindow({
      ...PRESETS.compact,
      ...(restoredBounds || {}),
      title: "Pi Office Companion",
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      show: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      hasShadow: false,
      autoHideMenuBar: true,
      skipTaskbar: false,
      webPreferences: {
        preload: path.join(baseDirectory, "preload.cjs"),
        session: companionSession,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        devTools: false,
        spellcheck: false,
        navigateOnDragDrop: false,
        backgroundThrottling: true,
        safeDialogs: true,
      },
    });
    window.setMenu(null);
    if (restoredBounds)
      preset =
        Object.entries(PRESETS).find(
          ([, size]) =>
            size.width === restoredBounds.width &&
            size.height === restoredBounds.height,
        )?.[0] || "custom";
    secureContents(window.webContents);
    ipcMain.handle(IPC.state, (event, ...args) => {
      if (!isTrustedSender(event, window, rendererUrl) || args.length)
        throw new Error("Untrusted companion request");
      return getState();
    });
    ipcMain.handle(IPC.command, (event, ...args) => {
      if (
        !isTrustedSender(event, window, rendererUrl) ||
        args.length !== 1 ||
        !isAllowedCommand(args[0])
      ) {
        throw new Error("Untrusted companion command");
      }
      return runCommand(args[0]);
    });
    ipcMain.handle(IPC.resize, (event, ...args) => {
      if (
        !isTrustedSender(event, window, rendererUrl) ||
        args.length !== 1 ||
        !isResizePayload(args[0])
      )
        throw new Error("Untrusted companion resize");
      return requestResize(event, args[0]);
    });
    createTray();
    try {
      shortcutAvailable = globalShortcut.register(RESTORE_SHORTCUT, restore);
    } catch {
      shortcutAvailable = false;
    }
    try {
      hideShortcutAvailable = globalShortcut.register(HIDE_SHORTCUT, () => {
        try {
          hide();
        } catch {
          /* Remain visible if every recovery method failed. */
        }
      });
    } catch {
      hideShortcutAvailable = false;
    }
    refreshMenu();
    window.on("show", syncVisibility);
    window.on("hide", syncVisibility);
    window.on("minimize", syncVisibility);
    window.on("restore", syncVisibility);
    window.on("move", rememberGeometry);
    window.on("resize", rememberGeometry);
    for (const event of [
      "display-added",
      "display-removed",
      "display-metrics-changed",
    ])
      screen.on?.(event, onDisplayChange);
    window.on("close", (event) => {
      cancelResize();
      rememberGeometry();
      geometryStore?.flush();
      if (quitting) return;
      shortcutAvailable =
        shortcutAvailable && globalShortcut.isRegistered(RESTORE_SHORTCUT);
      if (shortcutAvailable || (tray && !tray.isDestroyed())) {
        event.preventDefault();
        hide();
      } else quit();
    });
    window.once("ready-to-show", restore);
    window.webContents.on("did-finish-load", () => {
      rendererFailed = false;
      reloadPending = false;
      syncVisibility();
    });
    window.on("closed", () => {
      cancelResize();
      geometryStore?.flush();
      window = null;
      poller.setVisible(false);
    });
    // Never serve or embed the office website. This is a separate local renderer.
    // loadFile uses legacy url.format, which does not escape literal percent
    // signs. Load the same correctly encoded, fixed file URL that IPC validates.
    try {
      await window.loadURL(rendererUrl);
    } catch (error) {
      quit();
      throw new Error(`Unable to load built companion UI: ${error.message}`);
    }
    return true;
  }
  return {
    start,
    dispose,
    getState,
    runCommand,
    restore,
    hide,
    quit,
    getWindow: () => window,
    getTray: () => tray,
  };
}

module.exports = { IPC, RESTORE_SHORTCUT, HIDE_SHORTCUT, createCompanion };

if (require.main === module) {
  const electron = require("electron");
  try {
    const companion = createCompanion(electron);
    companion.start().catch((error) => {
      console.error(error.message);
      electron.app.quit();
    });
  } catch (error) {
    console.error(error.message);
    electron.app.quit();
  }
}
