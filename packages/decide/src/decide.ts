// The resolver: takes a set of decisions over one state and settles each with the best tier that answers it.
import { abstains, deterministicCore } from "./deterministic.js";
import { interpret } from "./interpret.js";
import type { JsonValue } from "./json.js";
import { planFor } from "./plan.js";
import type { Plan } from "./plan.js";
import type { DecisionImage, DecisionModel, DecisionOutcome } from "./port.js";
import type { AnyCore, Band, Decisions, Fallback, Provenance, ResultOf, ResultsOf } from "./result.js";
import { route } from "./route.js";
import { vetoFor } from "./veto.js";
import type { AnySpec, Bands } from "./spec.js";

/** How long a purpose-built decision model gets for one batch before the decision falls back; a latency guard, not a workflow cap. */
export const DEFAULT_DECISION_TIMEOUT_MS = 4_000;

/** How long the user's own language model gets for one batch. */
export const DEFAULT_MODEL_TIMEOUT_MS = 30_000;

/** What resolution may use; with no models every decision is answered offline and nothing touches the network. `signal` cancels every request still waiting. `image` is the frame the questions that want one may look at: it goes only to a provider that accepts images, in the one call that provider gets. */
export interface DecideOptions {
  readonly models?: ReadonlyArray<DecisionModel>;
  readonly decisionTimeoutMs?: number;
  readonly modelTimeoutMs?: number;
  readonly timeoutSignal?: (milliseconds: number) => AbortSignal;
  readonly signal?: AbortSignal;
  readonly image?: DecisionImage;
  readonly onCall?: (call: CallUsage) => void;
}

/** What one answered model call used: its provider, the model it reported, and the input tokens it billed (null when it reported none). It is sent once per answered call, whether or not that call's answers were kept, so a call's tokens are never repeated across its answers. */
export interface CallUsage {
  readonly provider: string;
  readonly model: string | null;
  readonly inputTokens: number | null;
}

interface Entry<S extends JsonValue> {
  readonly spec: AnySpec<S>;
  readonly fallback: Fallback | null;
}

type Pending<S extends JsonValue> = ReadonlyMap<string, Entry<S>>;
type AnyResult = AnyCore & Provenance;

interface Asked {
  readonly outcome: DecisionOutcome;
  readonly imageSent: boolean;
}

interface Stage<S extends JsonValue> {
  readonly settled: ReadonlyMap<string, AnyResult>;
  readonly pending: Pending<S>;
}

function bandsOf(spec: AnySpec<JsonValue>, model: DecisionModel): Bands {
  const single = spec.threshold ?? model.threshold;
  return model.bands ?? spec.bands ?? { verify: single, act: single };
}

function bandOfFallback(fallback: Fallback | null): Band | null {
  if (fallback === null) return null;
  if (fallback.reason === "low-confidence") return "escalate";
  return fallback.reason === "disagreement" ? "verify" : null;
}

function admits(model: DecisionModel, spec: AnySpec<JsonValue>, admitAll: boolean): boolean {
  if (spec.deterministicOnly === true) return false;
  if (spec.needsImage === true) return true;
  if (model.imageOnly === true) return false;
  return model.tier !== "model" || spec.useModel === true || admitAll;
}

function plansFor<S extends JsonValue>(model: DecisionModel, pending: Pending<S>, admitAll: boolean): ReadonlyArray<Plan<S>> {
  const plans: Plan<S>[] = [];
  for (const [key, entry] of pending) {
    if (!admits(model, entry.spec, admitAll)) continue;
    const plan = planFor(key, entry.spec, model.supports);
    if (plan !== null) plans.push(plan);
  }
  return plans;
}

function signalFor(model: DecisionModel, options: DecideOptions): AbortSignal {
  const milliseconds = model.tier === "model"
    ? options.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS
    : options.decisionTimeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS;
  const timeout = (options.timeoutSignal ?? AbortSignal.timeout)(milliseconds);
  return options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);
}

function imageFor<S extends JsonValue>(model: DecisionModel, plans: ReadonlyArray<Plan<S>>, options: DecideOptions): DecisionImage | undefined {
  if (options.image === undefined || model.acceptsImages !== true) return undefined;
  return plans.some((plan) => plan.spec.wantsImage === true) ? options.image : undefined;
}

async function ask<S extends JsonValue>(model: DecisionModel, state: S, plans: ReadonlyArray<Plan<S>>, options: DecideOptions): Promise<Asked> {
  const signal = signalFor(model, options);
  const image = imageFor(model, plans, options);
  try {
    const outcome = await model.decide(state, plans.flatMap((plan) => plan.questions), signal, ...(image === undefined ? [] : [image]));
    if (outcome.ok) options.onCall?.({ provider: model.id, model: outcome.usage.model, inputTokens: outcome.usage.inputTokens });
    return { outcome, imageSent: image !== undefined };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The decision model threw.";
    return { outcome: { ok: false, failure: { reason: signal.aborted ? "timeout" : "unavailable", detail } }, imageSent: image !== undefined };
  }
}

function settle<S extends JsonValue>(model: DecisionModel, plan: Plan<S>, state: S, asked: Asked): AnyResult | Fallback {
  const { outcome, imageSent } = asked;
  if (!outcome.ok) return { provider: model.id, ...outcome.failure };
  const interpreted = interpret(plan, outcome.answers);
  if (!interpreted.ok) return { provider: model.id, ...interpreted.failure };
  const { spec } = plan;
  const deterministic = deterministicCore(spec, state);
  const vetoed = vetoFor(spec, deterministic, interpreted.core);
  if (vetoed !== null) return { provider: model.id, ...vetoed };
  const routed = route({
    model: interpreted.core,
    deterministic,
    deterministicAbstained: abstains(spec, deterministic),
    bands: bandsOf(spec, model),
    high: spec.stakes === "high",
    preference: spec.kind === "choice" ? spec.preference : undefined,
    guarded: spec.kind === "choice" ? spec.guarded : undefined,
  });
  if (!routed.ok) return { provider: model.id, ...routed.failure };
  const { usage } = outcome;
  return { ...routed.core, source: model.tier, provider: model.id, calibrated: model.calibrated, model: usage.model, inputTokens: usage.inputTokens, imageSent, band: routed.band, abstained: false, fallback: null };
}

