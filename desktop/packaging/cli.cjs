"use strict";
const { writeSync } = require("node:fs");

// Build tooling can register exit handlers. Fail closed after all earlier
// handlers, rather than letting them mask a rejected verification as success.
function runCli(job) {
  return Promise.resolve()
    .then(job)
    .catch((error) => {
      try {
        writeSync(2, `${error?.stack || error?.message || String(error)}\n`);
      } finally {
        process.on("exit", () => {
          process.exitCode = 1;
        });
        process.exit(1);
      }
    });
}
module.exports = { runCli };
