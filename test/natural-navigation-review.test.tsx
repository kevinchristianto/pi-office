import fs from "node:fs";
import React, { act } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { createRoot, extend, _roots } from "@react-three/fiber";
import {
  createOfficeLayout,
  createFacilityLayout,
  WALKER_RADIUS,
  routeLength,
  type WorldPoint,
  type RoomBounds,
} from "../src/world";
import {
  createRoomDecor,
  createAmenityDecor,
  type OfficeSolid,
} from "../src/officeDecor";
import { createEntranceDecor } from "../src/entranceDecor";
import {
  createBuildingEntryRoute,
  createBuildingExitRoute,
  LIFECYCLE_WALK_SPEED,
} from "../src/lifecycleRoutes";
import { residentModel } from "../src/appearance";

const asset = vi.hoisted(() => ({ current: null as GLTF | null }));
vi.mock("@react-three/drei", () => ({
  useGLTF: () => asset.current,
  ContactShadows: () => null,
  Html: () => null,
  OrbitControls: () => null,
  PerspectiveCamera: () => null,
}));
vi.mock("../src/AgentBubble", () => ({ default: () => null }));
import { Character } from "../src/Office";

type Obstacle = { name: string; bounds: RoomBounds; owner?: string };
const meshes = new Map<string, THREE.Box3>();
async function load(name: string) {
  return new GLTFLoader().parseAsync(
    Uint8Array.from(fs.readFileSync(`public/models/${name}.glb`)).buffer,
    "",
  );
}
beforeAll(async () => {
  for (const name of ["desk", "chair", "plant"]) {
    const gltf = await load(name);
    gltf.scene.updateMatrixWorld(true);
    meshes.set(name, new THREE.Box3().setFromObject(gltf.scene, true));
  }
});

// Independent Liang–Barsky clipping, using physical GLB bounds rather than the
// navigation manifest or production collision/shortcut helpers.
function sweptHit(a: WorldPoint, b: WorldPoint, obstacle: RoomBounds) {
  let lo = 0,
    hi = 1;
  for (const [position, change, min, max] of [
    [
      a[0],
      b[0] - a[0],
      obstacle.minX - WALKER_RADIUS,
      obstacle.maxX + WALKER_RADIUS,
    ],
    [
      a[1],
      b[1] - a[1],
      obstacle.minZ - WALKER_RADIUS,
      obstacle.maxZ + WALKER_RADIUS,
    ],
  ]) {
    if (Math.abs(change) < 1e-12) {
      if (position < min || position > max) return false;
    } else {
      const enter = (min - position) / change,
        exit = (max - position) / change;
      lo = Math.max(lo, Math.min(enter, exit));
      hi = Math.min(hi, Math.max(enter, exit));
      if (lo > hi) return false;
    }
  }
  return true;
}
function physicalObstacles(rooms: ReturnType<typeof createOfficeLayout>) {
  const obstacles: Obstacle[] = [];
  const solids = (items: OfficeSolid[]) =>
    items.forEach(({ name, position: [x, y, z], size: [w, h, d] }) => {
      if (y + h / 2 <= 0.09 || y - h / 2 >= 1.8) return;
      obstacles.push({
        name,
        bounds: {
          minX: x - w / 2,
          maxX: x + w / 2,
          minZ: z - d / 2,
          maxZ: z + d / 2,
        },
      });
    });
  const model = (
    name: string,
    at: WorldPoint,
    angle = 0,
    scale = 1,
    owner?: string,
  ) => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(at[0], 0, at[1]),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        angle,
      ),
      new THREE.Vector3(scale, scale, scale),
    );
    const box = meshes.get(name)!.clone().applyMatrix4(matrix);
    obstacles.push({
      name,
      owner,
      bounds: {
        minX: box.min.x,
        maxX: box.max.x,
        minZ: box.min.z,
        maxZ: box.max.z,
      },
    });
  };
  for (const room of rooms) {
    solids(createRoomDecor(room));
    for (const desk of room.desks) {
      model("desk", desk.desk, desk.orientation);
      model(
        "chair",
        desk.seat,
        desk.orientation,
        1,
        `${room.id}/${desk.index}`,
      );
    }
    const [x, z] = room.center;
    if (!room.desks.length) {
      model("desk", [x, z - 1.4], Math.PI);
      model("chair", [x, z - 2.14], Math.PI);
      model("desk", [x, z + 0.4]);
      model("chair", [x, z + 1.14]);
    }
    model("plant", [x - 5.35, z - 4.25], 0, 0.8);
    model("plant", [x + 5.35, z - 4.25], 0, 0.8);
  }
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
      model(
        "chair",
        [centers.meeting[0] + dx, centers.meeting[1] + side * 0.8],
        side === 1 ? 0 : Math.PI,
      );
  model(
    "chair",
    [centers.reception[0] + 0.5, centers.reception[1] - 0.8],
    Math.PI,
  );
  model(
    "plant",
    [facilities.bounds.minX + 0.4, facilities.bounds.maxZ - 0.5],
    0,
    1.1,
  );
  model(
    "plant",
    [facilities.bounds.maxX - 0.4, facilities.bounds.maxZ - 0.5],
    0,
    1.1,
  );
  return obstacles;
}

