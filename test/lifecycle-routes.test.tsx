import { describe, expect, it } from "vitest";
import {
  buildingLayoutBounds,
  createOfficeLayout,
  createBuildingEntranceLayout,
  routeLength,
  sampleRoute,
  officeLayoutBounds,
  WALKER_RADIUS,
  type RoomBounds,
  type Route,
  type WorldPoint,
} from "../src/world";
import {
  buildingQueuePosition,
  createBuildingEntryRoute,
  createBuildingExitRoute,
  LIFECYCLE_WALK_SPEED,
  sampleLifecycleRoutePose,
  lifecycleWalkableFloors,
} from "../src/lifecycleRoutes";
import {
  createNavigationObstacles,
  assetNavigationBounds,
  solidNavigationBounds,
} from "../src/navigationObstacles";
import {
  createRouteClearance,
  createNaturalRoute,
} from "../src/naturalNavigation";
import { createEntranceDecor } from "../src/entranceDecor";

// Independent complete-segment slab test against the swept walker envelope.
function intersects(
  from: WorldPoint,
  to: WorldPoint,
  bounds: RoomBounds,
  radius = WALKER_RADIUS,
) {
  let enter = 0,
    leave = 1;
  for (const [axis, low, high] of [
    [0, bounds.minX - radius, bounds.maxX + radius],
    [1, bounds.minZ - radius, bounds.maxZ + radius],
  ] as const) {
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < 1e-10) {
      if (from[axis] < low || from[axis] > high) return false;
      continue;
    }
    const a = (low - from[axis]) / delta,
      b = (high - from[axis]) / delta;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return false;
  }
  return true;
}
const layouts = (count: number, agents = 6) =>
  createOfficeLayout(
    Array.from({ length: count }, (_, index) => ({
      id: `project-${index}`,
      agentCount: agents,
    })),
  );
const samePoint = (a: WorldPoint, b: WorldPoint) =>
  a[0] === b[0] && a[1] === b[1];

