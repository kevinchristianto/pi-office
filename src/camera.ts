import { Vector3 } from "three";
/** Fit every world-bound corner in a perspective view, including depth changes.
 * Margins reserve room for the small HUD without shrinking into a dashboard. */
export function fitOfficeCamera(
  width: number,
  height: number,
  roomCount: number,
) {
  const count = Math.max(1, Math.min(4, Math.floor(roomCount)));
  const target = new Vector3((count - 1) * 7, 0.95, 0);
  const backward = new Vector3(0.47, 0.72, 1).normalize();
  const right = new Vector3(0, 1, 0).cross(backward).normalize();
  const up = backward.clone().cross(right).normalize();
  const fov = 42;
  const tangent = Math.tan((fov * Math.PI) / 360);
  const aspect = Math.max(1, width) / Math.max(1, height);
  let distance = 14;
  for (const x of [-6.2, (count - 1) * 14 + 6.2])
    for (const y of [-0.4, 3.2])
      for (const z of [-5.2, 5.2]) {
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
