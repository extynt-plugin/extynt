// Turns the arguments of an ae_workflow_complete call into the completion proposal the reducer judges: declared criterion ids and evidence references.
import { decode, fallback, literal, map, object, skippingInvalid, string, taggedUnion } from "@extynt/decode";
import type { Decoder, Infer } from "@extynt/decode";
import type { WorkflowCompletionProposal, WorkflowCriterionEvidence } from "@extynt/workflow";
import type { ToolArguments } from "./agent-types.js";
import type { SidecarState } from "./server-state.js";

interface CompletionCriterion { readonly criterionId: string; readonly description: string }

const MAX_ENTRIES = 64;

const reference = taggedUnion("kind", {
  observation: object({ kind: literal("observation"), evidenceId: string() }),
  batch_receipt: object({ kind: literal("batch_receipt"), batchId: string(), receiptId: string() }),
});
const evidenceEntry = object({ criterionId: string(), reference });

function lenientList<T>(entry: Decoder<T>): Decoder<readonly T[] | undefined> {
  return fallback(skippingInvalid(entry, MAX_ENTRIES), undefined);
}

const goalDigest: Decoder<string> = map(fallback(string(), ""), (text) => text.slice(0, MAX_ENTRIES));
const proposalArguments = object({ criterionIds: lenientList(string()), goalDigest, evidence: lenientList(evidenceEntry) });

function normalizedCriterionId(value: string, declared: readonly CompletionCriterion[]): string | null {
  const exact = declared.find((criterion) => criterion.criterionId === value);
  if (exact) return exact.criterionId;
  const rendered = declared.find((criterion) => value === `job:${criterion.criterionId}:${criterion.description}`);
  return rendered?.criterionId ?? null;
}

function declaredIds(ids: readonly string[], declared: readonly CompletionCriterion[]): string[] {
  return ids.flatMap((id) => {
    const normalized = normalizedCriterionId(id, declared);
    return normalized ? [normalized] : [];
  });
}

function evidenceOf(deps: { readonly state: Pick<SidecarState, "now"> }, entries: readonly Infer<typeof evidenceEntry>[], declared: readonly CompletionCriterion[]): WorkflowCriterionEvidence[] {
  return entries.flatMap((entry): WorkflowCriterionEvidence[] => {
    const criterionId = normalizedCriterionId(entry.criterionId, declared);
    return criterionId ? [{ criterionId, reference: entry.reference, satisfiedAt: deps.state.now().toISOString() }] : [];
  });
}

/** Builds the completion proposal for the job seeded by `seed` from the model's call arguments: criterion ids and evidence the job declared (a criterion rendered as job:id:description is accepted exactly, never loosened), at most 64 of each; every declared criterion when the call names none. */
export function completionProposalFor(deps: { readonly state: Pick<SidecarState, "now"> }, coordinator: NonNullable<SidecarState["workflowCoordinator"]>, seed: string, args: ToolArguments): { jobId: string; criteria: string[]; proposal: WorkflowCompletionProposal } {
  const jobId = coordinator.jobIdForSeed(seed);
  const declared = coordinator.workflowStore.getState().jobs[jobId]?.successCriteria ?? [];
  const parsed = decode(proposalArguments, args);
  const given = parsed.ok ? parsed.value : { criterionIds: undefined, goalDigest: "", evidence: undefined };
  const criteria = given.criterionIds ? declaredIds(given.criterionIds, declared) : declared.map((criterion) => criterion.criterionId);
  return { jobId, criteria, proposal: { goalDigest: given.goalDigest, criterionIds: criteria, evidence: evidenceOf(deps, given.evidence ?? [], declared) } };
}
