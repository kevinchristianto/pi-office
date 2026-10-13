import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { initialState, useCompanion } from "../src/useCompanion";
import type { CompanionState } from "../src/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(
  resize = vi.fn(async (_width: number, _height: number) => initialState),
  command = vi.fn(async () => undefined),
) {
  let listener!: (state: CompanionState) => void;
  window.companion = {
    resize,
    command,
    getState: async () => initialState,
    onState(callback) {
      listener = callback;
      return () => {};
    },
  };
  return {
    ...renderHook(() => useCompanion()),
    push: (next: CompanionState) => listener(next),
    resize,
    command,
  };
}
afterEach(() => {
  cleanup();
  delete window.companion;
});

it("returns a fixed safe resize failure without native paths or exception text", async () => {
  const hook = setup(
    vi
      .fn()
      .mockRejectedValue(new Error("C:\\Private\\token secret <img src=x>")),
  );
  await act(async () => {
    expect(await hook.result.current.resize(700, 500)).toBe(false);
  });
  expect(hook.resize).toHaveBeenCalledWith(700, 500);
  expect(hook.result.current.commandError).toBe(
    "Couldn't resize the window. Try again or choose Compact size.",
  );
  expect(hook.result.current.commandError).not.toMatch(/Private|secret|<img/);
});

it("clears the failure when a later resize succeeds", async () => {
  const resize = vi
    .fn()
    .mockRejectedValueOnce(new Error("secret"))
    .mockResolvedValue(initialState);
  const hook = setup(resize);
  await act(async () => {
    await hook.result.current.resize(700, 500);
  });
  expect(hook.result.current.commandError).toContain("Couldn't resize");
  await act(async () => {
    expect(await hook.result.current.resize(710, 510)).toBe(true);
  });
  expect(hook.result.current.commandError).toBeNull();
});

it("handles an absent or older preload without invoking native resize", async () => {
  const hook = setup();
  delete window.companion!.resize;
  await act(async () => {
    expect(await hook.result.current.resize(700, 500)).toBe(false);
  });
  expect(hook.result.current.commandError).toBe(
    "Open the desktop companion to resize the window.",
  );
  delete window.companion;
  await act(async () => {
    expect(await hook.result.current.resize(700, 500)).toBe(false);
  });
});

it("does not apply a stale native reply over a newer pushed locked state", async () => {
  const native = deferred<CompanionState>();
  const hook = setup(vi.fn().mockReturnValue(native.promise));
  let request!: Promise<boolean>;
  await act(async () => {
    request = hook.result.current.resize(700, 500);
  });
  act(() =>
    hook.push({
      ...initialState,
      locked: true,
      windowSize: { width: 720, height: 520 },
    }),
  );
  await act(async () => {
    native.resolve({
      ...initialState,
      locked: false,
      windowSize: { width: 700, height: 500 },
    });
    await request;
  });
  expect(hook.result.current.state.locked).toBe(true);
  expect(hook.result.current.state.windowSize).toEqual({
    width: 720,
    height: 520,
  });
});

it.each(["resolve", "reject"])(
  "a newer command invalidates a pending resize %s and its error",
  async (outcome) => {
    const native = deferred<CompanionState>();
    const hook = setup(vi.fn().mockReturnValue(native.promise));
    let request!: Promise<boolean>;
    act(() => {
      request = hook.result.current.resize(700, 500);
    });
    await act(async () => {
      await hook.result.current.command("compact");
    });
    await act(async () => {
      if (outcome === "resolve") native.resolve(initialState);
      else native.reject(new Error("private"));
      expect(await request).toBe(false);
    });
    expect(hook.result.current.commandError).toBeNull();
  },
);

it("a newer resize invalidates an old command error", async () => {
  const native = deferred<void>();
  const hook = setup(
    vi.fn().mockResolvedValue(initialState),
    vi.fn().mockReturnValue(native.promise),
  );
  let command!: Promise<void>;
  act(() => {
    command = hook.result.current.command("roomy");
  });
  await act(async () => {
    expect(await hook.result.current.resize(700, 500)).toBe(true);
  });
  await act(async () => {
    native.reject(new Error("private"));
    await command;
  });
  expect(hook.result.current.commandError).toBeNull();
});

it("a newer failed command retains its own message when an older resize rejects", async () => {
  const native = deferred<CompanionState>();
  const hook = setup(
    vi.fn().mockReturnValue(native.promise),
    vi.fn().mockRejectedValue(new Error("private")),
  );
  let request!: Promise<boolean>;
  act(() => {
    request = hook.result.current.resize(700, 500);
  });
  await act(async () => {
    await hook.result.current.command("open-office");
  });
  expect(hook.result.current.commandError).toContain("default browser");
  await act(async () => {
    native.reject(new Error("native path"));
    await request;
  });
  expect(hook.result.current.commandError).toContain("default browser");
});

it("dismissing feedback invalidates a pending resize error", async () => {
  const native = deferred<CompanionState>();
  const hook = setup(vi.fn().mockReturnValue(native.promise));
  let request!: Promise<boolean>;
  act(() => {
    request = hook.result.current.resize(700, 500);
    hook.result.current.dismissError();
  });
  await act(async () => {
    native.reject(new Error("secret"));
    expect(await request).toBe(false);
  });
  expect(hook.result.current.commandError).toBeNull();
});

it.each(["resolve", "reject"])(
  "an aborted gesture ignores late resize %s without displaying an error",
  async (outcome) => {
    const native = deferred<CompanionState>();
    const hook = setup(vi.fn().mockReturnValue(native.promise));
    const controller = new AbortController();
    let request!: Promise<boolean>;
    act(() => {
      request = hook.result.current.resize(700, 500, controller.signal);
    });
    controller.abort();
    await act(async () => {
      if (outcome === "resolve") native.resolve(initialState);
      else native.reject(new Error("secret"));
      expect(await request).toBe(false);
    });
    expect(hook.result.current.commandError).toBeNull();
  },
);

it("does not dispatch an already aborted resize or an unmounted retry", async () => {
  const hook = setup();
  const controller = new AbortController();
  controller.abort();
  await act(async () => {
    expect(await hook.result.current.resize(700, 500, controller.signal)).toBe(
      false,
    );
  });
  expect(hook.resize).not.toHaveBeenCalled();
  hook.unmount();
  expect(await hook.result.current.resize(700, 500)).toBe(false);
  expect(hook.resize).not.toHaveBeenCalled();
});

it("does not update feedback after unmount", async () => {
  const native = deferred<CompanionState>();
  const hook = setup(vi.fn().mockReturnValue(native.promise));
  let request!: Promise<boolean>;
  act(() => {
    request = hook.result.current.resize(700, 500);
  });
  hook.unmount();
  await act(async () => {
    native.reject(new Error("secret"));
    expect(await request).toBe(false);
  });
  expect(hook.result.current.commandError).toBeNull();
});

it("returns accepted native geometry without replacing newer pushed state", async () => {
  const native = deferred<CompanionState>();
  const hook = setup(vi.fn().mockReturnValue(native.promise));
  let request!: ReturnType<typeof hook.result.current.resize>;
  act(() => {
    request = hook.result.current.resize(1264, 800);
  });
  act(() =>
    hook.push({
      ...initialState,
      alwaysOnTop: true,
      windowSize: { width: 1200, height: 800 },
    }),
  );
  await act(async () => {
    native.resolve({
      ...initialState,
      alwaysOnTop: false,
      windowSize: { width: 1200, height: 800 },
    });
    expect(await request).toEqual({ width: 1200, height: 800 });
  });
  expect(hook.result.current.state.alwaysOnTop).toBe(true);
});
