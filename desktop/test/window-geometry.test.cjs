"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  isResizePayload,
  clampBounds,
  createGeometryStore,
  GEOMETRY_FILENAME,
  MAX_GEOMETRY_BYTES,
} = require("../window-geometry.cjs");

function storage(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pi-office-geometry-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, GEOMETRY_FILENAME);
  const timers = new Map();
  let id = 0;
  const store = createGeometryStore({
    directory,
    setTimer(fn, ms) {
      const key = ++id;
      timers.set(key, { fn, ms });
      return key;
    },
    clearTimer: (key) => timers.delete(key),
  });
  t.after(() => store.dispose());
  return { directory, filename, store, timers };
}
const bounds = { x: -200, y: 40, width: 600, height: 360 };

test("geometry accepts only two positive safe integer data properties, never accessors", () => {
  assert.equal(isResizePayload({ width: 700, height: 350 }), true);
  assert.equal(
    isResizePayload({ width: Number.MAX_SAFE_INTEGER, height: 1 }),
    true,
  );
  const accessor = {
    height: 300,
    get width() {
      assert.fail("Must not evaluate accessor");
    },
  };
  assert.equal(isResizePayload(accessor), false);
  for (const value of [
    null,
    [],
    { width: 440, height: 260, x: 0 },
    { width: 440, height: 260, [Symbol("extra")]: 0 },
    Object.create({ width: 440, height: 260 }),
    { width: 10n, height: 300 },
    { width: NaN, height: 300 },
    { width: Infinity, height: 300 },
    { width: 0, height: 300 },
    { width: 400.5, height: 300 },
  ])
    assert.equal(isResizePayload(value), false);
});

test("geometry clamps dimensions and coordinates on tiny/negative-origin displays in DIP", () => {
  assert.deepEqual(
    clampBounds(
      { x: 9000, y: -9000, width: 10000, height: 10000 },
      { x: -5000, y: -100, width: 5000, height: 3000 },
    ),
    { x: -4096, y: -100, width: 4096, height: 2160 },
  );
  assert.deepEqual(
    clampBounds(
      { x: 0, y: 0, width: 1, height: 1 },
      { x: -300, y: 20, width: 300, height: 200 },
    ),
    { x: -300, y: 20, width: 300, height: 200 },
  );
  for (const invalid of [
    null,
    {},
    { ...bounds, x: Infinity },
    { ...bounds, x: 1000001 },
    { ...bounds, width: 0 },
    { ...bounds, height: 500.5 },
  ])
    assert.throws(() =>
      clampBounds(invalid, { x: 0, y: 0, width: 1200, height: 800 }),
    );
});

test("geometry persistence debounces repeated moves and flushes just the last geometry", (t) => {
  const f = storage(t);
  assert.equal(f.store.load(), null);
  for (let i = 0; i < 100; i++)
    f.store.save({ ...bounds, x: i, credentials: "must never persist" });
  assert.equal(fs.existsSync(f.filename), false);
  assert.equal(f.timers.size, 1);
  const timer = [...f.timers.values()][0];
  assert.equal(timer.ms, 1000);
  timer.fn();
  assert.equal(f.timers.size, 0);
  const data = JSON.parse(fs.readFileSync(f.filename, "utf8"));
  assert.deepEqual(data, { version: 1, bounds: { ...bounds, x: 99 } });
  assert.deepEqual(fs.readdirSync(f.directory), [GEOMETRY_FILENAME]);
  assert(fs.statSync(f.filename).size < MAX_GEOMETRY_BYTES);
  assert.deepEqual(f.store.load(), { ...bounds, x: 99 });
});

test("geometry close flushes pending data and teardown forbids later writes", (t) => {
  const f = storage(t);
  f.store.save(bounds);
  f.store.dispose();
  assert.equal(f.timers.size, 0);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(f.filename, "utf8")).bounds,
    bounds,
  );
  f.store.save({ ...bounds, width: 800 });
  f.store.dispose();
  assert.equal(f.timers.size, 0);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(f.filename, "utf8")).bounds,
    bounds,
  );
});

