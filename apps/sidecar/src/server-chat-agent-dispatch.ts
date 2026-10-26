// Dispatches one workflow tool call: the stringified queue arrays and job placeholders resolved first, the specialist consultation, the checklist label, then the design-first split and the batch rollover around the call proper.
import { array, decode, jsonValue, literal, object } from "@extynt/decode";
import { withArrayArg } from "@extynt/mcp-server";
import { WORKFLOW_DESIGN_TOOL, WORKFLOW_SPECIALIST_TOOL } from "./agent.js";
import { runnerIn, type AgentToolCall, type AgentToolRunner, type TurnToolRunner } from "./server-chat-agent-call.js";
import type { AgentToolReply, ChatAgentDeps } from "./server-chat-agent-types.js";
import { rollOverFullBatch, withRolloverNote } from "./server-workflow-batch-rollover.js";
import { checklistJob, checklistNudge } from "./server-workflow-checklist-tools.js";
import { noteQueueLabel, noteQueueRefusal } from "./server-workflow-checklist.js";
import { afterDesignerBatch, designPorts, queueDesignTool } from "./server-workflow-design-build.js";
import { runWithDesignFirst } from "./server-workflow-design-flow.js";
import { resolveJobPlaceholders } from "./server-workflow-job-placeholders.js";
import { queuedWorkflowOperations, supplyWorkflowPlaceholders } from "./server-workflow-queue-boundary.js";
import { recordSeedAction } from "./server-workflow-sidecar-actions.js";
import { designApprovalGate } from "./server-workflow-design-approval.js";
import { consultSpecialistTool, noteOwnerToolCall } from "./server-workflow-specialists.js";

const OWNER_QUEUE_TOOLS: ReadonlySet<string> = new Set(["ae_queue_add", "ae_queue_fix", "ae_queue_finish", "ae_queue_design"]);
const QUEUE_ATTEMPT_TOOLS: ReadonlySet<string> = new Set(["ae_queue_add", "ae_queue_fix", WORKFLOW_DESIGN_TOOL]);
const STAGED_NOTHING = object({ accepted: literal(0), fix: array(jsonValue) });

function refusedAttempt(answer: AgentToolReply): boolean {
  if (!answer.ok) return true;
  const staged = decode(STAGED_NOTHING, answer.data);
  return staged.ok && staged.value.fix.length > 0;
}

function coercedArrayArg(args: AgentToolCall["args"], key: string, shape: string): AgentToolReply | undefined {
  const read = withArrayArg(args, key, shape);
  if ("ok" in read) return read;
  if (read.args[key] !== args[key]) Reflect.set(args, key, read.args[key]);
  return undefined;
}

function stringifiedQueueArray({ name, args }: AgentToolCall): AgentToolReply | undefined {
  if (name === "ae_queue_add") return coercedArrayArg(args, "operations", "operation objects");
  if (name === "ae_queue_fix") return coercedArrayArg(args, "edits", "{op, index, operation} objects");
  return undefined;
}

function heldCall(deps: ChatAgentDeps, call: AgentToolCall): AgentToolReply | undefined {
  return call.state.designer ? undefined : designApprovalGate(deps, call, call.input);
}

function interceptedCall(deps: ChatAgentDeps, call: AgentToolCall, tools: TurnToolRunner): AgentToolReply | Promise<AgentToolReply> | undefined {
  const { name, args, input, state } = call;
  const early = stringifiedQueueArray(call) ?? resolveJobPlaceholders(deps, { name, args, input });
  if (early) return early;
  if (name === WORKFLOW_SPECIALIST_TOOL) return consultSpecialistTool(deps, input, args, tools);
  if (!state.designer) noteOwnerToolCall(input);
  return checklistNudge(deps, input, name);
}

async function dispatchLabelled(deps: ChatAgentDeps, call: AgentToolCall, tools: TurnToolRunner, preflighted: () => Promise<AgentToolReply>): Promise<AgentToolReply> {
  const { name, args, input, state } = call;
  const run: AgentToolRunner = runnerIn(tools, state);
  if (!state.designer && OWNER_QUEUE_TOOLS.has(name)) await afterDesignerBatch(deps, input);
  if (name === WORKFLOW_DESIGN_TOOL) {
    Reflect.deleteProperty(args, "stage");
    return queueDesignTool(deps, input, args, designPorts(deps, state, run));
  }
  if (input.workflowJobId && name === "ae_queue_add") supplyWorkflowPlaceholders(args, input.requestId, queuedWorkflowOperations(deps));
  const rolled = await rollOverFullBatch(deps, { name, args, input }, run);
  if (rolled.note) recordSeedAction(deps.state, input.workflowJobId, rolled.note);
  if (rolled.answer) return rolled.answer;
  return withRolloverNote(await runWithDesignFirst(deps, call, run, preflighted), rolled.note);
}

/** One workflow tool call with the design-first split, release and gates; withSelfSeal sits around it and `preflighted` runs the call proper. A stringified operations or edits array is read before any workflow gate looks at it. The queue tools are labelled with the checklist items they name: ae_queue_add and ae_queue_fix in the workflow preflight, after a rollover seal has closed the previous batch, and the design tool here. A queue attempt that is refused, by an error or by a fix list that staged nothing, counts as an attempt for those items. */
export async function dispatchAgentTool(deps: ChatAgentDeps, call: AgentToolCall, tools: TurnToolRunner, preflighted: () => Promise<AgentToolReply>): Promise<AgentToolReply> {
  const early = heldCall(deps, call) ?? interceptedCall(deps, call, tools);
  if (early) return early;
  const labelled = checklistJob(deps, call.input);
  if (labelled && call.name === WORKFLOW_DESIGN_TOOL) noteQueueLabel(deps.state, labelled, call.args);
  const answer = await dispatchLabelled(deps, call, tools, preflighted);
  if (labelled && QUEUE_ATTEMPT_TOOLS.has(call.name) && refusedAttempt(answer)) noteQueueRefusal(deps.state, labelled, {});
  return answer;
}
