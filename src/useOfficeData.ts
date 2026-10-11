import { useEffect, useState } from "react";
import type { AgentLifecycleEvent, Snapshot } from "./types";
import { createLifecycleGate, MAX_LIFECYCLE_EVENTS } from "./lifecycle";
export function useOfficeData() {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    sessions: [],
    updatedAt: Date.now(),
  });
  const [lifecycleEvents, setLifecycleEvents] = useState<AgentLifecycleEvent[]>(
    [],
  );
  const [lifecycleEpoch, setLifecycleEpoch] = useState(0);
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  useEffect(() => {
    let active = true;
    let receivedStream = false;
    const gate = createLifecycleGate();
    const abort = new AbortController();
    const disconnected = () => {
      gate.reset();
      if (active) {
        setLifecycleEpoch((value) => value + 1);
        setLifecycleEvents([]);
        setConnection("disconnected");
      }
    };
    fetch("/api/snapshot", { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((data) => {
        // HTTP is a baseline only. It may resolve after a newer SSE snapshot.
        if (active && !receivedStream && Array.isArray(data.sessions)) {
          setSnapshot(data);
          setConnection("connected");
        }
      })
      .catch(() => {
        if (active && !receivedStream) disconnected();
      });
    const stream = new EventSource("/api/events");
    stream.addEventListener("snapshot", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        if (active && Array.isArray(data.sessions)) {
          const result = gate.read(data);
          receivedStream = true;
          if (!result.accepted) return;
          setSnapshot(data);
          if (result.reset) {
            setLifecycleEpoch((value) => value + 1);
            setLifecycleEvents([]);
          } else if (result.events.length)
            setLifecycleEvents((previous) =>
              [...previous, ...result.events].slice(-MAX_LIFECYCLE_EVENTS),
            );
          setConnection("connected");
        }
      } catch {
        disconnected();
      }
    });
    stream.onopen = () => {
      // Every EventSource open, including automatic reconnect, starts a baseline.
      gate.reset();
      if (active) {
        setLifecycleEpoch((value) => value + 1);
        setLifecycleEvents([]);
        setConnection("connected");
      }
    };
    stream.onerror = disconnected;
    return () => {
      active = false;
      abort.abort();
      stream.close();
    };
  }, []);
  return { snapshot, connection, lifecycleEvents, lifecycleEpoch };
}
