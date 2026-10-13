"use strict";

const http = require("node:http");
const path = require("node:path");
const { parsePort } = require("./core.cjs");

const HEALTH_TIMEOUT_MS = 1_500;
const STARTUP_TIMEOUT_MS = 10_000;
const SHUTDOWN_GRACE_MS = 1_500;
const KILL_WAIT_MS = 500;
const MAX_HEALTH_BYTES = 4_096;
const PARENT_HEARTBEAT_MS = 5_000;

class BridgeRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BridgeRuntimeError";
    this.code = code;
  }
}

function runtimeError(code, port) {
  const messages = {
    STOPPED: "The desktop office is stopping.",
    NOT_READY:
      "The desktop office must finish starting before its local bridge can run.",
    HEALTH: `Port ${port} is in use, but its service is not a compatible Pi Office bridge. Close that service or choose a free PI_OFFICE_PORT, then restart.`,
    HEALTH_TIMEOUT: `The service on port ${port} did not answer the Pi Office health check. Check the existing office or choose a free PI_OFFICE_PORT, then restart.`,
    PORT_IN_USE: `Another service took port ${port} while Pi Office was starting. Check that service or choose a free PI_OFFICE_PORT, then restart.`,
    RESOURCES:
      "The bundled office files are missing or unreadable. Download a fresh copy of the portable executable, then restart.",
    TOKEN:
      "The observer credential file could not be read or created. Check PI_OFFICE_TOKEN_FILE and the application data folder permissions, then restart.",
    TOKEN_VALUE:
      "PI_OFFICE_TOKEN must contain 32–512 URL-safe characters. Correct it or remove the override, then restart.",
    TOKEN_PATH:
      "PI_OFFICE_TOKEN_FILE must be a valid local file path. Correct it or remove the override, then restart.",
    WORKER:
      "The bundled office bridge could not start. Restart the application; if this continues, download a fresh copy of the portable executable.",
    STARTUP_TIMEOUT:
      "The bundled office bridge did not become ready in time. Restart the application and check that its files and credential location are accessible.",
    CRASHED:
      "The bundled office bridge stopped unexpectedly. Restart the application to reconnect; your Pi sessions have not been stopped.",
  };
  return new BridgeRuntimeError(code, messages[code] || messages.WORKER);
}

function positiveInterval(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647)
    throw new TypeError(`${name} must be a positive timer interval`);
  return value;
}

// No URL, host, redirect, credential or request method comes from a renderer.
// Only an explicit IPv4 connection refusal means it is safe to try binding.
function requestBridgeHealth({
  port,
  timeoutMs = HEALTH_TIMEOUT_MS,
  signal,
  request = http.request,
} = {}) {
  port = parsePort(port);
  positiveInterval(timeoutMs, "timeoutMs");
  return new Promise((resolve, reject) => {
    let settled = false;
    let req;
    let response;
    let bytes = 0;
    const chunks = [];
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result);
      response?.destroy();
      req?.destroy();
    };
    const abort = () => finish(runtimeError("STOPPED", port));
    const deadline = setTimeout(
      () => finish(runtimeError("HEALTH_TIMEOUT", port)),
      timeoutMs,
    );
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      req = request(
        {
          protocol: "http:",
          hostname: "127.0.0.1",
          port,
          path: "/api/health",
          method: "GET",
          agent: false,
          headers: { Accept: "application/json", Connection: "close" },
          maxHeaderSize: 8_192,
        },
        (res) => {
          response = res;
          if (settled) return res.destroy();
          if (
            res.statusCode !== 200 ||
            !/^application\/json(?:;|$)/i.test(
              res.headers["content-type"] || "",
            ) ||
            Number(res.headers["content-length"]) > MAX_HEALTH_BYTES
          )
            return finish(runtimeError("HEALTH", port));
          res.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > MAX_HEALTH_BYTES)
              return finish(runtimeError("HEALTH", port));
            chunks.push(chunk);
          });
          res.on("end", () => {
            try {
              const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              if (
                !value ||
                typeof value !== "object" ||
                Array.isArray(value) ||
                value.ok !== true ||
                value.service !== "pi-office" ||
                value.version !== 1 ||
                value.readOnly !== true
              )
                return finish(runtimeError("HEALTH", port));
              finish(null, { status: "healthy" });
            } catch {
              finish(runtimeError("HEALTH", port));
            }
          });
          res.on("error", () => finish(runtimeError("HEALTH", port)));
          res.on("aborted", () => finish(runtimeError("HEALTH", port)));
        },
      );
      req.on("error", (error) => {
        if (!response && error.code === "ECONNREFUSED")
          finish(null, { status: "absent" });
        else finish(runtimeError("HEALTH", port));
      });
      req.end();
    } catch {
      finish(runtimeError("HEALTH", port));
    }
  });
}

