const test = require("node:test");
const assert = require("node:assert/strict");
const { requestSnapshot } = require("../core.cjs");

test("companion reads the unchanged real bridge without registering or mutating an observer", async (t) => {
  const { createBridge } = await import("../../bridge/server.mjs");
  const bridge = await createBridge({
    port: 0,
    token: "companion-test-only-token-0123456789abcdef",
  });
  const url = await bridge.listen();
  t.after(() => bridge.close());
  bridge.store.upsert({
    version: 1,
    session: {
      id: "sample-session",
      name: "Sample project",
      agents: [
        {
          id: "sample-agent",
          name: "Builder",
          state: "working",
          task: "Check the dock",
          logs: [{ message: "Not needed by dock" }],
        },
      ],
    },
  });
  const before = bridge.store.snapshot();
  const first = await requestSnapshot({ port: Number(new URL(url).port) });
  assert.equal(first.sessions.length, 1);
  assert.equal(first.sessions[0].agents[0].task, "Check the dock");
  assert.equal(first.sessions[0].connectionState, "live");
  assert.equal("logs" in first.sessions[0].agents[0], false);
  assert.equal(bridge.store.snapshot().revision, before.revision);
  const second = await requestSnapshot({ port: Number(new URL(url).port) });
  assert.equal(second.sessions.length, 1);
  assert.equal(second.sessions[0].id, "sample-session");
  assert.equal(bridge.store.snapshot().revision, before.revision);
});
