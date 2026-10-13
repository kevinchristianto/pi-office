"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const quotePowerShell = (value) =>
  "'" +
  String(value).replace(/['\u2018-\u201b]/g, (quote) => quote + quote) +
  "'";

// Invoked only by the user's explicit Connect Pi action. This exports the
// unchanged observer; it never executes Pi or alters its persistent settings.
async function prepareObserverConnection({
  officeDirectory,
  userData,
  tokenFile,
  port,
}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid port");
  for (const value of [
    officeDirectory,
    userData,
    ...(tokenFile ? [tokenFile] : []),
  ]) {
    if (!path.isAbsolute(value) || /[\r\n\0]/.test(value))
      throw new Error("Invalid connection path");
  }
  const root = await fs.realpath(userData);
  let directory = root;
  for (const segment of ["observer", "extension"]) {
    directory = path.join(directory, segment);
    let stat = await fs.lstat(directory).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat) {
      await fs.mkdir(directory).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
      stat = await fs.lstat(directory);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("Unsafe observer directory");
  }
  const realDirectory = await fs.realpath(directory);
  const relative = path.relative(root, realDirectory);
  if (
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  )
    throw new Error("Unsafe observer directory");
  const observer = path.join(realDirectory, "pi-office.ts");
  const source = await fs.readFile(
    path.join(officeDirectory, "extension", "pi-office.ts"),
  );
  // Reject a pre-existing symlink rather than following it outside app data.
  const previous = await fs.lstat(observer).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (previous && (!previous.isFile() || previous.isSymbolicLink()))
    throw new Error("Unsafe observer path");
  const temporary = path.join(realDirectory, `.observer-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, source, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, observer);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  const command = [
    ...(tokenFile
      ? [
          "Remove-Item Env:PI_OFFICE_TOKEN -ErrorAction SilentlyContinue",
          `$env:PI_OFFICE_TOKEN_FILE=${quotePowerShell(tokenFile)}`,
        ]
      : []),
    `$env:PI_OFFICE_URL=${quotePowerShell(`http://127.0.0.1:${port}`)}`,
    `pi -e ${quotePowerShell(observer)}`,
  ].join("; ");
  return { observer, command };
}
module.exports = { prepareObserverConnection, quotePowerShell };
