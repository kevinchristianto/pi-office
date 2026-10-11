import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";

// Independent event-bus tests of the new asynchronous discovery boundary.
const source = await fs.readFile(
  new URL("../extension/pi-office.ts", import.meta.url),
  "utf8",
);
const { default: piOffice } = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: "strip" })).toString("base64")}`
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function fixture(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "office-project-review-"),
  );
  const bin = path.join(directory, "bin");
  const slow = path.join(directory, "slow");
  const fast = path.join(directory, "fast");
  const signal = path.join(directory, "started");
  await Promise.all([bin, slow, fast].map((p) => fs.mkdir(p)));
  const script = `#!${process.execPath}\nconst fs=require('node:fs'); const cwd=process.argv[process.argv.indexOf('-C')+1]; if(cwd.endsWith('/slow')) {fs.writeFileSync(${JSON.stringify(signal)},'started'); setTimeout(()=>console.log(cwd),350);} else console.log(cwd);\n`;
  await fs.writeFile(path.join(bin, "git"), script, { mode: 0o700 });
  const originals = {
    PATH: process.env.PATH,
    PI_OFFICE_TOKEN: process.env.PI_OFFICE_TOKEN,
    PI_OFFICE_URL: process.env.PI_OFFICE_URL,
    PI_OFFICE_TOKEN_FILE: process.env.PI_OFFICE_TOKEN_FILE,
  };
  Object.assign(process.env, {
    PATH: bin,
    PI_OFFICE_TOKEN: "review-only-test-token-01234567890123456789",
    PI_OFFICE_URL: "http://127.0.0.1:4317",
    PI_OFFICE_TOKEN_FILE: "/not-read-token-in-environment",
  });
  const previousFetch = globalThis.fetch;
  const payloads = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/api/ingest")) payloads.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({ version: 1, capabilities: { readOnly: true } }),
    };
  };
  const handlers = new Map();
  piOffice({ on: (name, handler) => handlers.set(name, handler) });
  const event = (name, id, cwd) =>
    handlers.get(name)?.(
      { reason: "startup" },
      {
        cwd,
        isIdle: () => true,
        sessionManager: { getSessionId: () => id, getBranch: () => [] },
      },
    );
  t.after(async () => {
    await event("session_shutdown");
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(directory, { recursive: true, force: true });
  });
  const begun = async () => {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      try {
        await fs.access(signal);
        return;
      } catch {
        await pause(10);
      }
    }
    assert.fail("project discovery subprocess did not start");
  };
  return { event, payloads, slow, fast, begun };
}

test(
  "shutdown during canonical Git discovery cannot publish a ghost session after exit",
  { skip: process.platform === "win32", timeout: 5000 },
  async (t) => {
    const f = await fixture(t);
    const starting = f.event("session_start", "pending", f.slow);
    await f.begun();
    await f.event("session_shutdown");
    await starting;
    await pause(150);
    assert.equal(f.payloads.length, 0);
  },
);

test(
  "a newer session start wins an overlapping slow project lookup without cross-attributing its project or root agent",
  { skip: process.platform === "win32", timeout: 5000 },
  async (t) => {
    const f = await fixture(t);
    const starting = f.event("session_start", "superseded", f.slow);
    await f.begun();
    await f.event("session_start", "current", f.fast);
    await starting;
    await pause(150);
    assert.ok(f.payloads.length > 0);
    for (const payload of f.payloads) {
      assert.equal(payload.session.id, "current");
      assert.equal(payload.session.cwd, f.fast);
      assert.equal(payload.session.project.root, f.fast);
      assert.deepEqual(
        payload.session.agents.map((a) => a.id),
        ["current:main"],
      );
    }
  },
);
