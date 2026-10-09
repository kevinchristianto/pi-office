import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStateStore, PROTOCOL_VERSION, LIMITS } from "./state.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const validToken = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.~+\/-]{32,512}$/.test(value);
export async function getToken({
  token = process.env.PI_OFFICE_TOKEN,
  tokenFile = process.env.PI_OFFICE_TOKEN_FILE ||
    path.join(root, ".pi-office-token"),
} = {}) {
  if (token) {
    if (!validToken(token))
      throw new Error("PI_OFFICE_TOKEN must be 32–512 URL-safe characters");
    return token;
  }
  const read = async () => {
    const stat = await fs.lstat(tokenFile);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Token path must be a regular local file");
    if (process.platform !== "win32" && stat.mode & 0o077)
      await fs.chmod(tokenFile, 0o600);
    const value = (await fs.readFile(tokenFile, "utf8")).trim();
    if (!validToken(value))
      throw new Error(
        "Invalid local token file; use a fresh token file or PI_OFFICE_TOKEN",
      );
    return value;
  };
  try {
    return await read();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const value = randomBytes(32).toString("hex");
  try {
    await fs.writeFile(tokenFile, `${value}\n`, { flag: "wx", mode: 0o600 });
    return value;
  } catch (error) {
    if (error.code === "EEXIST") return read();
    throw error;
  }
}

export async function createBridge({
  token,
  tokenFile,
  port = Number(process.env.PI_OFFICE_PORT || 4317),
  distDir = path.join(root, "dist"),
  store = createStateStore(),
  heartbeatMs = 10_000,
} = {}) {
  const secret = await getToken({ token, tokenFile });
  const clients = new Set();
  let listeningPort = port;
  let lastProjection = "";
  const respond = (res, code, value) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value));
  };
  const auth = (req) => {
    const value =
      typeof req.headers.authorization === "string" &&
      req.headers.authorization.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : "";
    const a = Buffer.from(value);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const broadcast = (force = false) => {
    const data = JSON.stringify(store.snapshot());
    if (!force && data === lastProjection) return;
    lastProjection = data;
    for (const res of clients) {
      if (res.writableLength > 1024 * 1024) {
        res.destroy();
        clients.delete(res);
        continue;
      }
      res.write(`event: snapshot\ndata: ${data}\n\n`);
    }
  };
  async function body(req) {
    const chunks = [];
    let count = 0;
    if (Number(req.headers["content-length"]) > LIMITS.payloadBytes) {
      const err = new Error("Payload too large");
      err.status = 413;
      throw err;
    }
    for await (const chunk of req) {
      count += chunk.length;
      if (count > LIMITS.payloadBytes) {
        const err = new Error("Payload too large");
        err.status = 413;
        throw err;
      }
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      const err = new Error("Invalid JSON");
      err.status = 400;
      throw err;
    }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    const host = req.headers.host;
    const allowedHosts = new Set([
      `127.0.0.1:${listeningPort}`,
      `localhost:${listeningPort}`,
    ]);
    const remote = req.socket.remoteAddress;
    if (
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote) ||
      !allowedHosts.has(host)
    )
      return respond(res, 403, { error: "Loopback Host required" });
    if (req.headers.origin && req.headers.origin !== `http://${host}`)
      return respond(res, 403, { error: "Same-origin requests only" });
    if (req.headers["sec-fetch-site"] === "cross-site")
      return respond(res, 403, { error: "Cross-site requests denied" });
    let url;
    try {
      url = new URL(req.url, `http://${host}`);
    } catch {
      return respond(res, 400, { error: "Invalid URL" });
    }
    if (url.origin !== `http://${host}`)
      return respond(res, 400, { error: "Invalid request target" });
    try {
      if (url.pathname === "/api/health" && req.method === "GET")
        return respond(res, 200, {
          ok: true,
          version: PROTOCOL_VERSION,
          service: "pi-office",
          readOnly: true,
        });
      if (url.pathname === "/api/snapshot" && req.method === "GET")
        return respond(res, 200, store.snapshot());
      if (url.pathname === "/api/events" && req.method === "GET") {
        if (clients.size >= 32)
          return respond(res, 503, { error: "Too many observer connections" });
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(
          `retry: 2500\nevent: snapshot\ndata: ${JSON.stringify(store.snapshot())}\n\n`,
        );
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (
        ["/api/ingest", "/api/hello"].includes(url.pathname) &&
        req.method === "POST"
      ) {
        if (!auth(req))
          return respond(res, 401, {
            error: "Observer authentication required",
          });
        if (
          !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")
        )
          return respond(res, 415, { error: "application/json required" });
        const payload = await body(req);
        if (url.pathname === "/api/hello") {
          if (
            !payload ||
            typeof payload !== "object" ||
            Array.isArray(payload) ||
            (payload.version !== undefined &&
              payload.version !== PROTOCOL_VERSION)
          )
            return respond(res, 400, {
              error: "Unsupported observer protocol",
            });
          return respond(res, 200, {
            version: PROTOCOL_VERSION,
            capabilities: {
              snapshot: true,
              sse: true,
              ingest: true,
              readOnly: true,
            },
            limits: LIMITS,
          });
        }
        let result;
        try {
          result = store.upsert(payload);
        } catch (error) {
          return respond(res, 400, { error: error.message });
        }
        broadcast();
        return respond(res, 202, { ok: true, ...result });
      }
      if (url.pathname.startsWith("/api/"))
        return respond(res, 404, { error: "Observer endpoint not found" });
      if (!["GET", "HEAD"].includes(req.method))
        return respond(res, 405, { error: "Method not allowed" });
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return respond(res, 400, { error: "Invalid path" });
      }
      if (
        pathname.includes("\0") ||
        pathname.includes("\\") ||
        pathname.split("/").some((p) => p.startsWith("."))
      )
        return respond(res, 404, { error: "Not found" });
      let file = path.resolve(
        distDir,
        `.${pathname === "/" ? "/index.html" : pathname}`,
      );
      const within = (candidate) =>
        candidate === distDir ||
        candidate.startsWith(`${path.resolve(distDir)}${path.sep}`);
      if (!within(file)) return respond(res, 404, { error: "Not found" });
      try {
        file = await fs.realpath(file);
        if (!within(file)) return respond(res, 404, { error: "Not found" });
      } catch {
        return respond(res, 404, {
          error: "App not built or file not found. Run npm run build first.",
        });
      }
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024)
        return respond(res, 404, { error: "Not found" });
      const bytes = await fs.readFile(file);
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
        "Content-Length": bytes.length,
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      if (!res.headersSent && !res.destroyed)
        respond(res, error.status || 500, {
          error: error.status ? error.message : "Local bridge request failed",
        });
      else res.destroy();
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 40;
  const timer = setInterval(() => {
    broadcast();
    for (const res of clients) res.write(": heartbeat\n\n");
  }, heartbeatMs);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  return {
    server,
    store,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          listeningPort = server.address().port;
          resolve();
        });
      });
      return `http://127.0.0.1:${listeningPort}`;
    },
    async close() {
      clearInterval(timer);
      for (const res of clients) res.end();
      clients.clear();
      server.closeIdleConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const bridge = await createBridge();
    const url = await bridge.listen();
    console.log(`Pi Office is ready at ${url} (local, read-only observer).`);
    console.log(
      "Observer credential is available through PI_OFFICE_TOKEN or the local token file.",
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(
        signal,
        () => void bridge.close().then(() => process.exit(0)),
      );
  } catch (error) {
    console.error(`Pi Office could not start: ${error.message}`);
    process.exitCode = 1;
  }
}
