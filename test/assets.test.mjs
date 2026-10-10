import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
import { createHash } from "node:crypto";
import { RESIDENT_SEATED_Y, RESIDENT_STANDING_Y } from "../src/appearance.ts";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/models",
);
async function load(name) {
  const bytes = fs.readFileSync(path.join(root, name + ".glb"));
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
  const json = JSON.parse(
    bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)),
  );
  assert.ok(
    (json.buffers || []).every((b) => !b.uri),
    "Embedded model buffers only",
  );
  assert.ok(
    (json.images || []).every((i) => !i.uri),
    "Embedded image data only",
  );
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
}
for (const name of [
  "desk",
  "chair",
  "agent",
  "plant",
  "bookshelf",
  "sofa",
  "floorlamp",
  "coffeetable",
])
  test(`authored ${name} GLB loads with finite geometry and no remote dependencies`, async () => {
    const model = await load(name);
    const box = new THREE.Box3().setFromObject(model.scene);
    const size = box.getSize(new THREE.Vector3());
    assert.ok(
      [size.x, size.y, size.z].every(
        (n) => Number.isFinite(n) && n > 0 && n < 5,
      ),
    );
    let count = 0;
    model.scene.traverse((n) => {
      if (n.isMesh) count++;
    });
    assert.ok(count > 0);
  });
test("articulated character clips load, seat, stand, walk and wave with finite transforms", async () => {
  const model = await load("agent");
  const mixer = new THREE.AnimationMixer(model.scene);
  for (const name of [
    "Idle",
    "Walk",
    "Work",
    "Wave",
    "WaveSeated",
    "IdleSeated",
    "ThinkSeated",
    "WaitSeated",
    "ErrorSeated",
    "DoneSeated",
    "OfflineSeated",
  ]) {
    const clip = model.animations.find((c) => c.name === name);
    assert.ok(clip, name);
    assert.ok(clip.tracks.length >= 14);
    mixer.stopAllAction();
    mixer.clipAction(clip).reset().play();
    mixer.update(0.5);
    model.scene.updateMatrixWorld(true);
    const body = model.scene.getObjectByName("Body");
    assert.ok(body);
    const y = body.getWorldPosition(new THREE.Vector3()).y;
    assert.ok(Number.isFinite(y));
    assert.ok(
      [
        "Work",
        "WaveSeated",
        "IdleSeated",
        "ThinkSeated",
        "WaitSeated",
        "ErrorSeated",
        "DoneSeated",
        "OfflineSeated",
      ].includes(name)
        ? y < 0.65
        : y > 0.75,
      `${name} pelvis ${y}`,
    );
    model.scene.traverse((n) =>
      assert.ok(n.matrixWorld.elements.every(Number.isFinite)),
    );
  }
  mixer.stopAllAction();
});

