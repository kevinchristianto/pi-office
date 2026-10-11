import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stripTypeScriptTypes } from "node:module";
import { createStateStore } from "../bridge/state.mjs";

const source = await fs.readFile(
  new URL("../extension/pi-office.ts", import.meta.url),
  "utf8",
);
const {
  default: piOffice,
  normalizeProjectRoot,
  projectMetadata,
  resolveProjectMetadata,
} = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: "strip" })).toString("base64")}`
);
const exec = promisify(execFile);
const pause = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const git = (cwd, ...args) =>
  exec("git", ["-C", cwd, ...args], { timeout: 5000, maxBuffer: 64 * 1024 });
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "office-project-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return fs.realpath(directory);
}
async function repo(directory) {
  await fs.mkdir(directory, { recursive: true });
  await git(directory, "init", "--quiet");
  return directory;
}
function restoreEnv(t, entries) {
  const saved = Object.fromEntries(
    Object.keys(entries).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("actual Git worktree roots unify nested cwd and realpath aliases, never another clone/worktree", async (t) => {
  const dir = await temporary(t);
  const first = await repo(path.join(dir, "one", "same-name"));
  const nested = path.join(first, "src", "feature");
  await fs.mkdir(nested, { recursive: true });
  await git(
    first,
    "-c",
    "user.name=Project test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--allow-empty",
    "-m",
    "fixture",
    "--quiet",
  );
  const worktree = path.join(dir, "linked-worktree");
  await git(first, "worktree", "add", "--quiet", "--detach", worktree);
  await fs.mkdir(path.join(worktree, "subdirectory"));
  const clone = path.join(dir, "two", "same-name");
  await fs.mkdir(path.dirname(clone));
  await exec("git", ["clone", "--quiet", "--local", first, clone], {
    timeout: 5000,
  });
  const alias = path.join(dir, "alias");
  await fs.symlink(
    first,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  const root = await resolveProjectMetadata(first);
  assert.equal(root.kind, "git");
  assert.equal(root.root, normalizeProjectRoot(first));
  assert.deepEqual(await resolveProjectMetadata(nested), root);
  assert.deepEqual(
    await resolveProjectMetadata(path.join(alias, "src", "feature")),
    root,
  );
  const linked = await resolveProjectMetadata(worktree);
  assert.equal(linked.kind, "git");
  assert.notEqual(
    linked.id,
    root.id,
    "Git common-dir must not identify a project",
  );
  assert.deepEqual(
    await resolveProjectMetadata(path.join(worktree, "subdirectory")),
    linked,
  );
  const cloned = await resolveProjectMetadata(clone);
  assert.equal(cloned.name, root.name);
  assert.notEqual(
    cloned.id,
    root.id,
    "matching names/remotes must not merge distinct clones",
  );
});

test("ordinary directories use exact canonical cwd and unknown paths are isolated", async (t) => {
  const dir = await temporary(t);
  const first = path.join(dir, "one", "project");
  const second = path.join(dir, "two", "project");
  const nested = path.join(first, "nested");
  await fs.mkdir(nested, { recursive: true });
  await fs.mkdir(second, { recursive: true });
  const a = await resolveProjectMetadata(first);
  assert.equal(a.kind, "directory");
  assert.notEqual((await resolveProjectMetadata(nested)).id, a.id);
  assert.notEqual((await resolveProjectMetadata(second)).id, a.id);
  const alias = path.join(dir, "directory-alias");
  await fs.symlink(
    first,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.deepEqual(await resolveProjectMetadata(alias), a);
  const file = path.join(dir, "file");
  await fs.writeFile(file, "fixture");
  for (const unknown of [
    undefined,
    null,
    "",
    "relative/path",
    "C:relative",
    path.join(dir, "missing"),
    file,
    `${dir}\n`,
    "x".repeat(4097),
  ])
    assert.equal(await resolveProjectMetadata(unknown), null);
});

test("inherited Git repository/config overrides cannot redirect project discovery", async (t) => {
  const dir = await temporary(t);
  const first = await repo(path.join(dir, "first"));
  const second = await repo(path.join(dir, "second"));
  restoreEnv(t, {
    GIT_DIR: path.join(first, ".git"),
    GIT_WORK_TREE: first,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "*",
  });
  const actual = await resolveProjectMetadata(second);
  assert.equal(actual.kind, "git");
  assert.equal(actual.root, normalizeProjectRoot(second));
});

test("Git unavailable falls back to the canonical directory without altering trust settings", async (t) => {
  const dir = await temporary(t);
  const directory = await repo(path.join(dir, "repo"));
  restoreEnv(t, { PATH: path.join(dir, "no-executable-here") });
  const actual = await resolveProjectMetadata(directory);
  assert.equal(actual.kind, "directory");
  assert.equal(actual.root, normalizeProjectRoot(directory));
  assert.equal(
    actual.id,
    projectMetadata(directory, "git").id,
    "kind is descriptive, not part of root identity",
  );
});

test(
  "Git refusal, output overflow and timeout safely fall back; timeout kills even SIGTERM-resistant probes",
  { skip: process.platform === "win32", timeout: 10000 },
  async (t) => {
    const dir = await temporary(t);
    const bin = path.join(dir, "bin");
    const cwd = path.join(dir, "cwd");
    await fs.mkdir(bin);
    await fs.mkdir(cwd);
    const executable = path.join(bin, "git");
    restoreEnv(t, { PATH: bin });
    for (const body of [
      'process.stderr.write("fatal: detected dubious ownership in repository\\n"); process.exit(128);',
      'process.stdout.write("x".repeat(70 * 1024));',
      'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);',
    ]) {
      await fs.writeFile(executable, `#!${process.execPath}\n${body}\n`, {
        mode: 0o700,
      });
      const started = performance.now();
      const actual = await resolveProjectMetadata(cwd);
      assert.equal(actual.kind, "directory");
      assert.ok(
        performance.now() - started < 3000,
        "probe must finish within its bounded timeout",
      );
    }
    assert.doesNotMatch(
      source,
      /safe\.directory\s*=/,
      "observer never relaxes Git trust",
    );
  },
);

