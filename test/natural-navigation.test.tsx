import { describe, expect, it, vi } from "vitest";
import {
  createNaturalRoute,
  createRouteClearance,
  sampleNaturalRoutePose,
} from "../src/naturalNavigation";
import {
  createBuildingEntryRoute,
  createBuildingExitRoute,
} from "../src/lifecycleRoutes";
import {
  createOfficeLayout,
  createRoomLayout,
  routeLength,
  WALKER_RADIUS,
  type RoomBounds,
  type Route,
  type WorldPoint,
} from "../src/world";
import * as obstaclesModule from "../src/navigationObstacles";

const bounds: RoomBounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
const angleDifference = (a: number, b: number) =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const layouts = (count: number) =>
  createOfficeLayout(
    Array.from({ length: count }, (_, index) => ({
      id: `natural-${index}`,
      agentCount: 6,
    })),
  );

// Independent analytic slab test. Do not rely on the planner's collision method.
function hits(from: WorldPoint, to: WorldPoint, box: RoomBounds) {
  let enter = 0,
    leave = 1;
  for (const [axis, low, high] of [
    [0, box.minX - WALKER_RADIUS, box.maxX + WALKER_RADIUS],
    [1, box.minZ - WALKER_RADIUS, box.maxZ + WALKER_RADIUS],
  ] as const) {
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < 1e-12) {
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

describe("natural visibility navigation", () => {
  it("crosses genuinely empty space directly instead of preserving authored right angles", () => {
    const seed: Route = [
      [-4, -3],
      [-4, 5],
      [6, 5],
    ];
    expect(
      createNaturalRoute(seed, { obstacles: [], walkableBounds: [bounds] }),
    ).toEqual([
      [-4, -3],
      [6, 5],
    ]);
  });

  it("finds new obstacle-corner visibility waypoints and safely rounds their full segments", () => {
    const obstacle = { bounds: { minX: -1, maxX: 1, minZ: -2, maxZ: 2 } };
    const seed: Route = [
      [-4, 0],
      [-4, 7],
      [4, 7],
      [4, 0],
    ];
    const route = createNaturalRoute(seed, {
      obstacles: [obstacle],
      walkableBounds: [bounds],
    });
    expect(route[0]).toEqual(seed[0]);
    expect(route.at(-1)).toEqual(seed.at(-1));
    expect(routeLength(route)).toBeLessThan(routeLength(seed) * 0.6);
    expect(route.length).toBeGreaterThan(8);
    expect(
      route.some(
        (point) =>
          Math.abs(point[1]) > 2 + WALKER_RADIUS && Math.abs(point[1]) < 3,
      ),
    ).toBe(true);
    for (let i = 1; i < route.length; i++)
      expect(hits(route[i - 1], route[i], obstacle.bounds)).toBe(false);
    expect(
      createNaturalRoute(seed, {
        obstacles: [obstacle],
        walkableBounds: [bounds],
      }),
    ).toEqual(route);
  });

  it("blocks a diagonal through a missing floor and sweeps the full radius around concave joins", () => {
    const floors = [
      { minX: 0, maxX: 6, minZ: 0, maxZ: 2 },
      { minX: 4, maxX: 6, minZ: 0, maxZ: 6 },
    ];
    const clearance = createRouteClearance({
      obstacles: [],
      walkableBounds: floors,
    });
    expect(clearance.clear([1, 1], [5, 5])).toBe(false);
    // Centers are inside the union, but a radius-.28 body's inner corner would clip.
    expect(clearance.clear([3.8, 1.8], [4.2, 2.2])).toBe(false);
    const route = createNaturalRoute(
      [
        [1, 1],
        [5, 1],
        [5, 5],
      ],
      { obstacles: [], walkableBounds: floors },
    );
    const missingFloor = { minX: 0, maxX: 4, minZ: 2, maxZ: 6 };
    for (let i = 1; i < route.length; i++)
      expect(hits(route[i - 1], route[i], missingFloor)).toBe(false);
  });

  it("takes materially shorter southern desk arrivals and ordinary strolls without skipping the chair sidestep", () => {
    const rooms = layouts(1),
      room = rooms[0],
      desk = room.desks[1];
    const arrival = createBuildingEntryRoute(rooms, room, desk);
    const oldArrival: Route = [
      [2.1, 11.95],
      [2.1, 11],
      [2.1, 6.2],
      [room.mainAisleX, 6.2],
      [room.mainAisleX, desk.aisle[1]],
      desk.aisle,
      desk.exit,
      desk.seat,
    ];
    const oldStroll: Route = [
      desk.seat,
      desk.exit,
      desk.aisle,
      [room.mainAisleX, desk.aisle[1]],
      [room.mainAisleX, desk.lounge[1]],
      desk.lounge,
    ];
    expect(routeLength(arrival)).toBeLessThan(routeLength(oldArrival) * 0.75);
    expect(routeLength(desk.route)).toBeLessThan(routeLength(oldStroll) * 0.45);
    expect(arrival.at(-2)).toEqual(desk.exit);
    expect(arrival.at(-1)).toEqual(desk.seat);
    expect(desk.route.slice(0, 2)).toEqual([desk.seat, desk.exit]);
    expect(
      arrival.some(
        (point, i) =>
          i > 0 &&
          Math.abs(point[0] - arrival[i - 1][0]) > 0.05 &&
          Math.abs(point[1] - arrival[i - 1][1]) > 0.05,
      ),
    ).toBe(true);
  });

  it("keeps distance-based heading continuous across rounded curves and required chair corners", () => {
    const rooms = layouts(4);
    for (const room of rooms)
      for (const desk of room.desks) {
        for (const route of [
          createBuildingEntryRoute(rooms, room, desk),
          createBuildingExitRoute(rooms, room, desk),
          desk.route,
        ]) {
          const total = routeLength(route);
          let previous = sampleNaturalRoutePose(route, 0);
          let maximumTurn = 0,
            maximumStep = 0;
          for (let d = 0.01; d <= total; d += 0.01) {
            const pose = sampleNaturalRoutePose(route, d);
            maximumTurn = Math.max(
              maximumTurn,
              angleDifference(pose.yaw, previous.yaw),
            );
            maximumStep = Math.max(
              maximumStep,
              Math.hypot(
                pose.position[0] - previous.position[0],
                pose.position[1] - previous.position[1],
              ),
            );
            previous = pose;
          }
          expect(maximumTurn).toBeLessThan(0.14);
          expect(maximumStep).toBeLessThanOrEqual(0.010001);
        }
      }
  }, 15000);

  it("memoizes scene obstacles and repeated lifecycle plans while returning independent point arrays", () => {
    const spy = vi.spyOn(obstaclesModule, "createNavigationObstacles");
    const rooms = layouts(16),
      room = rooms[0],
      desk = room.desks[0];
    const original = createBuildingEntryRoute(rooms, room, desk);
    const before = JSON.stringify(original);
    for (let repeat = 0; repeat < 192; repeat++) {
      const route = createBuildingEntryRoute(rooms, room, desk, repeat);
      expect(route).toEqual(original);
      route[0][0] = -999;
    }
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(original)).toBe(before);
    spy.mockRestore();
  });

  it("reuses plans across status-only rebuilt layouts and caps retained geometry snapshots", () => {
    const make = (id: string) => createOfficeLayout([{ id, agentCount: 2 }]);
    const spy = vi.spyOn(obstaclesModule, "createNavigationObstacles");
    const first = make("cache-original");
    const original = createBuildingEntryRoute(
      first,
      first[0],
      first[0].desks[1],
    );
    for (let i = 0; i < 20; i++) {
      const rebuilt = make("cache-original");
      expect(
        createBuildingEntryRoute(rebuilt, rebuilt[0], rebuilt[0].desks[1]),
      ).toEqual(original);
    }
    expect(spy).toHaveBeenCalledTimes(1);
    // Eight newer independent scenes evict the old strong geometry entry.
    for (let i = 0; i < 8; i++) {
      const newer = make(`cache-new-${i}`);
      createBuildingEntryRoute(newer, newer[0], newer[0].desks[1]);
    }
    const again = make("cache-original");
    expect(
      createBuildingEntryRoute(again, again[0], again[0].desks[1]),
    ).toEqual(original);
    expect(spy).toHaveBeenCalledTimes(10);
    spy.mockRestore();
  });

  it("keeps both orientations' ordinary routes on their own room floors for all visible roster sizes", () => {
    for (let count = 1; count <= 6; count++) {
      const room = createRoomLayout(`roster-${count}`, 0, count);
      const obstacles = obstaclesModule.createRoomNavigationObstacles(room);
      for (const desk of room.desks)
        for (let i = 1; i < desk.route.length; i++) {
          for (const obstacle of obstacles) {
            if (i === 1 && obstacle.seatedChair?.deskIndex === desk.index)
              continue;
            expect(
              hits(desk.route[i - 1], desk.route[i], obstacle.bounds),
            ).toBe(false);
          }
        }
    }
  });
});
