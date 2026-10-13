import { useEffect, useId, useRef, useState } from "react";
import type { CompanionState, ResizeAction, WindowSize } from "./types";
import "./resize-handle.css";

export const RESIZE_LIMITS = {
  minWidth: 440,
  minHeight: 260,
  maxWidth: 4096,
  maxHeight: 2160,
};
const RESIZE_INTERVAL_MS = 50;

export function boundedWindowSize(width: number, height: number): WindowSize {
  return {
    width: Math.min(
      RESIZE_LIMITS.maxWidth,
      Math.max(RESIZE_LIMITS.minWidth, Math.round(width)),
    ),
    height: Math.min(
      RESIZE_LIMITS.maxHeight,
      Math.max(RESIZE_LIMITS.minHeight, Math.round(height)),
    ),
  };
}

interface AxisInput {
  total: number;
  low: number;
  high: number;
}
const emptyInput = (): AxisInput => ({ total: 0, low: 0, high: 0 });
function addInput(input: AxisInput, delta: number) {
  input.total += delta;
  input.low = Math.min(input.low, input.total);
  input.high = Math.max(input.high, input.total);
}
interface ResizeSession {
  controller: AbortController;
  keyboard: boolean;
  queuedInput: { width: AxisInput; height: AxisInput };
  desired: WindowSize;
  pointer: {
    id: number;
    x: number;
    y: number;
    start: WindowSize;
  } | null;
}
const sameSize = (a: WindowSize | null, b: WindowSize | null) =>
  a !== null && b !== null && a.width === b.width && a.height === b.height;

/** A bounded, event-driven resize queue. There is at most one IPC request and
 * one latest target, even if pointer input is much faster than the main process.
 * Native transparent windows intentionally remain resizable:false. */
