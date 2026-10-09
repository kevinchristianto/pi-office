import { it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useReducedMotion } from "../src/useReducedMotion";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("tracks OS reduced motion preference changes and removes listener", () => {
  let listener = () => {};
  const media = {
    matches: true,
    addEventListener: vi.fn((_, fn) => {
      listener = fn;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", () => media);
  const { result, unmount } = renderHook(() => useReducedMotion());
  expect(result.current).toBe(true);
  act(() => {
    media.matches = false;
    listener();
  });
  expect(result.current).toBe(false);
  unmount();
  expect(media.removeEventListener).toHaveBeenCalled();
});
it("works without matchMedia for server/tests", () => {
  vi.stubGlobal("matchMedia", undefined);
  expect(renderHook(() => useReducedMotion()).result.current).toBe(false);
});
