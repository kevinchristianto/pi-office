import assert from "node:assert/strict";
import * as THREE from "three";

const fingers = ["index", "middle", "ring", "little"];
const average = (points) =>
  points
    .reduce((sum, p) => sum.add(p), new THREE.Vector3())
    .divideScalar(points.length);
const vector = (data, key) => {
  assert.ok(
    Array.isArray(data[key]) &&
      data[key].length === 3 &&
      data[key].every(Number.isFinite),
    `finite ${key} landmark`,
  );
  return new THREE.Vector3(...data[key]);
};

export function handNode(scene, label) {
  const hand =
    scene.getObjectByName(`Hand.${label}`) ||
    scene.getObjectByName(`Hand${label}`);
  assert.ok(hand, `Hand.${label} exists`);
  return hand;
}

/** Check actual exported surface vertices against landmarks, not metadata alone. */
export function inspectHandGeometry(hand, label) {
  const data = hand.userData.handAnatomy;
  assert.ok(data, `${label}: anatomy landmarks are present`);
  assert.equal(data.schemaVersion, 2);
  assert.equal(data.coordinateSpace, "gltf_joint_local");
  assert.equal(data.rigLabel, label);
  // Retain legacy joint names: +X is anatomical right for forward -Z/up +Y.
  assert.equal(data.anatomicalSide, label === "L" ? "right" : "left");
  assert.deepEqual(data.fingerOrderRadialToUlnar, fingers);
  const radial = vector(data, "radialDirection");
  const distal = vector(data, "distalDirection");
  const palmar = vector(data, "palmarNormal");
  const dorsal = vector(data, "dorsalNormal");
  assert.deepEqual(radial.toArray(), [label === "L" ? -1 : 1, 0, 0]);
  assert.deepEqual(distal.toArray(), [0, -1, 0]);
  assert.deepEqual(palmar.toArray(), [0, 0, 1]);
  assert.deepEqual(dorsal.toArray(), [0, 0, -1]);
  const palm = vector(data, "palmCenter");
  vector(data, "wrist");
  const thumb = vector(data, "thumbTip");
  const tips = Object.fromEntries(
    fingers.map((name) => [name, vector(data, `${name}Tip`)]),
  );
  hand.updateWorldMatrix(true, true);
  const inverse = hand.matrixWorld.clone().invert();
  const skin = [],
    nails = [];
  hand.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    const target = materials.some((m) => m.name === "Agent_Skin")
      ? skin
      : materials.some((m) => m.name === "Agent_Inner")
        ? nails
        : null;
    if (!target) return;
    const matrix = inverse.clone().multiply(node.matrixWorld);
    const positions = node.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++)
      target.push(
        new THREE.Vector3()
          .fromBufferAttribute(positions, i)
          .applyMatrix4(matrix),
      );
  });
  assert.ok(
    skin.length > 100 && nails.length > 20,
    `${label}: real skin and nail surfaces present`,
  );
  const wing = skin.filter((p) => p.clone().sub(palm).dot(radial) > 0.039);
  const oppositeWing = skin.filter(
    (p) => p.clone().sub(palm).dot(radial) < -0.039,
  );
  assert.ok(
    wing.length > 10,
    `${label}: actual thumb wing is on the radial/index side`,
  );
  assert.equal(
    oppositeWing.length,
    0,
    `${label}: no thumb wing on the little-finger side`,
  );
  for (const [name, point] of Object.entries({ thumb, ...tips })) {
    assert.ok(
      Math.min(...skin.map((p) => p.distanceTo(point))) < 0.013,
      `${label}: ${name} landmark is supported by actual skin vertices`,
    );
  }
  const radialOrder = fingers.map((name) => tips[name].dot(radial));
  for (let i = 1; i < radialOrder.length; i++)
    assert.ok(
      radialOrder[i - 1] > radialOrder[i],
      `${label}: index-middle-ring-little order`,
    );
  assert.ok(
    thumb.distanceTo(tips.index) < thumb.distanceTo(tips.little),
    `${label}: thumb adjoins index, not little finger`,
  );

  const actualLengths = {},
    dorsalWitnesses = [];
  for (const name of fingers) {
    const tip = tips[name];
    const column = skin.filter(
      (p) => Math.abs(p.x - tip.x) < 0.006 && p.dot(distal) > 0.075,
    );
    assert.ok(column.length > 5, `${label}: ${name} finger geometry present`);
    actualLengths[name] = Math.max(...column.map((p) => p.dot(distal)));
    const nail = nails.filter(
      (p) =>
        Math.abs(p.x - tip.x) < 0.007 &&
        Math.abs(p.y - (tip.y + 0.005)) < 0.009,
    );
    assert.ok(nail.length > 5, `${label}: ${name} nail geometry present`);
    const direction = average(nail).sub(tip);
    direction.addScaledVector(distal, -direction.dot(distal)).normalize();
    assert.ok(
      direction.dot(dorsal) > 0.9,
      `${label}: ${name} actual nail is on the dorsal surface`,
    );
    dorsalWitnesses.push(direction);
  }
  assert.ok(
    actualLengths.middle > actualLengths.ring + 0.001,
    `${label}: middle finger longer than ring`,
  );
  assert.ok(
    actualLengths.ring > actualLengths.index + 0.002,
    `${label}: ring finger longer than index`,
  );
  assert.ok(
    actualLengths.index > actualLengths.little + 0.002,
    `${label}: index finger longer than little`,
  );
  const actualDorsal = average(dorsalWitnesses).normalize();
  const actualPalmar = actualDorsal.clone().negate();
  const actualRadial = average(wing).sub(palm);
  actualRadial.addScaledVector(distal, -actualRadial.dot(distal));
  actualRadial
    .addScaledVector(actualPalmar, -actualRadial.dot(actualPalmar))
    .normalize();
  const chirality = actualRadial.dot(distal.clone().cross(actualPalmar));
  assert.ok(
    (label === "L" ? 1 : -1) * chirality > 0.9,
    `${label}: actual thumb/nail geometry has correct opposite-handed chirality`,
  );
  return {
    radial: actualRadial,
    distal,
    palmar: actualPalmar,
    dorsal: actualDorsal,
    chirality,
  };
}
