import { MathUtils, Vector3 } from "three";
import { buildingLayoutBounds, type RoomBounds } from "./world";

export type CameraAction =
  | { type: "focus"; id: string; serial: number }
  | { type: "zoom-in" | "zoom-out"; serial: number };
export type CameraBounds = RoomBounds;
export const CAMERA_MIN_DISTANCE = 5.5;
export const CAMERA_MIN_POLAR = 0.3;
export const CAMERA_MAX_POLAR = Math.PI / 2.65;
export const CAMERA_FOCUS_DISTANCE = 9;

export function visibleRoomCount(count: number) {
  // The visible-project limit belongs to App, not camera geometry. A direct
  // scene with more sections must still be frameable and navigable.
  return Number.isFinite(count)
    ? MathUtils.clamp(Math.floor(count), 1, Number.MAX_SAFE_INTEGER)
    : 1;
}
export function officeCameraBounds(count: number): CameraBounds {
  const bounds = buildingLayoutBounds(visibleRoomCount(count));
  return {
    minX: bounds.minX - 0.5,
    maxX: bounds.maxX + 0.5,
    minZ: bounds.minZ - 0.5,
    maxZ: bounds.maxZ + 1,
  };
}
/** Move the eye and target together, preserving orientation and zoom at an edge. */
export function constrainCameraTarget(
  position: Vector3,
  target: Vector3,
  bounds: CameraBounds,
) {
  const x = MathUtils.clamp(target.x, bounds.minX, bounds.maxX);
  const z = MathUtils.clamp(target.z, bounds.minZ, bounds.maxZ);
  position.x += x - target.x;
  position.z += z - target.z;
  // Assign exact bounds; adding a correction can round fractionally outside
  // a decimal boundary after a large drag.
  target.x = x;
  target.z = z;
}
/** Frame-rate independent easing, with a cap after a hidden-tab/slow-frame gap. */
export function cameraEase(delta: number, reduced = false) {
  return reduced ? 1 : 1 - Math.exp(-MathUtils.clamp(delta, 0, 0.1) * 8);
}
export function cameraPan(
  keys: ReadonlySet<string>,
  backward: Vector3,
  distance: number,
  delta: number,
) {
  const forward = new Vector3(-backward.x, 0, -backward.z).normalize();
  const right = new Vector3(-forward.z, 0, forward.x);
  const forwardAmount =
    Number(keys.has("w") || keys.has("arrowup")) -
    Number(keys.has("s") || keys.has("arrowdown"));
  const rightAmount =
    Number(keys.has("d") || keys.has("arrowright")) -
    Number(keys.has("a") || keys.has("arrowleft"));
  const direction = forward
    .multiplyScalar(forwardAmount)
    .addScaledVector(right, rightAmount);
  // Diagonal input never moves faster. Pan scales with the visible world size.
  return direction
    .normalize()
    .multiplyScalar(
      MathUtils.clamp(distance * 0.45, 3, 24) * MathUtils.clamp(delta, 0, 0.05),
    );
}
/** Normalize wheel devices (pixels, lines, pages) without huge one-event jumps. */
export function cameraWheelScale(delta: number, mode: number, height: number) {
  if (!Number.isFinite(delta)) return 1;
  const pixels =
    delta * (mode === 1 ? 16 : mode === 2 ? Math.max(1, height) : 1);
  return Math.exp(MathUtils.clamp(pixels, -240, 240) * 0.0018);
}
export function cameraKey(
  key: string,
): "pan" | "zoom-in" | "zoom-out" | "reset" | null {
  const normalized = key.toLowerCase();
  if (
    [
      "w",
      "a",
      "s",
      "d",
      "arrowup",
      "arrowdown",
      "arrowleft",
      "arrowright",
    ].includes(normalized)
  )
    return "pan";
  if (key === "+" || key === "=") return "zoom-in";
  if (key === "-" || key === "_") return "zoom-out";
  return key === "Home" ? "reset" : null;
}
/** Fit every world-bound corner in a perspective view, including depth changes.
 * Margins reserve space for the HUD. Only initial entry and explicit Fit use this. */
export function fitOfficeCamera(
  width: number,
  height: number,
  roomCount: number,
) {
  const bounds = buildingLayoutBounds(visibleRoomCount(roomCount));
  const target = new Vector3(
    (bounds.minX + bounds.maxX) / 2,
    0.95,
    (bounds.minZ + bounds.maxZ) / 2,
  );
  const backward = new Vector3(0.47, 0.72, 1).normalize();
  const right = new Vector3(0, 1, 0).cross(backward).normalize();
  const up = backward.clone().cross(right).normalize();
  const fov = 42;
  const tangent = Math.tan((fov * Math.PI) / 360);
  const safeSize = (value: number) =>
    Number.isFinite(value) ? Math.max(1, value) : 1;
  const aspect = safeSize(width) / safeSize(height);
  let distance = 14;
  for (const x of [bounds.minX - 0.2, bounds.maxX + 0.2])
    for (const y of [-0.4, 3.2])
      for (const z of [bounds.minZ - 0.2, bounds.maxZ + 0.2]) {
        const relative = new Vector3(x, y, z).sub(target);
        const near = relative.dot(backward);
        distance = Math.max(
          distance,
          near + Math.abs(relative.dot(right)) / (tangent * aspect * 0.86),
          near + Math.abs(relative.dot(up)) / (tangent * 0.78),
        );
      }
  const position = target.clone().addScaledVector(backward, distance);
  return {
    fov,
    distance,
    target: target.toArray() as [number, number, number],
    position: position.toArray() as [number, number, number],
  };
}
