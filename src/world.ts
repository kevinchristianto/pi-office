/**
 * Deterministic, view-only office geometry. Coordinates are [x, z] on floor y=0.
 * Sessions occupy open sections of one shared office; the legacy RoomLayout
 * name describes a floor section, not enclosing walls. Visible desks are a
 * window onto each session roster, never its authoritative set of agents.
 */
export type WorldPoint = [number, number];
export type Route = readonly WorldPoint[];

export const ROOM_WIDTH = 12;
export const ROOM_DEPTH = 10;
export const ROOM_GAP = 2;
export const MAX_VISIBLE_DESKS = 6;
export const DESK_WIDTH = 2;
export const DESK_DEPTH = 0.9;
export const WALKER_RADIUS = 0.28;
export const CHAIR_RADIUS = 0.35;
export const CHAIR_BACK_OFFSET = 0.25;
export const CUBICLE_HEIGHT = 1.15;
export const CUBICLE_WIDTH = 2.7;
export const CUBICLE_SIDE_DEPTH = 1.7;
export const CUBICLE_THICKNESS = 0.08;

export interface RoomBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** One low, floor-mounted fabric panel; its Y center is height / 2. */
export interface CubiclePartition {
  kind: "back" | "left" | "right";
  center: WorldPoint;
  width: number;
  depth: number;
  height: number;
  bounds: RoomBounds;
}

export interface DeskLayout {
  index: number;
  /** Table center. Tables face -Z. */
  desk: WorldPoint;
  /** Seated/standing character origin behind the table. */
  seat: WorldPoint;
  /** Side exit from the chair, before stepping behind its back. */
  exit: WorldPoint;
  /** Clear row aisle behind the chair backs. */
  aisle: WorldPoint;
  /** Distinct standing destination in the front lounge. */
  lounge: WorldPoint;
  /** Low, open-front cubicle panels belonging to this workstation. */
  partitions: CubiclePartition[];
  /** Seat to lounge, with axis-aligned, furniture-safe segments. */
  route: WorldPoint[];
}

export interface RoomLayout {
  id: string;
  index: number;
  center: WorldPoint;
  bounds: RoomBounds;
  desks: DeskLayout[];
  /** Flattened workstation panels; these never enclose a session section. */
  partitions: CubiclePartition[];
  lounge: WorldPoint;
  mainAisleX: number;
  /** Total roster size, including agents outside the current desk window. */
  agentCount: number;
  overflowCount: number;
}

function nonNegativeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

/** Three low panels leave a full-width front opening toward +Z. */
export function createCubiclePartitions(desk: WorldPoint): CubiclePartition[] {
  assertFiniteRoute([desk]);
  const [x, z] = desk;
  const panel = (
    kind: CubiclePartition["kind"],
    center: WorldPoint,
    width: number,
    depth: number,
  ): CubiclePartition => ({
    kind,
    center,
    width,
    depth,
    height: CUBICLE_HEIGHT,
    bounds: {
      minX: center[0] - width / 2,
      maxX: center[0] + width / 2,
      minZ: center[1] - depth / 2,
      maxZ: center[1] + depth / 2,
    },
  });
  return [
    panel("back", [x, z - 0.75], CUBICLE_WIDTH, CUBICLE_THICKNESS),
    panel(
      "left",
      [x - CUBICLE_WIDTH / 2, z + 0.1],
      CUBICLE_THICKNESS,
      CUBICLE_SIDE_DEPTH,
    ),
    panel(
      "right",
      [x + CUBICLE_WIDTH / 2, z + 0.1],
      CUBICLE_THICKNESS,
      CUBICLE_SIDE_DEPTH,
    ),
  ];
}

/**
 * Session-section indices are stable positions along X, separated by ROOM_GAP.
 * Render table geometry no larger than DESK_WIDTH by DESK_DEPTH at `desk`.
 * Keep the row aisles, main aisle, and lounge destinations clear of furniture.
 * Use the returned panel dimensions for trim too; wider trim needs new clearance.
 * Multiple walkers need an animation-level reservation/spacing policy; these
 * routes guarantee furniture clearance, not inter-character collision handling.
 */
export function createRoomLayout(
  sessionId: string,
  index: number,
  agentCount: number,
): RoomLayout {
  nonNegativeInteger(index, "Room index");
  nonNegativeInteger(agentCount, "Agent count");
  const centerX = index * (ROOM_WIDTH + ROOM_GAP);
  // The rightmost side panel reaches local X=4.79. This line clears it
  // by 0.56 units and leaves 0.65 units to the section boundary.
  const mainAisleX = centerX + 5.35;
  const count = Math.min(agentCount, MAX_VISIBLE_DESKS);
  const desks: DeskLayout[] = Array.from({ length: count }, (_, deskIndex) => {
    const x = centerX + [-3.4, 0, 3.4][deskIndex % 3];
    const z = deskIndex < 3 ? -2 : 1;
    const desk: WorldPoint = [x, z];
    const seat: WorldPoint = [x, z + 0.74];
    const exit: WorldPoint = [x + 0.75, seat[1]];
    const aisle: WorldPoint = [exit[0], z + 1.8];
    // Reserve six distinct lounge spots even when fewer agents are visible.
    const lounge: WorldPoint = [centerX - 3.25 + deskIndex * 1.3, 3.8];
    return {
      index: deskIndex,
      desk,
      seat,
      exit,
      aisle,
      lounge,
      partitions: createCubiclePartitions(desk),
      route: [
        [...seat],
        [...exit],
        [...aisle],
        [mainAisleX, aisle[1]],
        [mainAisleX, lounge[1]],
        [...lounge],
      ],
    };
  });
  return {
    id: sessionId,
    index,
    center: [centerX, 0],
    bounds: {
      minX: centerX - ROOM_WIDTH / 2,
      maxX: centerX + ROOM_WIDTH / 2,
      minZ: -ROOM_DEPTH / 2,
      maxZ: ROOM_DEPTH / 2,
    },
    desks,
    partitions: desks.flatMap((desk) => desk.partitions),
    lounge: [centerX, 3.8],
    mainAisleX,
    agentCount,
    overflowCount: Math.max(0, agentCount - MAX_VISIBLE_DESKS),
  };
}

function assertFiniteRoute(route: Route) {
  for (const point of route) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      throw new RangeError("Route points must contain finite coordinates");
    }
  }
}

/** Total walking distance, in world units. Empty and singleton routes are 0. */
export function routeLength(route: Route): number {
  assertFiniteRoute(route);
  let length = 0;
  for (let i = 1; i < route.length; i++) {
    length += Math.hypot(
      route[i][0] - route[i - 1][0],
      route[i][1] - route[i - 1][1],
    );
  }
  return length;
}

/**
 * Walk by arc length, segment by segment, rather than drawing a diagonal
 * between the endpoints. Out-of-range finite distances clamp to the endpoints.
 * Returns a new point; it never mutates or aliases the source route.
 */
export function sampleRoute(route: Route, distance: number): WorldPoint {
  if (route.length === 0) throw new RangeError("Cannot sample an empty route");
  if (!Number.isFinite(distance)) {
    throw new RangeError("Route distance must be finite");
  }
  assertFiniteRoute(route);
  let remaining = Math.max(0, distance);
  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1];
    const to = route[i];
    const segment = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (segment === 0) continue;
    if (remaining <= segment) {
      const t = remaining / segment;
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    }
    remaining -= segment;
  }
  return [...route[route.length - 1]];
}

/** A fresh, reversed copy for the return trip; source waypoints stay unchanged. */
export function reverseRoute(route: Route): WorldPoint[] {
  return [...route].reverse().map((point) => [...point]);
}