export function ResizeHandle({
  state,
  resize,
}: {
  state: CompanionState;
  resize: ResizeAction;
}) {
  const helpId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(document.hidden);
  const disabled = state.locked || !state.visible || documentHidden;
  const latest = useRef({ state, resize, disabled });
  latest.current = { state, resize, disabled };
  const mounted = useRef(false);
  const session = useRef<ResizeSession | null>(null);
  const pending = useRef<WindowSize | null>(null);
  const inFlight = useRef(false);
  const sending = useRef<WindowSize | null>(null);
  const sendingSession = useRef<ResizeSession | null>(null);
  const lastSentAt = useRef(-Infinity);
  const lastSuccessful = useRef<WindowSize | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }
  function releasePointer(pointerId: number | undefined) {
    if (pointerId === undefined) return;
    try {
      if (button.current?.hasPointerCapture?.(pointerId))
        button.current.releasePointerCapture(pointerId);
    } catch {
      // Losing capture while the native window closes is already cancellation.
    }
  }
  function stop() {
    const current = session.current;
    session.current = null;
    pending.current = null;
    lastSuccessful.current = null;
    clearTimer();
    current?.controller.abort();
    releasePointer(current?.pointer?.id);
    if (mounted.current) setDragging(false);
  }
  function finishIfIdle() {
    if (
      !inFlight.current &&
      !pending.current &&
      session.current &&
      !session.current.pointer
    ) {
      // A completed keyboard burst must restart from native dimensions. The
      // OS can clamp below our maximum to fit a display's work area.
      session.current = null;
      lastSuccessful.current = null;
    }
  }
  function schedule() {
    if (
      !mounted.current ||
      latest.current.disabled ||
      !session.current ||
      !pending.current ||
      inFlight.current ||
      timer.current !== null
    )
      return;
    const delay = Math.max(
      0,
      RESIZE_INTERVAL_MS - (performance.now() - lastSentAt.current),
    );
    if (delay > 0) {
      timer.current = setTimeout(() => {
        timer.current = null;
        dispatch();
      }, Math.ceil(delay));
    } else dispatch();
  }
  function dispatch() {
    const current = session.current;
    const target = pending.current;
    if (
      !mounted.current ||
      latest.current.disabled ||
      !current ||
      !target ||
      inFlight.current
    )
      return;
    pending.current = null;
    inFlight.current = true;
    sending.current = target;
    sendingSession.current = current;
    current.queuedInput = { width: emptyInput(), height: emptyInput() };
    lastSentAt.current = performance.now();
    // Catch both synchronous and asynchronous callback failures. The hook owns
    // safe user-facing feedback; this component only stops the failed gesture.
    void (async () => {
      let result: WindowSize | boolean = false;
      try {
        result = await latest.current.resize(
          target.width,
          target.height,
          current.controller.signal,
        );
      } catch {
        result = false;
      } finally {
        inFlight.current = false;
        sending.current = null;
        sendingSession.current = null;
        if (!mounted.current) return;
        if (session.current === current) {
          if (!result) stop();
          else {
            lastSuccessful.current = target;
            if (current.keyboard && typeof result === "object") {
              const accepted = result;
              // Summarize queued keyboard intent in constant space. At an
              // upper limit, discard increases but preserve later decreases;
              // the lower limit is symmetric. This also handles Right, Right,
              // Left before the first capped request has acknowledged.
              const reconcile = (
                actual: number,
                sent: number,
                desired: number,
                input: AxisInput,
              ) =>
                actual < sent
                  ? actual + input.total - input.high
                  : actual > sent
                    ? actual + input.total - input.low
                    : desired;
              current.desired = boundedWindowSize(
                reconcile(
                  accepted.width,
                  target.width,
                  current.desired.width,
                  current.queuedInput.width,
                ),
                reconcile(
                  accepted.height,
                  target.height,
                  current.desired.height,
                  current.queuedInput.height,
                ),
              );
              // A very small display may force native bounds below the
              // normal minimum. Never retry that impossible size in a loop.
              if (accepted.width < RESIZE_LIMITS.minWidth)
                current.desired.width = accepted.width;
              if (accepted.height < RESIZE_LIMITS.minHeight)
                current.desired.height = accepted.height;
              pending.current = sameSize(current.desired, accepted)
                ? null
                : current.desired;
              lastSuccessful.current = accepted;
            }
            if (sameSize(pending.current, lastSuccessful.current))
              pending.current = null;
          }
        }
        // A cancelled old request may have held up a newer gesture. Its late
        // result cannot cancel that gesture or create a second in-flight call.
        schedule();
        finishIfIdle();
      }
    })();
  }
  function queue(target: WindowSize) {
    const current = session.current;
    if (!current || latest.current.disabled) return;
    current.desired = target;
    if (
      (sameSize(target, sending.current) &&
        sendingSession.current === current) ||
      (!inFlight.current && sameSize(target, lastSuccessful.current))
    ) {
      pending.current = null;
      clearTimer();
      return;
    }
    pending.current = target;
    schedule();
  }
  function sizeNow(): WindowSize {
    const actual = latest.current.state.windowSize;
    return boundedWindowSize(
      actual?.width ?? window.innerWidth,
      actual?.height ?? window.innerHeight,
    );
  }
  function begin(pointer: ResizeSession["pointer"] = null) {
    stop();
    const current: ResizeSession = {
      controller: new AbortController(),
      keyboard: pointer === null,
      queuedInput: { width: emptyInput(), height: emptyInput() },
      desired: sizeNow(),
      pointer,
    };
    session.current = current;
    return current;
  }
  function pointerTarget(x: number, y: number): WindowSize | null {
    const pointer = session.current?.pointer;
    if (!pointer || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return boundedWindowSize(
      pointer.start.width + x - pointer.x,
      pointer.start.height + y - pointer.y,
    );
  }

  useEffect(() => {
    mounted.current = true;
    const blur = () => stop();
    const visibility = () => {
      setDocumentHidden(document.hidden);
      if (document.hidden) stop();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !session.current) return;
      event.preventDefault();
      event.stopPropagation();
      stop();
    };
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", escape, true);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      stop();
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", escape, true);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`resize-handle${dragging ? " is-resizing" : ""}`}
        aria-label="Resize companion window"
        aria-describedby={helpId}
        title="Resize window. Arrow keys: 16px; Shift + arrows: 64px. Escape cancels."
        disabled={disabled}
        onPointerDown={(event) => {
          if (
            latest.current.disabled ||
            event.button !== 0 ||
            event.isPrimary === false ||
            session.current?.pointer ||
            !Number.isFinite(event.screenX) ||
            !Number.isFinite(event.screenY)
          )
            return;
          event.preventDefault();
          const start = sizeNow();
          begin({
            id: event.pointerId,
            x: event.screenX,
            y: event.screenY,
            start,
          });
          try {
            event.currentTarget.setPointerCapture?.(event.pointerId);
          } catch {
            stop();
            return;
          }
          event.currentTarget.focus({ preventScroll: true });
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (session.current?.pointer?.id !== event.pointerId) return;
          const target = pointerTarget(event.screenX, event.screenY);
          if (target) queue(target);
        }}
        onPointerUp={(event) => {
          const current = session.current;
          if (!current?.pointer || current.pointer.id !== event.pointerId)
            return;
          const target = pointerTarget(event.screenX, event.screenY);
          current.pointer = null;
          releasePointer(event.pointerId);
          setDragging(false);
          if (target) queue(target);
          finishIfIdle();
        }}
        onPointerCancel={(event) => {
          if (session.current?.pointer?.id === event.pointerId) stop();
        }}
        onLostPointerCapture={(event) => {
          if (session.current?.pointer?.id === event.pointerId) stop();
        }}
        onBlur={() => {
          // Keyboard work ends when focus moves elsewhere. Pointer capture can
          // still be active while a drag is ending, so do not cancel it here.
          if (session.current && !session.current.pointer) stop();
        }}
        onKeyDown={(event) => {
          if (
            latest.current.disabled ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            session.current?.pointer
          )
            return;
          const amount = event.shiftKey ? 64 : 16;
          let dx = 0;
          let dy = 0;
          if (event.key === "ArrowRight") dx = amount;
          else if (event.key === "ArrowLeft") dx = -amount;
          else if (event.key === "ArrowDown") dy = amount;
          else if (event.key === "ArrowUp") dy = -amount;
          else return;
          event.preventDefault();
          event.stopPropagation();
          const current = session.current ?? begin();
          const target = boundedWindowSize(
            current.desired.width + dx,
            current.desired.height + dy,
          );
          if (inFlight.current && sendingSession.current === current) {
            addInput(
              current.queuedInput.width,
              target.width - current.desired.width,
            );
            addInput(
              current.queuedInput.height,
              target.height - current.desired.height,
            );
          }
          queue(target);
        }}
      >
        <span className="resize-handle-grip" aria-hidden="true" />
      </button>
      <span id={helpId} className="resize-handle-help">
        Drag the bottom-right corner to resize. Arrow keys resize by 16 pixels;
        hold Shift for 64 pixels. Escape stops resizing.
      </span>
    </>
  );
}
