import type { Snapshot } from "../../src/types";

export interface CompanionState {
  snapshot: Snapshot | null;
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
  | "compact"
  | "roomy"
  | "quit";
export interface CompanionAPI {
  getState(): Promise<CompanionState>;
  onState(callback: (state: CompanionState) => void): () => void;
  command(command: CompanionCommand): Promise<CompanionState | void>;
}
declare global {
  interface Window {
    companion?: CompanionAPI;
  }
}
