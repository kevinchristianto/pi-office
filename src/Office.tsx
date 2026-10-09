import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Html,
  OrbitControls,
  PerspectiveCamera,
  useGLTF,
} from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Agent, Session } from "./types";
import {
  createRoomLayout,
  routeLength,
  sampleRoute,
  MAX_VISIBLE_DESKS,
  type DeskLayout,
  type RoomLayout,
} from "./world";
import AgentBubble from "./AgentBubble";
import { bubbleMode, presentation } from "./agentPresentation";
import { useReducedMotion } from "./useReducedMotion";
import { stateColor } from "./state";
import { mergeStaticModel } from "./models";
import { createMotion, requestMotion, stepMotion } from "./motion";
import { fitOfficeCamera } from "./camera";

type Command = {
  id: string;
  type: "wave" | "walk" | "return";
  serial: number;
} | null;
type Registry = React.MutableRefObject<Map<string, THREE.Vector3>>;
const palettes = [
  "#799a8a",
  "#b88c65",
  "#8d8ba7",
  "#758fba",
  "#b68378",
  "#a7a16f",
];
function Solid({
  position,
  size,
  color,
  roughness = 0.7,
}: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  roughness?: number;
}) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  );
}
function Asset({
  name,
  position,
  rotation = 0,
  scale = 1,
}: {
  name: string;
  position: [number, number, number];
  rotation?: number;
  scale?: number;
}) {
  const { scene } = useGLTF(`/models/${name}.glb`);
  const object = useMemo(() => mergeStaticModel(clone(scene)), [scene]);
  return (
    <primitive
      object={object}
      position={position}
      rotation={[0, rotation, 0]}
      scale={scale}
    />
  );
}
export function Character({
  agent,
  desk,
  roomId,
  selected,
  onSelect,
  command,
  positions,
  reservations,
  index,
}: {
  agent: Agent;
  desk: DeskLayout;
  roomId: string;
  selected: boolean;
  onSelect: () => void;
  command: Command;
  positions: Registry;
  reservations: React.MutableRefObject<Map<string, string>>;
  index: number;
}) {
  const { scene, animations } = useGLTF("/models/agent.glb");
  const group = useRef<THREE.Group>(null);
  const rig = useMemo(() => {
    const model = clone(scene);
    model.traverse((n) => {
      if (n instanceof THREE.Mesh) {
        n.castShadow = true;
        n.receiveShadow = true;
        n.material = Array.isArray(n.material)
          ? n.material.map((m) => m.clone())
          : n.material.clone();
      }
    });
    return model;
  }, [scene]);
  useEffect(() => {
    rig.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      for (const material of materials)
        if (
          /shirt|sweater|jacket|cloth/i.test(material.name) &&
          (material as THREE.MeshStandardMaterial).color
        )
          (material as THREE.MeshStandardMaterial).color.set(
            palettes[index % palettes.length],
          );
    });
  }, [rig, index]);
  const mixer = useMemo(() => new THREE.AnimationMixer(rig), [rig]);
  const actions = useMemo(
    () =>
      Object.fromEntries(
        animations.map((clip) => [
          clip.name.toLowerCase(),
          mixer.clipAction(clip),
        ]),
      ),
    [mixer, animations],
  );
  const currentAction = useRef<THREE.AnimationAction | null>(null);
  const joints = useMemo(
    () =>
      Object.fromEntries(
        [
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
        ].map((name) => {
          const obj =
            rig.getObjectByName(name) ||
            rig.getObjectByName(name.replaceAll(".", ""));
          return [
            name,
            obj ? { object: obj, rotation: obj.rotation.clone() } : null,
          ];
        }),
      ),
    [rig],
  );
  const motion = useRef(createMotion());
  const [hovered, setHovered] = useState(false);
  const reduced = useReducedMotion();
  const [bubble, setBubble] = useState<{
    mode: "hidden" | "dot" | "compact" | "detail";
    placement: "above" | "below";
    alignment: "left" | "center" | "right";
  }>({ mode: "compact", placement: "above", alignment: "center" });
  const lastBubble = useRef("");
  const bubbleTick = useRef(0);
  const stateStarted = useRef({
    state: agent.state,
    time: performance.now() / 1000,
  });
  if (stateStarted.current.state !== agent.state)
    stateStarted.current = {
      state: agent.state,
      time: performance.now() / 1000,
    };
  const [visual, setVisual] = useState("");
  const total = useMemo(() => routeLength(desk.route), [desk]);
  const prevVisual = useRef("");
  useEffect(() => {
    if (!command || command.id !== agent.id) return;
    if (reduced) {
      const m = motion.current;
      if (command.type === "walk") {
        m.mode = "lounge";
        m.distance = total;
        m.dwell = Infinity;
        m.pending = false;
      } else if (command.type === "return") {
        m.mode = "seated";
        m.distance = 0;
        m.pending = false;
      } else m.waveUntil = performance.now() / 1000 + 2.6;
      if (reservations.current.get(roomId) === agent.id)
        reservations.current.delete(roomId);
      return;
    }
    requestMotion(motion.current, command.type, performance.now() / 1000);
  }, [command, agent.id, reduced, total, reservations, roomId]);
  useEffect(
    () => () => {
      mixer.stopAllAction();
      positions.current.delete(agent.id);
      if (reservations.current.get(roomId) === agent.id)
        reservations.current.delete(roomId);
    },
    [agent.id, mixer, positions, reservations, roomId],
  );
  const setPose = (name: string) => {
    const next = actions[name];
    // A clip name can survive a replaced mixer or stopped action. Compare the
    // actual action and its scheduling so a fresh rig always starts playback.
    if (currentAction.current === next && next?.isScheduled()) return;
    if (next) {
      for (const action of Object.values(actions)) action.fadeOut(0.2);
      next.reset().fadeIn(0.2).play();
    }
    currentAction.current = next || null;
  };
  useFrame(({ clock, camera }, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const m = motion.current;
    if (!group.current) return;
    const now = performance.now() / 1000;
    stepMotion(m, delta, total, roomId, agent.id, reservations.current);
    const walking = m.mode === "outbound" || m.mode === "returning";
    const point = sampleRoute(desk.route, m.distance);
    group.current.position.set(point[0], 0.04, point[1]);
    if (walking) {
      const ahead = sampleRoute(
        desk.route,
        THREE.MathUtils.clamp(
          m.distance + (m.mode === "returning" ? -0.12 : 0.12),
          0,
          total,
        ),
      );
      const dx = ahead[0] - point[0],
        dz = ahead[1] - point[1];
      if (Math.abs(dx) + Math.abs(dz) > 0.001) m.yaw = Math.atan2(-dx, -dz);
    } else if (m.mode === "seated") m.yaw = 0;
    const angle =
      THREE.MathUtils.euclideanModulo(
        m.yaw - group.current.rotation.y + Math.PI,
        Math.PI * 2,
      ) - Math.PI;
    group.current.rotation.y += angle * Math.min(1, delta * 12);
    const waving = m.waveUntil > now;
    const reportedClip = presentation(agent).clip;
    const transientFinished =
      ["completed", "done", "error"].includes(agent.state) &&
      now - stateStarted.current.time > 5.8;
    const stateClip = transientFinished ? "idleseated" : reportedClip;
    const wanted = reduced
      ? m.mode === "seated"
        ? "idleseated"
        : "idle"
      : walking
        ? "walk"
        : waving
          ? m.mode === "seated"
            ? "waveseated"
            : "wave"
          : m.mode === "seated"
            ? stateClip
            : "idle";
    const pose = actions[wanted]
      ? wanted
      : m.mode === "seated"
        ? "idleseated"
        : "idle";
    setPose(pose);
    if (reduced) {
      const action = actions[pose];
      if (action) {
        action.fadeIn(0);
        action.time = 0;
        action.paused = true;
      }
      mixer.update(0);
    } else {
      for (const action of Object.values(actions)) action.paused = false;
      mixer.update(delta);
    }
    if (clock.elapsedTime - bubbleTick.current > 0.12) {
      bubbleTick.current = clock.elapsedTime;
      const anchor = new THREE.Vector3(point[0], 1.92, point[1]);
      const projection = anchor.clone().project(camera);
      const inView =
        projection.z >= -1 &&
        projection.z <= 1 &&
        Math.abs(projection.x) < 1.05 &&
        Math.abs(projection.y) < 1.05;
      const mode = bubbleMode(
        camera.position.distanceTo(anchor),
        selected || hovered,
        inView,
      );
      const placement = projection.y > 0.45 ? "below" : "above";
      const alignment =
        projection.x > 0.6 ? "right" : projection.x < -0.6 ? "left" : "center";
      const key = [mode, placement, alignment].join(":");
      if (key !== lastBubble.current) {
        lastBubble.current = key;
        setBubble({ mode, placement, alignment });
      }
    }
    if (!actions[pose]) {
      const t = reduced ? 0 : clock.elapsedTime;
      const joint = (name: string, x = 0, z = 0) => {
        const j = joints[name];
        if (j) {
          j.object.rotation.copy(j.rotation);
          j.object.rotateX(x);
          j.object.rotateZ(z);
        }
      };
      const step = walking ? Math.sin(t * 7) * 0.6 : 0;
      rig.position.y =
        m.mode === "seated"
          ? -0.35
          : walking
            ? Math.abs(Math.sin(t * 7)) * 0.025
            : Math.sin(t * 1.3) * 0.008;
      joint("UpperLeg.L", m.mode === "seated" ? 1.45 : step);
      joint("UpperLeg.R", m.mode === "seated" ? 1.45 : -step);
      joint(
        "LowerLeg.L",
        m.mode === "seated" ? -1.45 : Math.max(0, -step) * 0.65,
      );
      joint(
        "LowerLeg.R",
        m.mode === "seated" ? -1.45 : Math.max(0, step) * 0.65,
      );
      joint("UpperArm.L", m.mode === "seated" ? 0.8 : -step * 0.65);
      joint(
        "UpperArm.R",
        waving ? 2.8 : m.mode === "seated" ? 0.8 : step * 0.65,
        waving ? Math.sin(t * 10) * 0.2 : 0,
      );
      joint("LowerArm.L", m.mode === "seated" ? 0.55 : 0);
      joint("LowerArm.R", waving ? 0.4 : m.mode === "seated" ? 0.55 : 0);
      joint("Head", 0, Math.sin(t * 0.8 + index) * 0.025);
    }
    positions.current.set(agent.id, group.current.position.clone());
    const label = m.pending
      ? "Waiting for the aisle"
      : walking
        ? "Taking a stroll"
        : m.mode === "lounge"
          ? "Enjoying the lounge"
          : waving
            ? "Hello!"
            : "";
    if (label !== prevVisual.current) {
      prevVisual.current = label;
      setVisual(label);
    }
  });
  return (
    <group
      ref={group}
      position={
        [...desk.seat.slice(0, 1), 0, desk.seat[1]] as [number, number, number]
      }
    >
      <group
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
      >
        <primitive object={rig} />
        <mesh
          visible={selected || hovered}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.018, 0]}
        >
          <ringGeometry args={[0.36, 0.41, 48]} />
          <meshBasicMaterial
            color={selected ? "#f3e6a6" : "#d2e2aa"}
            transparent
            opacity={0.9}
            depthWrite={false}
          />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 0]}>
          <ringGeometry args={[0.3, 0.32, 40]} />
          <meshBasicMaterial
            color={stateColor(agent.state)}
            transparent
            opacity={0.65}
            depthWrite={false}
          />
        </mesh>
      </group>
      <AgentBubble
        agent={agent}
        selected={selected}
        hovered={hovered}
        mode={bubble.mode}
        placement={bubble.placement}
        alignment={bubble.alignment}
        onSelect={onSelect}
        onHover={setHovered}
        visual={visual}
        reduced={reduced}
      />
    </group>
  );
}
function Room({
  session,
  layout,
  selected,
  onSelect,
  command,
  positions,
  reservations,
}: {
  session: Session;
  layout: RoomLayout;
  selected: string | null;
  onSelect: (id: string) => void;
  command: Command;
  positions: Registry;
  reservations: React.MutableRefObject<Map<string, string>>;
}) {
  const x = layout.center[0];
  const shown = session.agents.slice(0, MAX_VISIBLE_DESKS);
  const chosen = session.agents.find((a) => a.id === selected);
  if (chosen && !shown.includes(chosen)) shown[MAX_VISIBLE_DESKS - 1] = chosen;
  const accents = ["#577b69", "#688082", "#8a7662", "#737d62"];
  const accent = accents[layout.index % accents.length];
  return (
    <group>
      <Solid
        position={[x, -0.18, 0]}
        size={[12.4, 0.36, 10.4]}
        color="#8d8e74"
      />
      <Solid
        position={[x, 0, 0]}
        size={[12.05, 0.055, 10.05]}
        color="#b7a184"
      />
      {Array.from({ length: 30 }, (_, i) => (
        <Solid
          key={i}
          position={[x - 5.82 + i * 0.4, 0.031, 0]}
          size={[0.009, 0.004, 10]}
          color="#988469"
        />
      ))}
      <Solid
        position={[x, 1.55, -5]}
        size={[12.2, 3.1, 0.18]}
        color="#e4dfc8"
      />

      <Solid
        position={[x, 0.12, -4.82]}
        size={[12, 0.16, 0.12]}
        color="#7c7b61"
      />
      {[-3.8, 0, 3.8].map((w) => (
        <group key={w}>
          <Solid
            position={[x + w, 1.8, -4.88]}
            size={[2.75, 1.65, 0.06]}
            color="#9fbdb7"
            roughness={0.2}
          />
          <Solid
            position={[x + w, 0.94, -4.75]}
            size={[2.9, 0.09, 0.35]}
            color="#eee4cd"
          />
          {[-0.88, 0, 0.88].map((s) => (
            <Solid
              key={s}
              position={[x + w + s, 1.8, -4.82]}
              size={[0.055, 1.67, 0.08]}
              color="#ede4cc"
            />
          ))}
          <Solid
            position={[x + w, 1.8, -4.81]}
            size={[2.76, 0.05, 0.08]}
            color="#ede4cc"
          />
          {[-1.25, 1.25].map((s) => (
            <Solid
              key={s}
              position={[x + w + s, 1.8, -4.7]}
              size={[0.19, 1.85, 0.12]}
              color={accent}
            />
          ))}
        </group>
      ))}
      <Solid
        position={[x - 1, 0.045, -0.45]}
        size={[9.9, 0.016, 6.9]}
        color={layout.index % 2 ? "#8f9d8b" : "#a0ac91"}
      />
      <Asset name="plant" position={[x - 5.35, 0.05, -4.25]} scale={1.05} />
      <Asset name="plant" position={[x + 5.35, 0.05, -4.25]} />
      <Asset
        name="bookshelf"
        position={[x - 5.55, 0.05, 0.9]}
        rotation={Math.PI / 2}
      />
      <Asset name="floorlamp" position={[x - 5.25, 0.05, 3.4]} />
      <Asset name="sofa" position={[x - 2.8, 0.05, 4.65]} rotation={Math.PI} />
      <Asset name="plant" position={[x + 4.8, 0.05, 4.65]} scale={0.7} />
      {layout.partitions.map((panel, i) => (
        <group key={`partition-${i}`}>
          <Solid
            position={[
              panel.center[0],
              panel.height / 2 + 0.045,
              panel.center[1],
            ]}
            size={[panel.width, panel.height, panel.depth]}
            color={accent}
            roughness={0.96}
          />
          <Solid
            position={[panel.center[0], panel.height + 0.065, panel.center[1]]}
            size={[panel.width + 0.025, 0.045, panel.depth + 0.025]}
            color="#a99875"
          />
          <Solid
            position={[panel.center[0], 0.105, panel.center[1]]}
            size={[panel.width, 0.1, panel.depth + 0.03]}
            color="#777e68"
          />
        </group>
      ))}
      <Html
        center
        position={[x, 2.75, -4.77]}
        zIndexRange={[7, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div className="room-plaque">
          {session.name}
          <small>
            {session.agents.length}{" "}
            {session.agents.length === 1 ? "agent" : "agents"}
            {session.agents.length > 6 ? " · 6 desks shown" : ""}
          </small>
        </div>
      </Html>
      {shown.map((agent, i) => {
        const desk = layout.desks[i];
        if (!desk) return null;
        return (
          <group key={agent.id}>
            <Asset name="desk" position={[desk.desk[0], 0.04, desk.desk[1]]} />
            <Asset name="chair" position={[desk.seat[0], 0.04, desk.seat[1]]} />
            <Character
              agent={agent}
              desk={desk}
              roomId={session.id}
              selected={selected === agent.id}
              onSelect={() => onSelect(agent.id)}
              command={command}
              positions={positions}
              reservations={reservations}
              index={i + layout.index * 3}
            />
          </group>
        );
      })}
      {!shown.length && (
        <>
          <Asset name="desk" position={[x - 2, 0.04, -1]} />
          <Asset name="chair" position={[x - 2, 0.04, -0.15]} />
          <Asset name="desk" position={[x + 1, 0.04, -1]} />
          <Asset name="chair" position={[x + 1, 0.04, -0.15]} />
        </>
      )}
      <pointLight
        position={[x - 4, 2.1, 3.5]}
        intensity={5}
        distance={6}
        color="#ffd99b"
      />
    </group>
  );
}
function CameraRig({
  count,
  reset,
  follow,
  positions,
  controls,
  onStopFollow,
}: {
  count: number;
  reset: number;
  follow: string | null;
  positions: Registry;
  controls: React.MutableRefObject<any>;
  onStopFollow: () => void;
}) {
  const { camera, size, gl } = useThree();
  const reduced = useReducedMotion();
  const keys = useRef(new Set<string>());
  useEffect(() => {
    const fit = fitOfficeCamera(size.width, size.height, count);
    const target = new THREE.Vector3(...fit.target);
    camera.position.set(...fit.position);

    camera.lookAt(target);
    if (controls.current) {
      controls.current.maxDistance = Math.max(85, fit.distance * 1.3);
      controls.current.target.copy(target);
      controls.current.update();
      controls.current.saveState();
    }
  }, [camera, count, reset, size.width, size.height, controls]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          'input,select,textarea,button,[role="dialog"],[role="listbox"]',
        )
      )
        return;
      if (
        [
          "w",
          "a",
          "s",
          "d",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(e.key)
      ) {
        keys.current.add(e.key.toLowerCase());
        if (follow) onStopFollow();
      }
    };
    const keyup = (e: KeyboardEvent) =>
      keys.current.delete(e.key.toLowerCase());
    const clear = () => keys.current.clear();
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", clear);
    };
  }, [follow, onStopFollow]);
  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    if (follow) {
      const position = positions.current.get(follow);
      if (position) {
        const target = position.clone().add(new THREE.Vector3(0, 0.85, 0));
        const desired = target.clone().add(new THREE.Vector3(4.3, 3.4, 5.6));
        const t = reduced ? 1 : 1 - Math.exp(-delta * 3);
        camera.position.lerp(desired, t);
        c.target.lerp(target, t);
        c.update();
      }
      return;
    }
    if (keys.current.size) {
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      const right = forward.clone().cross(new THREE.Vector3(0, 1, 0));
      const movement = new THREE.Vector3();
      if (keys.current.has("w") || keys.current.has("arrowup"))
        movement.add(forward);
      if (keys.current.has("s") || keys.current.has("arrowdown"))
        movement.sub(forward);
      if (keys.current.has("d") || keys.current.has("arrowright"))
        movement.add(right);
      if (keys.current.has("a") || keys.current.has("arrowleft"))
        movement.sub(right);
      movement.normalize().multiplyScalar(delta * 6);
      camera.position.add(movement);
      c.target.add(movement);
      c.update();
    }
  });
  return null;
}
export default function Office({
  sessions,
  selected,
  onSelect,
  reset,
  follow,
  command,
  onStopFollow,
}: {
  sessions: Session[];
  selected: string | null;
  onSelect: (id: string) => void;
  reset: number;
  follow: string | null;
  command: Command;
  onStopFollow: () => void;
}) {
  const controls = useRef<any>(null);
  const positions = useRef(new Map<string, THREE.Vector3>());
  const reservations = useRef(new Map<string, string>());
  const rooms = sessions.length
    ? sessions
    : [{ id: "empty-office", name: "Your next session", agents: [] }];
  const width = rooms.length * 14;
  return (
    <Canvas
      shadows
      dpr={[1, 1.6]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#a5b5a0"]} />
      <fog attach="fog" args={["#a5b5a0", 48, 115]} />
      <PerspectiveCamera
        makeDefault
        fov={42}
        position={[12, 15, 22]}
        near={0.1}
        far={200}
      />
      <ambientLight intensity={0.7} />
      <hemisphereLight args={["#fff6df", "#587663", 1.6]} />
      <directionalLight
        castShadow
        position={[-8, 20, 10]}
        intensity={2.8}
        color="#fff0cc"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-15}
        shadow-camera-right={width + 6}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-normalBias={0.035}
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[width / 2 - 7, -0.39, 0]}
        receiveShadow
      >
        <planeGeometry args={[150, 150]} />
        <meshStandardMaterial color="#879b79" roughness={1} />
      </mesh>
      <Solid
        position={[(rooms.length - 1) * 7, -0.27, 1]}
        size={[width + 3, 0.15, 16]}
        color="#b9bba0"
      />
      <Suspense
        fallback={
          <Html center>
            <div className="world-loading">Opening the office…</div>
          </Html>
        }
      >
        {rooms.map((s, i) => (
          <Room
            key={s.id}
            session={s}
            layout={createRoomLayout(s.id, i, s.agents.length)}
            selected={selected}
            onSelect={onSelect}
            command={command}
            positions={positions}
            reservations={reservations}
          />
        ))}
        <ContactShadows
          position={[(rooms.length - 1) * 7, -0.385, 0]}
          scale={Math.max(30, width + 10)}
          opacity={0.18}
          far={15}
          blur={2}
        />
      </Suspense>
      <OrbitControls
        ref={controls}
        makeDefault
        minDistance={4}
        maxDistance={85}
        minPolarAngle={0.22}
        maxPolarAngle={Math.PI / 2.13}
        enableDamping
        dampingFactor={0.09}
        zoomSpeed={0.8}
        panSpeed={0.85}
        onStart={() => {
          if (follow) onStopFollow();
        }}
      />
      <CameraRig
        count={rooms.length}
        reset={reset}
        follow={follow}
        positions={positions}
        controls={controls}
        onStopFollow={onStopFollow}
      />
    </Canvas>
  );
}
