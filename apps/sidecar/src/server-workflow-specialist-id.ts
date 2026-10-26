// The two small facts every specialist path needs: which workflow job a turn belongs to, and what the owner is told to do about a specialist whose turn failed.
import type { WorkflowId } from "@extynt/workflow";
import type { ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import type { WorkflowSpecialistRole } from "./workflow-orchestration.js";

/** The workflow job of a turn's seed, or undefined when the turn is not part of a workflow. */
export function specialistWorkflowId(deps: Pick<ChatAgentDeps, "state">, input: Pick<ChatAgentInput, "workflowJobId">): WorkflowId | undefined {
  return input.workflowJobId ? deps.state.workflowCoordinator.jobIdForSeed(input.workflowJobId) : undefined;
}

/** What to do about a failed turn: the reason alone leaves the owner to guess, and a designer asked again for the same drawing fails the same way. */
export function specialistRemedy(role: WorkflowSpecialistRole): string {
  return role === "visual-scene"
    ? "Relaunch it (ae_consult_specialist action launch, role visual-scene) with a bounded instruction: the layers by name, what the failure above complained about, every scattered mark (stars, particles) as one shape under data-scatter and every ring copy as one shape under data-repeat, and no decoration beyond the request. Layers it already built stay and are not built twice."
    : `Send a correction with ae_consult_specialist action=message, role ${role}, or continue without it.`;
}
