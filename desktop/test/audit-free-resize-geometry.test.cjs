"use strict";

// Independent audit: real filesystem boundaries and pure DIP geometry only.
// This does not launch Electron, a browser, or any listening socket.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  MIN_SIZE,
  MAX_SIZE,
  MAX_GEOMETRY_BYTES,
  GEOMETRY_FILENAME,
  isResizePayload,
  clampBounds,
  createGeometryStore,
} = require("../window-geometry.cjs");

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "resize-audit-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function clock() {
  let sequence = 0;
  const callbacks = new Map();
  return {
    callbacks,
    setTimer(fn) {
      const id = ++sequence;
      callbacks.set(id, fn);
      return id;
    },
    clearTimer(id) {
      callbacks.delete(id);
    },
    flush() {
      for (const [id, callback] of [...callbacks]) {
        callbacks.delete(id);
        callback();
      }
    },
  };
}

test("resize audit: payload is exactly two own integer data fields without evaluating accessors", () => {
  assert.equal(isResizePayload({ width: 440, height: 260 }), true);
  assert.equal(
    isResizePayload({ width: Number.MAX_SAFE_INTEGER, height: 1 }),
    true,
  );
  for (const value of [
    null,
    undefined,
    true,
    "640",
    [],
    [640, 380],
    {},
    { width: 640 },
    { height: 380 },
    { width: 640, height: 380, x: 0 },
    Object.create({ width: 640, height: 380 }),
    { width: 640, height: 380, [Symbol("extra")]: true },
  ]) {
    assert.equal(isResizePayload(value), false);
  }
  for (const value of [
    NaN,
    Infinity,
    -Infinity,
    0,
    -1,
    1.2,
    Number.MAX_SAFE_INTEGER + 1,
    "640",
    640n,
    null,
    {},
    [],
  ]) {
    assert.equal(isResizePayload({ width: value, height: 380 }), false);
    assert.equal(isResizePayload({ width: 640, height: value }), false);
  }
  let reads = 0;
  for (const field of ["width", "height"]) {
    const value = { width: 640, height: 380 };
    Object.defineProperty(value, field, {
      get() {
        reads++;
        throw new Error("must not read");
      },
    });
    assert.equal(isResizePayload(value), false);
  }
  assert.equal(reads, 0);
});

test("resize audit: negative and tiny monitor work areas remain completely reachable", () => {
  const areas = [
    { x: -1920, y: -1080, width: 1920, height: 1040 },
    { x: -3840, y: 120, width: 2560, height: 1440 },
    { x: 320, y: -2600, width: 3840, height: 2160 },
    { x: -330, y: -250, width: 330, height: 250 },
    { x: 0, y: 0, width: 1, height: 1 },
    { x: 12000, y: 2000, width: 7000, height: 5000 },
  ];
  for (const area of areas) {
    for (const width of [
      1,
      439,
      440,
      641,
      4096,
      100000,
      Number.MAX_SAFE_INTEGER,
    ]) {
      for (const height of [
        1,
        259,
        260,
        381,
        2160,
        100000,
        Number.MAX_SAFE_INTEGER,
      ]) {
        for (const sign of [-1, 0, 1]) {
          const bounds = { x: sign * 999999, y: -sign * 999999, width, height };
          const actual = clampBounds(bounds, area);
          assert.equal(
            actual.width,
            Math.min(
              area.width,
              MAX_SIZE.width,
              Math.max(MIN_SIZE.width, width),
            ),
          );
          assert.equal(
            actual.height,
            Math.min(
              area.height,
              MAX_SIZE.height,
              Math.max(MIN_SIZE.height, height),
            ),
          );
          assert(actual.x >= area.x && actual.y >= area.y);
          assert(actual.x + actual.width <= area.x + area.width);
          assert(actual.y + actual.height <= area.y + area.height);
          assert(Object.values(actual).every(Number.isSafeInteger));
          assert.deepEqual(clampBounds(actual, area), actual);
          assert.equal(bounds.width, width);
          assert.equal(bounds.height, height);
        }
      }
    }
  }
});

test("resize audit: geometry is DIP based and ignores unrelated scale factors", () => {
  const bounds = { x: -1100, y: 40, width: 641, height: 381 };
  for (const scaleFactor of [1, 1.25, 1.5, 1.75, 2, 3]) {
    const area = { x: -1280, y: 0, width: 1280, height: 720, scaleFactor };
    assert.deepEqual(clampBounds(bounds, area), bounds);
  }
});

