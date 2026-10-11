import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
// Furniture is static: combine compatible meshes by material after baking their
// world transforms. Keep the authored GLB unchanged and reduce draw calls locally.
export function mergeStaticModel(source: THREE.Object3D) {
  source.updateMatrixWorld(true);
  const batches = new Map<
    string,
    { material: THREE.Material; geometries: THREE.BufferGeometry[] }
  >();
  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material))
      return;
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    const signature = Object.keys(geometry.attributes)
      .sort()
      .map((k) => `${k}:${geometry.attributes[k].itemSize}`)
      .join(",");
    const key =
      object.material.uuid + "|" + signature + "|" + Boolean(geometry.index);
    let batch = batches.get(key);
    if (!batch) {
      batch = { material: object.material, geometries: [] };
      batches.set(key, batch);
    }
    batch.geometries.push(geometry);
  });
  const result = new THREE.Group();
  for (const { material, geometries } of batches.values()) {
    const merged = mergeGeometries(geometries, false);
    if (merged) {
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      result.add(mesh);
    }
    for (const g of geometries) g.dispose();
  }
  return result;
}

/** Batch architecture by material; own buffers, retain cached GLTF materials elsewhere. */
export function buildSolidModel(
  solids: readonly {
    position: [number, number, number];
    size: [number, number, number];
    color: string;
    glass?: boolean;
    emissive?: boolean;
  }[],
) {
  const source = new THREE.Group();
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  for (const solid of solids) {
    const key = [solid.color, solid.glass, solid.emissive].join(":");
    let material = materials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: solid.color,
        roughness: solid.glass ? 0.12 : 0.7,
        metalness: solid.glass ? 0.12 : 0.05,
        transparent: Boolean(solid.glass),
        opacity: solid.glass ? 0.2 : 1,
        depthWrite: !solid.glass,
        emissive: solid.emissive ? solid.color : "#000000",
        emissiveIntensity: solid.emissive ? 0.5 : 0,
      });
      materials.set(key, material);
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...solid.size), material);
    mesh.position.set(...solid.position);
    source.add(mesh);
  }
  const result = mergeStaticModel(source);
  source.traverse((node) => {
    if (node instanceof THREE.Mesh) node.geometry.dispose();
  });
  result.traverse((node) => {
    if (
      node instanceof THREE.Mesh &&
      !Array.isArray(node.material) &&
      node.material.transparent
    )
      node.castShadow = false;
  });
  return result;
}
