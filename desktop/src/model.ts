import {
  isHistoricalAgent,
  projectOffices,
  residentIdentity,
} from "../../src/projectProjection";
import type { Agent, Snapshot } from "../../src/types";

export interface Resident {
  key: string;
  agent: Agent;
  projectId: string;
  project: string;
  cwd?: string;
  session: string;
  historical: boolean;
}
export function projectResidents(snapshot: Snapshot | null) {
  const offices = projectOffices(snapshot?.sessions ?? []);
  const residents: Resident[] = offices.flatMap((office) =>
    office.agents.map((agent) => ({
      key: residentIdentity(office.id, agent),
      agent,
      projectId: office.id,
      project: office.name,
      cwd: office.cwd,
      session: agent.source?.sessionName ?? office.name,
      historical: isHistoricalAgent(office, agent),
    })),
  );
  return { offices, residents };
}
export const needsAttention = (resident: Resident) =>
  !resident.historical && ["waiting", "error"].includes(resident.agent.state);
export const isBusy = (resident: Resident) =>
  !resident.historical &&
  ["working", "thinking"].includes(resident.agent.state);
export function paletteFor(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++)
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(hash % 6);
}
export function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    working: "Working",
    thinking: "Thinking",
    idle: "Idle",
    waiting: "Needs you",
    done: "Task finished",
    completed: "Task finished",
    error: "Error",
    offline: "Offline",
    stale: "Quiet connection",
  };
  return Object.prototype.hasOwnProperty.call(labels, state)
    ? labels[state]
    : "Unknown state";
}