test("resize audit: malformed monitor and restored geometry fail closed", () => {
  const good = { x: 0, y: 0, width: 800, height: 600 };
  for (const bad of [
    null,
    [],
    {},
    { ...good, x: 1000001 },
    { ...good, y: NaN },
    { ...good, x: 0.25 },
    { ...good, width: 0 },
    { ...good, height: Infinity },
  ]) {
    assert.throws(() => clampBounds(bad, good), /geometry/);
    assert.throws(() => clampBounds(good, bad), /geometry/);
  }
});

test("resize audit: persistence coalesces and projects only geometry into one private atomic file", (t) => {
  const directory = temporary(t);
  const timers = clock();
  const store = createGeometryStore({ directory, ...timers });
  t.after(() => store.dispose());
  const first = { x: -1400, y: 50, width: 641, height: 381 };
  const last = { x: -1350, y: 70, width: 801, height: 451 };
  for (let i = 0; i < 1000; i++) store.save(first);
  store.save({
    ...last,
    token: "must-not-save",
    snapshot: { secret: true },
    command: "quit",
  });
  assert.equal(timers.callbacks.size, 1);
  assert.deepEqual(fs.readdirSync(directory), []);
  timers.flush();
  assert.deepEqual(fs.readdirSync(directory), [GEOMETRY_FILENAME]);
  const filename = path.join(directory, GEOMETRY_FILENAME);
  const bytes = fs.readFileSync(filename, "utf8");
  assert.deepEqual(JSON.parse(bytes), { version: 1, bounds: last });
  assert(!/token|secret|snapshot|command/.test(bytes));
  assert(Buffer.byteLength(bytes) < MAX_GEOMETRY_BYTES);
  if (process.platform !== "win32")
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  assert.deepEqual(createGeometryStore({ directory }).load(), last);
  const stat = fs.statSync(filename);
  store.save(last);
  timers.flush();
  assert.equal(fs.statSync(filename).ino, stat.ino);
  store.dispose();
  store.save(first);
  assert.equal(timers.callbacks.size, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(filename, "utf8")).bounds, last);
});

test("resize audit: invalid, oversized, or non-geometry restore files are ignored", (t) => {
  const directory = temporary(t);
  const filename = path.join(directory, GEOMETRY_FILENAME);
  const store = createGeometryStore({ directory });
  const bounds = { x: -1500, y: 30, width: 640, height: 380 };
  for (const raw of [
    "",
    "{",
    "null",
    "[]",
    JSON.stringify({ version: 2, bounds }),
    JSON.stringify({ version: 1, bounds: { ...bounds, width: 4097 } }),
    JSON.stringify({ version: 1, bounds: { ...bounds, height: 2161 } }),
    JSON.stringify({ version: 1, bounds: { ...bounds, x: 1000001 } }),
    " ".repeat(MAX_GEOMETRY_BYTES + 1) + JSON.stringify({ version: 1, bounds }),
  ]) {
    fs.writeFileSync(filename, raw);
    assert.equal(store.load(), null);
  }
  fs.writeFileSync(
    filename,
    JSON.stringify({ version: 1, bounds, token: "ignored" }),
  );
  assert.deepEqual(store.load(), bounds);
  fs.rmSync(filename);
  fs.mkdirSync(filename);
  assert.equal(store.load(), null);
  store.save(bounds);
  assert.doesNotThrow(() => store.dispose());
  assert.deepEqual(fs.readdirSync(directory), [GEOMETRY_FILENAME]);
});

test("resize audit: a geometry-file symlink is never read or followed by atomic replacement", (t) => {
  if (process.platform === "win32") {
    t.skip(
      "Windows symlink setup can require privileges unavailable to this test",
    );
    return;
  }
  const directory = temporary(t);
  const target = path.join(directory, "unrelated.json");
  const bounds = { x: -800, y: 50, width: 640, height: 380 };
  const original = JSON.stringify({ version: 1, bounds, secret: "untouched" });
  fs.writeFileSync(target, original);
  const filename = path.join(directory, GEOMETRY_FILENAME);
  fs.symlinkSync(target, filename);
  const store = createGeometryStore({ directory });
  assert.equal(store.load(), null);
  store.save(bounds);
  store.dispose();
  assert.equal(fs.readFileSync(target, "utf8"), original);
  assert.equal(fs.lstatSync(filename).isSymbolicLink(), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(filename, "utf8")), {
    version: 1,
    bounds,
  });
  assert.deepEqual(
    fs.readdirSync(directory).sort(),
    [GEOMETRY_FILENAME, "unrelated.json"].sort(),
  );
});