// Keep only OS essentials. Never inherit NODE_OPTIONS, NODE_PATH, Electron flags,
// loaders, debugging switches or unrelated credentials into the child.
function workerEnvironment(env) {
  const allowed =
    /^(?:systemroot|windir|temp|tmp|tmpdir|home|userprofile|localappdata|appdata|path|lang|lc_[a-z_]+)$/i;
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) => allowed.test(key) && typeof value === "string",
    ),
  );
}

function resolveWorkerConfig({
  app,
  env,
  port,
  baseDirectory,
  resourcesPath,
  cwd,
  shutdownGraceMs,
}) {
  const token = env.PI_OFFICE_TOKEN;
  if (
    token !== undefined &&
    token !== "" &&
    (typeof token !== "string" || !/^[A-Za-z0-9_.~+\/-]{32,512}$/.test(token))
  )
    throw runtimeError("TOKEN_VALUE", port);
  const explicitFile = token ? undefined : env.PI_OFFICE_TOKEN_FILE;
  if (
    explicitFile !== undefined &&
    explicitFile !== "" &&
    (typeof explicitFile !== "string" ||
      explicitFile.includes("\0") ||
      !explicitFile.trim())
  )
    throw runtimeError("TOKEN_PATH", port);
  const tokenFile = explicitFile
    ? path.resolve(cwd, explicitFile)
    : path.join(app.getPath("userData"), ".pi-office-token");
  const officeDirectory = app.isPackaged
    ? path.join(resourcesPath, "office")
    : path.resolve(baseDirectory, "..");
  return {
    port,
    officeDirectory,
    tokenFile,
    ...(token ? { token } : {}),
    createTokenDirectory: !token && !explicitFile,
    shutdownGraceMs,
  };
}

/**
 * Owns at most one utilityProcess handle, never an external bridge or arbitrary PID.
 * The caller owns app event registration and must await stop() before final quit.
 * No credential value or native path is included in getState()/onState().
 */
