// What a queue call answers: a resent group, a refused call, an accepted group with its checkpoint, a partly staged call, and the plan no operation can follow.
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { OperationVerdict } from "./batch.js";
import { verdictFix } from "./batch.js";
import { fixEntries } from "./batch-fix-entries.js";
import type { StoredPlan, ToolContext } from "./contracts.js";
import { jsonOf, objectOf } from "./json.js";
import { planOperationCount } from "./plan-coherence.js";
import { standingProblems } from "./plan-complete.js";
import type { PartialOutcome } from "./queue-partial.js";
import type { QueuedGroup } from "./queue-state.js";
import { positionRuns } from "./queue-words.js";
import { toolSuccess } from "./tool-result.js";
import type { ToolBase, ToolFailure, ToolResult } from "./tool-result.js";

/** Operations queued between two checkpoint re-reads of the whole queue. */
export const QUEUE_CHECKPOINT_SIZE = 6;

const NEXT_OPERATIONS = "Carry on with the next operations, or ae_queue_finish when the work is whole.";

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function ascending(positions: readonly number[]): number[] {
  return [...positions].sort((left, right) => left - right);
}

/** The answer to a group sent again: nothing is queued twice. */
export function duplicateAnswer(base: ToolBase, prior: QueuedGroup): ToolResult {
  if (prior.resend) return toolSuccess(base, { queued: prior.queued, accepted: prior.accepted, duplicate: true, next: `That whole call was already sent and part of it is queued — sending it again changes nothing. ${prior.resend}` });
  return toolSuccess(base, {
    queued: prior.queued,
    accepted: prior.accepted,
    corrected: prior.corrected,
    duplicate: true,
    next: `Already queued — that exact group is in the queue once, from the earlier call whose result did not come back. Nothing was queued twice. ${NEXT_OPERATIONS}`,
  });
}

/** A failure raised while staging, with the sentence that nothing from the call was queued. */
export function atomicFailure(failure: ToolFailure): ToolFailure {
  return { ok: false, error: { ...failure.error, message: `${failure.error.message} Nothing from this call was queued; correct it and resend the whole call.` } };
}

interface RefusalFacts {
  readonly chunked: boolean;
  readonly failedFrom: number;
  readonly failedChunk: number;
  readonly after: number;
  readonly total: number;
}

function refusalPositions(verdicts: readonly OperationVerdict[], facts: RefusalFacts) {
  const fix = fixEntries(verdicts);
  const refused = ascending(fix.flatMap((entry) => entry.positions));
  const consequential = ascending(fix.flatMap((entry) => (entry.consequences ?? []).flatMap((consequence) => consequence.positions)));
  const chunk = Array.from({ length: facts.failedChunk }, (_, step) => facts.failedFrom + step);
  const unstaged = chunk.filter((position) => !refused.includes(position) && !consequential.includes(position));
  return { refused, consequential, unstaged, fix };
}

function refusedClause(refused: readonly number[], consequential: readonly number[]): string {
  const one = refused.length === 1;
  const follows = consequential.length === 1;
  const consequences = consequential.length
    ? `, together with the ${follows ? "operation" : "operations"} that follow${follows ? "s" : ""} from ${one ? "it" : "them"} (position${follows ? "" : "s"} ${positionRuns(consequential)} — consequences, not separate fixes)`
    : "";
  return `${one ? "Position" : "Positions"} ${positionRuns(refused)} ${one ? "was" : "were"} refused${consequences}`;
}

function stagedClause(chunked: boolean, unstaged: readonly number[]): string {
  const whole = chunked ? "a chunk is staged whole or not at all" : "a call containing a refused operation stages nothing";
  const count = unstaged.length;
  const others = count
    ? `: the other ${count} ${plural(count, "operation", "operations")} in it (${plural(count, "position", "positions")} ${positionRuns(unstaged)}) ${plural(count, "was", "were")} validated and accepted but ${plural(count, "is", "are")} not queued either`
    : "";
  return `${whole}${others}.`;
}

function stoppedClause(range: { from: number; to: number } | undefined): string {
  return range ? `Positions ${range.from}–${range.to} were not validated: validation stops at the first failed chunk, because a later chunk would be judged against objects an earlier one never created.` : "";
}

/** The answer to a call that stages nothing because some operation was refused. */
export function refusalAnswer(base: ToolBase, verdicts: readonly OperationVerdict[], facts: RefusalFacts): ToolResult {
  const { refused, consequential, unstaged, fix } = refusalPositions(verdicts, facts);
  const failedTo = facts.failedFrom + facts.failedChunk - 1;
  const notValidated = failedTo < facts.total - 1 ? { from: failedTo + 1, to: facts.total - 1 } : undefined;
  const held = `Nothing from that call was queued; the queue still holds ${facts.after} ${plural(facts.after, "operation", "operations")}.`;
  const staged = `${refusedClause(refused, consequential)}, and ${stagedClause(facts.chunked, unstaged)}`;
  const repair = `Correct ${plural(refused.length, "it", "them")} and send the whole call again, with the fix applied.`;
  return toolSuccess(base, objectOf({
    queued: facts.after,
    accepted: 0,
    fix: jsonOf(fix),
    notValidated,
    next: [held, staged, stoppedClause(notValidated), repair].filter(Boolean).join(" "),
  }));
}

