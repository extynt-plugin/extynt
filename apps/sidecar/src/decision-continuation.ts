// The continuation decision for a message sent to a stopped job: asks a model once and books a "resume" answer so the synchronous ownership check reads it.
import { CONTINUATION, isContinuationPhrase, withFittedBands } from "@extynt/decide";
import { bookLabel } from "./decision-book.js";
import type { DecisionService } from "./decision-service.js";

/** Asks the models once whether a message means "carry on as it was"; a phrase the deterministic rule knows is not asked, and with no model nothing is. */
export async function primeContinuation(service: DecisionService, message: string, jobId: string | null = null): Promise<void> {
  if (!service.hasModels() || isContinuationPhrase(message)) return;
  const { settled } = await service.decideAll({ message }, { settled: withFittedBands(CONTINUATION) }, { moment: "continuation", jobId }, CONTINUATION.name);
  if (settled.source !== "deterministic") bookLabel({ decision: CONTINUATION.name, text: message }, settled.label);
}
