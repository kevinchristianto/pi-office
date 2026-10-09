export type AgentState =
  | "working"
  | "thinking"
  | "idle"
  | "waiting"
  | "done"
  | "error"
  | "offline"
  | "stale"
  | string;
export interface Agent {
  id: string;
  name: string;
  role?: string;
  task?: string;
  state: AgentState;
  tool?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cost?: number | null;
  updatedAt?: number | string;
  logs?: { time: number | string; level: string; message: string }[];
  capabilities?: string[];
}
export interface Session {
  id: string;
  name: string;
  cwd?: string;
  model?: string;
  agents: Agent[];
  capabilities?: string[];
}
export interface Snapshot {
  sessions: Session[];
  updatedAt: number | string;
}
