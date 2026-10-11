import { assetNavigationBounds } from "../src/navigationObstacles";
import { describe, expect, it } from "vitest";
import {
  createRoomLayout,
  createOfficeLayout,
  officeLayoutBounds,
  buildingLayoutBounds,
  createBuildingEntranceLayout,
  createFacilityLayout,
  createCubiclePartitions,
  CUBICLE_HEIGHT,
  CUBICLE_WIDTH,
  CUBICLE_SIDE_DEPTH,
  CUBICLE_THICKNESS,
  CHAIR_BACK_OFFSET,
  CHAIR_RADIUS,
  DESK_DEPTH,
  DESK_WIDTH,
  MAX_VISIBLE_DESKS,
  reverseRoute,
  ROOM_DEPTH,
  ROOM_GAP,
  ROOM_WIDTH,
  routeLength,
  sampleRoute,
  WALKER_RADIUS,
  type RoomBounds,
  type Route,
  type WorldPoint,
} from "../src/world";

/** Independent segment/AABB slab test, including the full interpolated segment. */
function segmentIntersectsBox(
  from: WorldPoint,
  to: WorldPoint,
  box: RoomBounds,
) {
  let enter = 0;
  let leave = 1;
  for (const [axis, low, high] of [
    [0, box.minX, box.maxX],
    [1, box.minZ, box.maxZ],
  ] as const) {
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < 1e-10) {
      if (from[axis] < low || from[axis] > high) return false;
      continue;
    }
    const a = (low - from[axis]) / delta;
    const b = (high - from[axis]) / delta;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return false;
  }
  return true;
}

function insideRoom(point: WorldPoint, bounds: RoomBounds, inset = 0) {
  expect(point[0]).toBeGreaterThanOrEqual(bounds.minX + inset);
  expect(point[0]).toBeLessThanOrEqual(bounds.maxX - inset);
  expect(point[1]).toBeGreaterThanOrEqual(bounds.minZ + inset);
  expect(point[1]).toBeLessThanOrEqual(bounds.maxZ - inset);
}

function facingSign(orientation: number) {
  return orientation === Math.PI ? -1 : 1;
}

function expanded(bounds: RoomBounds): RoomBounds {
  return {
    minX: bounds.minX - WALKER_RADIUS,
    maxX: bounds.maxX + WALKER_RADIUS,
    minZ: bounds.minZ - WALKER_RADIUS,
    maxZ: bounds.maxZ + WALKER_RADIUS,
  };
}

