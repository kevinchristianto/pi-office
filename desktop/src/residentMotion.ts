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
