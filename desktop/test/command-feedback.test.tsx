import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  commandFailureMessage,
  initialState,
  useCompanion,
} from "../src/useCompanion";
import type { CompanionCommand } from "../src/types";

afterEach(() => {
  cleanup();
  delete window.companion;
});
function setup(command = vi.fn(async () => undefined)) {
  window.companion = {
    command,
    getState: async () => initialState,
    onState: () => () => {},
  };
  return renderHook(() => useCompanion());
}
it("gives safe action-specific errors without echoing paths, credentials, or arbitrary HTML", () => {
  const secret = new Error("C:\\Private\\token secret <img src=x>");
  for (const name of [
    "toggle-top",
    "lock",
    "hide",
    "restore",
    "open-office",
    "connect-pi",
    "compact",
    "roomy",
    "quit",
  ] as CompanionCommand[]) {
    expect(commandFailureMessage(name, secret)).not.toMatch(
      /Private|secret|<img|That window action/,
    );
  }
  expect(commandFailureMessage("compact", secret)).toContain("window size");
  expect(commandFailureMessage("open-office", secret)).toContain(
    "default browser",
  );
});
it("recognizes only fixed native rejection suffixes", () => {
  expect(
    commandFailureMessage(
      "compact",
      new Error(
        "Error invoking remote method 'companion:command': Error: Untrusted companion request",
      ),
    ),
  ).toContain("verify its connection");
  expect(
    commandFailureMessage(
      "lock",
      new Error("Click-through is disabled: Ctrl+Shift+Space is unavailable"),
    ),
  ).toContain("already in use");
  expect(
    commandFailureMessage(
      "hide",
      new Error(
        "Hide requires the recovery shortcut or tray. Quit remains available.",
      ),
    ),
  ).toContain("Can't hide safely");
  expect(
    commandFailureMessage("roomy", new Error("Companion window unavailable")),
  ).toContain("closing");
  expect(
    commandFailureMessage(
      "compact",
      new Error("Untrusted companion request plus private text"),
    ),
  ).toContain("window size");
});
it("an older failed command cannot overwrite a newer successful command", async () => {
  let rejectOld!: (error: Error) => void;
  const action = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
    )
    .mockResolvedValue(undefined);
  const hook = setup(action);
  let old!: Promise<void>;
  act(() => {
    old = hook.result.current.command("open-office");
  });
  await act(async () => {
    await hook.result.current.command("compact");
  });
  await act(async () => {
    rejectOld(new Error("private"));
    await old;
  });
  expect(hook.result.current.commandError).toBeNull();
});
it("dismissal invalidates a still-pending command and retry can report its own failure", async () => {
  let reject!: (error: Error) => void;
  const action = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_r, j) => {
          reject = j;
        }),
    )
    .mockRejectedValue(new Error("private"));
  const hook = setup(action);
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.command("roomy");
    hook.result.current.dismissError();
  });
  await act(async () => {
    reject(new Error("private"));
    await pending;
  });
  expect(hook.result.current.commandError).toBeNull();
  await act(async () => {
    await hook.result.current.command("roomy");
  });
  expect(hook.result.current.commandError).toContain("window size");
});
it("an unmounted hook ignores late command errors", async () => {
  let reject!: (error: Error) => void;
  const hook = setup(
    vi.fn(
      () =>
        new Promise((_r, j) => {
          reject = j;
        }),
    ),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.command("hide");
  });
  hook.unmount();
  await act(async () => {
    reject(new Error("private"));
    await pending;
  });
  expect(hook.result.current.commandError).toBeNull();
});

it("classifies the exact native command rejection without leaking the exception", () => {
  expect(
    commandFailureMessage(
      "roomy",
      new Error(
        "Error invoking remote method 'companion:command': Error: Untrusted companion command",
      ),
    ),
  ).toContain("verify its connection");
});