test("geometry reads fail closed for malformed, huge, unsafe or version-mismatched data", (t) => {
  const f = storage(t);
  for (const data of [
    "",
    "not JSON",
    "null",
    "[]",
    "{}",
    "x".repeat(MAX_GEOMETRY_BYTES + 1),
    JSON.stringify({ version: 2, bounds }),
    JSON.stringify({
      version: 1,
      bounds: { ...bounds, width: Number.MAX_SAFE_INTEGER },
    }),
    JSON.stringify({ version: 1, bounds: { ...bounds, x: 1000001 } }),
    JSON.stringify({ version: 1, bounds: { ...bounds, height: -1 } }),
    JSON.stringify({ version: 1, bounds: { ...bounds, y: "400" } }),
    JSON.stringify({ version: 1, bounds: { ...bounds, x: 2.5 } }),
    JSON.stringify({ version: 1, bounds: { ...bounds, width: null } }),
  ]) {
    fs.writeFileSync(f.filename, data);
    assert.equal(f.store.load(), null);
  }
  fs.writeFileSync(
    f.filename,
    JSON.stringify({ version: 1, bounds: { ...bounds, x: -9000 } }),
  );
  const stored = f.store.load();
  assert.deepEqual(
    clampBounds(stored, { x: 0, y: 0, width: 1200, height: 800 }),
    { ...bounds, x: 0 },
  );
});

test("geometry persistence atomically replaces the destination using a private bounded temp file", (t) => {
  const f = storage(t);
  const previous = JSON.stringify({ version: 1, bounds });
  fs.writeFileSync(f.filename, previous);
  const rename = fs.renameSync;
  let renamed = false;
  fs.renameSync = (source, destination) => {
    assert.equal(destination, f.filename);
    assert.equal(path.dirname(source), f.directory);
    assert.equal(fs.readFileSync(destination, "utf8"), previous);
    assert.deepEqual(JSON.parse(fs.readFileSync(source, "utf8")).bounds, {
      ...bounds,
      width: 900,
    });
    assert(fs.statSync(source).size < MAX_GEOMETRY_BYTES);
    if (process.platform !== "win32")
      assert.equal(fs.statSync(source).mode & 0o777, 0o600);
    renamed = true;
    return rename(source, destination);
  };
  try {
    f.store.save({ ...bounds, width: 900 });
    f.store.flush();
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(renamed, true);
  assert.deepEqual(fs.readdirSync(f.directory), [GEOMETRY_FILENAME]);
});

test("symlinked geometry is never read and atomic save does not overwrite its target", (t) => {
  const f = storage(t);
  const target = path.join(f.directory, "other.json");
  const original = JSON.stringify({ version: 1, bounds });
  fs.writeFileSync(target, original);
  try {
    fs.symlinkSync(target, f.filename);
  } catch (error) {
    if (error.code === "EPERM") return t.skip("Symlink creation unavailable");
    throw error;
  }
  assert.equal(f.store.load(), null);
  f.store.save({ ...bounds, x: 10 });
  f.store.flush();
  assert.equal(fs.readFileSync(target, "utf8"), original);
  assert.equal(fs.lstatSync(f.filename).isFile(), true);
});

test("inaccessible geometry destination is nonfatal and leaves no temporary files", (t) => {
  const f = storage(t);
  fs.mkdirSync(f.filename);
  assert.equal(f.store.load(), null);
  f.store.save(bounds);
  assert.doesNotThrow(() => f.store.flush());
  assert.deepEqual(fs.readdirSync(f.directory), [GEOMETRY_FILENAME]);
  assert.doesNotThrow(() => f.store.dispose());
  assert.throws(
    () => createGeometryStore({ directory: "relative" }),
    /absolute/,
  );
});