function createBridgeRuntime({
  app,
  utilityProcess,
  env = process.env,
  baseDirectory = __dirname,
  resourcesPath = process.resourcesPath,
  cwd = process.cwd(),
  port = parsePort(env.PI_OFFICE_PORT),
  onState = () => {},
  probeHealth = requestBridgeHealth,
  healthTimeoutMs = HEALTH_TIMEOUT_MS,
  startupTimeoutMs = STARTUP_TIMEOUT_MS,
  shutdownGraceMs = SHUTDOWN_GRACE_MS,
  killWaitMs = KILL_WAIT_MS,
} = {}) {
  port = parsePort(port);
  for (const [name, value] of Object.entries({
    healthTimeoutMs,
    startupTimeoutMs,
    shutdownGraceMs,
    killWaitMs,
  }))
    positiveInterval(value, name);
  const abort = new AbortController();
  let state = { mode: "starting", error: null };
  let startPromise;
  let stopPromise;
  let stopping = false;
  let record = null;
  let config = null;
  const getState = () => ({ ...state });
  const publish = (mode, error = null) => {
    state = { mode, error };
    try {
      onState(getState());
    } catch {
      /* Reporting must not strand an owned process. */
    }
  };
  const assertActive = () => {
    if (stopping) throw runtimeError("STOPPED", port);
  };
  const setFailure = (error) => {
    if (!stopping) publish("error", error.message);
  };
  const waitForExit = (childRecord, timeoutMs) =>
    new Promise((resolve) => {
      if (childRecord.exited) return resolve(true);
      const timer = setTimeout(() => resolve(false), timeoutMs);
      childRecord.exitPromise.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  async function stopOwned() {
    const current = record;
    if (!current || current.exited) return;
    if (current.stoppingPromise) return current.stoppingPromise;
    current.stoppingPromise = (async () => {
      current.closing = true;
      clearInterval(current.heartbeat);
      try {
        current.child.postMessage({ type: "stop" });
      } catch {
        /* Kill remains bounded. */
      }
      if (await waitForExit(current, shutdownGraceMs)) return;
      if (!current.exited) {
        try {
          current.child.kill();
        } catch {
          /* Only this owned handle is ever targeted. */
        }
        await waitForExit(current, killWaitMs);
      }
    })();
    return current.stoppingPromise;
  }
  function launchOwned() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let current;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        abort.signal.removeEventListener("abort", cancel);
        if (current) current.rejectStartup = null;
        if (error) reject(error);
        else resolve();
      };
      const cancel = () => finish(runtimeError("STOPPED", port));
      const timer = setTimeout(
        () => finish(runtimeError("STARTUP_TIMEOUT", port)),
        startupTimeoutMs,
      );
      abort.signal.addEventListener("abort", cancel, { once: true });
      try {
        assertActive();
        const child = utilityProcess.fork(
          path.join(baseDirectory, "bridge-worker.cjs"),
          [],
          {
            env: workerEnvironment(env),
            execArgv: [],
            stdio: "ignore",
            serviceName: "Pi Office local bridge",
          },
        );
        let resolveExit;
        current = record = {
          child,
          exited: false,
          closing: false,
          rejectStartup: finish,
          exitPromise: new Promise((done) => {
            resolveExit = done;
          }),
        };
        child.on("exit", () => {
          current.exited = true;
          clearInterval(current.heartbeat);
          resolveExit();
          current.rejectStartup?.(runtimeError("CRASHED", port));
          if (!stopping && !current.closing && state.mode === "owned")
            setFailure(runtimeError("CRASHED", port));
        });
        child.on("error", () => {
          // Electron may include a full diagnostic report here. Never forward it.
          current.rejectStartup?.(runtimeError("WORKER", port));
          if (!stopping && !current.closing && state.mode === "owned") {
            setFailure(runtimeError("CRASHED", port));
            void stopOwned();
          }
        });
        child.on("message", (message) => {
          if (
            !message ||
            typeof message !== "object" ||
            current.closing ||
            stopping
          )
            return;
          if (message.type === "ready" && message.port === port) finish();
          else if (message.type === "error") {
            const code = [
              "PORT_IN_USE",
              "RESOURCES",
              "TOKEN",
              "WORKER",
            ].includes(message.code)
              ? message.code
              : "WORKER";
            current.rejectStartup?.(runtimeError(code, port));
          }
        });
        // Electron queues parent messages until the utility worker installs its handler.
        child.postMessage({ type: "start", config });
        current.heartbeat = setInterval(() => {
          if (current.exited || current.closing || stopping) return;
          try {
            child.postMessage({ type: "ping" });
          } catch {
            /* Worker also expires missing heartbeats. */
          }
        }, PARENT_HEARTBEAT_MS);
        current.heartbeat.unref?.();
      } catch (error) {
        finish(
          error instanceof BridgeRuntimeError
            ? error
            : runtimeError("WORKER", port),
        );
      }
    });
  }
  function start() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        assertActive();
        if (!app.isReady()) throw runtimeError("NOT_READY", port);
        publish("starting");
        const first = await probeHealth({
          port,
          timeoutMs: healthTimeoutMs,
          signal: abort.signal,
        });
        assertActive();
        if (first.status === "healthy") {
          publish("external");
          return getState();
        }
        if (first.status !== "absent") throw runtimeError("HEALTH", port);
        config = resolveWorkerConfig({
          app,
          env,
          port,
          baseDirectory,
          resourcesPath,
          cwd,
          shutdownGraceMs: Math.min(shutdownGraceMs, 1_000),
        });
        await launchOwned();
        assertActive();
        const ready = await probeHealth({
          port,
          timeoutMs: healthTimeoutMs,
          signal: abort.signal,
        });
        assertActive();
        if (record?.exited) throw runtimeError("CRASHED", port);
        if (ready.status !== "healthy") throw runtimeError("WORKER", port);
        publish("owned");
        return getState();
      } catch (error) {
        const safe =
          error instanceof BridgeRuntimeError
            ? error
            : runtimeError("HEALTH", port);
        setFailure(safe);
        await stopOwned();
        throw safe;
      }
    })();
    return startPromise;
  }
  function stop() {
    if (stopPromise) return stopPromise;
    stopping = true;
    abort.abort();
    stopPromise = stopOwned();
    return stopPromise;
  }
  return {
    start,
    stop,
    getState,
    // Native connection instructions only: never put this in renderer state.
    getTokenFile: () => (config && !config.token ? config.tokenFile : null),
  };
}

module.exports = {
  HEALTH_TIMEOUT_MS,
  STARTUP_TIMEOUT_MS,
  SHUTDOWN_GRACE_MS,
  MAX_HEALTH_BYTES,
  BridgeRuntimeError,
  requestBridgeHealth,
  workerEnvironment,
  resolveWorkerConfig,
  createBridgeRuntime,
};
