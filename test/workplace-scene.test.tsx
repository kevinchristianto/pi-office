import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createRoomDecor, createAmenityDecor } from "../src/officeDecor";
import { buildSolidModel } from "../src/models";
import {
  createOfficeLayout,
  createFacilityLayout,
  buildingLayoutBounds,
} from "../src/world";
for (const count of [1, 2, 3, 4, 9])
  describe(`corporate workplace geometry: ${count} projects`, () => {
    const rooms = createOfficeLayout(
      Array.from({ length: count }, (_, i) => ({
        id: `project-${i}`,
        agentCount: 6,
      })),
    );
    const f = createFacilityLayout(count);
    const amenities = createAmenityDecor({
      meeting: f.zones.meeting.center,
      reception: f.zones.reception.center,
      breakroom: f.zones.pantry.center,
      operations: f.zones.print.center,
    });
    const solids = [...rooms.flatMap(createRoomDecor), ...amenities];
    it("keeps architecture finite and inside camera building envelope", () => {
      const b = buildingLayoutBounds(count);
      for (const s of solids) {
        expect([...s.position, ...s.size].every(Number.isFinite)).toBe(true);
        expect(s.size.every((n) => n > 0)).toBe(true);
        expect(s.position[0] - s.size[0] / 2).toBeGreaterThanOrEqual(
          b.minX - 0.21,
        );
        expect(s.position[0] + s.size[0] / 2).toBeLessThanOrEqual(
          b.maxX + 0.21,
        );
        expect(s.position[2] - s.size[2] / 2).toBeGreaterThanOrEqual(
          b.minZ - 0.21,
        );
        expect(s.position[2] + s.size[2] / 2).toBeLessThanOrEqual(
          b.maxZ + 0.21,
        );
        expect(s.position[1] + s.size[1] / 2).toBeLessThanOrEqual(3.2);
      }
    });
    it("batches architecture by material without changing transformed bounds", () => {
      const model = buildSolidModel(solids),
        box = new THREE.Box3().setFromObject(model),
        expected = new THREE.Box3();
      for (const s of solids)
        expected.union(
          new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(...s.position),
            new THREE.Vector3(...s.size),
          ),
        );
      expect(box.min.distanceTo(expected.min)).toBeLessThan(0.00001);
      expect(box.max.distanceTo(expected.max)).toBeLessThan(0.00001);
      expect(model.children.length).toBeLessThan(35);
      expect(model.children.length).toBeLessThan(solids.length / 3);
      for (const mesh of model.children as THREE.Mesh[]) {
        mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material])
          m.dispose();
      }
    });
  });
