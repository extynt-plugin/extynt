// The reviewer's pre-screen: asks the decision models whether the covered work's receipts alone prove it, and leaves the picture-reading review out only when a model says so with confidence.
import { REVIEW_PROVEN, withFittedBands, type ReviewScreenCase } from "@extynt/decide";
import type { DecisionService } from "./decision-service.js";

interface ReviewScreenInput {
  readonly goal: string;
  readonly specs: ReadonlyArray<string>;
  readonly batchIds: ReadonlyArray<string>;
}

interface ReceiptState {
  readonly batches: Readonly<Record<string, { readonly operationIds: ReadonlyArray<string> } | undefined>>;
  readonly operations: Readonly<Record<string, { readonly type: string; readonly outcome?: string | null } | undefined>>;
}

const EXACT: ReadonlySet<string> = new Set(["confirmed", "host_confirmed"]);

const APPROXIMATE: ReadonlySet<string> = new Set(["coerced_equivalent"]);

/** The pre-screen's state for the covered batches: how their operations were confirmed and which kinds they were. */
export function screenCase(state: ReceiptState, input: ReviewScreenInput): ReviewScreenCase {
  const operations = input.batchIds.flatMap((batchId) => (state.batches[batchId]?.operationIds ?? []).flatMap((id) => state.operations[id] ?? []));
  const outcomes = operations.map((operation) => operation.outcome ?? "unknown");
  return {
    goal: input.goal,
    specs: input.specs,
    batches: input.batchIds.length,
    exact: outcomes.filter((outcome) => EXACT.has(outcome)).length,
    approximate: outcomes.filter((outcome) => APPROXIMATE.has(outcome)).length,
    unconfirmed: outcomes.filter((outcome) => !EXACT.has(outcome) && !APPROXIMATE.has(outcome)).length,
    operations: [...new Set(operations.map((operation) => operation.type))],
  };
}

/** Whether a decision model, in the act band, says the receipts prove the covered work; with no model, or any doubt, the answer is no and the review runs. */
export async function receiptsProveReview(service: DecisionService, screen: ReviewScreenCase, jobId: string | null = null): Promise<boolean> {
  if (!service.hasModels() || screen.exact === 0 || screen.approximate > 0 || screen.unconfirmed > 0) return false;
  const { settled } = await service.decideAll(screen, { settled: withFittedBands(REVIEW_PROVEN) }, { moment: "review", jobId }, REVIEW_PROVEN.name);
  return settled.source !== "deterministic" && settled.band === "act" && settled.value;
}
