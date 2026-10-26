// The ae_ask_user tool: the in-panel workflow owner ends its first cycle with a question, and the user's reply continues the job.
import { planOperationCount, type callTool } from "@extynt/mcp-server";
import { WORKFLOW_ASK_TOOL, type ToolArguments } from "./agent-types.js";
import type { ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { fontQuestionRefusal } from "./server-workflow-font-guard.js";
import { WORKFLOW_OWNER } from "./workflow-orchestration.js";

type AskResult = ReturnType<typeof callTool>;

const QUESTION_LIMIT = 2000;

function refusal(code: string, message: string): AskResult {
  return { ok: false, error: { code, message } };
}

function isWorkflowOwner(input: ChatAgentInput): boolean {
  return !!(input.workflowJobId && input.workflowRole === WORKFLOW_OWNER);
}

function queuedOperationCount(deps: Pick<ChatAgentDeps, "state">): number {
  const planId = deps.state.openQueuePlanId;
  const open = planId ? deps.state.plans.get(planId) : undefined;
  return open ? planOperationCount(open) : 0;
}

function askRefusal(deps: Pick<ChatAgentDeps, "state">, input: ChatAgentInput): AskResult | undefined {
  if (!isWorkflowOwner(input)) return refusal("ASK_UNAVAILABLE", "ae_ask_user is only available to the in-panel workflow owner.");
  if ((input.workflowCycle ?? 0) > 0) return refusal("ASK_NOT_IN_CONTINUATION", "A continuation cycle cannot stop to ask the user: author the next stage from the design and the receipts, or complete the job.");
  const count = queuedOperationCount(deps);
  if (count === 0) return undefined;
  return refusal("ASK_AFTER_QUEUE", `Ask before you queue: this cycle already holds ${count} queued operation(s), and ending the turn now would drop them. Seal them with ae_queue_finish, or remove them with ae_queue_fix, before asking.`);
}

/** Answers an ae_ask_user call: the trimmed question and its kind end the owner's turn, and a refusal says why the owner may not ask now. */
export function askUserTool(deps: Pick<ChatAgentDeps, "state" | "planState">, args: ToolArguments, input: ChatAgentInput): AskResult {
  const refused = askRefusal(deps, input);
  if (refused) return refused;
  const question = typeof args.question === "string" ? args.question.trim() : "";
  if (!question) return refusal("INVALID_ARGUMENT", "ae_ask_user needs a question.");
  const fontRefused = fontQuestionRefusal(deps.state.hostProfile, question, input.message);
  if (fontRefused) return fontRefused;
  const kind = args.kind === "design-brief" ? "design-brief" : "question";
  return {
    ok: true,
    tool: WORKFLOW_ASK_TOOL,
    snapshotFingerprint: deps.planState.normalizedLatest()?.fingerprint ?? null,
    data: { question: question.slice(0, QUESTION_LIMIT), kind, next: "Your turn ends here. The user's reply continues this job." },
  };
}
