export type MotionState = {
  mode: "seated" | "outbound" | "lounge" | "returning";
  distance: number;
  dwell: number;
  waveUntil: number;
  pending: boolean;
  yaw: number;
};
export const createMotion = (): MotionState => ({
  mode: "seated",
  distance: 0,
  dwell: 0,
  waveUntil: 0,
  pending: false,
  yaw: 0,
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
    if (state.mode === "outbound" || state.mode === "lounge")
      state.mode = "returning";
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
  const dt = Math.max(0, Math.min(delta, 0.05));
  if (state.pending && !reservations.has(roomId)) {
    reservations.set(roomId, agentId);
    state.pending = false;
    state.mode = "outbound";
    state.distance = 0;
  }
  if (state.mode === "outbound") {
    state.distance = Math.min(total, state.distance + dt * 1.2);
    if (state.distance >= total) {
      state.mode = "lounge";
      state.dwell = 5;
    }
  } else if (state.mode === "lounge") {
    state.dwell -= dt;
    if (state.dwell <= 0) state.mode = "returning";
  } else if (state.mode === "returning") {
    state.distance = Math.max(0, state.distance - dt * 1.2);
    if (state.distance <= 0) {
      state.mode = "seated";
      if (reservations.get(roomId) === agentId) reservations.delete(roomId);
    }
  }
}
