// When a retained observation still counts as current: its age, and whether the panel re-read the same native revision since.
const LIVE_CONFIRM_MS = 10000;

/** How long an observation stays current on its own. */
export const OBSERVED_TTL_MS = 15000;

/** A retained observation is current when its native identity matches the active context and either it is young or the panel re-read that same revision from After Effects within the live confirmation window. AE bumps project.revision on every project edit, so an unchanged live stamp proves the rows still describe the project. Write paths keep the strict age. */
export function liveCurrent(age: number, liveAt: number | undefined, now: number): boolean {
  if (age < 0) return false;
  return age < OBSERVED_TTL_MS || (liveAt !== undefined && now - liveAt >= 0 && now - liveAt < LIVE_CONFIRM_MS);
}
