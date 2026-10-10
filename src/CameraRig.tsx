import {
  useEffect,
  useRef,
  type ComponentRef,
  type MutableRefObject,
} from "react";
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  Fog,
  MathUtils,
  MOUSE,
  PerspectiveCamera,
  TOUCH,
  Vector3,
} from "three";
import { useReducedMotion } from "./useReducedMotion";
import {
  CAMERA_FOCUS_DISTANCE,
  CAMERA_MAX_POLAR,
  CAMERA_MIN_DISTANCE,
  CAMERA_MIN_POLAR,
  cameraEase,
  cameraKey,
  cameraPan,
  cameraWheelScale,
  constrainCameraTarget,
  fitOfficeCamera,
  officeCameraBounds,
  visibleRoomCount,
  type CameraAction,
} from "./camera";

type Pose = {
  position: Vector3;
  target: Vector3;
  kind: "fit" | "focus" | "zoom";
};
export interface CameraRigProps {
  count: number;
  reset: number;
  follow: string | null;
  positions: MutableRefObject<Map<string, Vector3>>;
  onStopFollow: () => void;
  cameraAction?: CameraAction | null;
}

/** One owner for camera motion: user gestures always interrupt automatic motion. */
export default function CameraRig(props: CameraRigProps) {
  const { camera, gl, size, scene, invalidate } = useThree();
  const reduced = useReducedMotion();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const current = useRef(props);
  current.current = props;
  const viewport = useRef(size);
  viewport.current = size;
  const keys = useRef(new Set<string>());
  const transition = useRef<Pose | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const followOffset = useRef<Vector3 | null>(null);
  const blockedFollow = useRef(false);
  // Do not pull a user's camera sideways when a live session disappears.
  // A deliberate Fit resets the extent; additions only expand it.
  const extent = useRef(visibleRoomCount(props.count));
  extent.current = Math.max(extent.current, visibleRoomCount(props.count));
  const bounds = useRef(officeCameraBounds(extent.current));
  bounds.current = officeCameraBounds(extent.current);
  const maxDistance = useRef(85);
  const initializedCamera = useRef<object | null>(null);

  function flushDamping() {
    const c = controls.current;
    if (!c) return;
    const eye = camera.position.clone();
    const target = c.target.clone();
    c.enableDamping = false;
    c.update();
    // Consume residual motion without visibly jumping to its old destination.
    camera.position.copy(eye);
    c.target.copy(target);
    c.update();
    c.enableDamping = !reduced;
  }
  function manual() {
    transition.current = null;
    pendingFocus.current = null;
    followOffset.current = null;
    if (!blockedFollow.current && current.current.follow) {
      blockedFollow.current = true;
      current.current.onStopFollow();
    }
  }
  function fit(immediate = false) {
    const c = controls.current;
    if (!c) return;
    flushDamping();
    const fit = fitOfficeCamera(
      viewport.current.width,
      viewport.current.height,
      current.current.count,
    );
    extent.current = visibleRoomCount(current.current.count);
    bounds.current = officeCameraBounds(extent.current);
    maxDistance.current = Math.max(45, fit.distance * 1.6);
    c.maxDistance = Math.max(
      c.maxDistance === Infinity ? 0 : c.maxDistance,
      maxDistance.current,
    );
    if (camera instanceof PerspectiveCamera) {
      camera.far = Math.max(250, maxDistance.current + 80);
      camera.updateProjectionMatrix();
    }
    const pose: Pose = {
      kind: "fit",
      position: new Vector3(...fit.position),
      target: new Vector3(...fit.target),
    };
    if (immediate || reduced) {
      camera.position.copy(pose.position);
      c.target.copy(pose.target);
      transition.current = null;
      c.maxDistance = maxDistance.current;
      c.update();
    } else transition.current = pose;
    invalidate();
  }
  function zoom(direction: "zoom-in" | "zoom-out" | number) {
    const c = controls.current;
    if (!c) return;
    // Repeated presses accumulate against the requested distance, not an
    // unfinished frame. Otherwise quick clicks feel as if they were ignored.
    const previous =
      transition.current?.kind === "zoom" ? transition.current : null;
    const origin = previous?.position.clone() ?? camera.position.clone();
    const target = previous?.target.clone() ?? c.target.clone();
    manual();
    flushDamping();
    const offset = origin.sub(target);
    offset.setLength(
      MathUtils.clamp(
        offset.length() *
          (typeof direction === "number"
            ? direction
            : direction === "zoom-in"
              ? 0.78
              : 1 / 0.78),
        CAMERA_MIN_DISTANCE,
        c.maxDistance,
      ),
    );
    transition.current = {
      position: target.clone().add(offset),
      target,
      kind: "zoom",
    };
    invalidate();
  }

  useEffect(() => {
    // Deliberately not dependent on viewport/count: orbiting survives resize,
    // new sessions, live snapshots, and parent callback identity changes.
    const initial = initializedCamera.current !== camera;
    initializedCamera.current = camera;
    manual();
    fit(initial);
  }, [camera, props.reset]);

  useEffect(() => {
    blockedFollow.current = false;
    followOffset.current = null;
    if (props.follow) {
      transition.current = null;
      pendingFocus.current = null;
      keys.current.clear();
      flushDamping();
    }
  }, [props.follow]);

  useEffect(() => {
    if (!props.cameraAction) return;
    if (props.cameraAction.type === "focus") {
      manual();
      flushDamping();
      pendingFocus.current = props.cameraAction.id;
    } else zoom(props.cameraAction.type);
  }, [props.cameraAction]);

  useEffect(() => {
    const canvas = gl.domElement;
    const previousTabIndex = canvas.getAttribute("tabindex");
    const previousLabel = canvas.getAttribute("aria-label");
    const previousDescription = canvas.getAttribute("aria-describedby");
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Office camera");
    canvas.setAttribute("aria-describedby", "camera-instructions");
    const keydown = (event: KeyboardEvent) => {
      if (
        event.target !== canvas ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const action = cameraKey(event.key);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "pan") {
        manual();
        keys.current.add(event.key.toLowerCase());
      } else if (action === "reset") {
        if (!event.repeat) {
          manual();
          fit();
        }
      } else zoom(action);
    };
    const keyup = (event: KeyboardEvent) =>
      keys.current.delete(event.key.toLowerCase());
    const clear = () => keys.current.clear();
    const visibility = () => {
      if (document.hidden) clear();
    };
    const pointerdown = () => canvas.focus({ preventScroll: true });
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        // Preserve browser zoom accessibility, including trackpad gestures that
        // the browser exposes as Ctrl-wheel. Do not let native controls eat it.
        event.stopImmediatePropagation();
        return;
      }
      if (!controls.current?.enabled || !event.deltaY) return;
      // Capture before OrbitControls' stepped wheel handler. Pinch and middle
      // drag remain native; wheel/trackpad zoom gets the same smooth easing as ±.
      event.preventDefault();
      event.stopImmediatePropagation();
      zoom(
        cameraWheelScale(
          event.deltaY,
          event.deltaMode,
          viewport.current.height,
        ),
      );
    };
    canvas.addEventListener("wheel", wheel, { passive: false, capture: true });
    canvas.addEventListener("keydown", keydown);
    canvas.addEventListener("pointerdown", pointerdown);
    canvas.addEventListener("blur", clear);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      canvas.removeEventListener("wheel", wheel, true);
      canvas.removeEventListener("keydown", keydown);
      canvas.removeEventListener("pointerdown", pointerdown);
      canvas.removeEventListener("blur", clear);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
      clear();
      for (const [attribute, value] of [
        ["tabindex", previousTabIndex],
        ["aria-label", previousLabel],
        ["aria-describedby", previousDescription],
      ]) {
        if (value === null) canvas.removeAttribute(attribute!);
        else canvas.setAttribute(attribute!, value!);
      }
    };
  }, [gl, camera, reduced]);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    if (pendingFocus.current) {
      const position = props.positions.current.get(pendingFocus.current);
      if (position) {
        const target = position.clone().add(new Vector3(0, 0.85, 0));
        const offset = camera.position
          .clone()
          .sub(c.target)
          .setLength(CAMERA_FOCUS_DISTANCE);
        transition.current = {
          position: target.clone().add(offset),
          target,
          kind: "focus",
        };
        pendingFocus.current = null;
      }
    }
    if (props.follow && !blockedFollow.current) {
      const position = props.positions.current.get(props.follow);
      if (position) {
        if (!followOffset.current)
          followOffset.current = camera.position
            .clone()
            .sub(c.target)
            .setLength(CAMERA_FOCUS_DISTANCE);
        const target = position.clone().add(new Vector3(0, 0.85, 0));
        const desired = target.clone().add(followOffset.current);
        const alpha = cameraEase(delta, reduced);
        camera.position.lerp(desired, alpha);
        c.target.lerp(target, alpha);
        constrainCameraTarget(camera.position, c.target, bounds.current);
        c.update();
        return;
      }
    }
    const destination = transition.current;
    if (destination) {
      const alpha = cameraEase(delta, reduced);
      camera.position.lerp(destination.position, alpha);
      c.target.lerp(destination.target, alpha);
      if (
        camera.position.distanceToSquared(destination.position) +
          c.target.distanceToSquared(destination.target) <
        0.00001
      ) {
        camera.position.copy(destination.position);
        c.target.copy(destination.target);
        transition.current = null;
        c.maxDistance = maxDistance.current;
      }
      c.update();
      return;
    }
    if (keys.current.size) {
      const backward = camera.position.clone().sub(c.target);
      const movement = cameraPan(
        keys.current,
        backward,
        backward.length(),
        delta,
      );
      camera.position.add(movement);
      c.target.add(movement);
    }
    c.update();
    // Clamp after OrbitControls has consumed its inertia, otherwise another
    // damping step can push the target back outside the floor this same frame.
    constrainCameraTarget(camera.position, c.target, bounds.current);
  });

  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    const distance = camera.position.distanceTo(c.target);
    // Portrait/all-office fits can be farther than the original scene's fog
    // cutoff. Keep the office visible and haze only the surrounding ground.
    if (scene.fog instanceof Fog) {
      scene.fog.near = Math.max(48, distance + 18);
      scene.fog.far = Math.max(115, distance + 90);
    }
    if (camera instanceof PerspectiveCamera) {
      const far = Math.max(250, c.maxDistance + 80);
      if (camera.far !== far) {
        camera.far = far;
        camera.updateProjectionMatrix();
      }
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      domElement={gl.domElement}
      minDistance={CAMERA_MIN_DISTANCE}
      minPolarAngle={CAMERA_MIN_POLAR}
      maxPolarAngle={CAMERA_MAX_POLAR}
      enableDamping={!reduced}
      dampingFactor={0.1}
      rotateSpeed={0.55}
      zoomSpeed={0.72}
      panSpeed={0.85}
      screenSpacePanning={false}
      mouseButtons={{
        LEFT: MOUSE.ROTATE,
        MIDDLE: MOUSE.DOLLY,
        RIGHT: MOUSE.PAN,
      }}
      touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
      onStart={manual}
    />
  );
}
