// Sidecar-owned reading of a goal's wording: which kinds of evidence it demands and whether exact values can answer it, read by the decide package's evidence words.
import type { WorkflowSuccessCriterion, WorkflowVerificationKind } from "@extynt/workflow";
import { goalAsksJudgement, goalIsTemporal, goalIsVisual } from "@extynt/decide";
import { bookedYesNo } from "./decision-book.js";

/** Model prose cannot downgrade the evidence a goal requires: appearance wording demands a visual check and motion wording adds sampled frames. */
export function requiredEvidenceKindsForGoal(goal: string): WorkflowVerificationKind[] {
  const temporal = bookedYesNo({ decision: "evidence-temporal", text: goal }) ?? goalIsTemporal(goal);
  const visual = temporal || (bookedYesNo({ decision: "evidence-visual", text: goal }) ?? goalIsVisual(goal));
  return [...(visual ? ["visual" as const] : []), ...(temporal ? ["temporal" as const] : [])];
}

/**
 * True when the goal's wording asks for a look, a match or a whole scene: a rendered frame is wanted whatever was queued, because exact values cannot answer it.
 * The decide package reads the wording, so a name, a composition setting or a plain value never counts as a judgement.
 */
export function goalAsksForJudgement(goal: string): boolean {
  return bookedYesNo({ decision: "evidence-judgement", text: goal }) ?? goalAsksJudgement(goal);
}

/** True when the goal names no scene, motion or judgement, so literal values read back by the host are the whole request. */
export function goalNamesNoSceneOrMotion(goal: string): boolean {
  return !requiredEvidenceKindsForGoal(goal).includes("temporal") && !goalAsksForJudgement(goal);
}

/** The success criteria a goal opens its job with: one per required evidence kind, or a single observed-goal criterion when none is required. */
export function successCriteriaForGoal(goal: string): WorkflowSuccessCriterion[] {
  const kinds = requiredEvidenceKindsForGoal(goal);
  if (!kinds.length) return [{ criterionId: "goal-observed", description: "The original user goal is satisfied by verified host evidence." }];
  return kinds.map((kind) => ({
    criterionId: `goal-${kind}`,
    description: kind === "visual" ? "Rendered-frame evidence satisfies the visual user requirements." : "Sampled motion evidence satisfies timing and continuity requirements.",
    requiredEvidenceKind: kind,
  }));
}
