import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { handNode, inspectHandGeometry } from "./resident-anatomy.mjs";

async function load(index) {
  const bytes = fs.readFileSync(
    new URL(
      `../public/models/agent-${String(index).padStart(2, "0")}.glb`,
      import.meta.url,
    ),
  );
  return new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, "");
}
for (let index = 1; index <= 8; index++) {
  test(`resident ${index} has correctly mirrored radial thumbs, fingers and dorsal nails in actual geometry`, async () => {
    const model = await load(index);
    const left = inspectHandGeometry(handNode(model.scene, "L"), "L");
    const right = inspectHandGeometry(handNode(model.scene, "R"), "R");
    assert.ok(left.chirality * right.chirality < -0.9);
  });
  test(`resident ${index} palms face down while typing and forward when waving, with chirality preserved`, async () => {
    const model = await load(index);
    const hands = Object.fromEntries(
      ["L", "R"].map((label) => {
        const hand = handNode(model.scene, label);
        return [label, { hand, basis: inspectHandGeometry(hand, label) }];
      }),
    );
    const mixer = new THREE.AnimationMixer(model.scene);
    for (const clip of model.animations) {
      mixer.stopAllAction();
      mixer.clipAction(clip).reset().play();
      for (let frame = 0; frame < 24; frame++) {
        const time = (frame * clip.duration) / 24;
        mixer.setTime(time);
        model.scene.updateMatrixWorld(true);
        for (const [label, { hand, basis }] of Object.entries(hands)) {
          const radial = basis.radial
            .clone()
            .transformDirection(hand.matrixWorld);
          const distal = basis.distal
            .clone()
            .transformDirection(hand.matrixWorld);
          const palm = basis.palmar
            .clone()
            .transformDirection(hand.matrixWorld);
          const dorsal = basis.dorsal
            .clone()
            .transformDirection(hand.matrixWorld);
          const signed =
            radial.dot(distal.clone().cross(palm)) * (label === "L" ? 1 : -1);
          assert.ok(
            signed > 0.9,
            `${clip.name} ${label}: world-space chirality survives animation`,
          );
          if (clip.name === "Idle") {
            assert.ok(
              palm.z > 0.95,
              `${label}: neutral resting palm faces backward`,
            );
            assert.ok(
              radial.x * (label === "L" ? -1 : 1) > 0.95,
              `${label}: neutral thumb points toward body`,
            );
          }
          if (clip.name === "Work") {
            assert.ok(
              palm.y < -0.95 && dorsal.y > 0.95,
              `${label}: typing palms down, nails up`,
            );
            assert.ok(
              distal.z < -0.95,
              `${label}: fingers extend toward keyboard`,
            );
          }
          if (
            ["Wave", "WaveSeated"].includes(clip.name) &&
            label === "R" &&
            time >= 0.4 &&
            time <= 1.6
          ) {
            // Only the raised hand's palm is constrained; radial direction can
            // legitimately rotate during a wave, so no global "thumbs inward" rule.
            assert.ok(
              palm.z < -0.85,
              `${clip.name}: raised palm faces forward`,
            );
          }
        }
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(model.scene);
  });
}

test("anatomy check rejects flipped actual hand meshes even when correct landmarks remain", async () => {
  const model = await load(1);
  const hand = handNode(model.scene, "L");
  inspectHandGeometry(hand, "L");
  hand.traverse((node) => {
    if (node.isMesh) {
      node.geometry = node.geometry.clone();
      node.geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
    }
  });
  assert.throws(
    () => inspectHandGeometry(hand, "L"),
    /actual thumb wing|little-finger side/,
  );
});

test("anatomy check rejects inverted nail surfaces without relying on thumb position", async () => {
  const model = await load(1);
  const hand = handNode(model.scene, "L");
  inspectHandGeometry(hand, "L");
  hand.traverse((node) => {
    if (node.isMesh && node.material.name === "Agent_Inner") {
      node.geometry = node.geometry.clone();
      node.geometry.translate(0, 0, 0.03);
    }
  });
  assert.throws(
    () => inspectHandGeometry(hand, "L"),
    /actual nail is on the dorsal surface/,
  );
});

test("all resident wrist skin bridges overlap the sleeve cuff at rest", async () => {
  for (let index = 1; index <= 8; index++) {
    const model = await load(index);
    model.scene.updateMatrixWorld(true);
    for (const label of ["L", "R"]) {
      const hand = handNode(model.scene, label);
      const inverse = hand.matrixWorld.clone().invert();
      const wrist = new THREE.Box3(),
        cuff = new THREE.Box3();
      hand.parent.traverse((node) => {
        if (!node.isMesh) return;
        const name = node.material.name;
        if (!["Agent_Skin", "Agent_ShirtRib"].includes(name)) return;
        const matrix = inverse.clone().multiply(node.matrixWorld);
        const positions = node.geometry.getAttribute("position");
        for (let i = 0; i < positions.count; i++) {
          const point = new THREE.Vector3()
            .fromBufferAttribute(positions, i)
            .applyMatrix4(matrix);
          if (name === "Agent_Skin" && point.y > -0.02)
            wrist.expandByPoint(point);
          if (name === "Agent_ShirtRib") cuff.expandByPoint(point);
        }
      });
      assert.ok(
        !wrist.isEmpty() && !cuff.isEmpty(),
        `${index}/${label}: actual wrist skin and cuff surfaces exist`,
      );
      assert.ok(
        wrist.intersectsBox(cuff),
        `${index}/${label}: wrist and cuff geometry bounds overlap`,
      );
      assert.ok(
        wrist.max.y > cuff.min.y + 0.001,
        `${index}/${label}: wrist skin overlaps cuff by at least 1mm`,
      );
    }
  }
});