describe("independent natural navigation geometry", () => {
  it.each([[6], [0, 6, 1], [6, 2, 0, 3, 5, 1], [0, 1, 2, 3, 4, 5, 6, 0, 6, 1]])(
    "checks complete curved/shortcut sweeps in a mixed-roster layout %j",
    (...counts) => {
      const rooms = createOfficeLayout(
        counts.map((agentCount, index) => ({
          id: `review-${index}`,
          agentCount,
        })),
      );
      const obstacles = physicalObstacles(rooms);
      const collisions: string[] = [];
      for (const room of rooms)
        for (const desk of room.desks) {
          const entry = createBuildingEntryRoute(rooms, room, desk);
          expect(createBuildingExitRoute(rooms, room, desk)).toEqual(
            [...entry].reverse(),
          );
          expect(entry.at(-1)).toEqual(desk.seat);
          // No shortcut is allowed to exempt a whole route from its own chair:
          // only the exact final side-exit/seat approach is intentionally seated.
          for (const path of [entry, desk.route])
            for (let index = 1; index < path.length; index++) {
              const from = path[index - 1],
                to = path[index];
              for (const other of rooms) {
                if (other.id !== room.id && sweptHit(from, to, other.bounds))
                  collisions.push(
                    `${room.id}/${desk.index}: enters unrelated ${other.id} segment ${index}`,
                  );
              }
              for (const obstacle of obstacles) {
                if (
                  obstacle.owner === `${room.id}/${desk.index}` &&
                  from[1] === desk.seat[1] &&
                  to[1] === desk.seat[1] &&
                  Math.min(from[0], to[0]) >=
                    Math.min(desk.seat[0], desk.exit[0]) - 1e-9 &&
                  Math.max(from[0], to[0]) <=
                    Math.max(desk.seat[0], desk.exit[0]) + 1e-9
                )
                  continue;
                if (sweptHit(from, to, obstacle.bounds))
                  collisions.push(
                    `${room.id}/${desk.index}: ${obstacle.name} segment ${index}`,
                  );
              }
            }
        }
      expect(collisions).toEqual([]);
    },
  );
});

type Props = React.ComponentProps<typeof Character>;
let root: ReturnType<typeof createRoot> | undefined,
  canvas: HTMLCanvasElement,
  now = 0,
  props: Props;
async function render() {
  await act(async () => {
    root!.render(
      <React.StrictMode>
        <Character {...props} />
      </React.StrictMode>,
    );
  });
}
async function frame(dt = 1 / 60) {
  await act(async () => {
    now += dt;
    _roots.get(canvas)!.store.getState().advance(now, true);
  });
}
const actor = () =>
  _roots
    .get(canvas)!
    .store.getState()
    .scene.getObjectByName("resident-natural-review")!;
const angleDistance = (a: number, b: number) =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

