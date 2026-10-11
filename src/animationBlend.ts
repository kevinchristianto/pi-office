import type { AnimationAction } from "three";

const BLEND_SECONDS = 0.2;

/** Blend from the evaluated weights, including when another state interrupts. */
export function createAnimationBlend(actions: Record<string, AnimationAction>) {
  const allActions = Object.values(actions);
  let current: AnimationAction | undefined;
  let from = new Map<AnimationAction, number>();
  let elapsed = BLEND_SECONDS;
  return (name: string, delta: number, immediate = false) => {
    const next = actions[name];
    if (!next) return;
    if (current !== next || !next.isScheduled()) {
      from = new Map(
        allActions.map((action) => [
          action,
          action.isScheduled() ? action.getEffectiveWeight() : 0,
        ]),
      );
      // Returning to a clip while it is still contributing must retain its
      // phase. Restarting it at time zero would pop even with continuous weights.
      if (!from.get(next)) next.reset();
      next.play();
      current = next;
      elapsed = [...from.values()].some((weight) => weight > 0)
        ? 0
        : BLEND_SECONDS;
    }
    elapsed = immediate
      ? BLEND_SECONDS
      : Math.min(BLEND_SECONDS, elapsed + delta);
    const progress = elapsed / BLEND_SECONDS;
    for (const action of allActions) {
      const start = from.get(action) ?? 0;
      const target = action === current ? 1 : 0;
      action.setEffectiveWeight(start + (target - start) * progress);
      if (progress === 1 && action !== current && action.isScheduled())
        action.stop();
    }
  };
}
