"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { crc32 } = require("node:zlib");
const {
  createConfiguration,
  validatePortableCompilerOptions,
} = require("../packaging/config.cjs");
const {
  asarFiles,
  embeddedArchive,
  identicalTree,
  readPE,
  verifyAppMetadata,
} = require("../packaging/verify.cjs");

test("package targets a single x64 portable EXE without publishing or elevation", () => {
  const config = createConfiguration(path.resolve(__dirname, ".."));
  assert.deepEqual(config.win.target, [{ target: "portable", arch: ["x64"] }]);
  assert.equal(config.portable.requestExecutionLevel, "user");
  assert.equal(config.win.requestedExecutionLevel, "asInvoker");
  assert.equal(config.portable.unpackDirName, true);
  assert.equal(config.win.signExecutable, false);
  assert.equal(config.publish, null);
  assert.match(config.artifactName, /win-x64-portable/);
});

test("NSIS compiler verification enforces per-launch extraction, x64 and no elevation", () => {
  assert.equal(validatePortableCompilerOptions({}), false);
  const valid = { REQUEST_EXECUTION_LEVEL: "user", APP_64: "payload.7z" };
  assert.equal(validatePortableCompilerOptions([valid, {}]), true);
  assert.throws(
    () =>
      validatePortableCompilerOptions([
        { ...valid, UNPACK_DIR_NAME: "fixed" },
        {},
      ]),
    /private extraction/,
  );
  assert.throws(
    () =>
      validatePortableCompilerOptions([
        { ...valid, REQUEST_EXECUTION_LEVEL: "admin" },
        {},
      ]),
    /must not elevate/,
  );
  assert.throws(
    () =>
      validatePortableCompilerOptions([
        { REQUEST_EXECUTION_LEVEL: "user" },
        {},
      ]),
    /x64 application/,
  );
});

test("package includes shell helpers, separate web office, bridge, observer and notices", () => {
  const config = createConfiguration(path.resolve(__dirname, ".."));
  assert(config.files.includes("*.cjs"));
  assert(config.files.includes("!package.cjs"));
  assert(config.files.includes("dist/**/*"));
  assert(!config.files.includes("**/*"));
  assert.deepEqual(
    config.extraResources.map((entry) => entry.to),
    ["office/bridge", "office/dist", "office/extension", "office"],
  );
  assert(config.extraResources[0].filter.includes("server.mjs"));
  assert(config.extraResources[0].filter.includes("state.mjs"));
  assert(config.extraResources[3].filter.includes("THIRD_PARTY_NOTICES.md"));
});

test("PE inspection rejects non-executables and detects x64 payload", () => {
  assert.throws(() => readPE(Buffer.alloc(80)), /Missing DOS header/);
  const bytes = Buffer.alloc(256);
  bytes.write("MZ");
  bytes.writeUInt32LE(64, 0x3c);
  bytes.write("PE\0\0", 64);
  bytes.writeUInt16LE(0x8664, 68);
  bytes.writeUInt16LE(112, 84);
  bytes.writeUInt16LE(0x20b, 88);
  assert.deepEqual(readPE(bytes), { machine: 0x8664, optionalMagic: 0x20b });
  assert.throws(() => readPE(bytes.subarray(0, 85)), /Truncated PE header/);
});

test("ASAR inspection inventories nested files", () => {
  assert.deepEqual(
    asarFiles({
      files: { "main.cjs": {}, dist: { files: { "index.html": {} } } },
    }),
    ["dist/index.html", "main.cjs"],
  );
});

test("ASAR metadata preserves identity, version and entry point without dependencies", () => {
  const metadata = {
    name: "pi-office-companion",
    version: "0.2.0",
    main: "main.cjs",
  };
  verifyAppMetadata(metadata, { ...metadata, dependencies: {} });
  for (const field of ["name", "version", "main"]) {
    assert.throws(
      () => verifyAppMetadata(metadata, { ...metadata, [field]: "changed" }),
      /metadata differs/,
    );
  }
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    assert.throws(
      () =>
        verifyAppMetadata(metadata, {
          ...metadata,
          [field]: { example: "1.0.0" },
        }),
      /must not ship/,
    );
  }
});

test("embedded payload detection validates header bounds and CRCs", () => {
  const archive = Buffer.alloc(36);
  Buffer.from("377abcaf271c", "hex").copy(archive);
  archive.writeBigUInt64LE(4n, 20);
  archive.write("test", 32);
  archive.writeUInt32LE(crc32(archive.subarray(32)), 28);
  archive.writeUInt32LE(crc32(archive.subarray(12, 32)), 8);
  assert.deepEqual(
    embeddedArchive(Buffer.concat([Buffer.alloc(100), archive])),
    archive,
  );
  archive[35] = 0;
  assert.throws(() => embeddedArchive(archive), /No intact embedded/);
  assert.throws(
    () => embeddedArchive(archive.subarray(0, 8)),
    /No intact embedded/,
  );
});

test("resource verification detects changed, missing and extra assets", async (t) => {
  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "pi-office-package-test-"),
  );
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, "source");
  const target = path.join(temp, "target");
  for (const folder of [source, target]) {
    await fs.mkdir(path.join(folder, "models"), { recursive: true });
    await fs.writeFile(
      path.join(folder, "models", "agent.glb"),
      Buffer.from([1, 2, 3]),
    );
  }
  assert.equal(await identicalTree(source, target), 1);
  await fs.writeFile(path.join(target, "models", "agent.glb"), "changed");
  await assert.rejects(identicalTree(source, target), /Packaged asset differs/);
  await fs.writeFile(path.join(target, "extra"), "unexpected");
  await assert.rejects(identicalTree(source, target), /Asset list differs/);
  await fs.rm(path.join(target, "extra"));
  await fs.rm(path.join(target, "models", "agent.glb"));
  await assert.rejects(identicalTree(source, target), /Asset list differs/);
});

test("ASAR reads convert portable inventory paths for the real Windows lookup algorithm", async () => {
  const vm = require("node:vm");
  const { createRequire } = require("node:module");
  const { nativeArchivePath } = require("../packaging/verify.cjs");
  const modulePath = require.resolve("app-builder-lib/out/asar/asar.js");
  const source = await fs.readFile(modulePath, "utf8");
  const localRequire = createRequire(modulePath);
  for (const pathApi of [path.win32, path.posix]) {
    const exports = {};
    vm.runInNewContext(source, {
      exports,
      require: (name) => (name === "path" ? pathApi : localRequire(name)),
      Buffer,
    });
    const leaf = { size: 0, offset: "0" };
    const archive = new exports.AsarFilesystem("fixture.asar", {
      files: { dist: { files: { assets: { files: { "index.css": leaf } } } } },
    });
    if (pathApi === path.win32)
      assert.throws(
        () => archive.getFile("dist/assets/index.css"),
        /Cannot find node/,
      );
    assert.equal(
      archive.getFile(nativeArchivePath("dist/assets/index.css", pathApi)),
      leaf,
    );
    assert.deepEqual(
      await archive.readFile(
        nativeArchivePath("dist/assets/index.css", pathApi),
      ),
      Buffer.alloc(0),
    );
  }
  assert.equal(nativeArchivePath("main.cjs", path.win32), "main.cjs");
  for (const bad of [
    "../secret",
    "/absolute",
    "dist//file",
    "dist\\file",
    "dist/./file",
    "dist/../file",
  ])
    assert.throws(() => nativeArchivePath(bad));
});
