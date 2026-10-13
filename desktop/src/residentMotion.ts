/** Explicit bridge-state mapping: unknown or historical data must never look live. */
export type ResidentActivity =
  "working" | "thinking" | "idle" | "waiting" | "error" | "resting" | "static";

export function residentActivity(
  state: string,
  historical = false,
): ResidentActivity {
  if (historical) return "static";
  switch (state) {
    case "working":
    case "thinking":
    case "idle":
    case "waiting":
    case "error":
      return state;
    case "done":
    case "completed":
      return "resting";
    default:
      return "static";
  }
}

/** A bounded, literal label. Transport loss and history override last-known work. */
export function residentStatus(
  state: string,
  historical = false,
  connected = true,
): string {
  if (historical) return "Historical";
  if (!connected) return "Last known";
  switch (state) {
    case "working":
      return "Working";
    case "thinking":
      return "Thinking";
    case "waiting":
      return "Needs input";
    case "error":
      return "Error";
    case "idle":
      return "Idle";
    case "done":
    case "completed":
      return "Completed";
    case "offline":
      return "Offline";
    case "stale":
      return "Last known";
    default:
      return "Unknown";
  }
}
