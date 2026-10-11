import { createNaturalRoute } from "./naturalNavigation";
import { createRoomNavigationObstacles } from "./navigationObstacles";

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
  /** Table center. Local forward is -Z before applying orientation. */
  desk: WorldPoint;
  /** World Y rotation in radians: 0 faces -Z, Math.PI faces +Z. */
  orientation: number;
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
  /** Seat to lounge, using direct visible space and verified rounded corners. */
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

/** Compact, centered grid; incomplete rows are centered independently. */
function officeGrid(roomCount: number) {
  nonNegativeInteger(roomCount, "Room count");
  const count = Math.max(1, roomCount);
  const idealColumns = Math.sqrt(
    (count * (ROOM_DEPTH + ROOM_GAP)) / (ROOM_WIDTH + ROOM_GAP),
  );
  const candidates = [
    Math.max(1, Math.floor(idealColumns)),
    Math.max(1, Math.ceil(idealColumns)),
  ].map((columns) => {
    const rows = Math.ceil(count / columns);
    return {
      count,
      columns,
      rows,
      width: columns * (ROOM_WIDTH + ROOM_GAP) - ROOM_GAP,
      depth: rows * (ROOM_DEPTH + ROOM_GAP) - ROOM_GAP,
    };
  });
  // Minimize the longer physical dimension rather than the number of columns.
  // Checking the two sides of the continuous optimum is constant-time, even
  // for large counts. Ties favor the smaller total floor footprint.
  return candidates.sort(
    (a, b) =>
      Math.max(a.width, a.depth) - Math.max(b.width, b.depth) ||
      a.width * a.depth - b.width * b.depth,
  )[0];
}

/** Unpadded world floor bounds. Zero rooms reserves one empty-office section. */
export function officeLayoutBounds(roomCount: number): RoomBounds {
  const { width, depth } = officeGrid(roomCount);
  return {
    minX: -width / 2,
    maxX: width / 2,
    minZ: -depth / 2,
    maxZ: depth / 2,
  };
}

export type FacilityKind = "meeting" | "reception" | "pantry" | "print";

export interface FacilityZone {
  kind: FacilityKind;
  center: WorldPoint;
  /** Maximum furniture envelope; circulation must remain outside it. */
  bounds: RoomBounds;
}

export interface FacilityLayout {
  /** Shared front wing, including its clear cross-office circulation lane. */
  bounds: RoomBounds;
  circulation: WorldPoint[];
  zones: Record<FacilityKind, FacilityZone>;
}

/** Physical entrance and compact exterior threshold share one floor plan. */
export interface BuildingEntranceLayout {
  threshold: WorldPoint;
  outside: WorldPoint;
  corridor: WorldPoint;
  eastSpineX: number;
  /** Logical controller capacity, not simultaneously visible exterior slots. */
  queueCapacity: number;
  /** Exterior forecourt; no amenity furniture is placed here. */
  apronBounds: RoomBounds;
}

/**
 * A front door in the real 1.2-unit gap between reception and pantry/print.
 * A global corridor reservation admits one lifecycle walker at a time. Waiting
 * arrivals stay offsite; only the granted actor occupies this exterior point.
 */
export function createBuildingEntranceLayout(
  roomCount: number,
): BuildingEntranceLayout {
  const office = officeLayoutBounds(roomCount);
  const threshold: WorldPoint = [2.1, office.maxZ + 6];
  return {
    threshold,
    outside: [threshold[0], threshold[1] + 0.95],
    corridor: [threshold[0], office.maxZ + 1.2],
    eastSpineX: office.maxX + 0.6,
    queueCapacity: Math.max(1, roomCount) * MAX_VISIBLE_DESKS * 2,
    apronBounds: {
      minX: office.minX - 1.2,
      maxX: office.maxX + 1.2,
      minZ: threshold[1],
      maxZ: threshold[1] + 1.6,
    },
  };
}

/** Whole workplace footprint includes the shared wing and exterior forecourt. */
export function buildingLayoutBounds(roomCount: number): RoomBounds {
  const office = officeLayoutBounds(roomCount);
  const entrance = createBuildingEntranceLayout(roomCount);
  return {
    minX: office.minX - 1.2,
    maxX: office.maxX + 1.2,
    minZ: office.minZ,
    maxZ: entrance.apronBounds.maxZ,
  };
}

