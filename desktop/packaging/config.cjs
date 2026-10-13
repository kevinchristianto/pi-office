"use strict";

const path = require("node:path");
const assert = require("node:assert/strict");
const SHELL_FILES = Object.freeze([
  "bridge-runtime.cjs",
  "bridge-worker.cjs",
  "core.cjs",
  "main.cjs",
  "observer-connect.cjs",
  "preload.cjs",
  "window-geometry.cjs",
]);

function createConfiguration(desktopDir) {
  const root = path.resolve(desktopDir, "..");
  return {
    appId: "io.pi-office.desktop",
    productName: "Pi-Office",
    artifactName: "Pi-Office-${version}-win-x64-portable.${ext}",
    directories: { output: path.join(desktopDir, "release") },
    asar: true,
    npmRebuild: false,
    compression: "maximum",
    ...(process.env.electron_config_cache || process.env.ELECTRON_CACHE
      ? {
          electronDownload: {
            cache:
              process.env.electron_config_cache || process.env.ELECTRON_CACHE,
          },
        }
      : {}),
    files: [...SHELL_FILES, "package.json", "dist/**/*"],
    extraResources: [
      {
        from: path.join(root, "bridge"),
        to: "office/bridge",
        filter: ["server.mjs", "state.mjs", "README.md"],
      },
      { from: path.join(root, "dist"), to: "office/dist", filter: ["**/*"] },
      {
        from: path.join(root, "extension"),
        to: "office/extension",
        filter: ["**/*"],
      },
      {
        from: root,
        to: "office",
        filter: ["README.md", "QUICKSTART.txt", "THIRD_PARTY_NOTICES.md"],
      },
    ],
    win: {
      target: [{ target: "portable", arch: ["x64"] }],
      requestedExecutionLevel: "asInvoker",
      // Keep executable metadata and embedded ASAR integrity, without signing.
      signExecutable: false,
    },
    portable: {
      requestExecutionLevel: "user",
      // In pinned builder 26.15.3, true leaves UNPACK_DIR_NAME undefined,
      // selecting unique-per-launch $PLUGINSDIR. Despite the upstream docs,
      // false selects one fixed build ID and can delete a first launch's files.
      // package.cjs asserts the actual compiler defines before compilation.
      unpackDirName: true,
    },
    publish: null,
  };
}

function validatePortableCompilerOptions(options) {
  if (!Array.isArray(options) || !options[0]?.REQUEST_EXECUTION_LEVEL)
    return false;
  const [defines] = options;
  assert.equal(
    defines.REQUEST_EXECUTION_LEVEL,
    "user",
    "Portable bootstrap must not elevate",
  );
  assert(
    !Object.hasOwn(defines, "UNPACK_DIR_NAME"),
    "Portable must use a private extraction directory per launch",
  );
  assert(defines.APP_64, "Portable must embed an x64 application payload");
  return true;
}

module.exports = {
  SHELL_FILES,
  createConfiguration,
  validatePortableCompilerOptions,
};
