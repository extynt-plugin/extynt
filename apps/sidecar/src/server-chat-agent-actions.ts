// Adds the sidecar's own acts to the reply of the tools the model reads them in: the unread ledger lines, and what the checklist stands at.
import { replyPayload } from "./server-chat-agent-reply.js";
import type { AgentToolReply, ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { withChecklistStatus } from "./server-workflow-checklist-tools.js";
import { drainSeedActions, noteSeedLooked } from "./server-workflow-sidecar-actions.js";

const LEDGER_REPLY_TOOLS: ReadonlySet<string> = new Set(["ae_queue_add", "ae_queue_fix", "ae_queue_design", "ae_queue_finish"]);
const MODEL_LOOK_TOOLS: ReadonlySet<string> = new Set(["ae_observe_frame", "ae_capture_composition_frame", "ae_get_capture_frame", "ae_inspect_composition", "ae_inspect_layer", "ae_measure_layer", "ae_refresh_snapshot"]);

/** A tool reply as the model reads it after the sidecar acted for it. A model-run look at the project means sidecar seals before it no longer count toward a recheck; the queue tools carry the unread ledger lines, once, and the checklist status. */
export function withSidecarActions(deps: ChatAgentDeps, input: ChatAgentInput, name: string, reply: AgentToolReply): AgentToolReply {
  if (MODEL_LOOK_TOOLS.has(name)) noteSeedLooked(deps.state, input.workflowJobId);
  const payload = replyPayload(reply);
  if (!LEDGER_REPLY_TOOLS.has(name) || !reply.ok || !payload) return reply;
  const lines = drainSeedActions(deps.state, input.workflowJobId);
  return withChecklistStatus(deps, input, name, lines.length ? { ...reply, data: { ...payload, sidecarActions: lines } } : reply);
}
