"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { crc32 } = require("node:zlib");
const { createHash } = require("node:crypto");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fileList(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const child of await fileList(path.join(directory, entry.name)))
        files.push(`${entry.name}/${child}`);
    } else {
      assert(entry.isFile(), `Unexpected non-file asset: ${entry.name}`);
      files.push(entry.name);
    }
  }
  return files.sort();
}

async function identicalTree(source, target) {
  const files = await fileList(source);
  assert.deepEqual(
    await fileList(target),
    files,
    `Asset list differs: ${target}`,
  );
  for (const file of files) {
    assert.equal(
      sha256(await fs.readFile(path.join(target, file))),
      sha256(await fs.readFile(path.join(source, file))),
      `Packaged asset differs: ${file}`,
    );
  }
  return files.length;
}

function readPE(bytes) {
  assert(bytes.length >= 64, "Truncated DOS header");
  assert.equal(bytes.subarray(0, 2).toString(), "MZ", "Missing DOS header");
  const offset = bytes.readUInt32LE(0x3c);
  assert(offset + 24 <= bytes.length, "Truncated PE header");
  assert.equal(
    bytes.subarray(offset, offset + 4).toString(),
    "PE\0\0",
    "Missing PE signature",
  );
  const machine = bytes.readUInt16LE(offset + 4);
  const optionalSize = bytes.readUInt16LE(offset + 20);
  assert(
    offset + 24 + optionalSize <= bytes.length,
    "Truncated optional header",
  );
  return { machine, optionalMagic: bytes.readUInt16LE(offset + 24) };
}

function asarFiles(node, prefix = "") {
  return Object.entries(node.files || {})
    .flatMap(([name, child]) => {
      const file = `${prefix}${name}`;
      return child.files ? asarFiles(child, `${file}/`) : [file];
    })
    .sort();
}

function verifyAppMetadata(source, packaged) {
  for (const field of ["name", "version", "main"]) {
    assert.equal(
      packaged[field],
      source[field],
      `Packaged application metadata differs: ${field}`,
    );
  }
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    assert.equal(
      Object.keys(packaged[field] || {}).length,
      0,
      `Packaged application must not ship ${field}`,
    );
  }
}

function embeddedArchive(bytes) {
  const signature = Buffer.from("377abcaf271c", "hex");
  for (
    let offset = bytes.indexOf(signature);
    offset !== -1;
    offset = bytes.indexOf(signature, offset + 1)
  ) {
    if (offset + 32 > bytes.length) continue;
    if (
      crc32(bytes.subarray(offset + 12, offset + 32)) !==
      bytes.readUInt32LE(offset + 8)
    )
      continue;
    const nextOffset = bytes.readBigUInt64LE(offset + 12);
    const nextSize = bytes.readBigUInt64LE(offset + 20);
    const end = BigInt(offset + 32) + nextOffset + nextSize;
    if (end > BigInt(bytes.length)) continue;
    const nextStart = Number(BigInt(offset + 32) + nextOffset);
    if (
      crc32(bytes.subarray(nextStart, Number(end))) !==
      bytes.readUInt32LE(offset + 28)
    )
      continue;
    return bytes.subarray(offset, Number(end));
  }
  throw new Error(
    "No intact embedded 7z application payload found in portable EXE",
  );
}

