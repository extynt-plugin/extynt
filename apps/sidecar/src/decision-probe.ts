// The live test of a decision model: one tiny closed question, answered or refused in a sentence that never carries the key.
import type { DecisionModel, FailureReason } from "@extynt/decide";

const PROBE_TIMEOUT_MS = 15_000;
const MAX_REASON_CHARS = 160;
const SECRET_PLACEHOLDER = "[key]";

/** Whether the model answered the test question, how long it took, or why it could not: the scrubbed words, and the model library's reason when it gave one (the panel words it in its own language). */
export type DecisionProbe =
  | { readonly ok: true; readonly ms: number }
  | { readonly ok: false; readonly reason: string; readonly code: FailureReason | null };

function scrubbed(text: string, secrets: ReadonlyArray<string>): string {
  const clean = secrets.filter((secret) => secret !== "").reduce((rest, secret) => rest.split(secret).join(SECRET_PLACEHOLDER), text);
  return clean.slice(0, MAX_REASON_CHARS);
}

/** Asks the model whether "ok" is a word; every outcome is a value, and any text of a failure has the given secrets replaced. */
export async function probeDecisionModel(model: DecisionModel, secrets: ReadonlyArray<string>, now: () => number = Date.now): Promise<DecisionProbe> {
  const startedAt = now();
  const question = { id: "probe", kind: "binary", instructions: "Is the word in the state a real English word?" } as const;
  try {
    const outcome = await model.decide({ word: "ok" }, [question], AbortSignal.timeout(PROBE_TIMEOUT_MS));
    if (outcome.ok) return { ok: true, ms: now() - startedAt };
    return { ok: false, reason: scrubbed(`${outcome.failure.reason}: ${outcome.failure.detail}`, secrets), code: outcome.failure.reason };
  } catch (error) {
    return { ok: false, reason: scrubbed(error instanceof Error ? error.message : "unreachable", secrets), code: null };
  }
}
