/** A plan the sidecar no longer holds because of a restart or a new After Effects session: asking about it says why, never a bare "not found". */
import type { ToolContext } from "./contracts.js";

export interface LostPlanNote {
  planId: string;
  code: string;
  message: string;
  summary: string;
  at: string;
  cancelled: boolean;
}

/** What the sidecar remembers about plans it let go; the sidecar owns it like `plans`. */
export interface LostPlans {
  find(planId: string): LostPlanNote | undefined;
  cancelled(limit: number): LostPlanNote[];
}

/** The refusal for a plan id this session does not hold: the recorded reason when there is one. */
export function planNotHeld(planId: string, context: ToolContext): { ok: false; error: { code: string; message: string } } {
  const lost = planId ? context.lostPlans?.find(planId) : undefined;
  if (lost) return { ok: false, error: { code: lost.code, message: lost.message } };
  return { ok: false, error: { code: "PLAN_NOT_FOUND", message: "The plan is not available in this panel session." } };
}
