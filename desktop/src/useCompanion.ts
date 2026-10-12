import { useCallback, useEffect, useState } from "react";
import type { CompanionCommand, CompanionState } from "./types";

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
    if (!window.companion) {
      setCommandError("Open the desktop companion to use window controls.");
      return;
    }
    setCommandError(null);
    try {
      // State is delivered by the subscription. Avoid applying an older command
      // reply after a newer snapshot or another window command has arrived.
      await window.companion.command(name);
    } catch {
      setCommandError("That window action didn't finish. Please try again.");
    }
  }, []);
  return {
    state,
    command,
    commandError,
    dismissError: () => setCommandError(null),
  };
}
