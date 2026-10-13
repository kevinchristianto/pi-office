"use strict";
// Independent URL-boundary regression audit. Windows path conversion uses
// Node's real windows:true option; this is not a native Electron/Windows test.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const url = require("node:url");

function platformCore(windows) {
  const module = { exports: {} };
  const filename = path.resolve(__dirname, "../core.cjs");
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
      URL,
      require(name) {
        if (name === "node:url") {
          return {
            ...url,
            fileURLToPath: (value) => url.fileURLToPath(value, { windows }),
          };
        }
        if (name === "node:path") return windows ? path.win32 : path.posix;
        return require(name);
      },
    },
    { filename },
  );
  return module.exports;
}

function sender(expected, ...urls) {
  const mainUrl = urls.length ? urls[0] : expected;
  const frameUrl = urls.length > 1 ? urls[1] : mainUrl;
  const frame = { url: frameUrl };
  const contents = {
    mainFrame: frame,
    isDestroyed: () => false,
    getURL: () => mainUrl,
  };
  const window = { webContents: contents, isDestroyed: () => false };
  return {
    expected,
    frame,
    contents,
    window,
    event: { sender: contents, senderFrame: frame },
  };
}

for (const windows of [false, true]) {
  const platform = windows ? "Windows paths" : "POSIX paths";
  const core = platformCore(windows);
  const trusted = (h, event = h.event, window = h.window) =>
    core.isTrustedSender(event, window, h.expected);
  const root = windows
    ? "c:\\Users\\Zoë\\Pi [preview]\\100% literal %2f\\"
    : "/home/Zoë/Pi [preview]/100% literal %2f/";
  const expected = url.pathToFileURL(
    `${root}dist${windows ? "\\" : "/"}index.html`,
    { windows },
  ).href;

  test(`menu security audit (${platform}): only serialization variants of one exact local file are trusted`, () => {
    const browser = expected
      .replace(/%5B/gi, "[")
      .replace(/%5D/gi, "]")
      .replace("%C3%AB", "ë")
      .replace("index", "%69ndex")
      .replace("file:///c:", "file:///C:");
    assert.equal(trusted(sender(expected)), true);
    assert.equal(trusted(sender(expected, browser)), true);
    assert.equal(trusted(sender(expected, browser, expected)), true);
    assert.equal(trusted(sender(expected, expected, browser)), true);
    assert.equal(
      trusted(
        sender(
          expected,
          expected.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()),
        ),
      ),
      true,
    );
    // These characters are literal filename characters, not query/fragment syntax.
    const special = url.pathToFileURL(
      `${root}hash# quote' bang! money$ 雪 [x]${windows ? "\\" : "/"}index.html`,
      { windows },
    ).href;
    assert.equal(
      trusted(
        sender(special, special.replace(/%5B/gi, "[").replace(/%5D/gi, "]")),
      ),
      true,
    );
  });

  test(`menu security audit (${platform}): query, fragment, remote authority, siblings and decoding traps fail closed`, () => {
    const slashRoot = windows ? "file:///C:/Users/Zoë/" : "file:///home/Zoë/";
    const hostile = [
      `${expected}?`,
      `${expected}?x=1`,
      `${expected}#`,
      `${expected}#x`,
      expected.replace("file:///", "file://localhost/"),
      expected.replace("file:///", "file://remote/"),
      expected.replace("file:///", "https:///"),
      expected.replace("index.html", "other.html"),
      expected.replace("index.html", "index.html.bak"),
      expected.replace("index.html", "INDEX.html"),
      expected.replace("dist/index.html", "dist2/index.html"),
      expected.replace("index.html", "%00index.html"),
      expected.replace("index.html", "%C0%AFindex.html"),
      expected.replace("index.html", "%EF%BF%BDindex.html"),
      expected.replace("index.html", "%index.html"),
      expected.replace("dist/index.html", "dist%2findex.html"),
      expected.replace("dist/index.html", "dist%2Findex.html"),
      expected.replace("dist/index.html", "dist%5cindex.html"),
      expected.replace("dist/index.html", "dist\\index.html"),
      expected.replace("%252f", "%2f"),
      expected.replace("%252f", "%25252f"),
      expected.replace("%20", " "),
      `${expected}\n`,
      `${expected}\t`,
      ` ${expected}`,
      `${slashRoot}different/dist/index.html`,
      "about:blank",
      "data:text/html,<p>same</p>",
      "javascript:void(0)",
      "",
      null,
      undefined,
      {},
    ];
    for (const actual of hostile) {
      assert.equal(
        trusted(sender(expected, actual)),
        false,
        `both URLs: ${String(actual)}`,
      );
      assert.equal(
        trusted(sender(expected, actual, expected)),
        false,
        `main URL: ${String(actual)}`,
      );
      assert.equal(
        trusted(sender(expected, expected, actual)),
        false,
        `frame URL: ${String(actual)}`,
      );
    }
    if (windows) {
      assert.equal(
        trusted(sender(expected, expected.replace("/c:", "/d:"))),
        false,
      );
      assert.equal(
        trusted(sender(expected, expected.replace("Users", "users"))),
        false,
      );
    }
  });

  test(`menu security audit (${platform}): same-URL foreign contents, subframes, missing and destroyed frames remain forbidden`, () => {
    const h = sender(expected);
    assert.equal(trusted(h, { ...h.event, sender: { ...h.contents } }), false);
    assert.equal(
      trusted(h, { ...h.event, senderFrame: { url: expected } }),
      false,
    );
    assert.equal(trusted(h, { ...h.event, senderFrame: null }), false);
    assert.equal(trusted(h, {}), false);
    assert.equal(trusted(h, null), false);
    assert.equal(core.isTrustedSender(undefined, h.window, expected), false);
    assert.equal(trusted(h, h.event, null), false);
    assert.equal(
      trusted(h, h.event, { ...h.window, isDestroyed: () => true }),
      false,
    );
    h.contents.isDestroyed = () => true;
    assert.equal(trusted(h), false);
    h.contents.isDestroyed = () => {
      throw new Error("destroyed contents");
    };
    assert.equal(trusted(h), false);
  });

  test(`menu security audit (${platform}): malformed expected URLs cannot match equally malformed input`, () => {
    for (const invalid of [
      null,
      "",
      "about:blank",
      `${expected}#`,
      `${expected}?`,
      expected.replace("dist/index.html", "dist%2findex.html"),
    ]) {
      assert.equal(trusted(sender(invalid)), false, String(invalid));
    }
  });
}
