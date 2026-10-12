"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadLabels() {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "src/model.ts"),
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, {
    exports,
    require(name) {
      assert.equal(name, "../../src/projectProjection");
      // This audit exercises the pure label lookup, not grouping (covered separately).
      return {};
    },
  });
  return exports.stateLabel;
}

test("audit: all unknown bridge state values stay plain text, including prototype property names", () => {
  const label = loadLabels();
  for (const state of [
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "prototype",
    "<script>x</script>",
    "unknown",
  ]) {
    assert.equal(label(state), "Unknown state", state);
  }
  assert.equal(label("working"), "Working");
  assert.equal(label("offline"), "Offline");
});