beforeEach(async (context) => {
  if (!context.task.name.startsWith("runtime:")) return;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now * 1000);
  const file = residentModel("natural-review")
    .split("/")
    .at(-1)!
    .replace(".glb", "");
  asset.current = await load(file);
  extend(THREE);
  canvas = document.createElement("canvas");
  const renderer = {
    render() {},
    setSize() {},
    setPixelRatio() {},
    domElement: canvas,
    shadowMap: {},
    xr: { addEventListener() {}, removeEventListener() {} },
  };
  root = createRoot(canvas);
  await root.configure({
    gl: renderer as unknown as THREE.WebGLRenderer,
    frameloop: "never",
    size: { width: 800, height: 600, top: 0, left: 0 },
  });
  const rooms = createOfficeLayout([{ id: "review", agentCount: 6 }]),
    desk = rooms[0].desks[5];
  props = {
    agent: { id: "natural-review", name: "Review", state: "working" },
    desk,
    roomId: "review",
    selected: false,
    onSelect() {},
    command: null,
    positions: { current: new Map() },
    reservations: { current: new Map() },
    index: 5,
    transition: { direction: "arriving", token: "arrival", queueIndex: 0 },
    lifecycleRoute: createBuildingEntryRoute(rooms, rooms[0], desk),
    onLifecycleComplete: vi.fn(),
  };
  await render();
});
afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = undefined;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("independent natural navigation runtime", () => {
  it("runtime: traverses full arrival at faster physical pace with bounded heading through seated cleanup", async () => {
    const route = props.lifecycleRoute!;
    let previous: THREE.Vector3 | undefined, yaw: number | undefined;
    let walkingDistance = 0,
      movingSeconds = 0,
      turnMaximum = 0;
    for (
      let index = 0;
      index < Math.ceil((routeLength(route) / 1.8 + 2) * 60);
      index++
    ) {
      await frame();
      const object = actor(),
        phase = object.userData.lifecycle?.phase;
      if (previous && phase === "walking") {
        const displacement = object.position.distanceTo(previous);
        expect(displacement).toBeLessThanOrEqual(1.8 / 60 + 1e-6);
        walkingDistance += displacement;
        movingSeconds += 1 / 60;
      }
      if (yaw !== undefined) {
        const change = angleDistance(object.rotation.y, yaw);
        turnMaximum = Math.max(turnMaximum, change);
        expect(change).toBeLessThanOrEqual((Math.PI * 2) / 60 + 1e-6);
      }
      previous = object.position.clone();
      yaw = object.rotation.y;
      if (phase === "settled") {
        props = { ...props, transition: undefined, lifecycleRoute: undefined };
        await render();
        await frame();
        expect(angleDistance(actor().rotation.y, yaw)).toBeLessThanOrEqual(
          (Math.PI * 2) / 60 + 1e-6,
        );
        break;
      }
    }
    expect(LIFECYCLE_WALK_SPEED).toBe(1.8);
    expect(walkingDistance / movingSeconds).toBeGreaterThan(1.74);
    expect(turnMaximum).toBeGreaterThan(0.001);
    expect(props.onLifecycleComplete).toHaveBeenCalledExactlyOnceWith(
      "arrival",
      "arriving",
    );
    expect(props.reservations.current.size).toBe(0);
  });

  it("runtime: reversing an active arrival preserves position and gradually turns to exit", async () => {
    for (let index = 0; index < 70; index++) await frame();
    const position = actor().position.clone(),
      yaw = actor().rotation.y;
    props = {
      ...props,
      transition: { direction: "exiting", token: "interrupted", queueIndex: 0 },
    };
    await render();
    await frame();
    expect(actor().position.distanceTo(position)).toBeLessThanOrEqual(
      1.8 / 60 + 1e-6,
    );
    expect(angleDistance(actor().rotation.y, yaw)).toBeLessThanOrEqual(
      (Math.PI * 2) / 60 + 1e-6,
    );
    for (let index = 0; index < 110; index++) await frame();
    expect(props.onLifecycleComplete).toHaveBeenCalledExactlyOnceWith(
      "interrupted",
      "exiting",
    );
    expect(props.reservations.current.size).toBe(0);
    expect(actor().visible).toBe(false);
  });

  it("runtime: faster translation plays the authored Walk at the matching 1.5x cadence", async () => {
    props = {
      ...props,
      lifecycleRoute: [
        [0, 0],
        [0, -10],
      ],
      desk: { ...props.desk, orientation: 0 },
    };
    await render();
    for (let index = 0; index < 42; index++) await frame();
    expect(actor().position.z).toBeCloseTo(-1.8 * 0.7, 6);
    const authored = asset.current!.scene.clone(true);
    const mixer = new THREE.AnimationMixer(authored);
    const clip = asset.current!.animations.find(
      ({ name }) => name.toLowerCase() === "walk",
    )!;
    mixer.clipAction(clip).play();
    mixer.setTime(0.7 * 1.5);
    const actualLeg =
      actor().getObjectByName("UpperLeg.L") ??
      actor().getObjectByName("UpperLegL");
    const expectedLeg =
      authored.getObjectByName("UpperLeg.L") ??
      authored.getObjectByName("UpperLegL");
    expect(actualLeg).toBeDefined();
    expect(expectedLeg).toBeDefined();
    expect(actualLeg!.quaternion.angleTo(expectedLeg!.quaternion)).toBeLessThan(
      1e-5,
    );
    mixer.stopAllAction();
  });
});