interface AcceptedFacts {
  readonly record: StoredPlan | undefined;
  readonly planId: string;
  readonly before: number;
  readonly after: number;
  readonly signature: string;
  readonly corrected: number;
  readonly notes: readonly string[];
}

type Outstanding = { index: number; type: string; code: string; message: string; instruction: string };

function outstandingProblems(facts: AcceptedFacts, snapshot: ProjectSnapshot, context: ToolContext): Outstanding[] {
  const held = context.plans?.get(facts.planId);
  return (held ? standingProblems(held, snapshot, context) : []).map((problem) => ({
    index: problem.index,
    type: problem.type,
    code: problem.code,
    message: problem.message,
    instruction: verdictFix(problem.code),
  }));
}

function checkpointSentence(after: number, outstanding: readonly Outstanding[]): string {
  const count = outstanding.length;
  if (!count) return `Checkpoint: I re-read all ${after} operations queued so far and nothing is outstanding. Carry on with the next operations; nothing is applied until you finish.`;
  const indexes = outstanding.map((entry) => entry.index).join(", ");
  return `Checkpoint: I re-read the ${after} operations queued so far and ${count === 1 ? "one is" : `${count} are`} outstanding — ${plural(count, "index", "indexes")} ${indexes}, above. Nothing else in the queue is a problem. Change ${plural(count, "that one", "those")} with ae_queue_fix, which takes them by queue index, then carry on. Nothing is applied until you finish.`;
}

/** The answer to a group that was staged, with a checkpoint review when the queue crossed a multiple of the checkpoint size. */
export function acceptedAnswer(base: ToolBase, facts: AcceptedFacts, snapshot: ProjectSnapshot, context: ToolContext): ToolResult {
  const count = facts.after - facts.before;
  if (facts.record) facts.record.lastQueuedGroup = { signature: facts.signature, queued: facts.after, accepted: count, corrected: facts.corrected };
  const notes = facts.notes.length ? [...facts.notes] : undefined;
  const reviewed = Math.floor(facts.after / QUEUE_CHECKPOINT_SIZE) * QUEUE_CHECKPOINT_SIZE;
  if (reviewed <= Math.floor(facts.before / QUEUE_CHECKPOINT_SIZE) * QUEUE_CHECKPOINT_SIZE) {
    return toolSuccess(base, objectOf({ queued: facts.after, accepted: count, corrected: facts.corrected, notes, next: `Accepted — ${count} ${plural(count, "operation", "operations")} queued and validated, ${facts.after} in the queue. ${NEXT_OPERATIONS}` }));
  }
  const outstanding = outstandingProblems(facts, snapshot, context);
  return toolSuccess(base, objectOf({
    queued: facts.after,
    accepted: count,
    corrected: facts.corrected,
    notes,
    checkpoint: { reviewed, queued: facts.after, outstanding: jsonOf(outstanding) },
    next: checkpointSentence(facts.after, outstanding),
  }));
}

interface PartialFacts {
  readonly planId: string;
  readonly before: number;
  readonly total: number;
  readonly signature: string;
  readonly notes: readonly string[];
}

function resendSentence({ staged, total, after }: { readonly staged: number; readonly total: number; readonly after: number }, roots: readonly number[], followers: readonly number[]): string {
  const resend = new Set([...roots, ...followers]).size;
  const many = roots.length !== 1;
  const dependents = followers.length ? ` (and their dependents ${positionRuns(followers)}, which follow from ${many ? "them" : "it"} and were held back)` : "";
  return `${staged} of ${total} operations staged (${after} in the queue); ${resend} not. Resend ONLY position${many ? "s" : ""} ${positionRuns(roots)}${dependents}, corrected, in one ae_queue_add call in that order — do not resend the other ${staged}: they are already queued, and sending the whole call again would queue them twice. Positions are indexes in the call you sent.`;
}

/** The answer to a call whose independent operations were staged and whose refused ones, with their dependents, must be sent again. */
export function partialAnswer(base: ToolBase, outcome: PartialOutcome, facts: PartialFacts, context: ToolContext): ToolResult {
  const record = context.plans?.get(facts.planId);
  const after = record ? planOperationCount(record) : facts.before;
  const fix = fixEntries(outcome.refused);
  const roots = ascending(fix.flatMap((entry) => entry.positions));
  const consequential = fix.flatMap((entry) => (entry.consequences ?? []).flatMap((consequence) => consequence.positions));
  const followers = ascending([...new Set([...consequential, ...outcome.dependents])]);
  const staged = outcome.kept.length;
  const corrected = outcome.stage.verdicts.filter((verdict) => verdict.status === "accepted_modified").length;
  const next = resendSentence({ staged, total: facts.total, after }, roots, followers);
  if (record) record.lastQueuedGroup = { signature: facts.signature, queued: after, accepted: staged, corrected, resend: next };
  const notes = [...outcome.stage.notes, ...facts.notes];
  return toolSuccess(base, objectOf({
    queued: after,
    accepted: staged,
    corrected: corrected || undefined,
    fix: jsonOf(fix),
    resend: ascending([...new Set([...roots, ...followers])]),
    dependents: outcome.dependents.length ? outcome.dependents : undefined,
    notes: notes.length ? notes : undefined,
    next,
  }));
}
