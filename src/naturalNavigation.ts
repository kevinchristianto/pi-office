import {
  WALKER_RADIUS,
  routeLength,
  sampleRoute,
  type RoomBounds,
  type Route,
  type WorldPoint,
} from "./world";

const EPSILON = 1e-7;
const navigationClearance = () => WALKER_RADIUS + 0.002;
/** Extra room at graph corners allows a genuinely rounded, collision-safe turn. */
const CORNER_MARGIN = 0.14;
export const ROUTE_HEADING_LOOKAHEAD = 0.12;

export interface NaturalRouteOptions {
  obstacles: readonly { bounds: RoomBounds }[];
  /** Actual floor union, before the walker's full clearance is applied. */
  walkableBounds: readonly RoomBounds[];
}

export function segmentIntersectsBounds(
  from: WorldPoint,
  to: WorldPoint,
  bounds: RoomBounds,
  radius = WALKER_RADIUS,
): boolean {
  let enter = 0,
    leave = 1;
  for (const [axis, low, high] of [
    [0, bounds.minX - radius, bounds.maxX + radius],
    [1, bounds.minZ - radius, bounds.maxZ + radius],
  ] as const) {
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < EPSILON) {
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

const distance = (a: WorldPoint, b: WorldPoint) =>
  Math.hypot(b[0] - a[0], b[1] - a[1]);
const contains = (bounds: RoomBounds, point: WorldPoint, inset = 0) =>
  point[0] >= bounds.minX + inset &&
  point[0] <= bounds.maxX - inset &&
  point[1] >= bounds.minZ + inset &&
  point[1] <= bounds.maxZ - inset;
const overlaps = (a: RoomBounds, b: RoomBounds) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
const encloses = (a: RoomBounds, b: RoomBounds) =>
  a.minX <= b.minX && a.maxX >= b.maxX && a.minZ <= b.minZ && a.maxZ >= b.maxZ;
function compact(route: Route): WorldPoint[] {
  return route
    .filter(
      (point, index) => !index || distance(point, route[index - 1]) > EPSILON,
    )
    .map((point) => [...point]);
}

/** Exact rectangular complement of the floor union, including concave joins. */
function floorComplement(floors: readonly RoomBounds[]) {
  const xs = [
    ...new Set(floors.flatMap((floor) => [floor.minX, floor.maxX])),
  ].sort((a, b) => a - b);
  const zs = [
    ...new Set(floors.flatMap((floor) => [floor.minZ, floor.maxZ])),
  ].sort((a, b) => a - b);
  const gaps: RoomBounds[] = [];
  for (let z = 1; z < zs.length; z++) {
    let pending: RoomBounds | undefined;
    for (let x = 1; x < xs.length; x++) {
      const center: WorldPoint = [
        (xs[x - 1] + xs[x]) / 2,
        (zs[z - 1] + zs[z]) / 2,
      ];
      if (floors.some((floor) => contains(floor, center))) {
        pending = undefined;
        continue;
      }
      if (pending) pending.maxX = xs[x];
      else {
        pending = {
          minX: xs[x - 1],
          maxX: xs[x],
          minZ: zs[z - 1],
          maxZ: zs[z],
        };
        gaps.push(pending);
      }
    }
  }
  return {
    outer: { minX: xs[0], maxX: xs.at(-1)!, minZ: zs[0], maxZ: zs.at(-1)! },
    gaps,
  };
}

/** Build one collision predicate; the full swept disk has floor and furniture clearance. */
export function createRouteClearance(options: NaturalRouteOptions) {
  if (!options.walkableBounds.length)
    throw new RangeError("A navigation route needs a walkable floor");
  const CLEARANCE = navigationClearance();
  const { outer, gaps } = floorComplement(options.walkableBounds);
  const obstacles = [
    ...options.obstacles.map((obstacle) => obstacle.bounds),
    ...gaps,
  ]
    .filter((bounds) =>
      options.walkableBounds.some((floor) =>
        overlaps(
          {
            minX: bounds.minX - CLEARANCE,
            maxX: bounds.maxX + CLEARANCE,
            minZ: bounds.minZ - CLEARANCE,
            maxZ: bounds.maxZ + CLEARANCE,
          },
          floor,
        ),
      ),
    )
    // Panel caps, kickplates and glass trim can enclose one another. Keeping only
    // maximal envelopes reduces graph work without weakening any collision bound.
    .filter(
      (bounds, index, all) =>
        !all.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            encloses(other, bounds) &&
            (!encloses(bounds, other) || otherIndex < index),
        ),
    );
  const clear = (from: WorldPoint, to: WorldPoint) =>
    contains(outer, from, CLEARANCE) &&
    contains(outer, to, CLEARANCE) &&
    !obstacles.some((bounds) =>
      segmentIntersectsBounds(from, to, bounds, CLEARANCE),
    );
  return { clear, obstacles, outer };
}

/** Rounded quadratic corners are accepted only after sweeping every output chord. */
function roundRoute(
  route: Route,
  clear: (from: WorldPoint, to: WorldPoint) => boolean,
): WorldPoint[] {
  if (route.length < 3) return compact(route);
  const result: WorldPoint[] = [[...route[0]]];
  for (let index = 1; index < route.length - 1; index++) {
    const previous = route[index - 1],
      corner = route[index],
      next = route[index + 1];
    const before = distance(previous, corner),
      after = distance(corner, next);
    let offset = Math.min(0.65, before * 0.44, after * 0.44);
    let curve: WorldPoint[] | undefined;
    for (
      let attempt = 0;
      attempt < 7 && offset > 0.006;
      attempt++, offset *= 0.5
    ) {
      const start: WorldPoint = [
        corner[0] + ((previous[0] - corner[0]) * offset) / before,
        corner[1] + ((previous[1] - corner[1]) * offset) / before,
      ];
      const end: WorldPoint = [
        corner[0] + ((next[0] - corner[0]) * offset) / after,
        corner[1] + ((next[1] - corner[1]) * offset) / after,
      ];
      const steps = Math.max(4, Math.ceil((2 * offset) / 0.035 - 1e-8));
      const candidate: WorldPoint[] = Array.from(
        { length: steps + 1 },
        (_, step) => {
          const t = step / steps,
            s = 1 - t;
          return [
            s * s * start[0] + 2 * s * t * corner[0] + t * t * end[0],
            s * s * start[1] + 2 * s * t * corner[1] + t * t * end[1],
          ];
        },
      );
      const whole = [result.at(-1)!, ...candidate, next];
      if (whole.slice(1).every((point, i) => clear(whole[i], point))) {
        curve = candidate;
        break;
      }
    }
    result.push(...(curve ?? [[...corner] as WorldPoint]));
  }
  result.push([...route.at(-1)!]);
  return compact(result);
}

/**
 * Deterministic local visibility graph, followed by verified rounded corners.
 * Seed points establish connectivity only; free space is traversed directly and
 * obstacle corners can replace the old prescribed right-angle aisle sequence.
 */
export function createNaturalRoute(
  safeWaypoints: Route,
  options: NaturalRouteOptions,
): WorldPoint[] {
  if (!safeWaypoints.length) throw new RangeError("Cannot plan an empty route");
  const seed = compact(safeWaypoints);
  if (seed.length === 1) return seed;
  const CLEARANCE = navigationClearance();
  const { clear, obstacles, outer } = createRouteClearance(options);
  const start = seed[0],
    goal = seed.at(-1)!;
  if (clear(start, goal)) return [[...start], [...goal]];
  const points: WorldPoint[] = [[...start], [...goal]];
  const add = (point: WorldPoint) => {
    if (
      contains(outer, point, CLEARANCE) &&
      clear(point, point) &&
      !points.some((existing) => distance(existing, point) < EPSILON)
    )
      points.push(point);
  };
  seed.slice(1, -1).forEach(add);
  // Only corners on this allowed floor union are admitted. An unrelated office
  // is blocked even if its furniture would otherwise leave a visible shortcut.
  for (const bounds of obstacles) {
    const pad = CLEARANCE + CORNER_MARGIN;
    for (const x of [bounds.minX - pad, bounds.maxX + pad])
      for (const z of [bounds.minZ - pad, bounds.maxZ + pad]) add([x, z]);
  }
  const costs = points.map(() => Infinity),
    previous = points.map(() => -1),
    closed = points.map(() => false);
  costs[0] = 0;
  for (;;) {
    let current = -1,
      score = Infinity;
    for (let index = 0; index < points.length; index++) {
      const candidate = costs[index] + distance(points[index], goal);
      if (!closed[index] && candidate < score - EPSILON) {
        current = index;
        score = candidate;
      }
    }
    if (current < 0)
      throw new RangeError(
        "No furniture-safe route across the reserved walkable floor",
      );
    if (current === 1) break;
    closed[current] = true;
    for (let next = 0; next < points.length; next++) {
      if (closed[next] || next === current) continue;
      const nextCost = costs[current] + distance(points[current], points[next]);
      if (
        nextCost < costs[next] - EPSILON &&
        clear(points[current], points[next])
      ) {
        costs[next] = nextCost;
        previous[next] = current;
      }
    }
  }
  const path: WorldPoint[] = [];
  for (let index = 1; index >= 0; index = previous[index])
    path.push(points[index]);
  return roundRoute(path.reverse(), clear);
}

/** Continuous, deterministic heading shared by the WebGL and offline renderer. */
export function sampleNaturalRoutePose(route: Route, distanceAlong: number) {
  const total = routeLength(route);
  const position = sampleRoute(route, distanceAlong);
  const distance = Math.max(0, Math.min(total, distanceAlong));
  const behind = sampleRoute(
    route,
    Math.max(0, distance - ROUTE_HEADING_LOOKAHEAD),
  );
  const ahead = sampleRoute(
    route,
    Math.min(total, distance + ROUTE_HEADING_LOOKAHEAD),
  );
  return {
    position,
    yaw:
      Math.hypot(ahead[0] - behind[0], ahead[1] - behind[1]) < EPSILON
        ? 0
        : Math.atan2(behind[0] - ahead[0], behind[1] - ahead[1]),
  };
}
