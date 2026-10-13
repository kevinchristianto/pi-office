"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// Electron bounds and screen.workArea are both device-independent pixels.
// Never multiply either by display.scaleFactor or devicePixelRatio.
const MIN_SIZE = Object.freeze({ width: 440, height: 260 });
const MAX_SIZE = Object.freeze({ width: 4096, height: 2160 });
const MAX_POSITION = 1_000_000;
const MAX_GEOMETRY_BYTES = 2048;
const GEOMETRY_FILENAME = "companion-window.json";
const RESIZE_INTERVAL_MS = 50;

const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const dimension = (value) => Number.isSafeInteger(value) && value > 0;

function isResizePayload(value) {
  if (!record(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("width") || !keys.includes("height"))
    return false;
  // Accept data only, never evaluate user-supplied accessor properties.
  return ["width", "height"].every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor &&
      Object.hasOwn(descriptor, "value") &&
      dimension(descriptor.value)
    );
  });
}

function validBounds(value) {
  return (
    record(value) &&
    ["x", "y"].every(
      (key) =>
        Number.isSafeInteger(value[key]) &&
        Math.abs(value[key]) <= MAX_POSITION,
    ) &&
    dimension(value.width) &&
    dimension(value.height)
  );
}

function clampBounds(bounds, workArea) {
  if (!validBounds(bounds) || !validBounds(workArea))
    throw new Error("Invalid window geometry");
  const width = Math.min(
    MAX_SIZE.width,
    workArea.width,
    Math.max(MIN_SIZE.width, bounds.width),
  );
  const height = Math.min(
    MAX_SIZE.height,
    workArea.height,
    Math.max(MIN_SIZE.height, bounds.height),
  );
  return {
    x: Math.max(
      workArea.x,
      Math.min(bounds.x, workArea.x + workArea.width - width),
    ),
    y: Math.max(
      workArea.y,
      Math.min(bounds.y, workArea.y + workArea.height - height),
    ),
    width,
    height,
  };
}

function storedBounds(value) {
  if (
    !validBounds(value) ||
    value.width > MAX_SIZE.width ||
    value.height > MAX_SIZE.height
  )
    return null;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

// A tiny geometry-only file; all paths originate in main, never renderer IPC.
// Synchronous I/O is bounded and happens only at startup, after a quiet second,
// or on close. Atomic rename prevents a partial JSON file after interruption.
function createGeometryStore({
  directory,
  debounceMs = 1000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  if (typeof directory !== "string" || !path.isAbsolute(directory))
    throw new Error("Geometry directory must be absolute");
  const filename = path.join(directory, GEOMETRY_FILENAME);
  let timer = null;
  let pending = null;
  let saved = null;
  let disposed = false;
  function load() {
    let fd;
    try {
      if (!fs.lstatSync(filename).isFile()) return null;
      fd = fs.openSync(
        filename,
        fs.constants.O_RDONLY |
          (fs.constants.O_NOFOLLOW || 0) |
          (fs.constants.O_NONBLOCK || 0),
      );
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_GEOMETRY_BYTES)
        return null;
      const bytes = Buffer.alloc(MAX_GEOMETRY_BYTES + 1);
      const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (count > MAX_GEOMETRY_BYTES) return null;
      const data = JSON.parse(bytes.subarray(0, count).toString("utf8"));
      const bounds = data?.version === 1 ? storedBounds(data.bounds) : null;
      if (bounds) saved = JSON.stringify(bounds);
      return bounds;
    } catch {
      return null;
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* Already closed or inaccessible. */
        }
      }
    }
  }
  function flush() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (!pending || JSON.stringify(pending) === saved) return;
    let temporary;
    try {
      fs.mkdirSync(directory, { recursive: true });
      temporary = path.join(
        directory,
        `.${GEOMETRY_FILENAME}.${randomUUID()}.tmp`,
      );
      fs.writeFileSync(
        temporary,
        `${JSON.stringify({ version: 1, bounds: pending })}\n`,
        { flag: "wx", mode: 0o600 },
      );
      fs.renameSync(temporary, filename);
      saved = JSON.stringify(pending);
      pending = null;
    } catch {
      // Read-only or removed app data must never prevent resize or shutdown.
    } finally {
      if (temporary) {
        try {
          fs.unlinkSync(temporary);
        } catch {
          /* Rename already removed it. */
        }
      }
    }
  }
  function save(value) {
    if (disposed) return;
    const bounds = storedBounds(value);
    if (!bounds) return;
    pending = bounds;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(flush, debounceMs);
    timer?.unref?.();
  }
  function dispose() {
    if (disposed) return;
    flush();
    disposed = true;
  }
  return { load, save, flush, dispose };
}

module.exports = {
  MIN_SIZE,
  MAX_SIZE,
  MAX_POSITION,
  MAX_GEOMETRY_BYTES,
  GEOMETRY_FILENAME,
  RESIZE_INTERVAL_MS,
  isResizePayload,
  clampBounds,
  createGeometryStore,
};