test("Windows pure fixtures normalize slash/namespace aliases and require filesystem identity before case folding", () => {
  const aliases = [
    "C:\\Work\\Project\\",
    "c:/work/project",
    "\\\\?\\C:\\Work\\Project",
  ];
  const first = projectMetadata(aliases[0], "git", "win32", "4:123");
  for (const alias of aliases)
    assert.equal(projectMetadata(alias, "git", "win32", "4:123").id, first.id);
  assert.notEqual(
    projectMetadata("C:/Work/Project", "git", "win32", "4:123").id,
    projectMetadata("C:/work/project", "git", "win32", "4:124").id,
  );
  assert.notEqual(
    projectMetadata("C:/Work/Project", "git", "win32").id,
    projectMetadata("C:/work/project", "git", "win32").id,
  );
  assert.equal(
    projectMetadata("\\\\Server\\Share\\Repo\\", "git", "win32", "5:12").id,
    projectMetadata("\\\\?\\UNC\\server\\share\\repo", "git", "win32", "5:12")
      .id,
  );
  assert.equal(normalizeProjectRoot("C:\\", "win32"), "C:/");
  for (const invalid of [
    "C:relative",
    "\\only-rooted",
    "//server",
    "//./device",
    "relative",
    "C:/project\n",
  ])
    assert.equal(normalizeProjectRoot(invalid, "win32"), null);
  assert.notEqual(
    projectMetadata("/Work/Project", "git", "linux").id,
    projectMetadata("/work/project", "git", "linux").id,
  );
  assert.notEqual(
    projectMetadata("/work/with\\slash", "directory", "linux").id,
    projectMetadata("/work/with/slash", "directory", "linux").id,
  );
});

