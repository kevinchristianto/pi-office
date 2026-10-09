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
