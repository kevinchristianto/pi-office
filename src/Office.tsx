import { Canvas, useFrame } from "@react-three/fiber";
import {
  ContactShadows,
  Html,
  PerspectiveCamera,
  useGLTF,
} from "@react-three/drei";
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Agent, AgentLifecycleEvent, Session } from "./types";
import { projectRosterSummary, residentIdentity } from "./projectProjection";
import {
  createOfficeLayout,
  buildingLayoutBounds,
  createFacilityLayout,
  routeLength,
  type DeskLayout,
  type RoomLayout,
  type Route,
} from "./world";
import AgentBubble from "./AgentBubble";
import BuildingEntrance from "./BuildingEntrance";
import {
  useResidentLifecycle,
  type ResidentEntry,
  type ResidentTransition,
} from "./useResidentLifecycle";
import {
  createBuildingEntryRoute,
  LIFECYCLE_WALK_SPEED,
  sampleLifecycleRoutePose,
} from "./lifecycleRoutes";
import {
  consumeVisualCommand,
  createLifecycleWalk,
  reverseLifecycleWalk,
  releaseLifecycleWalk,
  stepLifecycleWalk,
  type LifecycleWalk,
  type LifecycleDirection,
} from "./lifecycleWalking";
import { bubbleMode, presentation } from "./agentPresentation";
import { createAnimationBlend } from "./animationBlend";
import { useReducedMotion } from "./useReducedMotion";
import {
  createRoomDecor,
  createAmenityDecor,
  type OfficeSolid,
} from "./officeDecor";
import type { WorkplaceFacility } from "./WorkplacePanel";
import { stateColor } from "./state";
import { mergeStaticModel, buildSolidModel } from "./models";
import {
  animationPlaybackRate,
  createMotion,
  motionFrameDelta,
  requestMotion,
  stepHeading,
  stepMotion,
} from "./motion";
import type { CameraAction } from "./camera";
import CameraRig from "./CameraRig";
import {
  residentModel,
  RESIDENT_SEATED_Y,
  RESIDENT_STANDING_Y,
} from "./appearance";

