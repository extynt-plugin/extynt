// The gate a decision must pass before it is wired: routed accuracy at least the deterministic accuracy, with no regression on the hard cases.
import type { SuiteStats } from "./decision-eval-stats.js";

type Verdict = "pass" | "fail" | "offline";

function rate(tally: { readonly cases: number; readonly correct: number }): number {
  return tally.cases === 0 ? 1 : tally.correct / tally.cases;
}

/** Whether routing with the decision model is at least as accurate as the deterministic tier overall and on the hard cases. */
export function gateOf(stats: SuiteStats): Verdict {
  if (stats.routed === null) return "offline";
  const hardRouted = stats.hard.routed;
  const holdsHard = hardRouted === null || rate(hardRouted) >= rate(stats.hard.deterministic);
  return rate(stats.routed) >= rate(stats.deterministic) && holdsHard ? "pass" : "fail";
}
