import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanionCommand, CompanionState, ResizeAction } from "./types";

const actionFailures: Record<CompanionCommand, string> = {
  "toggle-top": "Couldn't change always-on-top. Try again.",
  lock: "Couldn't enable click-through. Use the tray to restore the window.",
  hide: "Couldn't hide the companion. You can quit from the tray.",
  restore: "Couldn't restore the window. Quit and reopen Pi Office.",
  "open-office":
    "Couldn't open the office. Check that a default browser is available.",
  "connect-pi": "Couldn't open connection setup. Try again.",
  compact: "Couldn't change the window size. Try again.",
  roomy: "Couldn't change the window size. Try again.",
  quit: "Couldn't quit the companion. Use Quit from the tray.",
};

// Main-process exception text may contain native paths or other private data.
// Recognize only fixed known errors; never echo an arbitrary rejection.
export function commandFailureMessage(
  name: CompanionCommand,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : "";
  const endsWith = (known: string) =>
    message === known || message.endsWith(`: ${known}`);
  if (
    endsWith("Untrusted companion request") ||
    endsWith("Untrusted companion command")
  )
    return "This window couldn't verify its connection. Quit and reopen Pi Office.";
  if (endsWith("Click-through is disabled: Ctrl+Shift+Space is unavailable"))
    return "Click-through is unavailable because Ctrl+Shift+Space is already in use.";
  if (
    endsWith(
      "Hide requires the recovery shortcut or tray. Quit remains available.",
    )
  )
    return "Can't hide safely: the tray and restore shortcut are unavailable. Quit remains available.";
  if (endsWith("Companion window unavailable"))
    return "The window is closing or unavailable. Reopen Pi Office to continue.";
  return (
    actionFailures[name] ||
    "That window action didn't finish. Please try again."
  );
}

export const initialState: CompanionState = {
  snapshot: null,
  connection: { status: "connecting", lastSuccessAt: null, error: null },
  visible: true,
  alwaysOnTop: false,
  locked: false,
  shortcutAvailable: true,
};
export function useCompanion() {
  const [state, setState] = useState<CompanionState>(initialState);
  const [commandError, setCommandError] = useState<string | null>(null);
  const commandEpoch = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      commandEpoch.current++;
    };
  }, []);
  useEffect(() => {
    const api = window.companion;
    if (!api) {
      setState({
        ...initialState,
        connection: {
          status: "offline",
          lastSuccessAt: null,
          error: "Open Pi Office Companion from the desktop app.",
        },
      });
      return;
    }
    let alive = true;
    let receivedUpdate = false;
    // Subscribe before requesting the initial state. A newer pushed update must
    // never be replaced by a slow response from the initial request.
    const unsubscribe = api.onState((next) => {
      receivedUpdate = true;
      if (alive) setState(next);
    });
    void api
      .getState()
      .then((next) => {
        if (alive && !receivedUpdate) setState(next);
      })
      .catch(() => {
        if (alive && !receivedUpdate)
          setState({
            ...initialState,
            connection: {
              status: "offline",
              lastSuccessAt: null,
              error: "The desktop connection is unavailable.",
            },
          });
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  const command = useCallback(async (name: CompanionCommand) => {
    const epoch = ++commandEpoch.current;
    if (!window.companion) {
      setCommandError("Open the desktop companion to use window controls.");
      return;
    }
    setCommandError(null);
    try {
      // State is delivered by the subscription. Avoid applying an older command
      // reply after a newer snapshot or another window command has arrived.
      await window.companion.command(name);
    } catch (error) {
      if (mounted.current && epoch === commandEpoch.current)
        setCommandError(commandFailureMessage(name, error));
    }
  }, []);
  const resize = useCallback<ResizeAction>(async (width, height, signal) => {
    if (!mounted.current || signal?.aborted) return false;
    const epoch = ++commandEpoch.current;
    if (!window.companion?.resize) {
      setCommandError("Open the desktop companion to resize the window.");
      return false;
    }
    setCommandError(null);
    try {
      // As with commands, only pushed state is authoritative. A late response
      // must never restore a pre-lock, pre-hide, or pre-preset snapshot.
      const next = await window.companion.resize(width, height);
      if (!mounted.current || signal?.aborted || epoch !== commandEpoch.current)
        return false;
      // Only expose the accepted geometry for input reconciliation, never
      // replace the authoritative subscription with this asynchronous reply.
      return next.windowSize ?? true;
    } catch {
      if (mounted.current && !signal?.aborted && epoch === commandEpoch.current)
        setCommandError(
          "Couldn't resize the window. Try again or choose Compact size.",
        );
      return false;
    }
  }, []);
  return {
    state,
    command,
    resize,
    commandError,
    dismissError: () => {
      commandEpoch.current++;
      setCommandError(null);
    },
  };
}
