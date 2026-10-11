import {
  createBuildingEntranceLayout,
  officeLayoutBounds,
  reverseRoute,
  buildingLayoutBounds,
  type RoomBounds,
  type DeskLayout,
  type RoomLayout,
  type Route,
  type WorldPoint,
} from "./world";

export { createBuildingEntranceLayout } from "./world";
export { WALK_SPEED as LIFECYCLE_WALK_SPEED } from "./motion";
import {
  createNaturalRoute,
  sampleNaturalRoutePose,
} from "./naturalNavigation";
import { createNavigationObstacles } from "./navigationObstacles";

interface CachedNavigationScene {
  obstacles: ReturnType<typeof createNavigationObstacles>;
  routes: Map<string, WorldPoint[]>;
}
// App status updates rebuild RoomLayout objects. Reuse plans by immutable
// geometry rather than by one render's object identity; cap retained scenes.
const geometryCache = new Map<string, CachedNavigationScene>();
const layoutCache = new WeakMap<readonly RoomLayout[], CachedNavigationScene>();
const MAX_CACHED_SCENES = 8;
function navigationScene(rooms: readonly RoomLayout[]): CachedNavigationScene {
  const known = layoutCache.get(rooms);
  if (known) return known;
  const signature = JSON.stringify(
    rooms.map((room) => ({
      id: room.id,
      index: room.index,
      center: room.center,
      bounds: room.bounds,
      mainAisleX: room.mainAisleX,
      desks: room.desks.map((desk) => ({
        index: desk.index,
        desk: desk.desk,
        seat: desk.seat,
        exit: desk.exit,
        aisle: desk.aisle,
        orientation: desk.orientation,
      })),
      panels: room.partitions.map((panel) => ({
        center: panel.center,
        width: panel.width,
        depth: panel.depth,
        height: panel.height,
      })),
    })),
  );
  let scene = geometryCache.get(signature);
  if (scene) geometryCache.delete(signature);
  else
    scene = { obstacles: createNavigationObstacles(rooms), routes: new Map() };
  geometryCache.set(signature, scene);
  while (geometryCache.size > MAX_CACHED_SCENES)
    geometryCache.delete(geometryCache.keys().next().value!);
  layoutCache.set(rooms, scene);
  return scene;
}

/**
 * Logical waiting tickets share an exterior point because waiting arrivals stay
 * offsite. The caller must hold the global corridor reservation before showing
 * the actor; departing actors remain at their desks until their grant.
 */
export function buildingQueuePosition(
  roomCount: number,
  queueIndex: number,
): WorldPoint {
  const entrance = createBuildingEntranceLayout(roomCount);
  if (
    !Number.isSafeInteger(queueIndex) ||
    queueIndex < 0 ||
    queueIndex >= entrance.queueCapacity
  ) {
    throw new RangeError(
      "Queue index must identify an available lifecycle ticket",
    );
  }
  return [...entrance.outside];
}

/** Reserved floor union: never cross another department's occupied desk area. */
export function lifecycleWalkableFloors(
  rooms: readonly RoomLayout[],
  room: RoomLayout,
): RoomBounds[] {
  const office = officeLayoutBounds(rooms.length);
  const building = buildingLayoutBounds(rooms.length);
  const floors = [
    { ...room.bounds },
    {
      minX: building.minX,
      maxX: building.maxX,
      minZ: office.maxZ,
      maxZ: building.maxZ,
    },
    {
      minX: office.maxX,
      maxX: building.maxX,
      minZ: office.minZ,
      maxZ: office.maxZ,
    },
  ];
  if (room.bounds.maxZ < office.maxZ - 1e-8)
    floors.push({
      minX: office.minX,
      maxX: building.maxX,
      minZ: room.bounds.maxZ,
      maxZ: room.bounds.maxZ + 2,
    });
  return floors;
}

/**
 * Protected exterior point → real front door → shared hall → department front opening
 * → collision-aware open space → desk. Northern departments are reached on the outer east
 * spine; no route cuts through another department or any rear glass wall.
 * Returned points are the exact route used by the runtime and render snapshots.
 */
export function createBuildingEntryRoute(
  rooms: readonly RoomLayout[],
  room: RoomLayout,
  desk: DeskLayout,
  queueIndex = 0,
): WorldPoint[] {
  if (
    !rooms.some(
      (candidate) => candidate.id === room.id && candidate.index === room.index,
    )
  ) {
    throw new RangeError("Arrival room must belong to the displayed office");
  }
  if (!room.desks.some((candidate) => candidate.index === desk.index)) {
    throw new RangeError("Arrival desk must belong to its department");
  }
  const outside = buildingQueuePosition(rooms.length, queueIndex);
  const scene = navigationScene(rooms);
  const routeKey = `${room.index}:${desk.index}`;
  const cached = scene.routes.get(routeKey);
  if (cached) return cached.map((point) => [...point]);
  const entrance = createBuildingEntranceLayout(rooms.length);
  const office = officeLayoutBounds(rooms.length);
  const route: WorldPoint[] = [[...entrance.threshold], [...entrance.corridor]];
  const frontRow = Math.abs(room.bounds.maxZ - office.maxZ) < 1e-8;
  const departmentCorridorZ = frontRow
    ? entrance.corridor[1]
    : room.bounds.maxZ + 1;
  if (!frontRow) {
    route.push(
      [entrance.eastSpineX, entrance.corridor[1]],
      [entrance.eastSpineX, departmentCorridorZ],
    );
  }
  route.push(
    [room.mainAisleX, departmentCorridorZ],
    [room.mainAisleX, desk.aisle[1]],
    [...desk.aisle],
    [...desk.exit],
  );
  const natural = [
    outside,
    ...createNaturalRoute(route, {
      obstacles: scene.obstacles,
      walkableBounds: lifecycleWalkableFloors(rooms, room),
    }),
    [...desk.seat] as WorldPoint,
  ];
  scene.routes.set(routeKey, natural);
  return natural.map((point) => [...point]);
}

/** The departure retraces precisely the same doorway and furniture-safe aisles. */
export function createBuildingExitRoute(
  rooms: readonly RoomLayout[],
  room: RoomLayout,
  desk: DeskLayout,
  queueIndex = 0,
): WorldPoint[] {
  return reverseRoute(createBuildingEntryRoute(rooms, room, desk, queueIndex));
}

/** Continuous look-ahead heading shared by runtime and offline snapshots. */
export function sampleLifecycleRoutePose(route: Route, distance: number) {
  return sampleNaturalRoutePose(route, distance);
}
