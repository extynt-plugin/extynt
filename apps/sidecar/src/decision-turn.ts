// The question-answered decision for a first cycle: the state it reads, the prime that asks a model once, and the synchronous read of the booked answer.
import { QUESTION_ANSWERED, type FirstCycle } from "@extynt/decide";
import { WORKFLOW_STAGE_TOOL, type AgentRunResult } from "./agent.js";
import { bookYesNo, bookedYesNo } from "./decision-book.js";
import type { DecisionSite } from "./decision-log.js";
import type { DecisionService } from "./decision-service.js";

const QUEUE_AUTHORING_TOOLS: ReadonlySet<string> = new Set(["ae_queue_add", "ae_queue_fix", "ae_queue_design", "ae_queue_finish", "ae_plan_add", "ae_plan_complete", "ae_propose_plan"]);

const entryOf = (state: FirstCycle) => ({ decision: QUESTION_ANSWERED.name, text: JSON.stringify(state) });

/** What the question-answered decision reads for a cycle: its words, whether it asked, and whether it authored work. */
export function firstCycleOf(current: AgentRunResult, cycle: number, continuation: boolean): FirstCycle {
  const authoredWork = current.tools.some((tool) => tool.ok && (tool.name === WORKFLOW_STAGE_TOOL || QUEUE_AUTHORING_TOOLS.has(tool.name)));
  return { answer: current.answer, askedUser: !!current.askedUser, cycle, continuation, authoredWork };
}

/** Whether the first cycle answered the user: the booked model answer when one was given, otherwise the deterministic rule. */
export function questionAnswered(state: FirstCycle): boolean {
  return bookedYesNo(entryOf(state)) ?? QUESTION_ANSWERED.deterministic(state);
}

/** Asks the models once whether an unsealed first cycle answered the user, and books what a model said. */
export async function primeQuestionAnswered(service: DecisionService, state: FirstCycle, site: DecisionSite = { moment: "question-answered", jobId: null }): Promise<void> {
  if (!service.hasModels() || state.cycle !== 0 || state.continuation) return;
  const answered = await service.settleBinary(QUESTION_ANSWERED, state, site);
  if (answered !== QUESTION_ANSWERED.deterministic(state)) bookYesNo(entryOf(state), answered);
}

/** Primes the question-answered decision for a cycle that ended unsealed and unfailed; any other cycle asks nothing. */
export async function primeCycleEnd(service: DecisionService, current: AgentRunResult | undefined, cycle: { readonly index: number; readonly continued: boolean; readonly jobId: string | null }): Promise<void> {
  if (current && !current.sealed && !current.failure) await primeQuestionAnswered(service, firstCycleOf(current, cycle.index, cycle.continued), { moment: "cycle-end", jobId: cycle.jobId });
}
