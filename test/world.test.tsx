import { describe, expect, it } from "vitest";
import {
  createRoomLayout,
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

describe("open session section layout", () => {
  it("is deterministic, independent, and does not mutate other layouts", () => {
    const first = createRoomLayout("session-a", 0, 6);
    const again = createRoomLayout("session-a", 0, 6);
    expect(first).toEqual(again);
    first.desks[0].route[0][0] = 100;
    expect(again.desks[0].route[0][0]).toBe(-3.4);
    expect(first.desks[0].seat[0]).toBe(-3.4);
  });

  it("keeps the full roster size while capping the visible desk window", () => {
    for (const count of [0, 1, 3, 6, 7, 50, 10_000]) {
      const room = createRoomLayout("session", 0, count);
      expect(room.desks).toHaveLength(Math.min(count, MAX_VISIBLE_DESKS));
      expect(room.agentCount).toBe(count);
      expect(room.overflowCount).toBe(Math.max(0, count - MAX_VISIBLE_DESKS));
    }
  });

  it("gives arbitrary sessions distinct equally sized floor sections with clear gaps", () => {
    const rooms = Array.from({ length: 100 }, (_, i) =>
      createRoomLayout(`session-${i}`, i, 6),
    );
    for (const [index, room] of rooms.entries()) {
      expect(room.id).toBe(`session-${index}`);
      expect(room.index).toBe(index);
      expect(room.center).toEqual([index * (ROOM_WIDTH + ROOM_GAP), 0]);
      expect(room.bounds.maxX - room.bounds.minX).toBe(ROOM_WIDTH);
      expect(room.bounds.maxZ - room.bounds.minZ).toBe(ROOM_DEPTH);
      if (index > 0) {
        expect(room.bounds.minX - rooms[index - 1].bounds.maxX).toBe(ROOM_GAP);
      }
      for (const desk of room.desks) {
        expect(desk.seat[1]).toBeCloseTo(desk.desk[1] + 0.74);
        insideRoom(desk.desk, room.bounds, DESK_WIDTH / 2);
        insideRoom(desk.seat, room.bounds, WALKER_RADIUS);
      }
    }
  });

  it("translates every desk and waypoint with its owning session", () => {
    const origin = createRoomLayout("a", 0, 6);
    const moved = createRoomLayout("b", 7, 6);
    const dx = 7 * (ROOM_WIDTH + ROOM_GAP);
    moved.desks.forEach((desk, i) => {
      for (const key of ["desk", "seat", "exit", "aisle", "lounge"] as const) {
        expect(desk[key][0]).toBeCloseTo(origin.desks[i][key][0] + dx);
        expect(desk[key][1]).toBe(origin.desks[i][key][1]);
      }
      desk.route.forEach((point, j) => {
        expect(point[0]).toBeCloseTo(origin.desks[i].route[j][0] + dx);
        expect(point[1]).toBe(origin.desks[i].route[j][1]);
      });
    });
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
    "rejects invalid room indices and agent counts: %s",
    (invalid) => {
      expect(() => createRoomLayout("session", invalid, 6)).toThrow(RangeError);
      expect(() => createRoomLayout("session", 0, invalid)).toThrow(RangeError);
    },
  );
});

describe("airy open-front cubicles", () => {
  it("builds exactly three low panels per visible desk and no front wall", () => {
    for (const count of [0, 1, 3, 6, 40]) {
      const section = createRoomLayout("open-office", 0, count);
      expect(section.partitions).toHaveLength(Math.min(count, 6) * 3);
      expect(section.partitions).toEqual(
        section.desks.flatMap((desk) => desk.partitions),
      );
      for (const desk of section.desks) {
        const [back, left, right] = desk.partitions;
        expect(desk.partitions.map((panel) => panel.kind)).toEqual([
          "back",
          "left",
          "right",
        ]);
        expect(back.center).toEqual([desk.desk[0], desk.desk[1] - 0.75]);
        expect(back.width).toBe(CUBICLE_WIDTH);
        expect(back.depth).toBe(CUBICLE_THICKNESS);
        for (const [panel, sign] of [
          [left, -1],
          [right, 1],
        ] as const) {
          expect(panel.center[0]).toBeCloseTo(desk.desk[0] + sign * 1.35);
          expect(panel.center[1]).toBeCloseTo(desk.desk[1] + 0.1);
          expect(panel.width).toBe(CUBICLE_THICKNESS);
          expect(panel.depth).toBe(CUBICLE_SIDE_DEPTH);
          expect(panel.bounds.minZ).toBeCloseTo(desk.desk[1] - 0.75);
          expect(panel.bounds.maxZ).toBeCloseTo(desk.desk[1] + 0.95);
        }
        // A 2.62-unit open front, with panels below standing head height.
        expect(right.bounds.minX - left.bounds.maxX).toBeCloseTo(2.62);
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

  it("retains desk spacing and at least 1.2 units of clear primary aisles", () => {
    const section = createRoomLayout("generous-aisles", 0, 6);
    expect(section.desks[1].desk[0] - section.desks[0].desk[0]).toBeCloseTo(
      3.4,
    );
    expect(section.desks[3].desk[1] - section.desks[0].desk[1]).toBe(3);
    const firstRowSide = section.desks[0].partitions.find(
      (panel) => panel.kind === "right",
    )!;
    const secondRowBack = section.desks[3].partitions.find(
      (panel) => panel.kind === "back",
    )!;
    expect(
      secondRowBack.bounds.minZ - firstRowSide.bounds.maxZ,
    ).toBeGreaterThanOrEqual(1.2);
    const rightEdge = Math.max(
      ...section.partitions.map((panel) => panel.bounds.maxX),
    );
    expect(section.bounds.maxX - rightEdge).toBeGreaterThanOrEqual(1.2);
    expect(section.mainAisleX - rightEdge).toBeGreaterThan(WALKER_RADIUS);
    expect(section.bounds.maxX - section.mainAisleX).toBeGreaterThan(
      WALKER_RADIUS,
    );
    for (const desk of section.desks) {
      expect(desk.seat[1] - desk.desk[1]).toBeCloseTo(0.74);
      expect(desk.exit[0] - desk.seat[0]).toBeCloseTo(0.75);
      expect(desk.aisle[1] - desk.desk[1]).toBeCloseTo(1.8);
    }
  });

  it("translates independent panel geometry into its session section", () => {
    const origin: WorldPoint = [2, 3];
    const original = createCubiclePartitions(origin);
    const translated = createCubiclePartitions([102, 3]);
    original.forEach((panel, i) => {
      expect(translated[i].center[0] - panel.center[0]).toBeCloseTo(100);
      expect(translated[i].center[1]).toBe(panel.center[1]);
      expect(translated[i].bounds.minX - panel.bounds.minX).toBeCloseTo(100);
      expect(translated[i].bounds.maxX - panel.bounds.maxX).toBeCloseTo(100);
      expect(translated[i].bounds.minZ).toBe(panel.bounds.minZ);
      expect(translated[i].bounds.maxZ).toBe(panel.bounds.maxZ);
    });
    original[0].center[0] = 999;
    expect(origin).toEqual([2, 3]);
    expect(createCubiclePartitions(origin)[0].center[0]).toBe(2);
    expect(() => createCubiclePartitions([NaN, 0])).toThrow(RangeError);
  });

  it("keeps every complete walking segment clear of expanded partition AABBs", () => {
    for (const index of [0, 1, 12, 1000]) {
      const section = createRoomLayout("panel-clearance", index, 6);
      for (const desk of section.desks) {
        for (const route of [desk.route, reverseRoute(desk.route)]) {
          for (let i = 1; i < route.length; i++) {
            for (const panel of section.partitions) {
              expect(
                segmentIntersectsBox(route[i - 1], route[i], {
                  minX: panel.bounds.minX - WALKER_RADIUS,
                  maxX: panel.bounds.maxX + WALKER_RADIUS,
                  minZ: panel.bounds.minZ - WALKER_RADIUS,
                  maxZ: panel.bounds.maxZ + WALKER_RADIUS,
                }),
              ).toBe(false);
            }
          }
        }
      }
    }
  });

  it("would detect the previous main aisle clipping the outer cubicle panel", () => {
    const section = createRoomLayout("regression-aisle", 0, 6);
    const panel = section.desks[5].partitions.find(
      (panel) => panel.kind === "right",
    )!;
    const expanded = {
      minX: panel.bounds.minX - WALKER_RADIUS,
      maxX: panel.bounds.maxX + WALKER_RADIUS,
      minZ: panel.bounds.minZ - WALKER_RADIUS,
      maxZ: panel.bounds.maxZ + WALKER_RADIUS,
    };
    expect(segmentIntersectsBox([5, -0.2], [5, 3.8], expanded)).toBe(true);
    expect(
      segmentIntersectsBox(
        [section.mainAisleX, -0.2],
        [section.mainAisleX, 3.8],
        expanded,
      ),
    ).toBe(false);
  });
});

describe("safe walking routes", () => {
  it("keeps complete outbound and return segments outside all expanded desk bounds", () => {
    // Test a full room even when a smaller roster is displayed, so spare desks
    // may remain visible as furniture without changing the navigation result.
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
            expect(from[0] === to[0] || from[1] === to[1]).toBe(true);
            for (const other of room.desks) {
              expect(
                segmentIntersectsBox(from, to, {
                  minX: other.desk[0] - DESK_WIDTH / 2 - WALKER_RADIUS,
                  maxX: other.desk[0] + DESK_WIDTH / 2 + WALKER_RADIUS,
                  minZ: other.desk[1] - DESK_DEPTH / 2 - WALKER_RADIUS,
                  maxZ: other.desk[1] + DESK_DEPTH / 2 + WALKER_RADIUS,
                }),
              ).toBe(false);
            }
          }
        }
      }
    }
  });

  it("sidesteps the chair back and clears every other chair during a visit", () => {
    const room = createRoomLayout("chair-clearance", 0, 6);
    for (const desk of room.desks) {
      expect(desk.exit[1]).toBe(desk.seat[1]);
      expect(desk.exit[0] - desk.seat[0]).toBeCloseTo(0.75);
      expect(desk.aisle[0]).toBe(desk.exit[0]);
      for (const route of [desk.route, reverseRoute(desk.route)]) {
        for (let i = 1; i < route.length; i++) {
          for (const other of room.desks) {
            // The initial seated origin intentionally lies inside its own
            // chair footprint. Permit just that departure/arrival segment.
            if (
              other.index === desk.index &&
              ((route[i - 1][0] === desk.seat[0] &&
                route[i - 1][1] === desk.seat[1]) ||
                (route[i][0] === desk.seat[0] && route[i][1] === desk.seat[1]))
            )
              continue;
            const chairZ = other.seat[1] + CHAIR_BACK_OFFSET;
            expect(
              segmentIntersectsBox(route[i - 1], route[i], {
                minX: other.seat[0] - CHAIR_RADIUS - WALKER_RADIUS,
                maxX: other.seat[0] + CHAIR_RADIUS + WALKER_RADIUS,
                minZ: chairZ - CHAIR_RADIUS - WALKER_RADIUS,
                maxZ: chairZ + CHAIR_RADIUS + WALKER_RADIUS,
              }),
            ).toBe(false);
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
