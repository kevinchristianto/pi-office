"use strict";

const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const {
  createConfiguration,
  validatePortableCompilerOptions,
} = require("./packaging/config.cjs");

// Use npm's own JavaScript entry point to avoid shell quoting on Windows.
function buildProject(cwd) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli)
    throw new Error("Run this build with npm run package:win from desktop/.");
  const result = spawnSync(process.execPath, [npmCli, "run", "build"], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build failed in ${cwd}`);
}

async function main() {
  buildProject(path.resolve(__dirname, ".."));
  buildProject(__dirname);
  const { build, Platform, Arch } = require("electron-builder");
  let compilerVerified = false;
  const artifacts = await build({
    projectDir: __dirname,
    targets: Platform.WINDOWS.createTarget("portable", Arch.x64),
    config: createConfiguration(__dirname),
    // Never publish, even when run in CI with release credentials present.
    publish: "never",
    effectiveOptionComputed: async (options) => {
      compilerVerified =
        validatePortableCompilerOptions(options) || compilerVerified;
      return false;
    },
  });
  assert(compilerVerified, "NSIS portable compiler options were not verified");
  const { verifyPackage } = require("./packaging/verify.cjs");
  console.log(
    JSON.stringify(
      await verifyPackage({ desktopDir: __dirname, artifacts }),
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildProject, main };
