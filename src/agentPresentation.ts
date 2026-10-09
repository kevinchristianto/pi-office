import type { Agent } from "./types";
export const statePresentation: Record<
  string,
  { label: string; symbol: string; clip: string; hint: string }
> = {
  working: {
    label: "Working",
    symbol: "↗",
    clip: "work",
    hint: "Executing reported work",
  },
  thinking: {
    label: "Thinking",
    symbol: "···",
    clip: "thinkseated",
    hint: "Reasoning in Pi",
  },
  waiting: {
    label: "Waiting",
    symbol: "◷",
    clip: "waitseated",
    hint: "Waiting state reported",
  },
  idle: {
    label: "Idle",
    symbol: "·",
    clip: "idleseated",
    hint: "No active work reported",
  },
  error: {
    label: "Needs attention",
    symbol: "!",
    clip: "errorseated",
    hint: "An error was reported",
  },
  completed: {
    label: "Completed",
    symbol: "✓",
    clip: "doneseated",
    hint: "Completion reported",
  },
  done: {
    label: "Completed",
    symbol: "✓",
    clip: "doneseated",
    hint: "Completion reported",
  },
  offline: {
    label: "Offline",
    symbol: "○",
    clip: "offlineseated",
    hint: "No recent connection",
  },
  stale: {
    label: "Last seen",
    symbol: "◌",
    clip: "offlineseated",
    hint: "Observation is stale",
  },
};
export function presentation(agent: Agent) {
  return (
    statePresentation[agent.state] || {
      label: agent.state || "Unknown",
      symbol: "·",
      clip: "idleseated",
      hint: "No recognized state reported",
    }
  );
}
export function activityLine(agent: Agent) {
  if (agent.state === "offline" || agent.state === "stale")
    return presentation(agent).hint;
  return agent.tool?.trim() || agent.task?.trim() || presentation(agent).hint;
}
export function freshness(
  updatedAt: number | string | undefined,
  now = Date.now(),
) {
  if (updatedAt == null) return "Not reported";
  const time = new Date(updatedAt).getTime();
  if (!Number.isFinite(time)) return "Not reported";
  const elapsed = Math.max(0, Math.floor((now - time) / 1000));
  return elapsed < 5
    ? "Just observed"
    : elapsed < 60
      ? `${elapsed}s ago`
      : elapsed < 3600
        ? `${Math.floor(elapsed / 60)}m ago`
        : `${Math.floor(elapsed / 3600)}h ago`;
}
export function bubbleMode(
  distance: number,
  priority: boolean,
  inView: boolean,
) {
  if (!inView) return "hidden";
  if (priority) return "detail";
  if (distance > 48) return "hidden";
  return distance > 30 ? "dot" : "compact";
}
