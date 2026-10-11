import {
  createBuildingEntranceLayout,
  createOfficeLayout,
  officeLayoutBounds,
} from "./world";
import { OFFICE_PALETTE, type OfficeSolid } from "./officeDecor";

/** Data-only door geometry is used by both WebGL and offline render snapshots. */
export function createEntranceDecor(roomCount: number): OfficeSolid[] {
  const entrance = createBuildingEntranceLayout(roomCount);
  const [x, z] = entrance.threshold;
  const apron = entrance.apronBounds;
  const p = OFFICE_PALETTE;
  const office = officeLayoutBounds(roomCount);
  const rooms = createOfficeLayout(
    Array.from({ length: roomCount }, (_, index) => ({
      id: `floor-${index}`,
      agentCount: 0,
    })),
  );
  const corridorRows = [
    ...new Set(
      rooms
        .filter((room) => room.bounds.maxZ < office.maxZ)
        .map((room) => room.bounds.maxZ + 1),
    ),
  ];
  return [
    {
      name: "East circulation spine floor",
      position: [entrance.eastSpineX, -0.01, (office.minZ + office.maxZ) / 2],
      size: [1.2, 0.06, office.maxZ - office.minZ],
      color: "#c3ccd0",
    },
    ...corridorRows.map((rowZ): OfficeSolid => ({
      name: "Department cross-corridor floor",
      position: [(office.minX + office.maxX + 1.2) / 2, -0.01, rowZ],
      size: [office.maxX - office.minX + 1.2, 0.06, 2],
      color: "#c3ccd0",
    })),
    {
      name: "Exterior entrance forecourt",
      position: [
        (apron.minX + apron.maxX) / 2,
        -0.015,
        (apron.minZ + apron.maxZ) / 2,
      ],
      size: [apron.maxX - apron.minX, 0.06, apron.maxZ - apron.minZ],
      color: "#aebcc3",
    },
    {
      name: "Entrance welcome mat",
      position: [x, 0.024, z + 0.28],
      size: [1.15, 0.016, 0.85],
      color: p.navy,
    },
    ...[-1, 1].map((side): OfficeSolid => ({
      name: "Entrance door jamb",
      position: [x + side * 0.7, 1.3, z],
      size: [0.12, 2.6, 0.16],
      color: p.navy,
    })),
    {
      name: "Entrance door lintel",
      position: [x, 2.56, z],
      size: [1.52, 0.16, 0.16],
      color: p.navy,
    },
    ...[-1, 1].map((side): OfficeSolid => ({
      name: "Entrance glazed side panel",
      position: [x + side * 1.25, 1.25, z],
      size: [1, 2.45, 0.06],
      color: "#adced7",
      glass: true,
    })),
    {
      name: "Entrance sign backing",
      position: [x, 2.87, z],
      size: [3.55, 0.35, 0.14],
      color: p.navy,
    },
    {
      name: "Entrance threshold stripe",
      position: [x, 0.038, z - 0.1],
      size: [1.15, 0.012, 0.07],
      color: "#d9c598",
    },
  ];
}
