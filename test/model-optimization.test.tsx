import { it, expect } from "vitest";
import * as THREE from "three";
import { mergeStaticModel } from "../src/models";
it("batches furniture without changing transformed bounds or geometry", () => {
  const scene = new THREE.Group(),
    material = new THREE.MeshStandardMaterial({ color: "red" });
  for (let i = 0; i < 20; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), material);
    mesh.position.set(i, 0, i * 0.2);
    mesh.rotation.y = i * 0.1;
    scene.add(mesh);
  }
  const before = new THREE.Box3().setFromObject(scene);
  const merged = mergeStaticModel(scene);
  const after = new THREE.Box3().setFromObject(merged);
  expect(merged.children).toHaveLength(1);
  expect(after.min.distanceTo(before.min)).toBeLessThan(0.0001);
  expect(after.max.distanceTo(before.max)).toBeLessThan(0.0001);
  expect(
    (merged.children[0] as THREE.Mesh).geometry.attributes.position.count,
  ).toBe(20 * 24);
});
