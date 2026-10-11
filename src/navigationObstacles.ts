import assetManifest from "../public/models/asset-manifest.json";
import {
  createAmenityDecor,
  createRoomDecor,
  type OfficeSolid,
} from "./officeDecor";
import { createEntranceDecor } from "./entranceDecor";
import {
  createFacilityLayout,
  type RoomBounds,
  type RoomLayout,
  type WorldPoint,
} from "./world";

export interface NavigationObstacle {
  name: string;
  bounds: RoomBounds;
  /** Only the matching seat-to-side-exit segment may overlap this chair. */
  seatedChair?: { roomId: string; deskIndex: number };
}

/** Ignore walkable floor surfaces and overhead-only fixtures, never low panels. */
export function solidNavigationBounds(solid: OfficeSolid): RoomBounds | null {
  if (
    solid.position[1] + solid.size[1] / 2 <= 0.09 ||
    solid.position[1] - solid.size[1] / 2 >= 1.8
  )
    return null;
  return {
    minX: solid.position[0] - solid.size[0] / 2,
    maxX: solid.position[0] + solid.size[0] / 2,
    minZ: solid.position[2] - solid.size[2] / 2,
    maxZ: solid.position[2] + solid.size[2] / 2,
  };
}

/** Full authored GLB envelope, including chair arms/casters and plant foliage. */
export function assetNavigationBounds(
  name: "desk" | "chair" | "plant",
  position: WorldPoint,
  orientation = 0,
  scale = 1,
): RoomBounds {
  const asset = assetManifest.assets[name];
  const sign = orientation === Math.PI ? -1 : 1;
  const xs = [asset.minXYZ[0], asset.maxXYZ[0]].map(
    (value) => position[0] + sign * value * scale,
  );
  const zs = [asset.minXYZ[2], asset.maxXYZ[2]].map(
    (value) => position[1] + sign * value * scale,
  );
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

/** Collision envelopes are derived from the same scene data and GLB manifest. */
export function createRoomNavigationObstacles(
  room: RoomLayout,
): NavigationObstacle[] {
  const obstacles: NavigationObstacle[] = [];
  const solids = (items: OfficeSolid[]) =>
    items.forEach((solid) => {
      const bounds = solidNavigationBounds(solid);
      if (bounds) obstacles.push({ name: solid.name, bounds });
    });
  const asset = (
    name: "desk" | "chair" | "plant",
    at: WorldPoint,
    orientation = 0,
    scale = 1,
    seatedChair?: NavigationObstacle["seatedChair"],
  ) =>
    obstacles.push({
      name,
      bounds: assetNavigationBounds(name, at, orientation, scale),
      seatedChair,
    });
  {
    solids(createRoomDecor(room));
    for (const desk of room.desks) {
      asset("desk", desk.desk, desk.orientation);
      asset("chair", desk.seat, desk.orientation, 1, {
        roomId: room.id,
        deskIndex: desk.index,
      });
    }
    const [x, z] = room.center;
    if (!room.desks.length) {
      asset("desk", [x, z - 1.4], Math.PI);
      asset("chair", [x, z - 2.14], Math.PI);
      asset("desk", [x, z + 0.4]);
      asset("chair", [x, z + 1.14]);
    }
    asset("plant", [x - 5.35, z - 4.25], 0, 0.8);
    asset("plant", [x + 5.35, z - 4.25], 0, 0.8);
  }
  return obstacles;
}

/** All scene furniture, including the common hall and genuine entrance. */
export function createNavigationObstacles(
  rooms: readonly RoomLayout[],
): NavigationObstacle[] {
  const obstacles = rooms.flatMap(createRoomNavigationObstacles);
  const solids = (items: OfficeSolid[]) =>
    items.forEach((solid) => {
      const bounds = solidNavigationBounds(solid);
      if (bounds) obstacles.push({ name: solid.name, bounds });
    });
  const asset = (
    name: "desk" | "chair" | "plant",
    at: WorldPoint,
    orientation = 0,
    scale = 1,
  ) =>
    obstacles.push({
      name,
      bounds: assetNavigationBounds(name, at, orientation, scale),
    });
  const facilities = createFacilityLayout(rooms.length);
  const centers = {
    meeting: facilities.zones.meeting.center,
    reception: facilities.zones.reception.center,
    breakroom: facilities.zones.pantry.center,
    operations: facilities.zones.print.center,
  };
  solids(createAmenityDecor(centers));
  solids(createEntranceDecor(rooms.length));
  for (const dx of [-0.7, 0.7])
    for (const side of [-1, 1])
      asset(
        "chair",
        [centers.meeting[0] + dx, centers.meeting[1] + side * 0.8],
        side === 1 ? 0 : Math.PI,
      );
  asset(
    "chair",
    [centers.reception[0] + 0.5, centers.reception[1] - 0.8],
    Math.PI,
  );
  asset(
    "plant",
    [facilities.bounds.minX + 0.4, facilities.bounds.maxZ - 0.5],
    0,
    1.1,
  );
  asset(
    "plant",
    [facilities.bounds.maxX - 0.4, facilities.bounds.maxZ - 0.5],
    0,
    1.1,
  );
  return obstacles;
}
