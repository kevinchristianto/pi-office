import type { Snapshot } from "../../src/types";

export interface WindowSize {
  width: number;
  height: number;
}
export type ResizeAction = (
  width: number,
  height: number,
  signal?: AbortSignal,
) => Promise<WindowSize | boolean>;

export interface CompanionState {
  windowSize?: WindowSize;
  snapshot: Snapshot | null;
  bridge?: {
    mode: "starting" | "external" | "owned" | "error";
    error: string | null;
  };
  connection: {
    status: "connecting" | "live" | "offline" | "paused";
    lastSuccessAt: number | null;
    error: string | null;
  };
  visible: boolean;
  alwaysOnTop: boolean;
  locked: boolean;
  shortcutAvailable: boolean;
}
export type CompanionCommand =
  | "toggle-top"
  | "lock"
  | "hide"
  | "restore"
  | "open-office"
  | "connect-pi"
  | "compact"
  | "roomy"
  | "quit";
export interface CompanionAPI {
  getState(): Promise<CompanionState>;
  onState(callback: (state: CompanionState) => void): () => void;
  command(command: CompanionCommand): Promise<CompanionState | void>;
  // Optional so the browser preview and an older preload fail safely.
  resize?(width: number, height: number): Promise<CompanionState>;
}
declare global {
  interface Window {
    companion?: CompanionAPI;
  }
}