async function verifyEmbeddedPayload(launcher, unpacked) {
  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "pi-office-exe-verify-"),
  );
  try {
    const archive = path.join(temp, "payload.7z");
    const extracted = path.join(temp, "payload");
    await fs.writeFile(archive, embeddedArchive(launcher));
    const { getPath7za } = require("app-builder-lib/out/toolsets/7zip.js");
    const result = spawnSync(
      await getPath7za(),
      ["x", archive, `-o${extracted}`, "-y", "-bd"],
      {
        encoding: "utf8",
        windowsHide: true,
      },
    );
    if (result.error) throw result.error;
    assert.equal(
      result.status,
      0,
      `Cannot extract embedded payload: ${result.stderr || result.stdout}`,
    );
    return await identicalTree(unpacked, extracted);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

// Inventory names use forward slashes on every host; app-builder-lib's ASAR
// lookup splits on the host path.sep, including Windows backslashes.
function nativeArchivePath(file, pathApi = path) {
  assert(
    typeof file === "string" && !file.includes("\\") && !file.includes("\0"),
    "Invalid archive path",
  );
  const parts = file.split("/");
  assert(
    parts.every((part) => part && part !== "." && part !== ".."),
    "Invalid archive path",
  );
  return parts.join(pathApi.sep);
}

async function verifyPackage({
  desktopDir = path.resolve(__dirname, ".."),
  artifacts,
} = {}) {
  const root = path.resolve(desktopDir, "..");
  const release = path.join(desktopDir, "release");
  const metadata = JSON.parse(
    await fs.readFile(path.join(desktopDir, "package.json"), "utf8"),
  );
  const executable = path.join(
    release,
    `Pi-Office-${metadata.version}-win-x64-portable.exe`,
  );
  if (artifacts)
    assert(
      artifacts.includes(executable),
      "Portable executable was not produced by this build",
    );
  const launcher = await fs.readFile(executable);
  const launcherPE = readPE(launcher);
  // NSIS uses an x86 bootstrap to unpack and launch an x64 Electron payload.
  assert.equal(
    launcherPE.machine,
    0x14c,
    "Unexpected NSIS bootstrap architecture",
  );
  const unpacked = path.join(release, "win-unpacked");
  const runtimePE = readPE(
    await fs.readFile(path.join(unpacked, "Pi-Office.exe")),
  );
  assert.equal(
    runtimePE.machine,
    0x8664,
    "Electron payload must be Windows x64",
  );
  assert.equal(
    runtimePE.optionalMagic,
    0x20b,
    "Electron payload must be PE32+",
  );
  const office = path.join(unpacked, "resources", "office");
  const webFiles = await identicalTree(
    path.join(root, "dist"),
    path.join(office, "dist"),
  );
  const extensionFiles = await identicalTree(
    path.join(root, "extension"),
    path.join(office, "extension"),
  );
  for (const file of ["server.mjs", "state.mjs", "README.md"]) {
    assert.equal(
      sha256(await fs.readFile(path.join(office, "bridge", file))),
      sha256(await fs.readFile(path.join(root, "bridge", file))),
      `Bridge differs: ${file}`,
    );
  }
  for (const file of [
    "README.md",
    "QUICKSTART.txt",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    assert.equal(
      sha256(await fs.readFile(path.join(office, file))),
      sha256(await fs.readFile(path.join(root, file))),
      `Notice differs: ${file}`,
    );
  }
  const { readAsar } = require("app-builder-lib/out/asar/asar.js");
  const asar = await readAsar(path.join(unpacked, "resources", "app.asar"));
  verifyAppMetadata(metadata, await asar.readJson("package.json"));
  const files = asarFiles(asar.header);
  const { SHELL_FILES } = require("./config.cjs");
  const shellFiles = [...SHELL_FILES].sort();
  const rendererFiles = (await fileList(path.join(desktopDir, "dist"))).map(
    (file) => `dist/${file}`,
  );
  assert.deepEqual(
    files,
    [...shellFiles, ...rendererFiles, "package.json"].sort(),
    "Unexpected or missing files in packaged application",
  );
  for (const file of [...shellFiles, ...rendererFiles]) {
    assert.equal(
      sha256(await asar.readFile(nativeArchivePath(file))),
      sha256(await fs.readFile(path.join(desktopDir, file))),
      `Packaged application differs: ${file}`,
    );
  }
  const embeddedPayloadFiles = await verifyEmbeddedPayload(launcher, unpacked);
  const report = {
    artifact: path.basename(executable),
    bytes: launcher.length,
    sha256: sha256(launcher),
    launcherArchitecture: "NSIS x86 bootstrap",
    runtimeArchitecture: "Windows x64 PE32+",
    webFiles,
    extensionFiles,
    shellFiles,
    rendererFiles: rendererFiles.length,
    embeddedPayloadFiles,
    packageContentsVerified: true,
    nativeWindowsExecutionVerified: false,
    signed: false,
  };
  await fs.writeFile(
    path.join(release, "package-verification.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await fs.writeFile(
    `${executable}.sha256`,
    `${report.sha256}  ${report.artifact}\n`,
  );
  return report;
}

if (require.main === module) {
  require("./cli.cjs").runCli(async () => {
    console.log(JSON.stringify(await verifyPackage(), null, 2));
  });
}

module.exports = {
  asarFiles,
  embeddedArchive,
  fileList,
  identicalTree,
  nativeArchivePath,
  readPE,
  verifyAppMetadata,
  verifyPackage,
};
