/** Stable visual identity. Names, roles, state and array order never affect it. */
export const RESIDENT_VARIANTS = 8;
// Match the rug/desk contact plane without scaling the articulated rig.
export const RESIDENT_SEATED_Y = 0.05;
export const RESIDENT_STANDING_Y = 0.04;
export function residentVariant(agentId: string): number {
  // FNV-1a over UTF-16 code units: deterministic in every supported browser.
  let hash = 2166136261;
  for (let i = 0; i < agentId.length; i++) {
    hash ^= agentId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % RESIDENT_VARIANTS;
}
export function residentModel(agentId: string): string {
  return `/models/agent-${String(residentVariant(agentId) + 1).padStart(2, "0")}.glb`;
}
