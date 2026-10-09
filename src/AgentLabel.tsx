import { Html } from "@react-three/drei";

export default function AgentLabel({
  name,
  color,
  state,
  selected,
  dim,
}: {
  name: string;
  color: string;
  state: string;
  selected: boolean;
  dim: boolean;
}) {
  return (
    // No distanceFactor: Drei uses a fixed CSS scale of 1. With an orthographic
    // camera, distanceFactor multiplies camera.zoom and can obscure the room.
    <Html
      zIndexRange={[10, 0]}
      position={[0, 1.8, 0.1]}
      center
      style={{ pointerEvents: "none" }}
    >
      <div
        className={`desk-label ${selected ? "selected" : ""} ${dim ? "dim" : ""}`}
        style={{ maxWidth: 156, height: 27, fontSize: 10, lineHeight: "13px" }}
      >
        <i style={{ background: color }} />
        <span className="desk-label-name" title={name}>
          {name}
        </span>
        <span className="desk-label-state" aria-hidden="true">
          {state === "working"
            ? "↗"
            : state === "thinking"
              ? "···"
              : state === "waiting"
                ? "◷"
                : "·"}
        </span>
      </div>
    </Html>
  );
}
