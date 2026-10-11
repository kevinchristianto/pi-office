import { Html } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { createBuildingEntranceLayout } from "./world";
import { createEntranceDecor } from "./entranceDecor";
import { buildSolidModel } from "./models";

/** Open front doorway and exterior forecourt. The walking centerline is clear. */
export default function BuildingEntrance({ count }: { count: number }) {
  const entrance = createBuildingEntranceLayout(count);
  const object = useMemo(
    () => buildSolidModel(createEntranceDecor(count)),
    [count],
  );
  useEffect(
    () => () => {
      const materials = new Set<THREE.Material>();
      object.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material])
            materials.add(material);
        }
      });
      materials.forEach((material) => material.dispose());
    },
    [object],
  );
  return (
    <group>
      <primitive object={object} />
      <Html
        center
        position={[entrance.threshold[0], 2.87, entrance.threshold[1] + 0.085]}
        zIndexRange={[7, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            color: "#eef5f7",
            background: "#263b4b",
            borderRadius: 3,
            padding: "3px 12px",
            fontSize: 10,
            letterSpacing: "0.13em",
            whiteSpace: "nowrap",
            fontWeight: 700,
          }}
        >
          π OFFICE · ENTRANCE
        </div>
      </Html>
    </group>
  );
}