test("bridge validates project identity, keeps sessions/agent IDs separate and supports legacy omission/explicit clearing", () => {
  const store = createStateStore();
  const project = projectMetadata("/work/project", "git", "linux");
  const ingest = (id, patch = {}) =>
    store.upsert({
      version: 1,
      session: {
        id,
        cwd: "/raw/alias/src",
        agents: [{ id: `${id}:main`, state: "working" }],
        ...patch,
      },
    });
  ingest("first", { project });
  ingest("second", { project });
  assert.equal(store.snapshot().sessions.length, 2);
  assert.deepEqual(
    store.snapshot().sessions.map((s) => s.id),
    ["first", "second"],
  );
  assert.deepEqual(
    store.snapshot().sessions.map((s) => s.agents[0].id),
    ["first:main", "second:main"],
  );
  assert.equal(store.snapshot().sessions[0].cwd, "/raw/alias/src");
  ingest("first");
  assert.deepEqual(store.snapshot().sessions[0].project, project);
  for (const invalid of [
    { ...project, id: `project:${"0".repeat(64)}` },
    { ...project, root: "relative" },
    { ...project, root: "/work/../project" },
    { ...project, root: `${project.root}\n` },
    { ...project, root: `/${"x".repeat(4096)}` },
    { ...project, kind: "remote" },
    { ...project, platform: "unknown" },
    { ...project, filesystemId: "1:2" },
    null,
  ]) {
    ingest("first", { project: invalid });
    assert.equal(store.snapshot().sessions[0].project, null);
  }
  ingest("legacy");
  assert.equal(Object.hasOwn(store.snapshot().sessions[2], "project"), false);
  const windows = projectMetadata("C:/Work/Project", "git", "win32", "123:456");
  ingest("windows", { project: windows });
  assert.deepEqual(store.snapshot().sessions[3].project, windows);
  ingest("windows", { project: { ...windows, filesystemId: "123:457" } });
  assert.equal(
    store.snapshot().sessions[3].project,
    null,
    "filesystem ID must match the digest",
  );
});

function observer(t) {
  restoreEnv(t, {
    PI_OFFICE_TOKEN: "project-tests-only-token-0123456789",
    PI_OFFICE_URL: "http://127.0.0.1:4317",
    PI_OFFICE_TOKEN_FILE: "/not-read-test-token-from-env",
  });
  const previous = globalThis.fetch;
  const payloads = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/api/ingest")) payloads.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({ version: 1, capabilities: { readOnly: true } }),
    };
  };
  const handlers = new Map();
  const bus = new Map();
  const emit = (name, data) => {
    for (const callback of bus.get(name) || []) callback(data);
  };
  piOffice({
    on: (name, handler) => handlers.set(name, handler),
    events: {
      on(name, callback) {
        if (!bus.has(name)) bus.set(name, new Set());
        bus.get(name).add(callback);
        return () => bus.get(name)?.delete(callback);
      },
      emit(name, data) {
        if (name === "subagents:rpc:v1:request")
          queueMicrotask(() =>
            emit(`subagents:rpc:v1:reply:${data.requestId}`, {
              version: 1,
              success: true,
              data:
                data.method === "ping"
                  ? {
                      capabilities: {},
                      events: { childStatus: "subagent:child-status" },
                    }
                  : {},
            }),
          );
        emit(name, data);
      },
    },
  });
  const event = (name, data, cwd, id) =>
    handlers.get(name)?.(data, {
      cwd,
      isIdle: () => true,
      sessionManager: { getSessionId: () => id, getBranch: () => [] },
    });
  t.after(async () => {
    await event("session_shutdown", {});
    globalThis.fetch = previous;
  });
  return { event, emit, payloads };
}

