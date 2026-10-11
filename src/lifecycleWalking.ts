import { motionFrameDelta, WALK_REVERSAL_SECONDS } from "./motion";

/** Frame-driven, view-only travel. Distance is measured on an exterior→seat route. */
export type LifecycleDirection = "arriving" | "exiting";
export type LifecycleWalkPhase =
  "waiting" | "standing" | "walking" | "seating" | "settled";
export type LifecycleWalk = {
  direction: LifecycleDirection;
  phase: LifecycleWalkPhase;
  distance: number;
  elapsed: number;
  notified: boolean;
  turnRemaining: number;
};
export const LIFECYCLE_POSE_SECONDS = 0.32;
export const MAX_LIFECYCLE_QUEUE = 64;
export const LIFECYCLE_CORRIDOR_KEY = "\0office-lifecycle-corridor";
export type LifecycleTraffic = { queue: string[]; capacity: number };
const trafficByReservations = new WeakMap<
  Map<string, string>,
  LifecycleTraffic
>();

const commandsByReservations = new WeakMap<
  Map<string, string>,
  Map<string, string>
>();
/** Command consumption belongs to the office, surviving view-only remounts. */
export function consumeVisualCommand(
  reservations: Map<string, string>,
  actorId: string,
  command: string,
) {
  let consumed = commandsByReservations.get(reservations);
  if (!consumed) {
    consumed = new Map();
    commandsByReservations.set(reservations, consumed);
  }
  if (consumed.get(actorId) === command) return false;
  consumed.delete(actorId);
  consumed.set(actorId, command);
  while (consumed.size > 512) consumed.delete(consumed.keys().next().value!);
  return true;
}

export function lifecycleTrafficFor(
  reservations: Map<string, string>,
): LifecycleTraffic {
  let traffic = trafficByReservations.get(reservations);
  if (!traffic) {
    traffic = { queue: [], capacity: MAX_LIFECYCLE_QUEUE };
    trafficByReservations.set(reservations, traffic);
  }
  return traffic;
}
export function createLifecycleWalk(
  direction: LifecycleDirection,
  total: number,
): LifecycleWalk {
  return {
    direction,
    phase: "waiting",
    distance: direction === "arriving" ? 0 : total,
    elapsed: 0,
    notified: false,
    turnRemaining: 0,
  };
}
/** A restart/stop reverses the same path at its current position, never at a desk. */
export function reverseLifecycleWalk(
  state: LifecycleWalk,
  direction: LifecycleDirection,
  total: number,
) {
  if (state.direction === direction) return;
  // Hold translation during a genuine turn-around; the rendered body turns
  // using the shared bounded heading rather than moonwalking in reverse.
  state.turnRemaining = state.phase === "walking" ? WALK_REVERSAL_SECONDS : 0;
  state.direction = direction;
  state.notified = false;
  state.elapsed = 0;
  if (state.phase === "standing") state.phase = "seating";
  else if (state.phase === "seating") state.phase = "standing";
  else if (state.phase === "settled") state.phase = "waiting";
  state.distance = Math.max(0, Math.min(total, state.distance));
}
export function releaseLifecycleWalk(
  reservations: Map<string, string>,
  roomId: string,
  agentId: string,
) {
  const traffic = lifecycleTrafficFor(reservations);
  traffic.queue = traffic.queue.filter((id) => id !== agentId);
  if (reservations.get(LIFECYCLE_CORRIDOR_KEY) === agentId)
    reservations.delete(LIFECYCLE_CORRIDOR_KEY);
  if (reservations.get(roomId) === agentId) reservations.delete(roomId);
}
function acquire(
  reservations: Map<string, string>,
  roomId: string,
  agentId: string,
) {
  const traffic = lifecycleTrafficFor(reservations);
  if (
    !traffic.queue.includes(agentId) &&
    traffic.queue.length < traffic.capacity
  )
    traffic.queue.push(agentId);
  const owner = reservations.get(LIFECYCLE_CORRIDOR_KEY);
  if (owner === agentId) return true;
  if (owner || traffic.queue[0] !== agentId) return false;
  const roomOwner = reservations.get(roomId);
  if (roomOwner && roomOwner !== agentId) return false;
  reservations.set(LIFECYCLE_CORRIDOR_KEY, agentId);
  reservations.set(roomId, agentId);
  traffic.queue.shift();
  return true;
}
/**
 * Called only by the rendered frame loop. A callback is due only after actual
 * travelled distance and the seat pose settle; wall-clock timers cannot remove
 * a walker after a slow/background frame. A paused renderer pauses the trip.
 */
export function stepLifecycleWalk(
  state: LifecycleWalk,
  rawDelta: number,
  total: number,
  speed: number,
  roomId: string,
  agentId: string,
  reservations: Map<string, string>,
): LifecycleDirection | null {
  const delta = motionFrameDelta(rawDelta);
  if (state.phase === "settled") {
    if (state.notified) return null;
    state.notified = true;
    releaseLifecycleWalk(reservations, roomId, agentId);
    return state.direction;
  }
  // Cancellation before leaving the queue needs no movement or aisle ownership.
  const atDestination =
    state.direction === "arriving"
      ? state.distance >= total
      : state.distance <= 0;
  if (state.phase === "waiting" && atDestination) {
    state.phase = "settled";
  } else if (state.phase === "waiting") {
    if (!acquire(reservations, roomId, agentId)) return null;
    state.phase = state.direction === "exiting" ? "standing" : "walking";
    state.elapsed = 0;
  }
  if (state.phase === "standing") {
    state.elapsed += delta;
    if (state.elapsed >= LIFECYCLE_POSE_SECONDS) {
      state.phase = "walking";
      state.elapsed = 0;
    }
  } else if (state.phase === "walking") {
    if (state.turnRemaining > 0) {
      state.turnRemaining = Math.max(0, state.turnRemaining - delta);
      return null;
    }
    const signed = state.direction === "arriving" ? 1 : -1;
    state.distance = Math.max(
      0,
      Math.min(total, state.distance + signed * delta * speed),
    );
    if (state.direction === "arriving" && state.distance >= total) {
      state.phase = "seating";
      state.elapsed = 0;
    } else if (state.direction === "exiting" && state.distance <= 0) {
      state.phase = "settled";
    }
  } else if (state.phase === "seating") {
    state.elapsed += delta;
    if (state.elapsed >= LIFECYCLE_POSE_SECONDS) state.phase = "settled";
  }
  if (state.phase === "settled") {
    state.notified = true;
    releaseLifecycleWalk(reservations, roomId, agentId);
    return state.direction;
  }
  return null;
}
