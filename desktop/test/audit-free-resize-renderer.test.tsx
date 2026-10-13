import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "../src/ResizeHandle";
import type { CompanionState, ResizeAction, WindowSize } from "../src/types";

const state = (width = 440, height = 260): CompanionState => ({
  snapshot: null,
  connection: { status: "live", lastSuccessAt: 1, error: null },
  visible: true,
  alwaysOnTop: true,
  locked: false,
  shortcutAvailable: true,
  windowSize: { width, height },
});

function deferred() {
  let resolve!: (value: boolean | WindowSize) => void;
  const promise = new Promise<boolean | WindowSize>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("independent free resize race audit", () => {
  it("keeps the 50 ms queue bounded when the system clock moves backward", async () => {
    const resize = vi.fn<ResizeAction>().mockResolvedValue(true);
    const view = render(<ResizeHandle state={state()} resize={resize} />);
    const handle = screen.getByRole("button", {
      name: "Resize companion window",
    });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    await act(async () => {});
    view.rerender(<ResizeHandle state={state(456, 260)} resize={resize} />);
    vi.setSystemTime(Date.now() - 60 * 60 * 1000);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(resize).toHaveBeenCalledTimes(2);
    expect(resize.mock.calls[1].slice(0, 2)).toEqual([472, 260]);
  });

  it("retains a new same-size gesture when a cancelled older request fails", async () => {
    const first = deferred();
    const resize = vi
      .fn<ResizeAction>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(true);
    render(<ResizeHandle state={state()} resize={resize} />);
    const handle = screen.getByRole("button", {
      name: "Resize companion window",
    });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize.mock.calls[0].slice(0, 2)).toEqual([456, 260]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(resize.mock.calls[0][2]?.aborted).toBe(true);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(resize).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve(false);
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(resize).toHaveBeenCalledTimes(2);
    expect(resize.mock.calls[1].slice(0, 2)).toEqual([456, 260]);
    expect(resize.mock.calls[1][2]?.aborted).toBe(false);
  });

  it("shrinks immediately after the main process caps a completed keyboard increase", async () => {
    const first = deferred();
    const resize = vi
      .fn<ResizeAction>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(true);
    const view = render(
      <ResizeHandle state={state(1200, 600)} resize={resize} />,
    );
    const handle = screen.getByRole("button", {
      name: "Resize companion window",
    });
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(resize.mock.calls[0].slice(0, 2)).toEqual([1264, 600]);
    // Main publishes its work-area-clamped dimensions before resolving invoke.
    view.rerender(<ResizeHandle state={state(1200, 600)} resize={resize} />);
    await act(async () => {
      first.resolve(true);
    });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(resize).toHaveBeenCalledTimes(2);
    expect(resize.mock.calls[1].slice(0, 2)).toEqual([1184, 600]);
  });

  it("preserves a shrink queued during a slow, work-area-capped keyboard burst", async () => {
    const first = deferred();
    const resize = vi
      .fn<ResizeAction>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(true);
    const view = render(
      <ResizeHandle state={state(1200, 600)} resize={resize} />,
    );
    const handle = screen.getByRole("button", {
      name: "Resize companion window",
    });
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(resize).toHaveBeenCalledTimes(1);
    view.rerender(<ResizeHandle state={state(1200, 600)} resize={resize} />);
    await act(async () => {
      first.resolve({ width: 1200, height: 600 });
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(resize).toHaveBeenCalledTimes(2);
    expect(resize.mock.calls[1].slice(0, 2)).toEqual([1184, 600]);
  });

  it("drops queued overshoot after a cap acknowledgment and preserves the next reversal", async () => {
    const first = deferred();
    const resize = vi
      .fn<ResizeAction>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(true);
    const view = render(
      <ResizeHandle state={state(1200, 600)} resize={resize} />,
    );
    const handle = screen.getByRole("button", {
      name: "Resize companion window",
    });
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    view.rerender(<ResizeHandle state={state(1200, 600)} resize={resize} />);
    await act(async () => {
      first.resolve({ width: 1200, height: 600 });
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(resize).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(resize).toHaveBeenCalledTimes(2);
    expect(resize.mock.calls[1].slice(0, 2)).toEqual([1184, 600]);
  });
});