describe("independent articulated-body corner review", () => {
  it.each(["arriving", "exiting"] as const)(
    "runtime: keeps authored walking vertices outside low panels and glass while %s at every workstation",
    async (direction) => {
      const rooms = createOfficeLayout([{ id: "review", agentCount: 6 }]);
      const obstacles = [
        ...createRoomDecor(rooms[0]),
        ...createEntranceDecor(1),
      ]
        .filter(
          ({ position, size }) =>
            position[1] + size[1] / 2 > 0.09 && position[1] - size[1] / 2 < 1.8,
        )
        .map((solid) => ({
          name: solid.name,
          box: new THREE.Box3(
            new THREE.Vector3(...solid.position).addScaledVector(
              new THREE.Vector3(...solid.size),
              -0.5,
            ),
            new THREE.Vector3(...solid.position).addScaledVector(
              new THREE.Vector3(...solid.size),
              0.5,
            ),
          ),
        }));
      const collisions: string[] = [];
      const vertex = new THREE.Vector3(),
        meshBox = new THREE.Box3();
      for (const desk of rooms[0].desks) {
        const route = createBuildingEntryRoute(rooms, rooms[0], desk);
        props = {
          ...props,
          desk,
          lifecycleRoute: route,
          transition: {
            direction,
            token: `desk-${desk.index}`,
            queueIndex: 0,
          },
        };
        // New task scope, as if this resident were freshly mounted at the door.
        await act(async () =>
          root!.render(<Character key={desk.index} {...props} />),
        );
        for (
          let i = 0;
          i < Math.ceil((routeLength(route) / 1.8 + 1) * 60);
          i++
        ) {
          await frame();
          const object = actor();
          if (object.userData.lifecycle?.phase !== "walking" || i % 3 !== 0)
            continue;
          object.updateWorldMatrix(true, true);
          const nearby = obstacles.filter(
            ({ box }) =>
              box.distanceToPoint(object.position.clone().setY(0.8)) < 0.9,
          );
          if (!nearby.length) continue;
          object.traverse((node) => {
            if (!(node instanceof THREE.Mesh) || !node.name) return;
            node.geometry.computeBoundingBox();
            meshBox
              .copy(node.geometry.boundingBox!)
              .applyMatrix4(node.matrixWorld);
            const candidates = nearby.filter(({ box }) =>
              box.intersectsBox(meshBox),
            );
            if (!candidates.length) return;
            const positions = node.geometry.getAttribute("position");
            for (let v = 0; v < positions.count; v++) {
              vertex
                .fromBufferAttribute(positions, v)
                .applyMatrix4(node.matrixWorld);
              const hit = candidates.find(
                ({ box }) =>
                  vertex.x > box.min.x + 0.003 &&
                  vertex.x < box.max.x - 0.003 &&
                  vertex.y > box.min.y + 0.003 &&
                  vertex.y < box.max.y - 0.003 &&
                  vertex.z > box.min.z + 0.003 &&
                  vertex.z < box.max.z - 0.003,
              );
              if (hit) {
                collisions.push(
                  `desk${desk.index} frame${i}: ${hit.name} ${node.name}`,
                );
                return;
              }
            }
          });
        }
      }
      expect(collisions).toEqual([]);
    },
  );
});
