import { useCallback, useState } from "react";
import type { Agent, AgentLifecycleEvent, Session } from "./types";
import { MAX_VISIBLE_DESKS } from "./world";
import type { LifecycleDirection } from "./lifecycleWalking";
import { residentIdentity } from "./projectProjection";

export const MAX_RESIDENT_HISTORY = 512;

export type ResidentTransition = {
  token: string;
  direction: LifecycleDirection;
  /** Stable exterior slot, retained when an interrupted trip reverses. */
  queueIndex: number;
};
export type ResidentEntry = {
  key: string;
  roomId: string;
  agent: Agent;
  deskIndex: number;
  transition?: ResidentTransition;
};
export function visibleAgents(session: Session, selected: string | null) {
  const shown = session.agents.slice(0, MAX_VISIBLE_DESKS);
  const chosen = session.agents.find((agent) => agent.id === selected);
  if (chosen && !shown.includes(chosen)) shown[MAX_VISIBLE_DESKS - 1] = chosen;
  return shown;
}
const keyFor = (session: string, agent: string) =>
  JSON.stringify([session, agent]);
function roster(sessions: Session[], selected: string | null): ResidentEntry[] {
  return sessions.flatMap((session) =>
    visibleAgents(session, selected).map((agent, deskIndex) => ({
      key: residentIdentity(session.id, agent),
      roomId: session.id,
      agent,
      deskIndex,
    })),
  );
}
type State = {
  scope: string;
  baseline: string;
  hidden: string[];
  signature: string;
  eventSignature: string;
  entries: ResidentEntry[];
  seen: string[];
};
export function useResidentLifecycle({
  sessions,
  selected,
  events,
  epoch,
  enabled,
  reduced,
  connection,
}: {
  sessions: Session[];
  selected: string | null;
  events: AgentLifecycleEvent[];
  epoch: number;
  enabled: boolean;
  reduced: boolean;
  connection: "connecting" | "connected" | "disconnected";
}) {
  const current = roster(sessions, selected);
  const overflowSelection = sessions.some(
    (session) =>
      session.agents.findIndex((agent) => agent.id === selected) >=
      MAX_VISIBLE_DESKS,
  )
    ? selected
    : "";
  // Focus/project/reconnect changes establish a fresh static snapshot. They are
  // navigation/data boundaries, never invented lifecycle events.
  const scope = JSON.stringify([
    epoch,
    enabled,
    reduced,
    connection,
    sessions.map((s) => s.id),
    overflowSelection,
  ]);
  // Retained departures may be outside the visible window and must still
  // receive fresh status/task/provenance updates on subsequent snapshots.
  const signature = JSON.stringify([
    sessions.map((session) => [session.id, session.agents]),
    events,
  ]);
  const eventSignature = JSON.stringify(events.map((event) => event.eventId));
  const baseline = JSON.stringify([epoch, enabled, connection]);
  const fresh = (hidden: string[] = []): State => ({
    scope,
    baseline,
    eventSignature,
    hidden,
    signature,
    entries: current.filter((entry) => !hidden.includes(entry.key)),
    seen: events.map((event) => event.eventId).slice(-MAX_RESIDENT_HISTORY),
  });
  const [stored, setStored] = useState<State>(() => fresh());
  let state = stored;
  if (stored.scope !== scope) {
    // A filter only changes the view, so a previously stopped resident remains
    // absent. A fresh transport epoch is an ordinary authoritative baseline.
    state = fresh(stored.baseline === baseline ? stored.hidden : []);
    setStored(state);
  } else if (stored.signature !== signature) {
    const seen = new Set(stored.seen);
    const latest = new Map<string, AgentLifecycleEvent>();
    if (
      enabled &&
      connection === "connected" &&
      eventSignature !== stored.eventSignature
    ) {
      for (const event of events) {
        if (!seen.has(event.eventId))
          latest.set(keyFor(event.sessionId, event.agentId), event);
      }
    }
    const hidden = new Set(stored.hidden);
    for (const [key, event] of latest) {
      if (event.kind === "stop") {
        hidden.delete(key);
        hidden.add(key);
      } else hidden.delete(key);
    }
    const previous = new Map(stored.entries.map((entry) => [entry.key, entry]));
    // Display priority can move a stopped actor beyond the six-desk window.
    // Keep its newest observed fields throughout its retained departure, even
    // when the visible roster has already made room for a live replacement.
    const observed = new Map(
      sessions.flatMap((session) =>
        session.agents.map(
          (agent) => [residentIdentity(session.id, agent), agent] as const,
        ),
      ),
    );
    const entries: ResidentEntry[] = [];
    const usedSlots = new Set(
      stored.entries.flatMap((entry) =>
        entry.transition ? [entry.transition.queueIndex] : [],
      ),
    );
    const capacity = Math.max(1, sessions.length) * MAX_VISIBLE_DESKS * 2;
    const transition = (
      entry: ResidentEntry,
      event: AgentLifecycleEvent,
      direction: LifecycleDirection,
    ): ResidentTransition | undefined => {
      const existing = previous.get(entry.key)?.transition;
      if (existing) return { ...existing, token: event.eventId, direction };
      let queueIndex = 0;
      while (usedSlots.has(queueIndex) && queueIndex < capacity) queueIndex++;
      if (queueIndex >= capacity) return undefined;
      usedSlots.add(queueIndex);
      return { token: event.eventId, direction, queueIndex };
    };
    // Explicit stop wins over presentation state (a stopped child may report
    // idle). Its last actor/desk survives until the rendered walk completes.
    for (const old of stored.entries) {
      const event = latest.get(old.key);
      if (event?.kind === "stop") {
        const exit = !reduced && transition(old, event, "exiting");
        if (exit)
          entries.push({
            ...old,
            agent: observed.get(old.key) ?? old.agent,
            transition: exit,
          });
      } else if (
        old.transition?.direction === "exiting" &&
        event?.kind !== "start"
      ) {
        if (!reduced)
          entries.push({ ...old, agent: observed.get(old.key) ?? old.agent });
      }
    }
    const occupied = new Map<string, Set<number>>();
    const reserve = (roomId: string, index: number) => {
      if (!occupied.has(roomId)) occupied.set(roomId, new Set());
      occupied.get(roomId)!.add(index);
    };
    for (const entry of entries) reserve(entry.roomId, entry.deskIndex);
    const assigned = new Map<string, number>();
    const seatOwners = new Set<string>();
    // A returning owner reclaims its original chair before an offsite successor
    // that borrowed that departure's slot. Only the waiting successor moves to
    // another free target; the active walk remains on its captured route.
    const existing = current
      .filter((item) => previous.has(item.key) && !hidden.has(item.key))
      .sort(
        (a, b) =>
          Number(previous.get(a.key)!.transition?.direction === "arriving") -
          Number(previous.get(b.key)!.transition?.direction === "arriving"),
      );
    for (const item of existing) {
      const old = previous.get(item.key)!;
      const seatKey = `${item.roomId}:${old.deskIndex}`;
      if (!seatOwners.has(seatKey)) {
        assigned.set(item.key, old.deskIndex);
        seatOwners.add(seatKey);
        reserve(item.roomId, old.deskIndex);
      }
    }
    const sharedDepartureSlots = new Set<string>();
    for (const item of current) {
      const event = latest.get(item.key);
      if (hidden.has(item.key)) continue;
      const old = previous.get(item.key);
      let movement: ResidentTransition | undefined;
      if (!reduced && event?.kind === "start")
        movement = transition(item, event, "arriving");
      else if (!reduced && old?.transition?.direction === "arriving")
        movement = old.transition;
      let deskIndex = assigned.get(item.key);
      if (deskIndex === undefined) {
        deskIndex = Array.from(
          { length: MAX_VISIBLE_DESKS },
          (_, index) => index,
        ).find((index) => !occupied.get(item.roomId)?.has(index));
        if (deskIndex === undefined && movement) {
          const outgoing = entries.find(
            (entry) =>
              entry.roomId === item.roomId &&
              entry.transition?.direction === "exiting" &&
              !sharedDepartureSlots.has(`${item.roomId}:${entry.deskIndex}`),
          );
          deskIndex = outgoing?.deskIndex;
          if (outgoing) sharedDepartureSlots.add(`${item.roomId}:${deskIndex}`);
        }
      }
      // If every seat is still physically occupied, an unmarked snapshot-only
      // replacement waits for a real departure to complete instead of popping
      // into the chair or removing the outgoing walker.
      if (deskIndex === undefined) continue;
      reserve(item.roomId, deskIndex);
      entries.push({ ...item, deskIndex, transition: movement });
    }
    const relevant = new Set(
      [...current, ...entries].map((entry) => entry.key),
    );
    const retainedHidden = [...hidden].filter((key) => relevant.has(key));
    const historyRoom = Math.max(
      0,
      MAX_RESIDENT_HISTORY - retainedHidden.length,
    );
    const recentHidden = historyRoom
      ? [...hidden].filter((key) => !relevant.has(key)).slice(-historyRoom)
      : [];
    state = {
      scope,
      baseline,
      signature,
      eventSignature,
      hidden: [...retainedHidden, ...recentHidden].slice(-MAX_RESIDENT_HISTORY),
      entries: entries.slice(0, capacity),
      seen: [
        ...stored.seen,
        ...events
          .filter((event) => !seen.has(event.eventId))
          .map((event) => event.eventId),
      ].slice(-MAX_RESIDENT_HISTORY),
    };
    setStored(state);
  }
  const complete = useCallback(
    (key: string, token: string, direction: LifecycleDirection) => {
      setStored((value) =>
        value.scope !== scope
          ? value
          : {
              ...value,
              signature: "",
              entries: value.entries.flatMap((entry) => {
                if (
                  entry.key !== key ||
                  entry.transition?.token !== token ||
                  entry.transition.direction !== direction
                )
                  return [entry];
                return direction === "exiting"
                  ? []
                  : [{ ...entry, transition: undefined }];
              }),
            },
      );
    },
    [scope],
  );
  return { residents: state.entries, complete, scope };
}