function isFallback(outcome: AnyResult | Fallback): outcome is Fallback {
  return "reason" in outcome;
}

interface Scope {
  readonly options: DecideOptions;
  readonly admitAll: boolean;
}

function canSeeImage(model: DecisionModel, options: DecideOptions): boolean {
  return options.image !== undefined && model.acceptsImages === true;
}

function withholdImageQuestions<S extends JsonValue>(model: DecisionModel, pending: Pending<S>, options: DecideOptions): { readonly askable: Pending<S>; readonly withheld: Pending<S> } {
  if (canSeeImage(model, options)) return { askable: pending, withheld: new Map() };
  const detail = options.image === undefined ? "The question reads a frame and none was given." : "The question reads a frame and this provider does not accept images.";
  const askable = new Map<string, Entry<S>>();
  const withheld = new Map<string, Entry<S>>();
  for (const [key, entry] of pending) {
    if (entry.spec.needsImage === true) withheld.set(key, { spec: entry.spec, fallback: entry.fallback ?? { provider: model.id, reason: "image-unavailable", detail } });
    else askable.set(key, entry);
  }
  return { askable, withheld };
}

async function consult<S extends JsonValue>(model: DecisionModel, state: S, all: Pending<S>, scope: Scope): Promise<Stage<S>> {
  const { options } = scope;
  const { askable: pending, withheld } = withholdImageQuestions(model, all, options);
  const plans = plansFor(model, pending, scope.admitAll);
  if (plans.length === 0) return { settled: new Map(), pending: new Map([...pending, ...withheld]) };
  const asked = await ask(model, state, plans, options);
  const settled = new Map<string, AnyResult>();
  const remaining = new Map([...pending, ...withheld]);
  for (const plan of plans) {
    const verdict = settle(model, plan, state, asked);
    if (isFallback(verdict)) remaining.set(plan.key, { spec: plan.spec, fallback: verdict });
    else settled.set(plan.key, { ...verdict, fallback: remaining.get(plan.key)?.fallback ?? null });
    if (!isFallback(verdict)) remaining.delete(plan.key);
  }
  return { settled, pending: remaining };
}

function offline<S extends JsonValue>(entry: Entry<S>, state: S): AnyResult {
  const core = deterministicCore(entry.spec, state);
  const abstained = abstains(entry.spec, core);
  const band = abstained ? "escalate" : bandOfFallback(entry.fallback);
  return { ...core, source: "deterministic", provider: null, calibrated: null, model: null, inputTokens: null, imageSent: false, band, abstained, fallback: entry.fallback };
}

function isUnsure<S extends JsonValue>(entry: Entry<S>, state: S): boolean {
  return entry.spec.stakes === "high" && entry.spec.useModel !== true && abstains(entry.spec, deterministicCore(entry.spec, state));
}

async function retryUnsure<S extends JsonValue>(state: S, pending: Pending<S>, models: ReadonlyArray<DecisionModel>, options: DecideOptions): Promise<Stage<S>> {
  const settled = new Map<string, AnyResult>();
  let left: Pending<S> = new Map([...pending].filter(([, entry]) => isUnsure(entry, state)));
  const rest = new Map([...pending].filter(([key]) => !left.has(key)));
  for (const model of models.filter((candidate) => candidate.tier === "model")) {
    if (left.size === 0) break;
    const stage = await consult(model, state, left, { options, admitAll: true });
    for (const [key, result] of stage.settled) settled.set(key, result);
    left = stage.pending;
  }
  return { settled, pending: new Map([...rest, ...left]) };
}

function tierOrder(models: ReadonlyArray<DecisionModel>): ReadonlyArray<DecisionModel> {
  return [...models.filter((model) => model.tier === "decision-model"), ...models.filter((model) => model.tier === "model")];
}

/** Settles every decision over one state: one batched request per provider, then the next tier for what is left, then the deterministic function. */
export function decideAll<S extends JsonValue, const D extends Decisions<S>>(state: S, decisions: D, options?: DecideOptions): Promise<ResultsOf<D>>;
export async function decideAll<S extends JsonValue>(state: S, decisions: Decisions<S>, options: DecideOptions = {}): Promise<Readonly<Record<string, AnyResult>>> {
  let pending: Pending<S> = new Map(Object.entries(decisions).map(([key, spec]) => [key, { spec, fallback: null }]));
  const settled = new Map<string, AnyResult>();
  for (const model of tierOrder(options.models ?? [])) {
    const stage = await consult(model, state, pending, { options, admitAll: false });
    for (const [key, result] of stage.settled) settled.set(key, result);
    pending = stage.pending;
  }
  const retried = await retryUnsure(state, pending, options.models ?? [], options);
  for (const [key, result] of retried.settled) settled.set(key, result);
  pending = retried.pending;
  const results: Record<string, AnyResult> = Object.fromEntries(settled);
  for (const [key, entry] of pending) results[key] = offline(entry, state);
  return results;
}

/** Settles one decision; the same tiers as `decideAll`, for the case where there is only one question. */
export async function decide<S extends JsonValue, const X extends AnySpec<S>>(state: S, spec: X, options: DecideOptions = {}): Promise<ResultOf<X>> {
  const results = await decideAll(state, { only: spec }, options);
  return results.only;
}
