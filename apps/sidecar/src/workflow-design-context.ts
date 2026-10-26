// Tells the evidence rules what a job designed: a launched scene designer or motion designer changes which frames must be checked.

import type { WorkflowId } from "@extynt/workflow";
import type { WorkflowOrchestrationBundle, WorkflowSpecialistRole, WorkflowSpecialistSession } from "./workflow-orchestration.js";

type DesignMaps = {
  readonly workflowOrchestrations: ReadonlyMap<WorkflowId, WorkflowOrchestrationBundle>;
  readonly workflowSpecialistSessions: ReadonlyMap<WorkflowId, ReadonlyMap<WorkflowSpecialistRole, WorkflowSpecialistSession>>;
};

function roleDesigned(maps: DesignMaps, jobId: WorkflowId, role: WorkflowSpecialistRole): boolean {
  if (maps.workflowOrchestrations.get(jobId)?.specialists.some((brief) => brief.role === role)) return true;
  const session = maps.workflowSpecialistSessions.get(jobId)?.get(role);
  return !!session && (session.pending !== undefined || session.brief !== undefined);
}

/** What the job's evidence depends on: a designed scene keeps a frame check, a designed motion keeps sampled frames. A role the model launched counts once it is working or has delivered a brief; failed or never launched roles do not. */
export function jobDesignContext(maps: DesignMaps, jobId: WorkflowId): { readonly designed: boolean; readonly motion: boolean } {
  return { designed: roleDesigned(maps, jobId, "visual-scene"), motion: roleDesigned(maps, jobId, "motion") };
}
