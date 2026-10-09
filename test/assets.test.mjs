import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
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
      ["Work", "WaveSeated", "IdleSeated"].includes(name) ? y < 0.65 : y > 0.75,
      `${name} pelvis ${y}`,
    );
    model.scene.traverse((n) =>
      assert.ok(n.matrixWorld.elements.every(Number.isFinite)),
    );
  }
  mixer.stopAllAction();
});