describe("compact project section layout", () => {
  it("is deterministic, independent, and does not mutate other layouts", () => {
    const first = createRoomLayout("session-a", 0, 6);
    const again = createRoomLayout("session-a", 0, 6);
    expect(first).toEqual(again);
    first.desks[0].route[0][0] = 100;
    expect(again.desks[0].route[0][0]).toBe(-3.4);
    expect(first.desks[0].seat[0]).toBe(-3.4);
    const renamed = createRoomLayout("renamed-project", 0, 6);
    expect(renamed.desks).toEqual(again.desks);
    expect(renamed.bounds).toEqual(again.bounds);
  });

  it("keeps the full roster size while capping the visible desk window", () => {
    for (const count of [0, 1, 3, 6, 7, 50, 10_000]) {
      const room = createRoomLayout("session", 0, count);
      expect(room.desks).toHaveLength(Math.min(count, MAX_VISIBLE_DESKS));
      expect(room.agentCount).toBe(count);
      expect(room.overflowCount).toBe(Math.max(0, count - MAX_VISIBLE_DESKS));
    }
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 9, 17, 25, 100])(
    "gives %s projects bounded, equally sized sections with nonoverlapping gaps",
    (count) => {
      const source = Array.from({ length: count }, (_, index) => ({
        id: `project-${index}`,
        agentCount: 6,
      }));
      const before = JSON.stringify(source);
      const rooms = createOfficeLayout(source);
      const bounds = officeLayoutBounds(count);
      expect(rooms).toHaveLength(count);
      expect(bounds.minX + bounds.maxX).toBe(0);
      expect(bounds.minZ + bounds.maxZ).toBe(0);
      expect(JSON.stringify(source)).toBe(before);
      for (const [index, room] of rooms.entries()) {
        expect(room.id).toBe(`project-${index}`);
        expect(room.index).toBe(index);
        expect(room).toEqual(createRoomLayout(room.id, index, 6, count));
        expect(room.bounds.maxX - room.bounds.minX).toBe(ROOM_WIDTH);
        expect(room.bounds.maxZ - room.bounds.minZ).toBe(ROOM_DEPTH);
        insideRoom([room.bounds.minX, room.bounds.minZ], bounds);
        insideRoom([room.bounds.maxX, room.bounds.maxZ], bounds);
        for (const other of rooms.slice(index + 1)) {
          const gapX = Math.max(
            room.bounds.minX - other.bounds.maxX,
            other.bounds.minX - room.bounds.maxX,
          );
          const gapZ = Math.max(
            room.bounds.minZ - other.bounds.maxZ,
            other.bounds.minZ - room.bounds.maxZ,
          );
          expect(Math.max(gapX, gapZ)).toBeGreaterThanOrEqual(ROOM_GAP);
        }
        for (const desk of room.desks) {
          expect(desk.seat[1]).toBeCloseTo(
            desk.desk[1] + facingSign(desk.orientation) * 0.74,
          );
          insideRoom(desk.desk, room.bounds, DESK_WIDTH / 2);
          insideRoom(desk.seat, room.bounds, WALKER_RADIUS);
        }
      }
      if (count > 0) {
        expect(Math.min(...rooms.map((room) => room.bounds.minX))).toBe(
          bounds.minX,
        );
        expect(Math.max(...rooms.map((room) => room.bounds.maxX))).toBe(
          bounds.maxX,
        );
        expect(Math.min(...rooms.map((room) => room.bounds.minZ))).toBe(
          bounds.minZ,
        );
        expect(Math.max(...rooms.map((room) => room.bounds.maxZ))).toBe(
          bounds.maxZ,
        );
      }
    },
  );

  it("reserves one bounded empty-office footprint and uses both axes for many projects", () => {
    expect(createOfficeLayout([])).toEqual([]);
    expect(officeLayoutBounds(0)).toEqual(officeLayoutBounds(1));
    expect(createRoomLayout("empty", 0, 0, 0).center).toEqual([0, 0]);
    expect(officeLayoutBounds(2)).toEqual({
      minX: -6,
      maxX: 6,
      minZ: -11,
      maxZ: 11,
    });
    expect(officeLayoutBounds(4)).toEqual({
      minX: -13,
      maxX: 13,
      minZ: -11,
      maxZ: 11,
    });
    for (const count of [3, 4, 5, 6, 7, 9, 17, 25, 100]) {
      const bounds = officeLayoutBounds(count);
      const width = bounds.maxX - bounds.minX;
      const depth = bounds.maxZ - bounds.minZ;
      expect(Math.max(width, depth) / Math.min(width, depth)).toBeLessThan(1.6);
      expect(width).toBeLessThan(count * (ROOM_WIDTH + ROOM_GAP) - ROOM_GAP);
      const rooms = createOfficeLayout(
        Array.from({ length: count }, (_, index) => ({
          id: String(index),
          agentCount: 0,
        })),
      );
      const rows = new Map<number, number[]>();
      rooms.forEach((room) =>
        rows.set(room.center[1], [
          ...(rows.get(room.center[1]) ?? []),
          room.center[0],
        ]),
      );
      expect(rows.size).toBeGreaterThan(1);
      for (const centers of rows.values()) {
        expect(Math.min(...centers) + Math.max(...centers)).toBe(0);
      }
    }
  });

  it("translates every desk, panel, and waypoint along both grid axes", () => {
    const origin = createRoomLayout("a", 0, 6);
    const moved = createRoomLayout("b", 8, 6, 9);
    const [dx, dz] = moved.center;
    expect(dx).not.toBe(0);
    expect(dz).not.toBe(0);
    moved.desks.forEach((desk, i) => {
      expect(desk.orientation).toBe(origin.desks[i].orientation);
      for (const key of ["desk", "seat", "exit", "aisle", "lounge"] as const) {
        expect(desk[key][0]).toBeCloseTo(origin.desks[i][key][0] + dx);
        expect(desk[key][1]).toBeCloseTo(origin.desks[i][key][1] + dz);
      }
      desk.route.forEach((point, j) => {
        expect(point[0]).toBeCloseTo(origin.desks[i].route[j][0] + dx);
        expect(point[1]).toBeCloseTo(origin.desks[i].route[j][1] + dz);
      });
      desk.partitions.forEach((panel, j) => {
        const other = origin.desks[i].partitions[j];
        expect(panel.center[0]).toBeCloseTo(other.center[0] + dx);
        expect(panel.center[1]).toBeCloseTo(other.center[1] + dz);
        expect(panel.bounds.minX).toBeCloseTo(other.bounds.minX + dx);
        expect(panel.bounds.maxX).toBeCloseTo(other.bounds.maxX + dx);
        expect(panel.bounds.minZ).toBeCloseTo(other.bounds.minZ + dz);
        expect(panel.bounds.maxZ).toBeCloseTo(other.bounds.maxZ + dz);
      });
    });
  });

  it("fills opposing pairs before the next column, even for two-agent projects", () => {
    for (const count of [2, 3, 4, 5, 6]) {
      const room = createRoomLayout("paired", 0, count);
      for (let i = 0; i + 1 < count; i += 2) {
        const north = room.desks[i];
        const south = room.desks[i + 1];
        expect(north.orientation).toBe(Math.PI);
        expect(south.orientation).toBe(0);
        expect(north.desk[0]).toBe(south.desk[0]);
        expect(north.seat[0]).toBe(south.seat[0]);
        expect(north.seat[1]).toBeLessThan(north.desk[1]);
        expect(south.seat[1]).toBeGreaterThan(south.desk[1]);
        // The residents' forward vectors point directly toward one another.
        const difference = south.seat[1] - north.seat[1];
        expect(-Math.cos(north.orientation) * difference).toBeGreaterThan(0);
        expect(-Math.cos(south.orientation) * -difference).toBeGreaterThan(0);
        expect(
          south.partitions[0].bounds.minZ - north.partitions[0].bounds.maxZ,
        ).toBeCloseTo(0.22);
      }
    }
  });

  it("provides distinct lounge destinations with room for character width", () => {
    const room = createRoomLayout("session", 0, 6);
    for (let i = 0; i < room.desks.length; i++) {
      for (let j = i + 1; j < room.desks.length; j++) {
        const a = room.desks[i].lounge;
        const b = room.desks[j].lounge;
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(
          WALKER_RADIUS * 2,
        );
      }
    }
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid room indices, counts, and total counts: %s",
    (invalid) => {
      expect(() => createRoomLayout("session", invalid, 6)).toThrow(RangeError);
      expect(() => createRoomLayout("session", 0, invalid)).toThrow(RangeError);
      expect(() => createRoomLayout("session", 0, 6, invalid)).toThrow(
        RangeError,
      );
      expect(() => officeLayoutBounds(invalid)).toThrow(RangeError);
    },
  );

  it("rejects a section index outside the selected office", () => {
    expect(() => createRoomLayout("outside", 1, 6, 1)).toThrow(RangeError);
    expect(() => createRoomLayout("outside-empty", 1, 0, 0)).toThrow(
      RangeError,
    );
  });
});

describe("shared corporate facilities", () => {
  it.each([0, 1, 2, 3, 4, 9, 25])(
    "keeps one bounded facility wing and an unobstructed lobby for %s projects",
    (count) => {
      const office = officeLayoutBounds(count);
      const building = buildingLayoutBounds(count);
      const facilities = createFacilityLayout(count);
      const entrance = createBuildingEntranceLayout(count);
      expect(building).toEqual({
        minX: office.minX - 1.2,
        maxX: office.maxX + 1.2,
        minZ: office.minZ,
        maxZ: entrance.apronBounds.maxZ,
      });
      expect(building.maxZ).toBeGreaterThan(office.maxZ + 6);
      insideRoom(entrance.threshold, building, WALKER_RADIUS);
      insideRoom(entrance.outside, building, WALKER_RADIUS);
      expect(facilities.bounds).toEqual({
        minX: office.minX - 1.2,
        maxX: office.maxX + 1.2,
        minZ: office.maxZ,
        maxZ: office.maxZ + 6,
      });
      expect(Object.keys(facilities.zones)).toEqual([
        "meeting",
        "reception",
        "pantry",
        "print",
      ]);
      facilities.circulation.forEach((point) =>
        insideRoom(point, facilities.bounds, WALKER_RADIUS),
      );
      const zones = Object.values(facilities.zones);
      zones.forEach((zone, index) => {
        insideRoom([zone.bounds.minX, zone.bounds.minZ], facilities.bounds);
        insideRoom([zone.bounds.maxX, zone.bounds.maxZ], facilities.bounds);
        expect(zone.bounds.minZ - office.maxZ).toBeGreaterThanOrEqual(
          2.8 - 1e-10,
        );
        expect(
          segmentIntersectsBox(
            facilities.circulation[0],
            facilities.circulation[1],
            expanded(zone.bounds),
          ),
        ).toBe(false);
        for (const other of zones.slice(index + 1)) {
          const gapX = Math.max(
            zone.bounds.minX - other.bounds.maxX,
            other.bounds.minX - zone.bounds.maxX,
          );
          const gapZ = Math.max(
            zone.bounds.minZ - other.bounds.maxZ,
            other.bounds.minZ - zone.bounds.maxZ,
          );
          expect(Math.max(gapX, gapZ)).toBeGreaterThanOrEqual(1.2 - 1e-10);
        }
      });
      const rooms = createOfficeLayout(
        Array.from({ length: count }, (_, index) => ({
          id: String(index),
          agentCount: 6,
        })),
      );
      for (const room of rooms) {
        for (const desk of room.desks) {
          for (let i = 1; i < desk.route.length; i++) {
            for (const zone of zones) {
              expect(
                segmentIntersectsBox(
                  desk.route[i - 1],
                  desk.route[i],
                  expanded(zone.bounds),
                ),
              ).toBe(false);
            }
          }
        }
      }
    },
  );

  it("returns independent facility layouts and rejects invalid counts", () => {
    const first = createFacilityLayout(1);
    first.zones.meeting.center[0] = 99;
    first.circulation[0][0] = 99;
    expect(createFacilityLayout(1).zones.meeting.center[0]).toBe(-4.6);
    expect(createFacilityLayout(1).circulation[0][0]).not.toBe(99);
    expect(() => buildingLayoutBounds(-1)).toThrow(RangeError);
    expect(() => createFacilityLayout(Infinity)).toThrow(RangeError);
  });
});

describe("facing open-front cubicles", () => {
  it("builds exactly three rotated low panels per visible desk and no front wall", () => {
    for (const count of [0, 1, 3, 6, 40]) {
      const section = createRoomLayout("open-office", 0, count);
      expect(section.partitions).toHaveLength(Math.min(count, 6) * 3);
      expect(section.partitions).toEqual(
        section.desks.flatMap((desk) => desk.partitions),
      );
      for (const desk of section.desks) {
        const sign = facingSign(desk.orientation);
        const [back, left, right] = desk.partitions;
        expect(desk.partitions.map((panel) => panel.kind)).toEqual([
          "back",
          "left",
          "right",
        ]);
        expect(back.center[0]).toBe(desk.desk[0]);
        expect(back.center[1]).toBeCloseTo(desk.desk[1] - sign * 0.75);
        expect(back.width).toBe(CUBICLE_WIDTH);
        expect(back.depth).toBe(CUBICLE_THICKNESS);
        for (const [panel, side] of [
          [left, -1],
          [right, 1],
        ] as const) {
          expect(panel.center[0]).toBeCloseTo(
            desk.desk[0] + side * sign * 1.35,
          );
          expect(panel.center[1]).toBeCloseTo(desk.desk[1] + sign * 0.1);
          expect(panel.width).toBe(CUBICLE_THICKNESS);
          expect(panel.depth).toBe(CUBICLE_SIDE_DEPTH);
        }
        // Either orientation has a 2.62-unit opening behind the seated person.
        expect(
          Math.abs(right.center[0] - left.center[0]) - CUBICLE_THICKNESS,
        ).toBeCloseTo(2.62);
        for (const panel of desk.partitions) {
          expect(panel.height).toBe(CUBICLE_HEIGHT);
          expect(panel.height).toBe(1.15);
          expect(panel.bounds.maxX - panel.bounds.minX).toBeCloseTo(
            panel.width,
          );
          expect(panel.bounds.maxZ - panel.bounds.minZ).toBeCloseTo(
            panel.depth,
          );
          insideRoom([panel.bounds.minX, panel.bounds.minZ], section.bounds);
          insideRoom([panel.bounds.maxX, panel.bounds.maxZ], section.bounds);
        }
      }
    }
  });

  it("retains desk spacing and generous outer row aisles in both directions", () => {
    const section = createRoomLayout("generous-aisles", 0, 6);
    expect(section.desks[2].desk[0] - section.desks[0].desk[0]).toBeCloseTo(
      3.4,
    );
    expect(section.desks[1].desk[1] - section.desks[0].desk[1]).toBeCloseTo(
      1.8,
    );
    const rightEdge = Math.max(
      ...section.partitions.map((panel) => panel.bounds.maxX),
    );
    expect(section.bounds.maxX - rightEdge).toBeGreaterThanOrEqual(1.2);
    expect(section.mainAisleX - rightEdge).toBeGreaterThan(WALKER_RADIUS);
    expect(section.bounds.maxX - section.mainAisleX).toBeGreaterThan(
      WALKER_RADIUS,
    );
    for (const desk of section.desks) {
      const sign = facingSign(desk.orientation);
      expect((desk.seat[1] - desk.desk[1]) * sign).toBeCloseTo(0.74);
      expect((desk.exit[0] - desk.seat[0]) * sign).toBeCloseTo(0.75);
      expect((desk.aisle[1] - desk.desk[1]) * sign).toBeCloseTo(1.8);
      const chairEdge =
        desk.seat[1] + sign * (CHAIR_BACK_OFFSET + CHAIR_RADIUS);
      expect((desk.aisle[1] - chairEdge) * sign).toBeGreaterThan(WALKER_RADIUS);
      if (sign < 0) {
        expect(chairEdge - section.bounds.minZ).toBeGreaterThanOrEqual(1.2);
      } else {
        expect(section.lounge[1] - chairEdge).toBeGreaterThanOrEqual(1.2);
      }
    }
  });

  it("half-turns independent panel geometry and translates in both axes", () => {
    const origin: WorldPoint = [2, 3];
    const original = createCubiclePartitions(origin);
    const rotated = createCubiclePartitions(origin, Math.PI);
    const translated = createCubiclePartitions([102, 23]);
    original.forEach((panel, i) => {
      expect(rotated[i].center[0]).toBeCloseTo(2 * origin[0] - panel.center[0]);
      expect(rotated[i].center[1]).toBeCloseTo(2 * origin[1] - panel.center[1]);
      expect(translated[i].center[0] - panel.center[0]).toBeCloseTo(100);
      expect(translated[i].center[1] - panel.center[1]).toBeCloseTo(20);
      expect(translated[i].bounds.minX - panel.bounds.minX).toBeCloseTo(100);
      expect(translated[i].bounds.maxX - panel.bounds.maxX).toBeCloseTo(100);
      expect(translated[i].bounds.minZ - panel.bounds.minZ).toBeCloseTo(20);
      expect(translated[i].bounds.maxZ - panel.bounds.maxZ).toBeCloseTo(20);
    });
    original[0].center[0] = 999;
    expect(origin).toEqual([2, 3]);
    expect(createCubiclePartitions(origin)[0].center[0]).toBe(2);
    expect(() => createCubiclePartitions([NaN, 0])).toThrow(RangeError);
    expect(() => createCubiclePartitions(origin, NaN)).toThrow(RangeError);
    expect(() => createCubiclePartitions(origin, Math.PI / 2)).toThrow(
      RangeError,
    );
  });

  it("keeps every outbound and return segment clear of expanded partition bounds", () => {
    for (const index of [0, 1, 12, 1000]) {
      const section = createRoomLayout("panel-clearance", index, 6);
      for (const desk of section.desks) {
        for (const route of [desk.route, reverseRoute(desk.route)]) {
          for (let i = 1; i < route.length; i++) {
            for (const panel of section.partitions) {
              expect(
                segmentIntersectsBox(
                  route[i - 1],
                  route[i],
                  expanded(panel.bounds),
                ),
              ).toBe(false);
            }
          }
        }
      }
    }
  });

  it("detects the old narrow main aisle clipping an outer cubicle panel", () => {
    const section = createRoomLayout("regression-aisle", 0, 6);
    const panel = section.desks[5].partitions.find(
      (panel) => panel.kind === "right",
    )!;
    const obstacle = expanded(panel.bounds);
    expect(segmentIntersectsBox([5, -3.2], [5, 3.8], obstacle)).toBe(true);
    expect(
      segmentIntersectsBox(
        [section.mainAisleX, -3.2],
        [section.mainAisleX, 3.8],
        obstacle,
      ),
    ).toBe(false);
  });
});

describe("safe walking routes", () => {
  it("keeps full outbound and return paths inside their room and clear of every table", () => {
    // Test full rooms, including both orientations, so spare furniture does not
    // change the clearance guarantee when the visible roster is smaller.
    for (const index of [0, 1, 12, 1000]) {
      const room = createRoomLayout("session", index, 6);
      for (const desk of room.desks) {
        expect(desk.route[0]).toEqual(desk.seat);
        expect(desk.route.at(-1)).toEqual(desk.lounge);
        for (const route of [desk.route, reverseRoute(desk.route)]) {
          route.forEach((point) =>
            insideRoom(point, room.bounds, WALKER_RADIUS),
          );
          for (let i = 1; i < route.length; i++) {
            const from = route[i - 1];
            const to = route[i];

            for (const other of room.desks) {
              expect(
                segmentIntersectsBox(
                  from,
                  to,
                  expanded({
                    minX: other.desk[0] - DESK_WIDTH / 2,
                    maxX: other.desk[0] + DESK_WIDTH / 2,
                    minZ: other.desk[1] - DESK_DEPTH / 2,
                    maxZ: other.desk[1] + DESK_DEPTH / 2,
                  }),
                ),
              ).toBe(false);
            }
          }
        }
      }
    }
  });

  it("sidesteps the correctly rotated chair back and clears all other chairs", () => {
    for (const index of [0, 1, 12, 1000]) {
      const room = createRoomLayout("chair-clearance", index, 6);
      for (const desk of room.desks) {
        expect(desk.exit[1]).toBe(desk.seat[1]);
        expect(
          (desk.exit[0] - desk.seat[0]) * facingSign(desk.orientation),
        ).toBeCloseTo(0.75);
        expect(desk.aisle[0]).toBe(desk.exit[0]);
        for (const route of [desk.route, reverseRoute(desk.route)]) {
          for (let i = 1; i < route.length; i++) {
            for (const other of room.desks) {
              // Only the owner's first departure / last arrival segment may
              // intersect its chair: the seated origin is inside that chair.
              if (
                other.index === desk.index &&
                ((route[i - 1][0] === desk.seat[0] &&
                  route[i - 1][1] === desk.seat[1]) ||
                  (route[i][0] === desk.seat[0] &&
                    route[i][1] === desk.seat[1]))
              )
                continue;
              expect(
                segmentIntersectsBox(
                  route[i - 1],
                  route[i],
                  expanded(
                    assetNavigationBounds(
                      "chair",
                      other.seat,
                      other.orientation,
                    ),
                  ),
                ),
              ).toBe(false);
            }
          }
        }
      }
    }
  });

  it("samples by segment length instead of cutting diagonally through a desk", () => {
    const route: Route = [
      [0, 0],
      [0, 2],
      [3, 2],
      [3, 6],
    ];
    expect(routeLength(route)).toBe(9);
    expect(sampleRoute(route, -2)).toEqual([0, 0]);
    expect(sampleRoute(route, 1)).toEqual([0, 1]);
    expect(sampleRoute(route, 2)).toEqual([0, 2]);
    expect(sampleRoute(route, 3)).toEqual([1, 2]);
    expect(sampleRoute(route, 7)).toEqual([3, 4]);
    expect(sampleRoute(route, 20)).toEqual([3, 6]);
    expect(sampleRoute(reverseRoute(route), 2)).toEqual([3, 4]);
  });

  it("remains finite and repeatable through many full round trips", () => {
    const room = createRoomLayout("repeated-visits", 5, 6);
    for (const desk of room.desks) {
      const snapshot = JSON.stringify(desk.route);
      const length = routeLength(desk.route);
      const reverse = reverseRoute(desk.route);
      for (let visit = 0; visit < 40; visit++) {
        for (let step = 0; step <= 100; step++) {
          const distance = (step / 100) * length;
          const outbound = sampleRoute(desk.route, distance);
          const returning = sampleRoute(reverse, length - distance);
          expect(outbound.every(Number.isFinite)).toBe(true);
          expect(returning[0]).toBeCloseTo(outbound[0], 8);
          expect(returning[1]).toBeCloseTo(outbound[1], 8);
          insideRoom(outbound, room.bounds, WALKER_RADIUS);
        }
      }
      const home = sampleRoute(reverse, length);
      expect(home[0]).toBeCloseTo(desk.seat[0], 10);
      expect(home[1]).toBeCloseTo(desk.seat[1], 10);
      expect(JSON.stringify(desk.route)).toBe(snapshot);
    }
  });

  it("handles duplicate waypoints and stationary routes without NaN", () => {
    expect(routeLength([])).toBe(0);
    expect(routeLength([[4, 5]])).toBe(0);
    expect(sampleRoute([[4, 5]], 12)).toEqual([4, 5]);
    const duplicates: Route = [
      [0, 0],
      [0, 0],
      [2, 0],
      [2, 0],
    ];
    expect(routeLength(duplicates)).toBe(2);
    expect(sampleRoute(duplicates, 0)).toEqual([0, 0]);
    expect(sampleRoute(duplicates, 1)).toEqual([1, 0]);
    expect(sampleRoute(duplicates, 2)).toEqual([2, 0]);
    expect(sampleRoute(duplicates, 99)).toEqual([2, 0]);
  });

  it("never aliases route input points when sampling or reversing", () => {
    const route: Route = [
      [0, 0],
      [3, 0],
    ];
    const end = sampleRoute(route, 20);
    const reversed = reverseRoute(route);
    end[0] = 99;
    reversed[0][1] = 99;
    expect(route).toEqual([
      [0, 0],
      [3, 0],
    ]);
  });

  it("rejects empty sampling and non-finite animation input", () => {
    expect(() => sampleRoute([], 0)).toThrow(RangeError);
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(() => sampleRoute([[0, 0]], invalid)).toThrow(RangeError);
      expect(() => sampleRoute([[invalid, 0]], 0)).toThrow(RangeError);
      expect(() => routeLength([[0, invalid]])).toThrow(RangeError);
    }
  });
});
