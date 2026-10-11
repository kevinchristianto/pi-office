import fs from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildSolidModel, mergeStaticModel } from "../src/models";
import { assetNavigationBounds } from "../src/navigationObstacles";

async function load(name: string) {
  const bytes = Uint8Array.from(fs.readFileSync(`public/models/${name}.glb`));
  return (await new GLTFLoader().parseAsync(bytes.buffer, "")).scene;
}

function meshes(object: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) result.push(node);
  });
  return result;
}

function geometryFingerprint(geometry: THREE.BufferGeometry) {
  const hash = createHash("sha256");
  for (const attribute of [
    geometry.index,
    ...Object.values(geometry.attributes),
  ]) {
    if (!attribute) continue;
    hash.update(
      Buffer.from(
        attribute.array.buffer,
        attribute.array.byteOffset,
        attribute.array.byteLength,
      ),
    );
  }
  return hash.digest("hex");
}

const triangleCount = (items: THREE.Mesh[]) =>
  items.reduce(
    (total, mesh) =>
      total +
      (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) /
        3,
    0,
  );

describe("independent shipped static-model audit", () => {
  it.each([
    "desk",
    "chair",
    "plant",
    "bookshelf",
    "sofa",
    "floorlamp",
    "coffeetable",
  ])(
    "preserves %s geometry and shared materials through batching and disposal",
    async (name) => {
      const source = await load(name);
      const originalMeshes = meshes(source);
      const originalGeometry = originalMeshes.map(({ geometry }) => geometry);
      const fingerprints = originalGeometry.map(geometryFingerprint);
      const sourceDisposed = vi.fn();
      const materials = new Set<THREE.Material>();
      for (const mesh of originalMeshes) {
        // These are the supported static inputs, rather than animated/skinned,
        // mirrored, hidden or multi-material meshes that need another batcher.
        expect(mesh).not.toBeInstanceOf(THREE.SkinnedMesh);
        expect(Array.isArray(mesh.material)).toBe(false);
        expect(mesh.visible).toBe(true);
        expect(Object.keys(mesh.geometry.morphAttributes)).toEqual([]);
        materials.add(mesh.material as THREE.Material);
        mesh.geometry.addEventListener("dispose", sourceDisposed);
      }
      materials.forEach((material) =>
        material.addEventListener("dispose", sourceDisposed),
      );
      const expectedBounds = new THREE.Box3().setFromObject(source, true);
      expect(
        originalMeshes.every((mesh) => mesh.matrixWorld.determinant() > 0),
      ).toBe(true);

      const result = mergeStaticModel(source);
      const batches = meshes(result);
      const actualBounds = new THREE.Box3().setFromObject(result, true);
      expect(actualBounds.min.distanceTo(expectedBounds.min)).toBeLessThan(
        1e-5,
      );
      expect(actualBounds.max.distanceTo(expectedBounds.max)).toBeLessThan(
        1e-5,
      );
      expect(triangleCount(batches)).toBe(triangleCount(originalMeshes));
      expect(
        batches.reduce(
          (sum, mesh) => sum + mesh.geometry.attributes.position.count,
          0,
        ),
      ).toBe(
        originalMeshes.reduce(
          (sum, mesh) => sum + mesh.geometry.attributes.position.count,
          0,
        ),
      );
      for (const batch of batches) {
        expect(originalGeometry).not.toContain(batch.geometry);
        expect(materials.has(batch.material as THREE.Material)).toBe(true);
        expect(batch.castShadow && batch.receiveShadow).toBe(true);
        batch.geometry.dispose();
      }
      // Asset teardown owns generated buffers only. Other Asset instances still
      // use the GLTF cache's original buffers and material objects.
      expect(sourceDisposed).not.toHaveBeenCalled();
      expect(originalGeometry.map(geometryFingerprint)).toEqual(fingerprints);
      originalGeometry.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
  );

  it.each(["desk", "chair", "plant"] as const)(
    "encloses the actual %s GLB collision envelope in both facing directions",
    async (name) => {
      const source = await load(name);
      const original = new THREE.Box3().setFromObject(source, true);
      for (const orientation of [0, Math.PI])
        for (const scale of [0.8, 1, 1.1]) {
          const matrix = new THREE.Matrix4().compose(
            new THREE.Vector3(13, 0.04, -8),
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              orientation,
            ),
            new THREE.Vector3(scale, scale, scale),
          );
          const actual = original.clone().applyMatrix4(matrix);
          const bounds = assetNavigationBounds(
            name,
            [13, -8],
            orientation,
            scale,
          );
          // Manifest envelopes may be deliberately conservative (chair casters)
          // and are rounded to millimetres. The planner adds two millimetres
          // beyond the walker radius, covering any sub-millimetre rounding.
          expect(bounds.minX).toBeLessThanOrEqual(actual.min.x + 0.001);
          expect(bounds.maxX).toBeGreaterThanOrEqual(actual.max.x - 0.001);
          expect(bounds.minZ).toBeLessThanOrEqual(actual.min.z + 0.001);
          expect(bounds.maxZ).toBeGreaterThanOrEqual(actual.max.z - 0.001);
        }
      for (const mesh of meshes(source)) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    },
  );

  it("keeps separately built architecture resources independent and glass shadow-free", () => {
    const solids = [
      { position: [0, 1, 0], size: [2, 2, 0.1], color: "#abcdef", glass: true },
      { position: [0, 0.2, 0], size: [2, 0.4, 0.2], color: "#abcdef" },
      {
        position: [0, 3, 0],
        size: [2, 0.1, 0.1],
        color: "#abcdef",
        emissive: true,
      },
    ] satisfies Parameters<typeof buildSolidModel>[0];
    const first = meshes(buildSolidModel(solids));
    const second = meshes(buildSolidModel(solids));
    const secondDisposed = vi.fn();
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    for (const mesh of second) {
      mesh.geometry.addEventListener("dispose", secondDisposed);
      (mesh.material as THREE.Material).addEventListener(
        "dispose",
        secondDisposed,
      );
    }
    for (const mesh of first) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(mesh.castShadow).toBe(!material.transparent);
      expect(material.depthWrite).toBe(!material.transparent);
      expect(material.opacity).toBe(material.transparent ? 0.2 : 1);
      expect(
        second.some(
          (other) =>
            other.geometry === mesh.geometry || other.material === material,
        ),
      ).toBe(false);
      mesh.geometry.dispose();
      material.dispose();
    }
    expect(secondDisposed).not.toHaveBeenCalled();
    for (const mesh of second) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
});