type Command = {
  id: string;
  type: "wave" | "walk" | "return";
  serial: number;
} | null;
type Registry = React.MutableRefObject<Map<string, THREE.Vector3>>;
// Pointer ownership can transfer directly between residents. An older actor's
// hide/unmount must not clear the cursor currently owned by another actor.
let residentCursor: { owner: object; previous: string } | null = null;
function claimResidentCursor(owner: object) {
  residentCursor = {
    owner,
    previous: residentCursor?.previous ?? document.body.style.cursor,
  };
  document.body.style.cursor = "pointer";
}
function releaseResidentCursor(owner: object) {
  if (residentCursor?.owner !== owner) return;
  if (document.body.style.cursor === "pointer")
    document.body.style.cursor = residentCursor.previous;
  residentCursor = null;
}
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
function Decor({ solids }: { solids: OfficeSolid[] }) {
  const signature = JSON.stringify(solids);
  const object = useMemo(() => buildSolidModel(solids), [signature]);
  useEffect(
    () => () => {
      const materials = new Set<THREE.Material>();
      object.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material])
            materials.add(material);
        }
      });
      materials.forEach((material) => material.dispose());
    },
    [object],
  );
  return <primitive object={object} />;
}
function SharedWorkplace({
  count,
  onFacility,
}: {
  count: number;
  onFacility: (facility: WorkplaceFacility) => void;
}) {
  const facilities = createFacilityLayout(count);
  const centers = {
    meeting: facilities.zones.meeting.center,
    reception: facilities.zones.reception.center,
    breakroom: facilities.zones.pantry.center,
    operations: facilities.zones.print.center,
  };
  const solids = createAmenityDecor(centers);
  const labels: Record<WorkplaceFacility, string> = {
    reception: "Reception",
    meeting: "Project room",
    operations: "Operations",
    breakroom: "Break & print",
  };
  return (
    <group>
      <Solid
        position={[
          (facilities.bounds.minX + facilities.bounds.maxX) / 2,
          -0.01,
          (facilities.bounds.minZ + facilities.bounds.maxZ) / 2,
        ]}
        size={[
          facilities.bounds.maxX - facilities.bounds.minX,
          0.06,
          facilities.bounds.maxZ - facilities.bounds.minZ,
        ]}
        color="#c3ccd0"
      />
      <Solid
        position={[0, 0.031, facilities.circulation[0][1]]}
        size={[
          facilities.bounds.maxX - facilities.bounds.minX - 1.2,
          0.008,
          0.08,
        ]}
        color="#4b7685"
      />
      <Decor solids={solids} />
      {[-0.7, 0.7].flatMap((dx) =>
        [-1, 1].map((side) => (
          <Asset
            key={`${dx}-${side}`}
            name="chair"
            position={[
              centers.meeting[0] + dx,
              0.04,
              centers.meeting[1] + side * 0.8,
            ]}
            rotation={side === 1 ? 0 : Math.PI}
          />
        )),
      )}
      <Asset
        name="chair"
        position={[
          centers.reception[0] + 0.5,
          0.04,
          centers.reception[1] - 0.8,
        ]}
        rotation={Math.PI}
      />
      <Asset
        name="plant"
        position={[
          facilities.bounds.minX + 0.4,
          0.04,
          facilities.bounds.maxZ - 0.5,
        ]}
        scale={1.1}
      />
      <Asset
        name="plant"
        position={[
          facilities.bounds.maxX - 0.4,
          0.04,
          facilities.bounds.maxZ - 0.5,
        ]}
        scale={1.1}
      />
      {(Object.entries(centers) as [WorkplaceFacility, [number, number]][]).map(
        ([kind, point]) => (
          <Html
            key={kind}
            center
            position={[point[0], kind === "operations" ? 2.7 : 2.15, point[1]]}
            zIndexRange={[8, 0]}
          >
            <button
              className="facility-label"
              aria-label={`Open ${labels[kind]}`}
              onClick={() => onFacility(kind)}
            >
              <span>
                {kind === "reception"
                  ? "π"
                  : kind === "meeting"
                    ? "01"
                    : kind === "operations"
                      ? "02"
                      : "03"}
              </span>
              {labels[kind]}
              <small>Open</small>
            </button>
          </Html>
        ),
      )}
    </group>
  );
}
export function Asset({
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
  useEffect(
    () => () => {
      object.traverse((node) => {
        if (node instanceof THREE.Mesh) node.geometry.dispose();
      });
    },
    [object],
  );
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
  transition,
  lifecycleRoute,
  onLifecycleComplete,
  motionScope,
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
  transition?: ResidentTransition;
  lifecycleRoute?: Route;
  motionScope?: string;
  onLifecycleComplete?: (token: string, direction: LifecycleDirection) => void;
}) {
  const { scene, animations } = useGLTF(
    residentModel(agent.source?.agentId ?? agent.id),
  );
  const group = useRef<THREE.Group>(null);
  const trafficId = JSON.stringify([roomId, agent.id]);
  const rig = useMemo(() => {
    const model = clone(scene);
    model.traverse((n) => {
      if (n instanceof THREE.Mesh) {
        n.castShadow = true;
        n.receiveShadow = true;
        // Authored variant materials are immutable and safely shared.
        // Clone only the articulated hierarchy, never per-frame or on selection.
      }
    });
    return model;
  }, [scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(rig), [rig]);
  const actions = useMemo(
    () =>
      Object.fromEntries(
        animations.map((clip) => [
          clip.name.toLowerCase(),
          mixer
            .clipAction(clip)
            .setEffectiveTimeScale(animationPlaybackRate(clip.name)),
        ]),
      ),
    [mixer, animations],
  );
  const blendPose = useMemo(() => createAnimationBlend(actions), [actions]);
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
  // Finish the seat-facing turn even if lifecycle completion removes the
  // transition prop before the next rendered frame.
  const turning = useRef(false);
  const fallbackPoseTime = useRef(0);
  const travel = useRef<{
    routeKey: string;
    route: Route;
    total: number;
    token: string;
    state: LifecycleWalk;
  } | null>(null);
  const routeKey = JSON.stringify(lifecycleRoute ?? []);
  const lifecycleTotal = useMemo(
    () => (lifecycleRoute ? routeLength(lifecycleRoute) : 0),
    [routeKey],
  );
  const [hovered, setHovered] = useState(false);
  const cursorIdentity = useRef({});
  useEffect(() => () => releaseResidentCursor(cursorIdentity.current), []);
  const reduced = useReducedMotion();
  const [bubble, setBubble] = useState<{
    mode: "hidden" | "dot" | "compact" | "detail";
    placement: "above" | "below";
    alignment: "left" | "center" | "right";
  }>({ mode: "compact", placement: "above", alignment: "center" });
  // Drei Html lives in a DOM portal and does not inherit Group.visible.
  // Keep offsite actors out of both the rendered scene and keyboard hit area.
  const [bubbleVisible, setBubbleVisible] = useState(
    transition?.direction !== "arriving",
  );
  const visibleBubble = useRef(bubbleVisible);
  function setActorVisibility(visible: boolean) {
    if (group.current) group.current.visible = visible;
    if (visibleBubble.current !== visible) {
      visibleBubble.current = visible;
      setBubbleVisible(visible);
      if (!visible) {
        setHovered(false);
        releaseResidentCursor(cursorIdentity.current);
      }
    }
  }
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
  // View/transport boundaries cancel travel without destroying the loaded rig
  // or restarting its current state animation. Ordinary snapshots keep scope.
  useLayoutEffect(() => {
    Object.assign(motion.current, createMotion());
    travel.current = null;
    turning.current = false;
    releaseLifecycleWalk(reservations.current, roomId, trafficId);
    if (group.current) {
      setActorVisibility(transition?.direction !== "arriving");
      group.current.rotation.set(0, desk.orientation, 0);
      const arrival = transition?.direction === "arriving" && lifecycleRoute;
      group.current.position.set(
        arrival ? arrival[0][0] : desk.seat[0],
        arrival ? RESIDENT_STANDING_Y : RESIDENT_SEATED_Y,
        arrival ? arrival[0][1] : desk.seat[1],
      );
    }
  }, [motionScope, roomId]);
  // Capture direction changes when React commits them, even when the frame
  // loop is paused. Otherwise stop/start updates between two frames would
  // forget the queued departure and respawn a seated actor outdoors.
  function syncLifecycleTravel() {
    if (!transition || !lifecycleRoute) return null;
    const m = motion.current;
    if (
      !travel.current ||
      (travel.current.state.phase === "settled" &&
        travel.current.token !== transition.token)
    ) {
      travel.current = {
        routeKey,
        route: lifecycleRoute,
        total: lifecycleTotal,
        token: transition.token,
        state: createLifecycleWalk(transition.direction, lifecycleTotal),
      };
      // A new run marker for somebody already strolling does not teleport
      // them outdoors. Safely return that existing actor, then settle seated.
      if (transition.direction === "arriving" && m.mode !== "seated")
        travel.current.state.distance = lifecycleTotal;
    }
    // A still-hidden successor may be assigned another chair if the original
    // departing owner restarts. Updating an offsite route is safe; an active
    // path is immutable until completion or an explicit view-scope reset.
    if (
      travel.current.routeKey !== routeKey &&
      travel.current.state.phase === "waiting" &&
      travel.current.state.direction === "arriving" &&
      travel.current.state.distance === 0
    ) {
      travel.current.routeKey = routeKey;
      travel.current.route = lifecycleRoute;
      travel.current.total = lifecycleTotal;
    }
    travel.current.token = transition.token;
    reverseLifecycleWalk(
      travel.current.state,
      transition.direction,
      travel.current.total,
    );
    return travel.current;
  }
  useLayoutEffect(() => {
    const journey = syncLifecycleTravel();
    // A genuinely fresh arrival begins offsite. An in-flight stop/restart is
    // a reversal of the visible actor and must never hide or reposition it.
    if (
      group.current &&
      journey?.state.direction === "arriving" &&
      journey.state.phase === "waiting" &&
      journey.state.distance === 0 &&
      motion.current.mode === "seated"
    )
      setActorVisibility(false);
  }, [transition?.token, transition?.direction, routeKey, motionScope, roomId]);
  useEffect(() => {
    if (!command || command.id !== agent.id) return;
    const commandKey = `${command.id}:${command.type}:${command.serial}`;
    if (
      !consumeVisualCommand(
        reservations.current,
        residentIdentity(roomId, agent),
        commandKey,
      )
    )
      return;
    if (transition) return;
    if (reduced) {
      const m = motion.current;
      if (command.type === "walk") {
        m.mode = "lounge";
        m.distance = total;
        m.dwell = Infinity;
        m.pending = false;
        m.turnRemaining = 0;
      } else if (command.type === "return") {
        m.mode = "seated";
        m.distance = 0;
        m.pending = false;
        m.turnRemaining = 0;
      } else m.waveUntil = performance.now() / 1000 + 2.6;
      if (reservations.current.get(roomId) === trafficId)
        reservations.current.delete(roomId);
      return;
    }
    requestMotion(motion.current, command.type, performance.now() / 1000);
  }, [command, agent.id, reduced, total, reservations, roomId, transition]);
  useEffect(
    () => () => {
      positions.current.delete(agent.id);
      releaseLifecycleWalk(reservations.current, roomId, trafficId);
    },
    [agent.id, positions, reservations, roomId],
  );
  useEffect(
    () => () => {
      mixer.stopAllAction();
    },
    [mixer],
  );
  useFrame(({ clock, camera }, rawDelta) => {
    const delta = motionFrameDelta(rawDelta);
    const m = motion.current;
    if (!group.current) return;
    const now = performance.now() / 1000;
    let life: LifecycleWalk | null = null;
    let activeLifecycleRoute = lifecycleRoute;
    let activeLifecycleTotal = lifecycleTotal;
    let returningBeforeExit = false;
    let enteringFromOffsite = false;
    if (transition && lifecycleRoute) {
      const journey = syncLifecycleTravel()!;
      life = journey.state;
      activeLifecycleRoute = journey.route;
      activeLifecycleTotal = journey.total;
      enteringFromOffsite =
        life.phase === "waiting" &&
        life.direction === "arriving" &&
        life.distance === 0;
      // A resident already taking a stroll returns along that safe route before
      // standing up to depart. Its existing aisle reservation is retained.
      if (life.phase === "waiting" && m.mode !== "seated") {
        requestMotion(m, "return", now);
        returningBeforeExit = true;
        stepMotion(m, delta, total, roomId, trafficId, reservations.current);
      } else {
        m.pending = false;
        const completed = reduced
          ? !life.notified
            ? ((life.distance =
                life.direction === "arriving" ? activeLifecycleTotal : 0),
              (life.phase = "settled"),
              (life.turnRemaining = 0),
              (life.notified = true),
              releaseLifecycleWalk(reservations.current, roomId, trafficId),
              life.direction)
            : null
          : stepLifecycleWalk(
              life,
              delta,
              activeLifecycleTotal,
              LIFECYCLE_WALK_SPEED,
              roomId,
              trafficId,
              reservations.current,
            );
        if (completed) onLifecycleComplete?.(transition.token, completed);
      }
    } else {
      if (travel.current) {
        travel.current = null;
        releaseLifecycleWalk(reservations.current, roomId, trafficId);
        Object.assign(m, createMotion());
      }
      stepMotion(m, delta, total, roomId, trafficId, reservations.current);
    }
    const traveling = !returningBeforeExit ? life : null;
    const seated = traveling
      ? traveling.phase === "seating" ||
        (traveling.phase === "waiting" && traveling.direction === "exiting") ||
        (traveling.phase === "settled" && traveling.direction === "arriving")
      : m.mode === "seated";
    const reversing = (traveling?.turnRemaining ?? m.turnRemaining) > 0;
    const walking =
      !reversing &&
      (traveling
        ? traveling.phase === "walking"
        : m.mode === "outbound" || m.mode === "returning");
    const routePose = sampleLifecycleRoutePose(
      traveling && activeLifecycleRoute ? activeLifecycleRoute : desk.route,
      traveling ? traveling.distance : m.distance,
    );
    const point = routePose.position;
    const wasVisible = group.current.visible;
    setActorVisibility(
      !(
        traveling &&
        ((traveling.phase === "settled" && traveling.direction === "exiting") ||
          (traveling.phase === "waiting" && traveling.direction === "arriving"))
      ),
    );
    group.current.userData.lifecycle = traveling
      ? {
          direction: traveling.direction,
          phase: traveling.phase,
          distance: traveling.distance,
          total: activeLifecycleTotal,
          turnRemaining: traveling.turnRemaining,
        }
      : null;
    group.current.position.set(
      point[0],
      seated ? RESIDENT_SEATED_Y : RESIDENT_STANDING_Y,
      point[1],
    );
    if (walking || reversing || traveling?.phase === "standing") {
      const backwards = traveling
        ? traveling.direction === "exiting"
        : m.mode === "returning";
      m.yaw = routePose.yaw + (backwards ? Math.PI : 0);
      turning.current = true;
    } else if (seated) {
      m.yaw = desk.orientation;
    }
    // An offsite arrival can be oriented before its first visible frame.
    // All visible turns, including walk/seat boundaries and reversals, use
    // the same bounded step instead of snapping to a new route segment.
    if (reduced || (!wasVisible && enteringFromOffsite)) {
      group.current.rotation.y = m.yaw;
    } else if (!turning.current && seated) {
      // A static desk reassignment may set its facing immediately. Preserve
      // an already equivalent unwrapped heading after a completed turn.
      if (Math.abs(Math.sin((m.yaw - group.current.rotation.y) / 2)) > 1e-8)
        group.current.rotation.y = m.yaw;
    } else {
      const next = stepHeading(group.current.rotation.y, m.yaw, delta);
      group.current.rotation.y = next;
      if (seated && Math.abs(Math.sin((m.yaw - next) / 2)) < 1e-8)
        turning.current = false;
    }
    const waving = m.waveUntil > now;
    const reportedClip = presentation(agent).clip;
    const transientFinished =
      ["completed", "done", "error"].includes(agent.state) &&
      now - stateStarted.current.time > 5.8;
    const stateClip = transientFinished ? "idleseated" : reportedClip;
    const wanted = reduced
      ? seated
        ? "idleseated"
        : "idle"
      : walking
        ? "walk"
        : waving
          ? seated
            ? "waveseated"
            : "wave"
          : seated
            ? stateClip
            : "idle";
    const pose = actions[wanted] ? wanted : seated ? "idleseated" : "idle";
    blendPose(pose, delta, reduced);
    if (reduced) {
      const action = actions[pose];
      if (action) {
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
      if (!reduced)
        fallbackPoseTime.current +=
          delta * animationPlaybackRate(walking ? "walk" : pose);
      const t = reduced ? 0 : fallbackPoseTime.current;
      const joint = (name: string, x = 0, z = 0) => {
        const j = joints[name];
        if (j) {
          j.object.rotation.copy(j.rotation);
          j.object.rotateX(x);
          j.object.rotateZ(z);
        }
      };
      const step = walking ? Math.sin(t * 7) * 0.6 : 0;
      rig.position.y = seated
        ? -0.35
        : walking
          ? Math.abs(Math.sin(t * 7)) * 0.025
          : Math.sin(t * 1.3) * 0.008;
      joint("UpperLeg.L", seated ? 1.45 : step);
      joint("UpperLeg.R", seated ? 1.45 : -step);
      joint("LowerLeg.L", seated ? -1.45 : Math.max(0, -step) * 0.65);
      joint("LowerLeg.R", seated ? -1.45 : Math.max(0, step) * 0.65);
      joint("UpperArm.L", seated ? 0.8 : -step * 0.65);
      joint(
        "UpperArm.R",
        waving ? 2.8 : seated ? 0.8 : step * 0.65,
        waving ? Math.sin(t * 10) * 0.2 : 0,
      );
      joint("LowerArm.L", seated ? 0.55 : 0);
      joint("LowerArm.R", waving ? 0.4 : seated ? 0.55 : 0);
      joint("Head", 0, Math.sin(t * 0.8 + index) * 0.025);
    }
    if (group.current.visible)
      positions.current.set(agent.id, group.current.position.clone());
    else positions.current.delete(agent.id);
    const label = traveling
      ? traveling.direction === "arriving"
        ? traveling.phase === "waiting"
          ? "Waiting outside"
          : "Walking into the office"
        : traveling.phase === "waiting"
          ? "Waiting for the aisle"
          : "Leaving the office"
      : m.pending
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
    <group ref={group} name={`resident-${agent.id}`}>
      <group
        onClick={(e) => {
          // Three raycasting includes invisible descendants, unlike rendering.
          if (!group.current?.visible) return;
          e.stopPropagation();
          // OrbitControls also finishes with a click; dragging must not select.
          if (e.delta <= 4) onSelect();
        }}
        onPointerOver={(e) => {
          if (!group.current?.visible) return;
          e.stopPropagation();
          setHovered(true);
          claimResidentCursor(cursorIdentity.current);
        }}
        onPointerOut={() => {
          setHovered(false);
          releaseResidentCursor(cursorIdentity.current);
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
      {bubbleVisible && (
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
      )}
    </group>
  );
}
function Room({ session, layout }: { session: Session; layout: RoomLayout }) {
  const [x, z] = layout.center;
  return (
    <group>
      <Decor solids={createRoomDecor(layout)} />
      <Asset name="plant" position={[x - 5.35, 0.05, z - 4.25]} scale={0.8} />
      <Asset name="plant" position={[x + 5.35, 0.05, z - 4.25]} scale={0.8} />
      <Html
        center
        position={[x, 2.62, z - 4.82]}
        zIndexRange={[7, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div className="room-plaque">
          {session.name}
          <small>
            {projectRosterSummary(session)}
            {session.agents.length > 6 ? " · 6 desks shown" : ""}
          </small>
        </div>
      </Html>
      {layout.desks.map((desk) => (
        <group key={`furniture-${desk.index}`}>
          <Asset
            name="desk"
            position={[desk.desk[0], 0.04, desk.desk[1]]}
            rotation={desk.orientation}
          />
          <Asset
            name="chair"
            position={[desk.seat[0], 0.04, desk.seat[1]]}
            rotation={desk.orientation}
          />
        </group>
      ))}
      {!layout.desks.length && (
        <>
          <Asset name="desk" position={[x, 0.04, z - 1.4]} rotation={Math.PI} />
          <Asset
            name="chair"
            position={[x, 0.04, z - 2.14]}
            rotation={Math.PI}
          />
          <Asset name="desk" position={[x, 0.04, z + 0.4]} />
          <Asset name="chair" position={[x, 0.04, z + 1.14]} />
        </>
      )}
      <pointLight
        position={[x - 4, 2.1, z + 3.5]}
        intensity={5}
        distance={6}
        color="#d9efff"
      />
    </group>
  );
}
export function ResidentLayer({
  residents,
  layouts,
  selected,
  onSelect,
  command,
  positions,
  reservations,
  scope,
  onComplete,
}: {
  residents: ResidentEntry[];
  layouts: RoomLayout[];
  selected: string | null;
  onSelect: (id: string) => void;
  command: Command;
  positions: Registry;
  reservations: React.MutableRefObject<Map<string, string>>;
  scope: string;
  onComplete: (
    key: string,
    token: string,
    direction: LifecycleDirection,
  ) => void;
}) {
  return (
    <group>
      {residents.map((resident) => {
        const layout = layouts.find((room) => room.id === resident.roomId);
        const desk = layout?.desks[resident.deskIndex];
        if (!layout || !desk) return null;
        return (
          <Suspense key={resident.key} fallback={null}>
            <Character
              agent={resident.agent}
              desk={desk}
              roomId={resident.roomId}
              selected={selected === resident.agent.id}
              onSelect={() => onSelect(resident.agent.id)}
              command={command}
              positions={positions}
              reservations={reservations}
              index={resident.deskIndex + layout.index * 3}
              motionScope={JSON.stringify([
                scope,
                layout.id,
                layout.index,
                layouts.length,
              ])}
              transition={resident.transition}
              lifecycleRoute={
                resident.transition
                  ? createBuildingEntryRoute(
                      layouts,
                      layout,
                      desk,
                      resident.transition.queueIndex,
                    )
                  : undefined
              }
              onLifecycleComplete={(token, direction) =>
                onComplete(resident.key, token, direction)
              }
            />
          </Suspense>
        );
      })}
    </group>
  );
}
export default function Office({
  onFacility = () => {},
  lifecycleEvents = [],
  lifecycleEpoch = 0,
  lifecycleEnabled = false,
  connection = "connected",
  cameraAction,
  sessions,
  selected,
  onSelect,
  reset,
  follow,
  command,
  onStopFollow,
}: {
  onFacility?: (facility: WorkplaceFacility) => void;
  lifecycleEvents?: AgentLifecycleEvent[];
  lifecycleEpoch?: number;
  lifecycleEnabled?: boolean;
  connection?: "connecting" | "connected" | "disconnected";
  cameraAction?: CameraAction | null;
  sessions: Session[];
  selected: string | null;
  onSelect: (id: string) => void;
  reset: number;
  follow: string | null;
  command: Command;
  onStopFollow: () => void;
}) {
  const reduced = useReducedMotion();
  const { residents, complete } = useResidentLifecycle({
    sessions,
    selected,
    events: lifecycleEvents,
    epoch: lifecycleEpoch,
    enabled: lifecycleEnabled,
    reduced,
    connection,
  });
  const positions = useRef(new Map<string, THREE.Vector3>());
  const reservations = useRef(new Map<string, string>());
  const rooms = sessions.length
    ? sessions
    : [{ id: "empty-office", name: "Your next session", agents: [] }];
  const layouts = createOfficeLayout(
    rooms.map((room) => ({
      id: room.id,
      agentCount: Math.max(
        room.agents.length,
        ...residents
          .filter((resident) => resident.roomId === room.id)
          .map((resident) => resident.deskIndex + 1),
      ),
    })),
  );
  const bounds = buildingLayoutBounds(rooms.length);
  const width = bounds.maxX - bounds.minX,
    depth = bounds.maxZ - bounds.minZ;
  const centerX = (bounds.minX + bounds.maxX) / 2,
    centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const shadowExtent = Math.max(width, depth) + 10;
  return (
    <Canvas
      shadows
      dpr={[1, 1.6]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#b3c3ce"]} />
      <fog attach="fog" args={["#b3c3ce", 48, 115]} />
      <PerspectiveCamera
        makeDefault
        fov={42}
        position={[12, 15, 22]}
        near={0.1}
        far={200}
      />
      <ambientLight intensity={0.7} />
      <hemisphereLight args={["#f0f6ff", "#657c8b", 1.6]} />
      <directionalLight
        castShadow
        position={[-8, 20, 10]}
        intensity={2.8}
        color="#f1f6ff"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
        shadow-normalBias={0.035}
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[centerX, -0.39, centerZ]}
        receiveShadow
      >
        <planeGeometry args={[150, 150]} />
        <meshStandardMaterial color="#8399a8" roughness={1} />
      </mesh>
      <Solid
        position={[centerX, -0.27, centerZ]}
        size={[width + 3, 0.15, depth + 3]}
        color="#b4c0c8"
      />
      <Suspense
        fallback={
          <Html center>
            <div className="world-loading">Opening the office…</div>
          </Html>
        }
      >
        {rooms.map((session, i) => (
          <Room key={session.id} session={session} layout={layouts[i]} />
        ))}
        <ResidentLayer
          residents={residents}
          layouts={layouts}
          selected={selected}
          onSelect={onSelect}
          command={command}
          positions={positions}
          reservations={reservations}
          scope={JSON.stringify([
            lifecycleEpoch,
            lifecycleEnabled,
            reduced,
            connection,
          ])}
          onComplete={complete}
        />
        <SharedWorkplace count={rooms.length} onFacility={onFacility} />
        <BuildingEntrance count={rooms.length} />
        <ContactShadows
          position={[centerX, -0.385, centerZ]}
          scale={Math.max(30, width + 10, depth + 10)}
          opacity={0.18}
          far={15}
          blur={2}
        />
      </Suspense>
      <CameraRig
        count={rooms.length}
        reset={reset}
        follow={follow}
        positions={positions}
        cameraAction={cameraAction}
        onStopFollow={onStopFollow}
      />
    </Canvas>
  );
}
