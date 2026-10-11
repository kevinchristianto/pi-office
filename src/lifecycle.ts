import type {
  AgentLifecycleEvent,
  AgentLifecycleMarker,
  Snapshot,
} from "./types";

/** Cosmetic effects are deliberately gated even after a delayed ingest. */
export const LIFECYCLE_EVENT_MAX_AGE_MS = 10_000;
export const MAX_LIFECYCLE_EVENTS = 128;
const MAX_SEEN_MARKERS = 2048;
const isMarker = (value: unknown): value is AgentLifecycleMarker => {
  if (!value || typeof value !== "object") return false;
  const marker = value as AgentLifecycleMarker;
  return (
    marker.version === 1 &&
    typeof marker.eventId === "string" &&
    /^[A-Za-z0-9:_-]{1,160}$/.test(marker.eventId) &&
    typeof marker.at === "string" &&
    Number.isFinite(Date.parse(marker.at)) &&
    ((marker.source === "pi:session_start" && marker.kind === "start") ||
      (marker.source === "pi:session_shutdown" && marker.kind === "stop") ||
      (marker.source === "pi-subagents:child-status" &&
        (marker.kind === "start" || marker.kind === "stop")))
  );
};

/**
 * Runs on the complete live stream, before room/roster filtering. A snapshot
 * establishes state; only a fresh explicit marker on a continuous stream can
 * establish an animation. There is no membership- or task-state diff heuristic.
 */
export function createLifecycleGate(now = Date.now) {
  let streamId: string | undefined;
  let revision = -1;
  let connectedAt = 0;
  let ready = false;
  let hasBaseline = false;
  let agents = new Set<string>();
  const seen = new Map<string, true>();
  const remember = (id: string) => {
    seen.set(id, true);
    if (seen.size > MAX_SEEN_MARKERS) seen.delete(seen.keys().next().value!);
  };
  function reset() {
    ready = false;
    hasBaseline = false;
    streamId = undefined;
    revision = -1;
    agents = new Set();
    seen.clear();
  }
  function read(snapshot: Snapshot) {
    const time = now();
    const validStream =
      typeof snapshot.streamId === "string" &&
      snapshot.streamId.length > 0 &&
      Number.isSafeInteger(snapshot.revision) &&
      snapshot.revision! >= 0;
    const newBaseline =
      !ready || !validStream || snapshot.streamId !== streamId;
    // Legacy snapshots cannot prove lifecycle continuity, so every one is a
    // marker-ineligible baseline. That does not make every heartbeat a new
    // transport: repeated visual resets would remount every resident and rig.
    const resetVisuals =
      !hasBaseline ||
      (validStream ? !ready || snapshot.streamId !== streamId : ready);
    // Do not let a late HTTP read or reordered stream frame rewind the UI.
    if (!newBaseline && snapshot.revision! < revision)
      return {
        accepted: false,
        reset: false,
        events: [] as AgentLifecycleEvent[],
      };
    const current = new Set<string>();
    const events: AgentLifecycleEvent[] = [];
    for (const session of snapshot.sessions) {
      for (const agent of session.agents) {
        const key = `${session.id}\0${agent.id}`;
        current.add(key);
        const marker = agent.lifecycle;
        if (!isMarker(marker)) continue;
        const at = Date.parse(marker.at);
        if (
          !newBaseline &&
          snapshot.revision! > revision &&
          !seen.has(marker.eventId) &&
          at >= connectedAt &&
          at <= time &&
          time - at <= LIFECYCLE_EVENT_MAX_AGE_MS &&
          (marker.kind === "start" || agents.has(key))
        )
          events.push({ ...marker, sessionId: session.id, agentId: agent.id });
        remember(marker.eventId);
      }
    }
    if (newBaseline) connectedAt = time;
    hasBaseline = true;
    ready = validStream;
    streamId = snapshot.streamId;
    revision = snapshot.revision ?? -1;
    agents = current;
    return {
      accepted: true,
      reset: resetVisuals,
      events: events.slice(-MAX_LIFECYCLE_EVENTS),
    };
  }
  return { read, reset };
}
