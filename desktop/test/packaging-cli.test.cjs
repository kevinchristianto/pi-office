"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packagingDir = path.resolve(__dirname, "../packaging");
const cliPath = path.join(packagingDir, "cli.cjs");

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, `Unexpected signal: ${result.signal}`);
  return result;
}

function runJob(body) {
  return runNode([
    "-e",
    `const { runCli } = require(${JSON.stringify(cliPath)});
     runCli(${body});`,
  ]);
}

test("packaging CLI waits for successful asynchronous work and exits zero", () => {
  const result = runJob(`async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    console.log("completed-successfully");
  }`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "completed-successfully");
  assert.equal(result.stderr, "");
});

test("packaging CLI reports synchronous failures and exits nonzero", () => {
  const result = runJob(`() => {
    throw new Error("synchronous-packaging-failure");
  }`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /synchronous-packaging-failure/);
  assert.equal(result.stdout, "");
});

for (const hook of ["beforeExit", "exit"]) {
  test(`packaging CLI rejection stays nonzero despite the ${hook} reset hook`, () => {
    const result = runJob(`async () => {
      process.on(${JSON.stringify(hook)}, () => { process.exitCode = 0; });
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("asynchronous-packaging-failure");
    }`);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /asynchronous-packaging-failure/);
    assert.equal(result.stdout, "");
  });
}

test("standalone verifier fails closed without fabricating a report or checksum", async (t) => {
  const desktopDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pi-office-verifier-cli-test-"),
  );
  t.after(() => fs.rm(desktopDir, { recursive: true, force: true }));
  const fixturePackaging = path.join(desktopDir, "packaging");
  const releaseDir = path.join(desktopDir, "release");
  await fs.mkdir(fixturePackaging);
  await fs.mkdir(releaseDir);
  for (const file of ["verify.cjs", "cli.cjs", "config.cjs"]) {
    await fs.copyFile(
      path.join(packagingDir, file),
      path.join(fixturePackaging, file),
    );
  }
  await fs.writeFile(
    path.join(desktopDir, "package.json"),
    JSON.stringify({
      name: "pi-office-companion",
      version: "0.2.0",
      main: "main.cjs",
    }),
  );
  const executable = path.join(
    releaseDir,
    "Pi-Office-0.2.0-win-x64-portable.exe",
  );
  await fs.writeFile(executable, Buffer.alloc(80));
  const resetHook = path.join(desktopDir, "reset-exit.cjs");
  await fs.writeFile(
    resetHook,
    'process.on("beforeExit", () => { process.exitCode = 0; });\n' +
      'process.on("exit", () => { process.exitCode = 0; });\n',
  );

  const result = runNode([
    "--require",
    resetHook,
    path.join(fixturePackaging, "verify.cjs"),
  ]);

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Missing DOS header/);
  assert.equal(result.stdout, "");
  await assert.rejects(
    fs.access(path.join(releaseDir, "package-verification.json")),
    { code: "ENOENT" },
  );
  await assert.rejects(fs.access(`${executable}.sha256`), { code: "ENOENT" });
});