test("observer new/reload/missing session IDs retain stable project metadata and untouched raw cwd", async (t) => {
  const dir = await temporary(t);
  const root = await repo(path.join(dir, "repo"));
  const nested = path.join(root, "nested");
  await fs.mkdir(nested);
  const f = observer(t);
  let stable;
  const seen = [];
  for (const [reason, id, cwd] of [
    ["startup", "root-one", root],
    ["reload", "root-one", nested],
    ["new", "root-two", nested],
    ["reload", undefined, root],
    ["reload", undefined, nested],
  ]) {
    await f.event("session_start", { reason }, cwd, id);
    await pause();
    const actual = f.payloads.at(-1).session;
    stable ||= actual.project;
    assert.deepEqual(actual.project, stable);
    assert.equal(actual.cwd, cwd);
    assert.equal(actual.agents[0].id, `${actual.id}:main`);
    if (id) assert.equal(actual.id, id);
    seen.push(actual);
  }
  assert.notEqual(
    seen[3].id,
    seen[4].id,
    "missing-ID sessions remain distinct transport observations",
  );
  await f.event("session_start", { reason: "new" }, undefined, "unknown");
  await pause();
  assert.equal(f.payloads.at(-1).session.project, null);
});

test("explicit children keep their parent's project and bridge retains raw lifecycle/session identities", async (t) => {
  const dir = await temporary(t);
  const root = await repo(path.join(dir, "parent"));
  const elsewhere = await repo(path.join(dir, "other-project"));
  const f = observer(t);
  await f.event("session_start", { reason: "startup" }, root, "parent-session");
  await pause();
  f.emit("subagent:child-status", {
    type: "subagent.child-status",
    version: 1,
    sessionId: "parent-session",
    runId: "run",
    childId: "child",
    agent: "Scout",
    status: "started",
    ts: Date.now(),
    cwd: elsewhere,
  });
  await pause();
  const parent = f.payloads.at(-1);
  assert.equal(parent.session.agents.length, 2);
  const child = parent.session.agents.find((a) => a.role === "subagent");
  assert.ok(child.id.startsWith("parent-session:"));
  assert.equal(child.lifecycle.kind, "start");
  assert.equal(parent.session.project.root, normalizeProjectRoot(root));
  const store = createStateStore();
  store.upsert(parent);
  // An independently observed process is another root session, not a guessed
  // alias of a parent-reported child, even if its cwd is the same project.
  await f.event(
    "session_start",
    { reason: "startup" },
    root,
    "independent-session",
  );
  await pause();
  store.upsert(f.payloads.at(-1));
  const sessions = store.snapshot().sessions;
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].project.id, sessions[1].project.id);
  assert.deepEqual(
    sessions[0].agents.map((a) => a.id),
    parent.session.agents.map((a) => a.id),
  );
  assert.deepEqual(
    sessions[0].agents.map((a) => a.lifecycle),
    parent.session.agents.map((a) => a.lifecycle),
  );
  assert.equal(sessions[1].agents[0].id, "independent-session:main");
  assert.notEqual(
    sessions[1].agents[0].lifecycle.eventId,
    sessions[0].agents[0].lifecycle.eventId,
  );
});

test(
  "shutdown during pending project discovery cannot revive the observer",
  { skip: process.platform === "win32" },
  async (t) => {
    const dir = await temporary(t);
    const bin = path.join(dir, "bin");
    await fs.mkdir(bin);
    await fs.writeFile(
      path.join(bin, "git"),
      `#!${process.execPath}\nsetTimeout(() => process.stdout.write(process.argv[3] + "\\n"), 200);\n`,
      { mode: 0o700 },
    );
    restoreEnv(t, { PATH: bin });
    const f = observer(t);
    const starting = f.event(
      "session_start",
      { reason: "startup" },
      dir,
      "starting",
    );
    await pause(50);
    await f.event("session_shutdown", { reason: "quit" });
    await starting;
    await pause();
    assert.equal(f.payloads.length, 0);
  },
);