describe("genuine building arrival and departure routes", () => {
  it.each(Array.from({ length: 16 }, (_, index) => index + 1))(
    "sweeps every segment clear of all real geometry in a %i-project grid",
    (count) => {
      const rooms = layouts(count),
        bounds = buildingLayoutBounds(count);
      const obstacles = createNavigationObstacles(rooms);
      const collisions: string[] = [];
      for (const room of rooms)
        for (const desk of room.desks) {
          const slot = room.index * 6 + desk.index;
          const entry = createBuildingEntryRoute(rooms, room, desk, slot);
          const exit = createBuildingExitRoute(rooms, room, desk, slot);
          expect(entry[0]).toEqual(buildingQueuePosition(count, slot));
          expect(entry.at(-1)).toEqual(desk.seat);
          expect(exit).toEqual([...entry].reverse());
          for (const route of [entry, exit]) {
            for (const point of route) {
              expect(point[0]).toBeGreaterThanOrEqual(
                bounds.minX + WALKER_RADIUS,
              );
              expect(point[0]).toBeLessThanOrEqual(bounds.maxX - WALKER_RADIUS);
              expect(point[1]).toBeGreaterThanOrEqual(
                bounds.minZ + WALKER_RADIUS,
              );
              expect(point[1]).toBeLessThanOrEqual(bounds.maxZ - WALKER_RADIUS);
            }
            for (let index = 1; index < route.length; index++) {
              const from = route[index - 1],
                to = route[index];

              for (const obstacle of obstacles) {
                const ownChair =
                  obstacle.seatedChair?.roomId === room.id &&
                  obstacle.seatedChair?.deskIndex === desk.index;
                // Only the exact own seat/side-exit leg may overlap the parked chair.
                if (
                  ownChair &&
                  ((samePoint(from, desk.seat) && samePoint(to, desk.exit)) ||
                    (samePoint(to, desk.seat) && samePoint(from, desk.exit)))
                )
                  continue;
                if (intersects(from, to, obstacle.bounds))
                  collisions.push(
                    `${room.id}/desk${desk.index}/segment${index}: ${obstacle.name}`,
                  );
              }
            }
          }
        }
      expect(collisions).toEqual([]);
    },
    15000,
  );

  it.each([1, 2, 3, 4, 7, 12])(
    "uses one compact reserved exterior point for all %i-project lifecycle tickets",
    (count) => {
      const rooms = layouts(count),
        entrance = createBuildingEntranceLayout(count);
      const route = createBuildingEntryRoute(
        rooms,
        rooms[0],
        rooms[0].desks[0],
        0,
      );
      expect(route[0]).toEqual(entrance.outside);
      expect(route[1]).toEqual(entrance.threshold);
      expect(entrance.outside[1]).toBeGreaterThan(
        entrance.threshold[1] + WALKER_RADIUS,
      );
      expect(entrance.apronBounds.maxZ - entrance.apronBounds.minZ).toBeCloseTo(
        1.6,
      );
      // Waiting arrivals are offsite; the controller must grant a single walker.
      for (let slot = 0; slot < entrance.queueCapacity; slot++) {
        expect(buildingQueuePosition(count, slot)).toEqual(entrance.outside);
        expect(
          createBuildingEntryRoute(rooms, rooms[0], rooms[0].desks[0], slot),
        ).toEqual(route);
      }
    },
  );

  it("enters northern rooms around the east spine, through each open front", () => {
    const rooms = layouts(4),
      entrance = createBuildingEntranceLayout(4);
    for (const room of rooms.slice(0, 2)) {
      const route = createBuildingEntryRoute(rooms, room, room.desks[0]);
      const office = officeLayoutBounds(rooms.length);
      expect(
        route.some(
          (point) =>
            point[0] > office.maxX + WALKER_RADIUS &&
            point[1] < office.maxZ &&
            point[1] > room.bounds.maxZ + 2,
        ),
      ).toBe(true);
      const clearance = createRouteClearance({
        obstacles: [],
        walkableBounds: lifecycleWalkableFloors(rooms, room),
      });
      for (let index = 1; index < route.length; index++)
        expect(clearance.clear(route[index - 1], route[index])).toBe(true);
    }
    // The tempting straight north shortcut would hit the southern rear glass.
    const glass = createNavigationObstacles(rooms).filter(
      (obstacle) => obstacle.name === "Glazed office partition",
    );
    expect(
      glass.some((obstacle) =>
        intersects(
          [rooms[0].mainAisleX, entrance.corridor[1]],
          [rooms[0].mainAisleX, rooms[0].desks[0].aisle[1]],
          obstacle.bounds,
        ),
      ),
    ).toBe(true);
  });

  it("uses the clear reception/pantry gap and catches a shortcut through reception", () => {
    const rooms = layouts(1),
      entrance = createBuildingEntranceLayout(1);
    const counter = createNavigationObstacles(rooms).find(
      (obstacle) => obstacle.name === "Reception counter",
    )!;
    expect(
      intersects(
        [0, entrance.outside[1]],
        [0, entrance.corridor[1]],
        counter.bounds,
      ),
    ).toBe(true);
    expect(
      intersects(entrance.threshold, entrance.corridor, counter.bounds),
    ).toBe(false);
    expect(entrance.threshold[0]).toBe(2.1);
  });

  it("uses full model bounds and actual low fixtures while omitting floors and overhead signs", () => {
    const chair = assetNavigationBounds("chair", [0, 0]);
    expect(chair.maxX).toBe(0.453); // Arms/casters extend beyond legacy CHAIR_RADIUS.
    const plant = assetNavigationBounds("plant", [0, 0], 0, 1.1);
    expect(plant.maxZ).toBeCloseTo(0.662 * 1.1);
    const entrance = createEntranceDecor(4);
    expect(
      entrance.some(
        (solid) => solid.name === "Department cross-corridor floor",
      ),
    ).toBe(true);
    expect(
      solidNavigationBounds(
        entrance.find((solid) => solid.name === "Entrance door jamb")!,
      ),
    ).not.toBeNull();
    expect(
      solidNavigationBounds(
        entrance.find((solid) => solid.name === "Entrance glazed side panel")!,
      ),
    ).not.toBeNull();
    expect(
      solidNavigationBounds(
        entrance.find((solid) => solid.name === "Entrance sign backing")!,
      ),
    ).toBeNull();
    expect(
      solidNavigationBounds(
        entrance.find((solid) => solid.name === "Exterior entrance forecourt")!,
      ),
    ).toBeNull();
  });

  it("gives reproducible fresh routes with constant physical walking speed and correct tangent yaw", () => {
    expect(LIFECYCLE_WALK_SPEED).toBe(1.8);
    const rooms = layouts(3),
      room = rooms[0],
      desk = room.desks[0];
    const route = createBuildingEntryRoute(rooms, room, desk, 5);
    const snapshot = JSON.stringify({ rooms, route });
    let walked = 0;
    for (let index = 1; index < route.length; index++) {
      const [x, z] = route[index - 1],
        [xx, zz] = route[index];
      const length = Math.hypot(xx - x, zz - z);
      const pose = sampleLifecycleRoutePose(route, walked + length / 2);
      expect(pose.position[0]).toBeCloseTo((x + xx) / 2);
      expect(pose.position[1]).toBeCloseTo((z + zz) / 2);
      const behind = sampleRoute(route, walked + length / 2 - 0.12);
      const ahead = sampleRoute(route, walked + length / 2 + 0.12);
      const expectedYaw = Math.atan2(
        behind[0] - ahead[0],
        behind[1] - ahead[1],
      );
      expect(Math.sin(pose.yaw)).toBeCloseTo(Math.sin(expectedYaw));
      expect(Math.cos(pose.yaw)).toBeCloseTo(Math.cos(expectedYaw));
      walked += length;
    }
    expect(walked).toBeCloseTo(routeLength(route));
    const second = createBuildingEntryRoute(rooms, room, desk, 5);
    second[0][0] = 999;
    const pose = sampleLifecycleRoutePose(route, 0);
    pose.position[0] = 999;
    expect(JSON.stringify({ rooms, route })).toBe(snapshot);
  });

  it("blends heading continuously across corners and handles duplicate route points", () => {
    const route: Route = [
      [0, 0],
      [0, 0],
      [2, 0],
      [2, 0],
      [2, 3],
    ];
    expect(sampleLifecycleRoutePose(route, 0).yaw).toBeCloseTo(-Math.PI / 2);
    expect(sampleLifecycleRoutePose(route, 2).yaw).toBeCloseTo(
      (-3 * Math.PI) / 4,
    );
    expect(
      Math.abs(
        sampleLifecycleRoutePose(route, 2 - 1e-5).yaw -
          sampleLifecycleRoutePose(route, 2 + 1e-5).yaw,
      ),
    ).toBeLessThan(0.001);
    expect(sampleLifecycleRoutePose(route, 20).position).toEqual([2, 3]);
    expect(Math.abs(sampleLifecycleRoutePose(route, 20).yaw)).toBeCloseTo(
      Math.PI,
    );
    expect(() => sampleLifecycleRoutePose(route, NaN)).toThrow(RangeError);
  });

  it("rejects invalid slots and mismatched room/desk ownership", () => {
    for (const value of [-1, 0.5, Infinity, NaN, 12])
      expect(() => buildingQueuePosition(1, value)).toThrow(RangeError);
    const rooms = layouts(2);
    expect(() =>
      createBuildingEntryRoute([rooms[0]], rooms[1], rooms[1].desks[0]),
    ).toThrow(RangeError);
    expect(() =>
      createBuildingEntryRoute(rooms, rooms[0], {
        ...rooms[0].desks[0],
        index: 7,
      }),
    ).toThrow(RangeError);
  });
});
