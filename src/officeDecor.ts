import type { RoomLayout } from "./world";
export interface OfficeSolid {
  name: string;
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  glass?: boolean;
  emissive?: boolean;
}
export const OFFICE_PALETTE = {
  carpet: "#87959e",
  concrete: "#bcc5c9",
  navy: "#263b4b",
  steel: "#70838d",
  white: "#e4e9e9",
  oak: "#b9a082",
  teal: "#427c83",
};
/** Data-only authored geometry shared by runtime and reproducible Blender reviews. */
export function createRoomDecor(layout: RoomLayout): OfficeSolid[] {
  const [x, z] = layout.center;
  const solids: OfficeSolid[] = [];
  const box = (
    name: string,
    dx: number,
    y: number,
    dz: number,
    size: OfficeSolid["size"],
    color: string,
    options: Partial<OfficeSolid> = {},
  ) =>
    solids.push({
      name,
      position: [x + dx, y, z + dz],
      size,
      color,
      ...options,
    });
  box(
    "Department raised floor",
    0,
    -0.18,
    0,
    [12.4, 0.36, 10.4],
    OFFICE_PALETTE.concrete,
  );
  box(
    "Commercial carpet",
    0,
    0,
    0,
    [12.05, 0.055, 10.05],
    OFFICE_PALETTE.carpet,
  );
  for (let i = -5; i <= 5; i++)
    box("Carpet tile joint", i, 0.03, 0, [0.008, 0.004, 10], "#7b8993");
  for (let i = -4; i <= 4; i++)
    box("Carpet tile joint", 0, 0.03, i, [12, 0.004, 0.008], "#7b8993");
  box(
    "Glazed partition plinth",
    0,
    0.28,
    -5,
    [12.2, 0.56, 0.15],
    OFFICE_PALETTE.white,
  );
  box("Glazed office partition", 0, 1.8, -5, [12.2, 2.5, 0.055], "#adced7", {
    glass: true,
  });
  for (const dx of [-6, -3, 0, 3, 6])
    box(
      "Aluminium mullion",
      dx,
      1.55,
      -5,
      [0.055, 3.1, 0.09],
      OFFICE_PALETTE.steel,
    );
  box(
    "Partition top rail",
    0,
    3.08,
    -5,
    [12.2, 0.065, 0.11],
    OFFICE_PALETTE.steel,
  );
  box(
    "Department sign backing",
    0,
    2.62,
    -4.92,
    [4.4, 0.46, 0.06],
    OFFICE_PALETTE.navy,
  );
  box(
    "Workstation carpet inset",
    0,
    0.045,
    -0.45,
    [10.2, 0.016, 6.9],
    "#6e838b",
  );
  for (const dx of [-3.4, 0, 3.4]) {
    box("Pendant rail", dx, 3.02, -0.5, [2.65, 0.06, 0.2], OFFICE_PALETTE.navy);
    box("Linear work light", dx, 2.982, -0.5, [2.45, 0.018, 0.14], "#e6f5fa", {
      emissive: true,
    });
  }
  box(
    "Department wayfinding strip",
    0,
    0.034,
    4.1,
    [9.8, 0.008, 0.08],
    "#d9c598",
  );
  const accents = ["#526f82", "#547b7f", "#636f89", "#5f7b74"];
  for (const panel of layout.partitions) {
    solids.push({
      name: "Acoustic workstation panel",
      position: [panel.center[0], panel.height / 2 + 0.045, panel.center[1]],
      size: [panel.width, panel.height, panel.depth],
      color: accents[layout.index % accents.length],
    });
    solids.push({
      name: "Panel metal cap",
      position: [panel.center[0], panel.height + 0.065, panel.center[1]],
      size: [panel.width + 0.025, 0.045, panel.depth + 0.025],
      color: OFFICE_PALETTE.steel,
    });
    solids.push({
      name: "Panel kickplate",
      position: [panel.center[0], 0.105, panel.center[1]],
      size: [panel.width, 0.1, panel.depth + 0.03],
      color: OFFICE_PALETTE.navy,
    });
  }
  return solids;
}
export function createAmenityDecor(
  centers: Record<string, [number, number]>,
): OfficeSolid[] {
  const solids: OfficeSolid[] = [];
  const p = OFFICE_PALETTE;
  const box = (
    name: string,
    key: string,
    dx: number,
    y: number,
    dz: number,
    size: OfficeSolid["size"],
    color: string,
    options: Partial<OfficeSolid> = {},
  ) => {
    const at = centers[key];
    solids.push({
      name,
      position: [at[0] + dx, y, at[1] + dz],
      size,
      color,
      ...options,
    });
  };
  box("Reception counter", "reception", 0, 0.55, 0, [2.8, 1.1, 0.75], p.white);
  box(
    "Reception oak worktop",
    "reception",
    0,
    1.13,
    0,
    [2.95, 0.09, 0.88],
    p.oak,
  );
  box(
    "Reception brand face",
    "reception",
    0,
    0.65,
    0.387,
    [1.35, 0.52, 0.025],
    p.navy,
  );
  box(
    "Reception return",
    "reception",
    -1.15,
    0.55,
    -0.6,
    [0.5, 1.1, 1],
    p.white,
  );
  box(
    "Reception monitor stand",
    "reception",
    0.72,
    1.25,
    -0.14,
    [0.08, 0.24, 0.08],
    p.steel,
  );
  box(
    "Reception monitor",
    "reception",
    0.72,
    1.47,
    -0.14,
    [0.6, 0.38, 0.05],
    p.navy,
  );
  box(
    "Reception display",
    "reception",
    0.72,
    1.47,
    -0.108,
    [0.54, 0.3, 0.013],
    "#85b8c3",
    { emissive: true },
  );
  box("Meeting table", "meeting", 0, 0.78, 0, [2.5, 0.1, 1.2], p.oak);
  for (const dx of [-0.85, 0.85])
    box(
      "Meeting table pedestal",
      "meeting",
      dx,
      0.4,
      0,
      [0.14, 0.74, 0.7],
      p.navy,
    );
  box(
    "Meeting cable channel",
    "meeting",
    0,
    0.835,
    0,
    [1.7, 0.025, 0.15],
    p.navy,
  );
  box(
    "Conference speaker",
    "meeting",
    0,
    0.865,
    0.1,
    [0.3, 0.07, 0.23],
    p.steel,
  );
  box(
    "Meeting whiteboard backing",
    "meeting",
    0,
    1.57,
    -1.35,
    [3, 1.32, 0.1],
    p.steel,
  );
  box(
    "Meeting whiteboard",
    "meeting",
    0,
    1.57,
    -1.285,
    [2.85, 1.17, 0.02],
    p.white,
  );
  for (let i = 0; i < 3; i++)
    box(
      "Whiteboard project line",
      "meeting",
      -0.35,
      1.9 - i * 0.22,
      -1.267,
      [1.55 - i * 0.27, 0.032, 0.012],
      p.teal,
    );
  box("Pantry cabinetry", "breakroom", 0, 0.48, 0, [2.8, 0.96, 0.7], p.white);
  box("Pantry countertop", "breakroom", 0, 0.99, 0, [2.92, 0.07, 0.78], p.oak);
  for (const dx of [-0.93, 0, 0.93]) {
    box(
      "Cabinet reveal",
      "breakroom",
      dx,
      0.5,
      0.356,
      [0.018, 0.83, 0.01],
      p.steel,
    );
    box(
      "Cabinet handle",
      "breakroom",
      dx + 0.25,
      0.78,
      0.383,
      [0.3, 0.027, 0.035],
      p.navy,
    );
  }
  box(
    "Coffee machine",
    "breakroom",
    -0.75,
    1.28,
    -0.08,
    [0.46, 0.54, 0.46],
    p.navy,
  );
  box(
    "Coffee front",
    "breakroom",
    -0.75,
    1.24,
    0.157,
    [0.34, 0.26, 0.016],
    p.steel,
  );
  box(
    "Coffee display",
    "breakroom",
    -0.75,
    1.46,
    0.166,
    [0.17, 0.05, 0.012],
    "#84d0c2",
    { emissive: true },
  );
  for (const dx of [-0.3, -0.05])
    box("Cup", "breakroom", dx, 1.09, 0.08, [0.11, 0.16, 0.11], p.white);
  box(
    "Office printer",
    "breakroom",
    0.82,
    1.22,
    -0.015,
    [0.69, 0.44, 0.55],
    p.white,
  );
  box(
    "Printer scanner",
    "breakroom",
    0.82,
    1.46,
    -0.015,
    [0.71, 0.06, 0.56],
    p.navy,
  );
  box(
    "Printer paper tray",
    "breakroom",
    0.82,
    1.1,
    0.32,
    [0.5, 0.045, 0.2],
    p.steel,
  );
  box(
    "Printer paper",
    "breakroom",
    0.82,
    1.132,
    0.34,
    [0.4, 0.018, 0.19],
    "#f7f8f6",
  );
  box(
    "Operations stand",
    "operations",
    0,
    0.52,
    0,
    [0.13, 1.04, 0.13],
    p.steel,
  );
  box(
    "Operations stand foot",
    "operations",
    0,
    0.06,
    0,
    [1.25, 0.12, 0.5],
    p.navy,
  );
  box(
    "Operations display frame",
    "operations",
    0,
    1.72,
    0,
    [2.55, 1.45, 0.13],
    p.navy,
  );
  box(
    "Operations display",
    "operations",
    0,
    1.72,
    0.08,
    [2.37, 1.28, 0.025],
    "#193343",
  );
  for (let i = 0; i < 3; i++) {
    box(
      "Operations status tile",
      "operations",
      -0.76 + i * 0.76,
      1.86,
      0.099,
      [0.52, 0.34, 0.02],
      ["#4c9993", "#6385b4", "#c1ad77"][i],
    );
    box(
      "Operations status line",
      "operations",
      -0.76 + i * 0.76,
      1.47,
      0.099,
      [0.52, 0.045, 0.02],
      "#a7c8cf",
    );
  }
  return solids;
}
