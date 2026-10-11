export interface AgentLifecycleMarker {
  version: 1;
  eventId: string;
  kind: "start" | "stop";
  source:
    "pi:session_start" | "pi:session_shutdown" | "pi-subagents:child-status";
  at: string;
}
export interface AgentLifecycleEvent extends AgentLifecycleMarker {
  sessionId: string;
  agentId: string;
}
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
  lifecycle?: AgentLifecycleMarker | null;
  /** Display-only provenance. Never sent back to the observer/bridge. */
  source?: {
    sessionId: string;
    sessionName: string;
    agentId: string;
    cwd?: string;
    model?: string;
    historical: boolean;
  };
}
export interface SessionProject {
  id: string;
  root: string;
  name: string;
  kind: "git" | "directory";
  platform?: string;
  filesystemId?: string;
}
export interface Session {
  id: string;
  name: string;
  cwd?: string;
  model?: string;
  agents: Agent[];
  capabilities?: string[];
  /** Undefined is a legacy observer; null means resolution was attempted and failed. */
  project?: SessionProject | null;
  connected?: boolean;
  connectionState?: "live" | "stale" | "offline";
  lastSeen?: string;
  /** Present only on a display projection, never on transport sessions. */
  sourceSessions?: readonly Session[];
  liveAgentCount?: number;
  historyAgentCount?: number;
}
export interface Snapshot {
  streamId?: string;
  revision?: number;
  sessions: Session[];
  updatedAt: number | string;
}