const residentClips = [
  "Idle",
  "Walk",
  "Work",
  "Wave",
  "WaveSeated",
  "IdleSeated",
  "ThinkSeated",
  "WaitSeated",
  "ErrorSeated",
  "DoneSeated",
  "OfflineSeated",
];
const residentJoints = [
  "Body",
  "Head",
  "UpperArm.L",
  "UpperArm.R",
  "LowerArm.L",
  "LowerArm.R",
  "UpperLeg.L",
  "UpperLeg.R",
  "LowerLeg.L",
  "LowerLeg.R",
];
function snapshotPose(scene) {
  const pose = [];
  scene.traverse((node) =>
    pose.push(...node.position, ...node.quaternion, ...node.scale),
  );
  return pose;
}
for (let index = 1; index <= 8; index++) {
  const name = `agent-${String(index).padStart(2, "0")}`;
  test(`${name} evaluates all eleven real animation clips with intact joints and finite geometry`, async () => {
    const model = await load(name);
    const box = new THREE.Box3().setFromObject(model.scene);
    const size = box.getSize(new THREE.Vector3());
    assert.ok(
      size.y > 1.3 && size.y < 2.3,
      `${name} standing height ${size.y}`,
    );
    assert.ok(
      [size.x, size.y, size.z].every((n) => Number.isFinite(n) && n > 0),
    );
    for (const joint of residentJoints) {
      assert.ok(
        model.scene.getObjectByName(joint) ||
          model.scene.getObjectByName(joint.replaceAll(".", "")),
        `${name}: ${joint}`,
      );
    }
    assert.deepEqual(
      model.animations.map((clip) => clip.name).sort(),
      [...residentClips].sort(),
    );
    const mixer = new THREE.AnimationMixer(model.scene);
    for (const clip of model.animations) {
      assert.ok(clip.duration > 0, `${name}: ${clip.name} duration`);
      assert.ok(clip.tracks.length >= 14, `${name}: ${clip.name} tracks`);
      assert.ok(
        clip.tracks.every((track) =>
          Array.from(track.values).every(Number.isFinite),
        ),
        `${name}: ${clip.name} finite keys`,
      );
      mixer.stopAllAction();
      mixer.clipAction(clip).reset().play();
      mixer.update(0.21);
      const before = snapshotPose(model.scene);
      mixer.update(0.37);
      const after = snapshotPose(model.scene);
      assert.ok(
        after.every(Number.isFinite),
        `${name}: ${clip.name} finite pose`,
      );
      const moved = after.some(
        (value, i) => Math.abs(value - before[i]) > 1e-6,
      );
      assert.equal(
        moved,
        clip.name !== "OfflineSeated",
        `${name}: ${clip.name} expected playback`,
      );
      const pelvis = model.scene.getObjectByName("Body");
      const seated = !["Idle", "Walk", "Wave"].includes(clip.name);
      assert.ok(
        seated ? pelvis.position.y < 0.65 : pelvis.position.y > 0.75,
        `${name}: ${clip.name} pelvis ${pelvis.position.y}`,
      );
      model.scene.updateMatrixWorld(true);
      model.scene.traverse((node) =>
        assert.ok(
          node.matrixWorld.elements.every(Number.isFinite),
          `${name}: ${clip.name} ${node.name}`,
        ),
      );
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(model.scene);
  });
}

test("the eight resident variants contain distinct authored geometry, not palette-only copies", async () => {
  const signatures = [];
  for (let index = 1; index <= 8; index++) {
    const model = await load(`agent-${String(index).padStart(2, "0")}`);
    const hash = createHash("sha256");
    let vertices = 0;
    model.scene.traverse((node) => {
      if (!node.isMesh) return;
      const positions = node.geometry.getAttribute("position");
      vertices += positions.count;
      hash.update(
        Buffer.from(
          positions.array.buffer,
          positions.array.byteOffset,
          positions.array.byteLength,
        ),
      );
      hash.update(
        JSON.stringify([...node.position, ...node.quaternion, ...node.scale]),
      );
    });
    assert.ok(
      vertices > 0 && vertices < 200000,
      `bounded resident vertex budget: ${vertices}`,
    );
    signatures.push(hash.digest("hex"));
  }
  assert.equal(new Set(signatures).size, 8);
});

test("resident soles stay within desk-rug tolerance and working hands overlap keyboard bounds", async () => {
  // Use actual exported runtime resident heights and the 0.74m chair offset.
  // The carpet top is y=0.053m; allow up to 3mm seated sole penetration
  // into its thin pile (6mm for standing/walk cycle). These are AABB tolerance
  // checks, not exact physical contact or per-triangle collision tests.
  const desk = await load("desk");
  desk.scene.position.y = 0.04;
  desk.scene.updateMatrixWorld(true);
  const keyboard = new THREE.Box3().setFromObject(
    desk.scene.getObjectByName("DeskRootKeyAccent"),
  );
  const tabletop = new THREE.Box3().setFromObject(
    desk.scene.getObjectByName("DeskRootOak"),
  );
  for (let index = 1; index <= 8; index++) {
    const name = `agent-${String(index).padStart(2, "0")}`;
    const model = await load(name);
    model.scene.position.set(0, RESIDENT_STANDING_Y, 0.74);
    const mixer = new THREE.AnimationMixer(model.scene);
    for (const clip of model.animations) {
      const seated = !["Idle", "Walk", "Wave"].includes(clip.name);
      model.scene.position.y = seated ? RESIDENT_SEATED_Y : RESIDENT_STANDING_Y;
      mixer.stopAllAction();
      mixer.clipAction(clip).reset().play();
      for (let frame = 0; frame <= 24; frame++) {
        mixer.setTime((clip.duration * frame) / 24);
        model.scene.updateMatrixWorld(true);
        for (const side of ["L", "R"]) {
          const foot =
            model.scene.getObjectByName(`Foot.${side}`) ||
            model.scene.getObjectByName(`Foot${side}`);
          const sole = new THREE.Box3().setFromObject(foot);
          assert.ok(
            sole.min.y >= 0.053 - (seated ? 0.003 : 0.006),
            `${name}: ${clip.name} ${side} sole exceeds carpet penetration tolerance`,
          );
          if (clip.name !== "Walk")
            assert.ok(
              sole.min.y < 0.09,
              `${name}: ${clip.name} ${side} resting foot floats too high`,
            );
          if (clip.name === "Work") {
            const hand =
              model.scene.getObjectByName(`Hand.${side}`) ||
              model.scene.getObjectByName(`Hand${side}`);
            const bounds = new THREE.Box3().setFromObject(hand);
            assert.ok(
              bounds.min.y >= tabletop.max.y,
              `${name}: ${side} hand below tabletop`,
            );
            assert.ok(
              bounds.intersectsBox(keyboard),
              `${name}: ${side} working hand misses keyboard bounds`,
            );
          }
        }
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(model.scene);
  }
});
