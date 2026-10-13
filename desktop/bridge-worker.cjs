"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { promises: fs } = require("node:fs");

function validConfig(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Number.isInteger(value.port) &&
    value.port >= 1 &&
    value.port <= 65535 &&
    [value.officeDirectory, value.tokenFile].every(
      (part) =>
        typeof part === "string" &&
        !part.includes("\0") &&
        path.isAbsolute(part),
    ) &&
    (value.token === undefined ||
      (typeof value.token === "string" &&
        /^[A-Za-z0-9_.~+\/-]{32,512}$/.test(value.token))) &&
    typeof value.createTokenDirectory === "boolean" &&
    Number.isInteger(value.shutdownGraceMs) &&
    value.shutdownGraceMs >= 1 &&
    value.shutdownGraceMs <= 1_000
  );
}

// Error messages and filesystem paths are deliberately not sent across the port.
function classifyError(error, phase) {
  if (error?.code === "EADDRINUSE") return "PORT_IN_USE";
  if (phase === "resources") return "RESOURCES";
  if (phase === "credential") return "TOKEN";
  return "WORKER";
}

function createBridgeWorker({
  parentPort,
  loadBridge = (filename) => import(pathToFileURL(filename).href),
  mkdir = (...args) => fs.mkdir(...args),
  stat = (...args) => fs.stat(...args),
  exit = (code) => process.exit(code),
  parentTimeoutMs = 20_000,
  shutdownTimeoutMs = 2_000,
} = {}) {
  if (!parentPort)
    throw new Error("The bridge worker requires its desktop parent");
  let bridge;
  let startPromise;
  let shutdownPromise;
  let stopping = false;
  let exitCode = 0;
  let phase = "resources";
  let watchdog;
  let shutdownDeadline;
  let exited = false;
  function terminate(code) {
    if (exited) return;
    exited = true;
    clearTimeout(watchdog);
    clearTimeout(shutdownDeadline);
    parentPort.off("message", receive);
    parentPort.off("close", stop);
    exit(code);
  }
  function armShutdownDeadline() {
    if (shutdownDeadline || exited) return;
    // A dead parent cannot kill a child blocked in startup or graceful close.
    // This process exits itself; it never targets a PID or another bridge.
    shutdownDeadline = setTimeout(() => terminate(1), shutdownTimeoutMs);
    shutdownDeadline.unref?.();
  }
  const touchParent = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      void stop();
    }, parentTimeoutMs);
    watchdog.unref?.();
  };
  const send = (message) => {
    try {
      parentPort.postMessage(message);
    } catch {
      /* Parent may have already exited. */
    }
  };
  function finishShutdown() {
    armShutdownDeadline();
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      clearTimeout(watchdog);
      try {
        await bridge?.close();
      } catch {
        exitCode = 1;
      }
      if (!exited) send({ type: "stopped" });
      terminate(exitCode);
    })();
    return shutdownPromise;
  }
  function stop() {
    stopping = true;
    armShutdownDeadline();
    clearTimeout(watchdog);
    return (startPromise || Promise.resolve()).then(finishShutdown);
  }
  async function start(config) {
    if (!validConfig(config)) throw new Error("Invalid parent configuration");
    const serverPath = path.join(
      config.officeDirectory,
      "bridge",
      "server.mjs",
    );
    const distDir = path.join(config.officeDirectory, "dist");
    // Do not create credentials for a broken or incomplete application bundle.
    if (!(await stat(path.join(distDir, "index.html"))).isFile())
      throw new Error("Office build unavailable");
    if (stopping) return;
    const { createBridge } = await loadBridge(serverPath);
    if (stopping) return;
    phase = "credential";
    if (config.createTokenDirectory)
      await mkdir(path.dirname(config.tokenFile), {
        recursive: true,
        mode: 0o700,
      });
    if (stopping) return;
    bridge = await createBridge({
      port: config.port,
      distDir,
      tokenFile: config.tokenFile,
      ...(config.token ? { token: config.token } : {}),
      shutdownGraceMs: config.shutdownGraceMs,
    });
    if (stopping) return;
    phase = "listen";
    await bridge.listen();
    if (!stopping) send({ type: "ready", port: config.port });
  }
  function receive(event) {
    const message = event?.data;
    if (!message || typeof message !== "object" || Array.isArray(message))
      return;
    if (message.type === "ping" && startPromise && !stopping) {
      touchParent();
      return;
    }
    if (message.type === "stop") {
      void stop();
      return;
    }
    if (message.type !== "start" || startPromise || stopping) return;
    touchParent();
    startPromise = start(message.config).catch((error) => {
      exitCode = 1;
      stopping = true;
      send({ type: "error", code: classifyError(error, phase) });
    });
    void startPromise.then(() => {
      if (stopping) return finishShutdown();
    });
  }
  parentPort.on("message", receive);
  // close is defensive; the heartbeat also handles Electron versions that do
  // not emit it when their parent disappears. No PID-based cleanup is used.
  parentPort.on("close", stop);
  return { stop };
}

module.exports = { createBridgeWorker, validConfig, classifyError };

if (require.main === module) {
  if (!process.parentPort) process.exitCode = 1;
  else createBridgeWorker({ parentPort: process.parentPort });
}
