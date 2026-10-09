import { useEffect, useState } from "react";
import type { Snapshot } from "./types";
export function useOfficeData() {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    sessions: [],
    updatedAt: Date.now(),
  });
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    fetch("/api/snapshot", { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((data) => {
        if (active && Array.isArray(data.sessions)) {
          setSnapshot(data);
          setConnection("connected");
        }
      })
      .catch(() => {
        if (active) setConnection("disconnected");
      });
    const stream = new EventSource("/api/events");
    stream.addEventListener("snapshot", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        if (active && Array.isArray(data.sessions)) {
          setSnapshot(data);
          setConnection("connected");
        }
      } catch {
        if (active) setConnection("disconnected");
      }
    });
    stream.onopen = () => {
      if (active) setConnection("connected");
    };
    stream.onerror = () => {
      if (active) setConnection("disconnected");
    };
    return () => {
      active = false;
      abort.abort();
      stream.close();
    };
  }, []);
  return { snapshot, connection };
}
