// Primes the book for a job: asks the configured decision models the job-open batch once and books the answers a model gave, so the synchronous seams read them; with no model nothing is asked and nothing is booked.
import { FEATURE_IDS, LAYER_STYLE_REQUEST, REQUEST_MISSING, REQUEST_SPECIALISTS, SPECIALIST_ROLES, type AnyCore, type Provenance, withFittedBands } from "@extynt/decide";
import { bookBand, bookLabel, bookYesNo, bookedYesNo } from "./decision-book.js";
import { jobOpenBatch, namedObjectKey, type JobText } from "./decision-job-specs.js";
import { loggedName, type DecisionService } from "./decision-service.js";
import { forgetRequestedFeatures, progressSteps, progressText, requestedFeatures } from "./request-coverage.js";
import { appliedFacts, type AppliedOperation } from "./request-applied.js";

type Settled = AnyCore & Provenance;
type Entry = { readonly decision: string; readonly text: string; readonly item?: string };

const PRIMED = "job-open-primed";

function entryOf(key: string, text: JobText): Entry {
  const decision = loggedName(key);
  const namedPrefix = namedObjectKey("");
  if (key.startsWith(namedPrefix)) return { decision, text: text.request, item: key.slice(namedPrefix.length) };
  if (decision === LAYER_STYLE_REQUEST.name) return { decision, text: `${text.request}\n${text.message}` };
  return { decision, text: text.request };
}

function bookResult(key: string, result: Settled, text: JobText): void {
  if (result.source === "deterministic") return;
  const entry = entryOf(key, text);
  if (result.band !== null) bookBand(entry, result.band);
  if ("labels" in result) for (const id of entry.decision === REQUEST_SPECIALISTS.name ? SPECIALIST_ROLES : FEATURE_IDS) bookYesNo({ ...entry, item: id }, result.labels.has(id));
  else if ("label" in result) bookLabel(entry, result.label);
  else if ("value" in result) bookYesNo(entry, result.value);
}

/** Asks the job-open batch about a request once per distinct text and books what the models answered. */
export async function primeJobOpen(service: DecisionService, text: JobText, jobId: string | null = null): Promise<void> {
  const primed = { decision: PRIMED, text: `${text.request}\n${text.message}` };
  if (!service.hasModels() || bookedYesNo(primed) !== undefined) return;
  const results = await service.decideAll(text, jobOpenBatch(text.request), { moment: "job-open", jobId });
  for (const [key, result] of Object.entries<Settled>(results)) bookResult(key, result, text);
  bookYesNo(primed, true);
  forgetRequestedFeatures(text.request);
}

/** Asks the models once, for the operations executed so far, which asked features are still missing, and books what a model said; the coverage check may then treat a feature a model finds shown as covered. */
export async function primeRequestMissing<Payload>(service: DecisionService, goal: string, applied: readonly AppliedOperation<Payload>[], jobId: string | null = null): Promise<void> {
  const facts = appliedFacts(applied);
  const text = progressText(goal, facts);
  const primed = { decision: "request-missing-primed", text };
  if (!service.hasModels() || requestedFeatures(goal).length === 0 || bookedYesNo(primed) !== undefined) return;
  const { settled } = await service.decideAll({ request: goal, applied: progressSteps(facts) }, { settled: withFittedBands(REQUEST_MISSING) }, { moment: "completion", jobId }, REQUEST_MISSING.name);
  bookYesNo(primed, true);
  if (settled.source === "deterministic") return;
  for (const id of FEATURE_IDS) bookYesNo({ decision: REQUEST_MISSING.name, text, item: id }, settled.labels.has(id));
}
