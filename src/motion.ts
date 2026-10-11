/** Shared by rendered travel, controllers, and deterministic visual reviews. */
export const WALK_SPEED = 1.8;
export const WALK_GAIT_RATE = 1.5;
/** A half turn takes at least half a second, including an interrupted trip. */
export const WALK_TURN_SPEED = Math.PI * 2;
export const MAX_MOTION_FRAME_SECONDS = 0.05;
export const WALK_REVERSAL_SECONDS = Math.PI / WALK_TURN_SPEED;

export function motionFrameDelta(rawDelta: number) {
  return Number.isNaN(rawDelta)
    ? 0
    : Math.max(0, Math.min(rawDelta, MAX_MOTION_FRAME_SECONDS));
}

/** Keep clip crossfades and nonwalking poses on their unmodified wall clock. */
export function animationPlaybackRate(clip: string) {
  return clip.toLowerCase() === "walk" ? WALK_GAIT_RATE : 1;
}

/**
 * Shortest-path, bounded heading shared by the runtime and offline review.
 * Return an unwrapped angle so crossing ±PI cannot create a visible full turn.
 */
export function stepHeading(current: number, target: number, rawDelta: number) {
  const tau = Math.PI * 2;
  const difference =
    ((((target - current + Math.PI) % tau) + tau) % tau) - Math.PI;
  const maximum = WALK_TURN_SPEED * motionFrameDelta(rawDelta);
  return current + Math.max(-maximum, Math.min(maximum, difference));
}

export type MotionState = {
  mode: "seated" | "outbound" | "lounge" | "returning";
  distance: number;
  dwell: number;
  waveUntil: number;
  pending: boolean;
  yaw: number;
  turnRemaining: number;
};
export const createMotion = (): MotionState => ({
  mode: "seated",
  distance: 0,
  dwell: 0,
  waveUntil: 0,
  pending: false,
  yaw: 0,
  turnRemaining: 0,
});
export function requestMotion(
  state: MotionState,
  type: "wave" | "walk" | "return",
  now: number,
) {
  if (type === "wave") state.waveUntil = now + 2.6;
  else if (type === "walk") {
    if (state.mode === "seated") state.pending = true;
    else if (state.mode === "lounge") state.dwell = 0;
  } else {
    state.pending = false;
    if (state.mode === "outbound" || state.mode === "lounge") {
      state.mode = "returning";
      state.turnRemaining = WALK_REVERSAL_SECONDS;
    }
  }
}
// One walking resident owns a room's aisle through its round trip. This prevents
// opposing route traffic; queued visual requests wait without changing Pi state.
export function stepMotion(
  state: MotionState,
  delta: number,
  total: number,
  roomId: string,
  agentId: string,
  reservations: Map<string, string>,
) {
  const dt = motionFrameDelta(delta);
  if (state.pending && !reservations.has(roomId)) {
    reservations.set(roomId, agentId);
    state.pending = false;
    state.mode = "outbound";
    state.distance = 0;
  }
  if (state.turnRemaining > 0) {
    state.turnRemaining = Math.max(0, state.turnRemaining - dt);
    return;
  }
  if (state.mode === "outbound") {
    state.distance = Math.min(total, state.distance + dt * WALK_SPEED);
    if (state.distance >= total) {
      state.mode = "lounge";
      state.dwell = 5;
    }
  } else if (state.mode === "lounge") {
    state.dwell -= dt;
    if (state.dwell <= 0) {
      state.mode = "returning";
      state.turnRemaining = WALK_REVERSAL_SECONDS;
    }
  } else if (state.mode === "returning") {
    state.distance = Math.max(0, state.distance - dt * WALK_SPEED);
    if (state.distance <= 0) {
      state.mode = "seated";
      if (reservations.get(roomId) === agentId) reservations.delete(roomId);
    }
  }
}