/**
 * One shared reception/meeting/pantry/print wing serves every department.
 * Zone bounds are reserved furniture envelopes, not enclosed rooms. All
 * furnishings begin at least 2.8 units beyond the department floor, leaving
 * an unobstructed circulation lane. Residents' desk routes stay in their
 * department; facility destinations can be added only with separate routes.
 */
export function createFacilityLayout(roomCount: number): FacilityLayout {
  const office = officeLayoutBounds(roomCount);
  const building = buildingLayoutBounds(roomCount);
  const zone = (
    kind: FacilityKind,
    x: number,
    z: number,
    width: number,
    depth: number,
  ): FacilityZone => ({
    kind,
    center: [x, office.maxZ + z],
    bounds: {
      minX: x - width / 2,
      maxX: x + width / 2,
      minZ: office.maxZ + z - depth / 2,
      maxZ: office.maxZ + z + depth / 2,
    },
  });
  return {
    bounds: { ...building, minZ: office.maxZ, maxZ: office.maxZ + 6 },
    circulation: [
      [building.minX + 0.6, office.maxZ + 1.2],
      [building.maxX - 0.6, office.maxZ + 1.2],
    ],
    zones: {
      meeting: zone("meeting", -4.6, 4.2, 3.8, 2.8),
      reception: zone("reception", 0, 4.2, 3, 2.8),
      pantry: zone("pantry", 4.6, 3.2, 3.8, 0.8),
      print: zone("print", 4.6, 5.2, 3.8, 0.8),
    },
  };
}

/** Opposing workstations use deterministic half-turn orientations. */
function facingSign(orientation: number) {
  if (orientation !== 0 && orientation !== Math.PI) {
    throw new RangeError("Desk orientation must be 0 or Math.PI radians");
  }
  return orientation === 0 ? 1 : -1;
}

/** Three low panels leave a full-width opening behind the seated resident. */
export function createCubiclePartitions(
  desk: WorldPoint,
  orientation = 0,
): CubiclePartition[] {
  assertFiniteRoute([desk]);
  const [x, z] = desk;
  const sign = facingSign(orientation);
  const panel = (
    kind: CubiclePartition["kind"],
    offset: WorldPoint,
    width: number,
    depth: number,
  ): CubiclePartition => {
    const center: WorldPoint = [x + sign * offset[0], z + sign * offset[1]];
    return {
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
    };
  };
  return [
    panel("back", [0, -0.75], CUBICLE_WIDTH, CUBICLE_THICKNESS),
    panel(
      "left",
      [-CUBICLE_WIDTH / 2, 0.1],
      CUBICLE_THICKNESS,
      CUBICLE_SIDE_DEPTH,
    ),
    panel(
      "right",
      [CUBICLE_WIDTH / 2, 0.1],
      CUBICLE_THICKNESS,
      CUBICLE_SIDE_DEPTH,
    ),
  ];
}

/**
 * Project sections share a centered compact grid, separated by ROOM_GAP.
 * Supply the same totalRoomCount for every section in a displayed office.
 * Workstations fill facing pairs, with chairs outside the paired desk banks.
 * Render table geometry no larger than DESK_WIDTH by DESK_DEPTH at `desk`, and
 * rotate the desk, chair, and seated resident by the returned orientation.
 * Keep the outside row aisles, main aisle, and lounge clear of furniture.
 * Use the returned panel dimensions for trim too; wider trim needs clearance.
 * Multiple walkers still need animation-level reservations: these routes
 * guarantee furniture clearance, not inter-character collision handling.
 */
