import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResizeHandle } from "../src/ResizeHandle";
import { initialState } from "../src/useCompanion";
import type { CompanionState, ResizeAction, WindowSize } from "../src/types";

const state: CompanionState = {
  ...initialState,
  windowSize: { width: 600, height: 400 },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function show(resize: ResizeAction = vi.fn(async () => true), next = state) {
  const view = render(<ResizeHandle state={next} resize={resize} />);
  return {
    ...view,
    resize,
    handle: screen.getByRole("button", { name: "Resize companion window" }),
  };
}
function start(handle: HTMLElement, pointerId = 1) {
  fireEvent.pointerDown(handle, {
    button: 0,
    pointerId,
    isPrimary: true,
    screenX: 100,
    screenY: 100,
  });
}
function move(handle: HTMLElement, x: number, y: number, pointerId = 1) {
  fireEvent.pointerMove(handle, { pointerId, screenX: x, screenY: y });
}
function up(handle: HTMLElement, x: number, y: number, pointerId = 1) {
  fireEvent.pointerUp(handle, { pointerId, screenX: x, screenY: y });
}
async function tick(ms = 0) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId: number;
      isPrimary: boolean;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.isPrimary = init.isPrimary ?? true;
      }
    },
  );
  const captures = new Set<number>();
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: {
      configurable: true,
      value: vi.fn((id: number) => captures.add(id)),
    },
    releasePointerCapture: {
      configurable: true,
      value: vi.fn((id: number) => captures.delete(id)),
    },
    hasPointerCapture: {
      configurable: true,
      value: vi.fn((id: number) => captures.has(id)),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("is focusable and has accessible drag, keyboard, and cancellation help", async () => {
  const { handle, resize } = show();
  handle.focus();
  expect(document.activeElement).toBe(handle);
  expect(handle.getAttribute("aria-describedby")).toBeTruthy();
  const help = document.getElementById(
    handle.getAttribute("aria-describedby")!,
  );
  expect(help?.textContent).toMatch(/Arrow keys resize by 16 pixels/);
  expect(help?.textContent).toMatch(/Shift for 64 pixels/);
  expect(help?.textContent).toMatch(/Escape/);
  expect(resize).not.toHaveBeenCalled();
  await tick();
  expect(vi.getTimerCount()).toBe(0);
});

it("coalesces rapid moves to one latest target, at most once every 50 ms", async () => {
  const resize = vi.fn(async () => true);
  const { handle } = show(resize);
  start(handle);
  move(handle, 101, 101);
  await tick();
  for (let i = 102; i <= 350; i++) move(handle, i, i);
  expect(resize).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1);
  await tick(49);
  expect(resize).toHaveBeenCalledTimes(1);
  await tick(1);
  expect(resize).toHaveBeenCalledTimes(2);
  expect(resize.mock.calls[1].slice(0, 2)).toEqual([850, 650]);
  await tick(5000);
  expect(resize).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("holds only the latest target while IPC is pending and flushes pointerup coordinates", async () => {
  const first = deferred<boolean>();
  const resize = vi
    .fn<ResizeAction>()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(true);
  const { handle } = show(resize);
  start(handle);
  move(handle, 120, 130);
  for (let i = 121; i <= 500; i++) move(handle, i, i);
  up(handle, 550, 580);
  await tick(1000);
  expect(resize).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => first.resolve(true));
  expect(resize).toHaveBeenCalledTimes(2);
  expect(resize.mock.calls[1].slice(0, 2)).toEqual([1050, 880]);
  await tick(5000);
  expect(resize).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not send an unchanged final target twice", async () => {
  const first = deferred<boolean>();
  const resize = vi.fn<ResizeAction>().mockReturnValue(first.promise);
  const { handle } = show(resize);
  start(handle);
  move(handle, 160, 180);
  up(handle, 160, 180);
  await act(async () => first.resolve(true));
  await tick(1000);
  expect(resize).toHaveBeenCalledTimes(1);
});

it("delivers a final pointerup even without a preceding move", async () => {
  const resize = vi.fn(async () => true);
  const { handle } = show(resize);
  start(handle);
  up(handle, 130, 160);
  await tick();
  expect(resize.mock.calls[0].slice(0, 2)).toEqual([630, 460]);
  expect(handle.className).not.toContain("is-resizing");
  expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
});

it.each([
  "pointerCancel",
  "lostPointerCapture",
  "blur",
  "escape",
  "visibility",
])(
  "%s discards pending targets, aborts the old signal, and does not restart on a late response",
  async (reason) => {
    const first = deferred<boolean>();
    const resize = vi.fn<ResizeAction>().mockReturnValue(first.promise);
    const { handle } = show(resize);
    start(handle);
    move(handle, 150, 150);
    move(handle, 180, 180);
    const signal = resize.mock.calls[0][2]!;
    if (reason === "pointerCancel")
      fireEvent.pointerCancel(handle, { pointerId: 1 });
    if (reason === "lostPointerCapture")
      fireEvent.lostPointerCapture(handle, { pointerId: 1 });
    if (reason === "blur") fireEvent(window, new Event("blur"));
    if (reason === "escape") fireEvent.keyDown(handle, { key: "Escape" });
    if (reason === "visibility") {
      vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      fireEvent(document, new Event("visibilitychange"));
    }
    expect(signal.aborted).toBe(true);
    expect(handle.className).not.toContain("is-resizing");
    await act(async () => first.resolve(true));
    await tick(1000);
    expect(resize).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("cancels a throttled timer on blur and unmount", async () => {
  const resize = vi.fn(async () => true);
  const { handle, unmount } = show(resize);
  start(handle);
  move(handle, 130, 130);
  await tick();
  move(handle, 150, 150);
  expect(vi.getTimerCount()).toBe(1);
  fireEvent(window, new Event("blur"));
  expect(vi.getTimerCount()).toBe(0);
  start(handle);
  move(handle, 200, 200);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  await tick(1000);
  expect(resize).toHaveBeenCalledTimes(1);
});

it("does not dispatch after unmount when a pending promise settles", async () => {
  const first = deferred<boolean>();
  const resize = vi.fn<ResizeAction>().mockReturnValue(first.promise);
  const { handle, unmount } = show(resize);
  start(handle);
  move(handle, 130, 130);
  move(handle, 160, 160);
  unmount();
  expect(resize.mock.calls[0][2]?.aborted).toBe(true);
  await act(async () => first.resolve(true));
  await tick(1000);
  expect(resize).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([false, "reject", "throw"])(
  "stops on failure %s and allows a fresh gesture to retry",
  async (failure) => {
    const resize = vi
      .fn<ResizeAction>()
      .mockImplementationOnce(() => {
        if (failure === "throw") throw new Error("private native text");
        if (failure === "reject")
          return Promise.reject(new Error("private native text"));
        return Promise.resolve(false);
      })
      .mockResolvedValue(true);
    const { handle } = show(resize);
    start(handle);
    move(handle, 130, 130);
    move(handle, 160, 160);
    await tick(1000);
    expect(resize).toHaveBeenCalledTimes(1);
    expect(handle.className).not.toContain("is-resizing");
    start(handle);
    up(handle, 140, 140);
    await tick(50);
    expect(resize).toHaveBeenCalledTimes(2);
  },
);

it("a cancelled pending request cannot cancel or deduplicate a new gesture", async () => {
  const first = deferred<boolean>();
  const resize = vi
    .fn<ResizeAction>()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(true);
  const { handle } = show(resize);
  start(handle);
  move(handle, 150, 150);
  fireEvent.pointerCancel(handle, { pointerId: 1 });
  start(handle, 2);
  up(handle, 150, 150, 2);
  await tick(1000);
  expect(resize).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve(false));
  expect(resize).toHaveBeenCalledTimes(2);
  expect(resize.mock.calls[1].slice(0, 2)).toEqual([650, 450]);
  expect(resize.mock.calls[1][2]?.aborted).toBe(false);
});

it("accumulates keyboard steps during a slow resize and flushes the latest size", async () => {
  const first = deferred<boolean>();
  const resize = vi
    .fn<ResizeAction>()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(true);
  const { handle } = show(resize);
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  fireEvent.keyDown(handle, { key: "ArrowUp", shiftKey: true });
  expect(resize).toHaveBeenCalledTimes(1);
  await tick(100);
  await act(async () => first.resolve(true));
  expect(resize.mock.calls.map((args) => args.slice(0, 2))).toEqual([
    [616, 400],
    [680, 352],
  ]);
});

it("clamps pointer and keyboard targets to the same min/max bounds", async () => {
  const resize = vi.fn(async () => true);
  const { handle } = show(resize);
  start(handle);
  move(handle, -5000, -5000);
  await tick(50);
  move(handle, 10000, 10000);
  up(handle, 10000, 10000);
  await tick(50);
  expect(resize.mock.calls.map((args) => args.slice(0, 2))).toEqual([
    [440, 260],
    [4096, 2160],
  ]);
  cleanup();
  const minimum = show(resize, {
    ...state,
    windowSize: { width: 440, height: 260 },
  });
  fireEvent.keyDown(minimum.handle, { key: "ArrowLeft" });
  fireEvent.keyDown(minimum.handle, { key: "ArrowUp", shiftKey: true });
  await tick(50);
  expect(resize.mock.calls.at(-1)?.slice(0, 2)).toEqual([440, 260]);
});

it.each([{ locked: true }, { visible: false }])(
  "disables all interactions for %j and cancels active work",
  async (change) => {
    const first = deferred<boolean>();
    const resize = vi.fn<ResizeAction>().mockReturnValue(first.promise);
    const { handle, rerender } = show(resize);
    start(handle);
    move(handle, 130, 130);
    move(handle, 160, 160);
    rerender(<ResizeHandle state={{ ...state, ...change }} resize={resize} />);
    expect((handle as HTMLButtonElement).disabled).toBe(true);
    expect(resize.mock.calls[0][2]?.aborted).toBe(true);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    start(handle);
    move(handle, 230, 230);
    await act(async () => first.resolve(true));
    await tick(1000);
    expect(resize).toHaveBeenCalledTimes(1);
  },
);

it("ignores other pointers, non-primary buttons and modified browser shortcuts", async () => {
  const resize = vi.fn(async () => true);
  const { handle } = show(resize);
  fireEvent.pointerDown(handle, {
    button: 2,
    pointerId: 1,
    screenX: 100,
    screenY: 100,
  });
  move(handle, 160, 160);
  fireEvent.keyDown(handle, { key: "ArrowRight", ctrlKey: true });
  expect(resize).not.toHaveBeenCalled();
  start(handle);
  move(handle, 200, 200, 2);
  up(handle, 200, 200, 2);
  fireEvent.pointerCancel(handle, { pointerId: 2 });
  expect(resize).not.toHaveBeenCalled();
  up(handle, 140, 140);
  await tick();
  expect(resize).toHaveBeenCalledTimes(1);
});

it("fails safely if native pointer capture cannot be acquired", () => {
  const resize = vi.fn(async () => true);
  const { handle } = show(resize);
  vi.mocked(handle.setPointerCapture).mockImplementationOnce(() => {
    throw new Error("pointer ended");
  });
  start(handle);
  move(handle, 200, 200);
  up(handle, 200, 200);
  expect(resize).not.toHaveBeenCalled();
  expect(handle.className).not.toContain("is-resizing");
});

it("starts the next keyboard burst from the work-area-clamped native dimensions", async () => {
  const resize = vi.fn<ResizeAction>().mockResolvedValue(true);
  const capped = { ...state, windowSize: { width: 1200, height: 800 } };
  const { handle, rerender } = show(resize, capped);
  fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
  await tick(50);
  rerender(
    <ResizeHandle
      state={{ ...capped, windowSize: { width: 1200, height: 800 } }}
      resize={resize}
    />,
  );
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  await tick(50);
  expect(resize.mock.calls.map((args) => args.slice(0, 2))).toEqual([
    [1264, 800],
    [1184, 800],
  ]);
});

it("keeps throttling bounded when the wall clock moves backwards", async () => {
  const resize = vi.fn(async () => true);
  const { handle } = show(resize);
  start(handle);
  move(handle, 130, 130);
  await tick();
  vi.setSystemTime(Date.now() - 60 * 60 * 1000);
  up(handle, 160, 160);
  await tick(50);
  expect(resize).toHaveBeenCalledTimes(2);
  expect(resize.mock.calls[1].slice(0, 2)).toEqual([660, 460]);
  expect(vi.getTimerCount()).toBe(0);
});

it("discards queued keyboard overshoot at the native work-area limit", async () => {
  const first = deferred<WindowSize | boolean>();
  const resize = vi
    .fn<ResizeAction>()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(true);
  const capped = { ...state, windowSize: { width: 1200, height: 800 } };
  const { handle } = show(resize, capped);
  fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
  for (let i = 0; i < 20; i++)
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
  await tick(50);
  await act(async () => first.resolve({ width: 1200, height: 800 }));
  expect(resize).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  await tick(50);
  expect(resize.mock.calls[1].slice(0, 2)).toEqual([1184, 800]);
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves a queued reverse step relative to the accepted size during slow IPC", async () => {
  const first = deferred<WindowSize | boolean>();
  const resize = vi
    .fn<ResizeAction>()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(true);
  const capped = { ...state, windowSize: { width: 1200, height: 800 } };
  const { handle } = show(resize, capped);
  fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  await tick(50);
  await act(async () => first.resolve({ width: 1200, height: 800 }));
  expect(resize.mock.calls.map((args) => args.slice(0, 2))).toEqual([
    [1264, 800],
    [1184, 800],
  ]);
});

it("keeps a pointerup final target anchored to the original drag after native clamping", async () => {
  const first = deferred<WindowSize | boolean>();
  const resize = vi
    .fn<ResizeAction>()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(true);
  const capped = { ...state, windowSize: { width: 1200, height: 800 } };
  const { handle } = show(resize, capped);
  start(handle);
  move(handle, 164, 100);
  up(handle, 148, 100);
  await tick(50);
  await act(async () => first.resolve({ width: 1200, height: 800 }));
  expect(resize.mock.calls.map((args) => args.slice(0, 2))).toEqual([
    [1264, 800],
    [1248, 800],
  ]);
});

it("preserves reverse input after multiple increases before the first cap acknowledgment", async () => {
  const first = deferred<WindowSize | boolean>();
  const resize = vi
    .fn<ResizeAction>()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(true);
  const capped = { ...state, windowSize: { width: 1200, height: 800 } };
  const { handle } = show(resize, capped);
  fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
  for (let i = 0; i < 20; i++)
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  await tick(50);
  await act(async () => first.resolve({ width: 1200, height: 800 }));
  expect(resize.mock.calls.map((args) => args.slice(0, 2))).toEqual([
    [1264, 800],
    [1184, 800],
  ]);
});

it("preserves a reverse key even when queued input returned to the sent target", async () => {
  const first = deferred<WindowSize | boolean>();
  const resize = vi
    .fn<ResizeAction>()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(true);
  const capped = { ...state, windowSize: { width: 1200, height: 800 } };
  const { handle } = show(resize, capped);
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  await tick(50);
  await act(async () => first.resolve({ width: 1200, height: 800 }));
  expect(resize.mock.calls.map((args) => args.slice(0, 2))).toEqual([
    [1216, 800],
    [1184, 800],
  ]);
});

it("does not retry forever when a tiny native work area is below the usual minimum", async () => {
  const resize = vi
    .fn<ResizeAction>()
    .mockResolvedValue({ width: 400, height: 200 });
  const { handle } = show(resize, {
    ...state,
    windowSize: { width: 400, height: 200 },
  });
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  await tick(10000);
  expect(resize).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
