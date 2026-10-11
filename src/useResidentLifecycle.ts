import { useCallback, useState } from "react";
import type {
  Agent,
  AgentLifecycleEvent,
  AgentLifecycleMarker,
  Session,
} from "./types";
import { MAX_VISIBLE_DESKS } from "./world";
import type { LifecycleDirection } from "./lifecycleWalking";
import { isHistoricalAgent, residentIdentity } from "./projectProjection";

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
  const current = session.agents.filter(
    (agent) => !isHistoricalAgent(session, agent),
  );
  const shown = current.slice(0, MAX_VISIBLE_DESKS);
  const chosen = current.find((agent) => agent.id === selected);
  if (chosen && !shown.includes(chosen)) shown[MAX_VISIBLE_DESKS - 1] = chosen;
  return shown;
}
const keyFor = (session: string, agent: string) =>
  JSON.stringify([session, agent]);
type StoppedResident = {
  key: string;
  marker: AgentLifecycleMarker;
  previousStartId?: string;
};
/**
 * Transport resets settle travel, not a resident's lifetime. A newer start
 * snapshot can reopen a stopped lifetime without replaying its arrival; an
 * old pre-stop start marker or an unmarked heartbeat cannot resurrect it.
 */
function reconcileStopped(
  stopped: StoppedResident[],
  sessions: Session[],
): Map<string, StoppedResident> {
  const hidden = new Map(stopped.map((entry) => [entry.key, entry]));
  for (const session of sessions) {
    for (const agent of session.agents) {
      const marker = agent.lifecycle;
      if (!marker) continue;
      const key = residentIdentity(session.id, agent);
      const previous = hidden.get(key);
      if (marker.kind === "stop") {
        if (
          !previous ||
          Date.parse(marker.at) >= Date.parse(previous.marker.at)
        )
          hidden.set(key, { ...previous, key, marker });
      } else if (
        previous &&
        marker.eventId !== previous.previousStartId &&
        Date.parse(marker.at) >= Date.parse(previous.marker.at)
      )
        hidden.delete(key);
    }
  }
  return hidden;
}
function stoppedHistory(
  hidden: Map<string, StoppedResident>,
  relevant: Set<string>,
): StoppedResident[] {
  const entries = [...hidden.values()];
  const retained = entries.filter((entry) => relevant.has(entry.key));
  const room = Math.max(0, MAX_RESIDENT_HISTORY - retained.length);
  const recent = room
    ? entries.filter((entry) => !relevant.has(entry.key)).slice(-room)
    : [];
  return [...retained, ...recent].slice(-MAX_RESIDENT_HISTORY);
}
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
  resetScope: string;
  enabled: boolean;
  roomIds: string[];
  hidden: StoppedResident[];
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
  const roomIds = sessions.map((session) => session.id);
  const resetScope = JSON.stringify([epoch, enabled, reduced, connection]);
  // Transport and accessibility changes establish a baseline. View changes
  // only rebase rooms whose physical slot changed, keeping unaffected walkers.
  const scope = JSON.stringify([resetScope, roomIds]);
  // Retained departures may be outside the visible window and must still
  // receive fresh status/task/provenance updates on subsequent snapshots.
  const signature = JSON.stringify([
    sessions.map((session) => [
      session.id,
      session.connectionState,
      session.connected,
      session.agents,
    ]),
    events,
    // Selection changes the six-desk window, not the lifetime of every actor.
    // In particular, historical priority can move the unchanged selection
    // past the cutoff on a stop snapshot; its marker must still be consumed.
    selected,
  ]);
  const eventSignature = JSON.stringify(events.map((event) => event.eventId));
  const fresh = (stopped: StoppedResident[] = []): State => {
    const hidden = reconcileStopped(stopped, sessions);
    return {
      scope,
      resetScope,
      enabled,
      roomIds,
      eventSignature,
      hidden: stoppedHistory(
        hidden,
        new Set(current.map((entry) => entry.key)),
      ),
      signature,
      entries: current.filter((entry) => !hidden.has(entry.key)),
      seen: events.map((event) => event.eventId).slice(-MAX_RESIDENT_HISTORY),
    };
  };
  const [stored, setStored] = useState<State>(() => fresh());
  let state = stored;
  if (stored.resetScope !== resetScope) {
    // Reconnect/accessibility baselines cancel travel and keep confirmed stops
    // absent. Live/demo switches are separate observation namespaces, so a
    // coincidentally matching sample identity must not inherit a live stop.
    state = fresh(stored.enabled === enabled ? stored.hidden : []);
    setStored(state);
  } else if (stored.scope !== scope || stored.signature !== signature) {
    // The centered grid changes when the room count or slot changes. Never
    // carry an absolute walking path through relocated furniture. Unrelated
    // room replacement at the same count leaves other slots uninterrupted.
    const stableRooms = new Set(
      roomIds.filter(
        (id, index) =>
          roomIds.length === stored.roomIds.length &&
          stored.roomIds[index] === id,
      ),
    );
    const observedRooms = new Map(
      sessions.flatMap((session) =>
        session.agents.map(
          (agent) => [residentIdentity(session.id, agent), session.id] as const,
        ),
      ),
    );
    const previousEntries = stored.entries.filter(
      (entry) =>
        stableRooms.has(entry.roomId) &&
        (!observedRooms.has(entry.key) ||
          observedRooms.get(entry.key) === entry.roomId),
    );
    const seen = new Set(stored.seen);
    const latest = new Map<string, AgentLifecycleEvent>();
    const unrenderedStops = new Set<string>();
    if (
      enabled &&
      connection === "connected" &&
      eventSignature !== stored.eventSignature
    ) {
      for (const event of events) {
        if (!seen.has(event.eventId)) {
          const key = keyFor(event.sessionId, event.agentId);
          latest.set(key, event);
          if (event.kind === "stop") unrenderedStops.add(key);
        }
      }
    }
    const hidden = reconcileStopped(stored.hidden, sessions);
    for (const [key, event] of latest) {
      if (event.kind === "stop") {
        const old = previousEntries.find((entry) => entry.key === key);
        const previousStartId =
          old?.agent.lifecycle?.kind === "start"
            ? old.agent.lifecycle.eventId
            : hidden.get(key)?.previousStartId;
        hidden.delete(key);
        hidden.set(key, { key, marker: event, previousStartId });
      } else hidden.delete(key);
    }
    const previous = new Map(
      previousEntries.map((entry) => [entry.key, entry]),
    );
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
      previousEntries.flatMap((entry) =>
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
    for (const old of previousEntries) {
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
        event?.kind !== "start" &&
        hidden.has(old.key)
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
      if (
        !reduced &&
        event?.kind === "start" &&
        stableRooms.has(item.roomId) &&
        // Stop/restart frames can be batched into one React commit. An actor
        // that never began that departure is already here; leave it in place.
        !(unrenderedStops.has(item.key) && old && !old.transition)
      )
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
    state = {
      scope,
      resetScope,
      enabled,
      roomIds,
      signature,
      eventSignature,
      hidden: stoppedHistory(hidden, relevant),
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