export function createRoomLayout(
  sessionId: string,
  index: number,
  agentCount: number,
  totalRoomCount = index + 1,
): RoomLayout {
  nonNegativeInteger(index, "Room index");
  nonNegativeInteger(agentCount, "Agent count");
  const grid = officeGrid(totalRoomCount);
  if (index >= grid.count) {
    throw new RangeError(
      "Room index must be smaller than the office room count",
    );
  }
  const row = Math.floor(index / grid.columns);
  const column = index % grid.columns;
  const rowLength = Math.min(grid.columns, grid.count - row * grid.columns);
  const centerX = (column - (rowLength - 1) / 2) * (ROOM_WIDTH + ROOM_GAP);
  const centerZ = (row - (grid.rows - 1) / 2) * (ROOM_DEPTH + ROOM_GAP);
  // The outer panel ends at local X=4.79. The main aisle clears it by 0.56
  // units and leaves 0.65 units to the floor boundary.
  const mainAisleX = centerX + 5.35;
  const count = Math.min(agentCount, MAX_VISIBLE_DESKS);
  const desks: DeskLayout[] = Array.from({ length: count }, (_, deskIndex) => {
    const north = deskIndex % 2 === 0;
    const orientation = north ? Math.PI : 0;
    const sign = facingSign(orientation);
    const x = centerX + [-3.4, 0, 3.4][Math.floor(deskIndex / 2)];
    const z = centerZ + (north ? -1.4 : 0.4);
    const desk: WorldPoint = [x, z];
    const seat: WorldPoint = [x, z + sign * 0.74];
    const exit: WorldPoint = [x + sign * 0.75, seat[1]];
    const aisle: WorldPoint = [exit[0], z + sign * 1.8];
    // Six distinct spots stay clear of the lounge furniture and chair backs.
    const lounge: WorldPoint = [
      centerX - 3.25 + deskIndex * 1.3,
      centerZ + 3.8,
    ];
    return {
      index: deskIndex,
      desk,
      orientation,
      seat,
      exit,
      aisle,
      lounge,
      partitions: createCubiclePartitions(desk, orientation),
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
  const room: RoomLayout = {
    id: sessionId,
    index,
    center: [centerX, centerZ],
    bounds: {
      minX: centerX - ROOM_WIDTH / 2,
      maxX: centerX + ROOM_WIDTH / 2,
      minZ: centerZ - ROOM_DEPTH / 2,
      maxZ: centerZ + ROOM_DEPTH / 2,
    },
    desks,
    partitions: desks.flatMap((desk) => desk.partitions),
    lounge: [centerX, centerZ + 3.8],
    mainAisleX,
    agentCount,
    overflowCount: Math.max(0, agentCount - MAX_VISIBLE_DESKS),
  };
  applyNaturalStrollRoutes(room);
  return room;
}

// Workstation geometry is translation-invariant and has only seven roster
// variants. Cache local routes, then return fresh translated arrays per room.
const strollRoutes = new Map<number, WorldPoint[][]>();
function applyNaturalStrollRoutes(room: RoomLayout) {
  const [x, z] = room.center;
  const local = (point: WorldPoint): WorldPoint => [point[0] - x, point[1] - z];
  let routes = strollRoutes.get(room.desks.length);
  if (!routes) {
    const obstacles = createRoomNavigationObstacles(room).map((obstacle) => ({
      bounds: {
        minX: obstacle.bounds.minX - x,
        maxX: obstacle.bounds.maxX - x,
        minZ: obstacle.bounds.minZ - z,
        maxZ: obstacle.bounds.maxZ - z,
      },
    }));
    const walkableBounds = [
      {
        minX: -ROOM_WIDTH / 2,
        maxX: ROOM_WIDTH / 2,
        minZ: -ROOM_DEPTH / 2,
        maxZ: ROOM_DEPTH / 2,
      },
    ];
    routes = room.desks.map((desk) => [
      local(desk.seat),
      ...createNaturalRoute(desk.route.slice(1).map(local), {
        obstacles,
        walkableBounds,
      }),
    ]);
    strollRoutes.set(room.desks.length, routes);
  }
  room.desks.forEach((desk, index) => {
    desk.route = routes![index].map((point) => [point[0] + x, point[1] + z]);
    // Keep the precise model anchors even after translating floating-point paths.
    desk.route[0] = [...desk.seat];
    desk.route[1] = [...desk.exit];
    desk.route[desk.route.length - 1] = [...desk.lounge];
  });
}

/** Build all project sections with one consistent office grid. */
export function createOfficeLayout(
  sections: readonly { id: string; agentCount: number }[],
): RoomLayout[] {
  return sections.map((section, index) =>
    createRoomLayout(section.id, index, section.agentCount, sections.length),
  );
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
