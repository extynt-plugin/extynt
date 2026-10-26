/**
 * ae_offer_variants: the model offers two to four values for ONE static effect control and the user picks.
 *
 * Every number comes from the model; this module only checks them. Each value that is not the control's current value is
 * composed through the same whole-plan composer ae_propose_plan uses (one set_effect_control each: same digest, same
 * validation, same policy), so a candidate is an ordinary approval-required plan and nothing here applies anything.
 */
import type { Infer, JsonObject, JsonValue } from "@extynt/decode";
import { flattenProperties, type CompositionSnapshot, type LayerSnapshot, type ProjectSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import type { ToolBase, ToolFailure, ToolResult } from "./tool-dispatch.js";
import type { ToolContext } from "./contracts.js";
import { PROPOSAL_OPERATION_LIMIT } from "./core-constants.js";
import { now } from "./plan-store.js";
import { toolError } from "./tool-result.js";
import { composeProposal } from "./compose.js";
import { isJsonArray } from "@extynt/decode";
import type { AE_OFFER_VARIANTS } from "./variant-tool-definitions.js";
import { closeVariantSet, pruneVariantSets, type VariantCandidate, type VariantNames, type VariantSet, type VariantTarget, type VariantValue } from "./variant-sets.js";

/** The fewest options a set offers. */
export const MIN_VARIANTS = 2;
/** The most options a set offers. */
export const MAX_VARIANTS = 4;
/** The longest option label, in characters. */
export const MAX_LABEL_CHARS = 40;
/** The longest question line, in characters. */
export const MAX_QUESTION_CHARS = 160;

const MAX_PATH_CHARS = 512;
const MIN_VECTOR_LENGTH = 2;
const MAX_VECTOR_LENGTH = 4;
const FLOAT_NOISE = 1e-9;
const NEXT = "The options are now on the user's screen with a thumbnail each when the panel can make one. Nothing is applied until they pick one, and a pick applies exactly that one like any plan; you cannot apply, approve or re-propose them. Say in a short sentence that the options are shown, then stop.";

type OfferArgs = Infer<typeof AE_OFFER_VARIANTS.input.decoder>;

interface Candidate { readonly label: string; readonly value: VariantValue }
interface Request { readonly target: VariantTarget; readonly candidates: ReadonlyArray<Candidate>; readonly question: string }
interface Observed { readonly property: PropertySnapshot; readonly names: VariantNames }
interface Prepared { readonly request: Request; readonly observed: Observed; readonly current: VariantValue; readonly variants: Map<string, VariantSet> }
interface Composition { readonly base: ToolBase; readonly snapshot: ProjectSnapshot; readonly context: ToolContext; readonly request: Request; readonly names: VariantNames; readonly current: VariantValue }

function isFiniteNumber(candidate: JsonValue | undefined): candidate is number {
  return typeof candidate === "number" && Number.isFinite(candidate);
}

function observedValueOf(candidate: JsonValue | undefined): VariantValue | undefined {
  if (isFiniteNumber(candidate)) return candidate;
  if (!isJsonArray(candidate)) return undefined;
  const numbers = candidate.filter(isFiniteNumber);
  return numbers.length === candidate.length ? candidateValueOf(numbers) : undefined;
}

function candidateValueOf(candidate: number | ReadonlyArray<number>): VariantValue | undefined {
  if (typeof candidate === "number") return candidate;
  return candidate.length < MIN_VECTOR_LENGTH || candidate.length > MAX_VECTOR_LENGTH ? undefined : [...candidate];
}

function plainLine(line: string): string {
  return line.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function requiredString(found: string, key: string, where: string): string | ToolFailure {
  return found && found.length <= MAX_PATH_CHARS ? found : toolError("INVALID_ARGUMENT", `${where}${key} is required: the exact string set_effect_control takes.`);
}

function targetOf(args: OfferArgs): VariantTarget | ToolFailure {
  const { target } = args;
  const compositionId = requiredString(target.compositionId, "compositionId", "target.");
  if (typeof compositionId !== "string") return compositionId;
  const layerId = requiredString(target.layerId, "layerId", "target.");
  if (typeof layerId !== "string") return layerId;
  const effectPath = requiredString(target.effectPath, "effectPath", "target.");
  if (typeof effectPath !== "string") return effectPath;
  const propertyPath = requiredString(target.propertyPath, "propertyPath", "target.");
  if (typeof propertyPath !== "string") return propertyPath;
  const effectMatchName = requiredString(args.effectMatchName, "effectMatchName", "");
  if (typeof effectMatchName !== "string") return effectMatchName;
  return { compositionId, layerId, effectPath, propertyPath, effectMatchName };
}

function candidateOf(entry: OfferArgs["candidates"][number], index: number): Candidate | ToolFailure {
  const label = plainLine(entry.label ?? "");
  if (!label || label.length > MAX_LABEL_CHARS) return toolError("INVALID_ARGUMENT", `candidates[${index}].label is required: a short label you write (at most ${MAX_LABEL_CHARS} characters, for example "subtler").`);
  const value = candidateValueOf(entry.value);
  return value === undefined ? toolError("INVALID_ARGUMENT", `candidates[${index}].value must be a finite number or 2-4 finite numbers.`) : { label, value };
}

function candidatesOf({ candidates: entries }: OfferArgs): Candidate[] | ToolFailure {
  if (entries.length < MIN_VARIANTS || entries.length > MAX_VARIANTS) return toolError("INVALID_ARGUMENT", `candidates must hold ${MIN_VARIANTS}-${MAX_VARIANTS} entries, each {label, value}: values you choose, with a short label for each.`);
  const candidates: Candidate[] = [];
  for (const [index, entry] of entries.entries()) {
    const candidate = candidateOf(entry, index);
    if ("ok" in candidate) return candidate;
    candidates.push(candidate);
  }
  return candidates;
}

function questionOf({ question: given }: OfferArgs): string | ToolFailure {
  if (given === undefined) return "";
  const question = plainLine(given);
  return question && question.length <= MAX_QUESTION_CHARS ? question : toolError("INVALID_ARGUMENT", `question is optional; when given it is one line of at most ${MAX_QUESTION_CHARS} characters.`);
}

function requestOf(args: OfferArgs): Request | ToolFailure {
  const target = targetOf(args);
  if ("ok" in target) return target;
  const candidates = candidatesOf(args);
  if ("ok" in candidates) return candidates;
  const question = questionOf(args);
  return typeof question === "string" ? { target, candidates, question } : question;
}

function findControl(snapshot: ProjectSnapshot, target: VariantTarget): { composition: CompositionSnapshot; layer: LayerSnapshot; properties: PropertySnapshot[]; property: PropertySnapshot } | undefined {
  const composition = snapshot.compositions.find((candidate) => candidate.id === target.compositionId);
  const layer = composition?.layers.find((candidate) => candidate.id === target.layerId);
  const properties = layer ? flattenProperties(layer.properties) : [];
  const property = properties.find((candidate) => candidate.path === target.propertyPath);
  return composition && layer && property ? { composition, layer, properties, property } : undefined;
}

function observedControl(snapshot: ProjectSnapshot, target: VariantTarget): Observed | ToolFailure {
  const found = findControl(snapshot, target);
  if (!found) return toolError("VARIANT_CONTROL_NOT_OBSERVED", "That control is not in the current snapshot: read the layer's effects first (ae_inspect_layer, or ae_list_effects_and_expressions) and pass its exact compositionId, layerId, effectPath and propertyPath. To change a control that is not there, write a normal plan.");
  const { composition, layer, properties, property } = found;
  const effect = properties.find((candidate) => candidate.path === target.effectPath);
  return { property, names: { composition: composition.name, layer: layer.name, effect: effect?.displayName ?? target.effectMatchName, control: property.displayName || property.matchName } };
}

function notStaticReason(property: PropertySnapshot): string | undefined {
  const keyed = (property.keyframeCount ?? 0) > 0 || (property.keyframes?.length ?? 0) > 0;
  if (keyed) return "has keyframes";
  return property.expressionEnabled === true ? "is driven by an expression" : undefined;
}

function staticRefusal(observed: Observed): ToolFailure | undefined {
  const reason = notStaticReason(observed.property);
  return reason ? toolError("VARIANT_CONTROL_NOT_STATIC", `${observed.names.control} ${reason}, so a single value cannot stand for it. Offer variants only for a control with one constant value; to change this one, write a normal plan (ae_propose_plan, or the queue you already use).`) : undefined;
}

function currentValueOf(observed: Observed): { current: VariantValue } | ToolFailure {
  const current = observedValueOf(observed.property.value);
  return current === undefined ? toolError("VARIANT_CONTROL_NOT_NUMERIC", `${observed.names.control} does not hold a number or a short list of numbers, so there are no values to offer. Write a normal plan instead (ae_propose_plan, or the queue you already use).`) : { current };
}

function closeNumbers(left: number, right: number): boolean {
  return Math.abs(left - right) <= FLOAT_NOISE * Math.max(1, Math.abs(left), Math.abs(right));
}

function sameValue(left: VariantValue, right: VariantValue): boolean {
  if (typeof left === "number" || typeof right === "number") return typeof left === "number" && typeof right === "number" && closeNumbers(left, right);
  return left.length === right.length && left.every((part, index) => closeNumbers(part, right[index] ?? Number.NaN));
}

function arityOf(value: VariantValue): number {
  return typeof value === "number" ? 0 : value.length;
}

function shapeRefusal(candidates: ReadonlyArray<Candidate>, current: VariantValue): ToolFailure | undefined {
  const arity = arityOf(current);
  const misfit = candidates.findIndex((candidate) => arityOf(candidate.value) !== arity);
  if (misfit < 0) return undefined;
  return toolError("INVALID_ARGUMENT", `candidates[${misfit}].value must be ${arity ? `${arity} numbers` : "one number"}, like the control's current value ${JSON.stringify(current)}.`);
}

function distinctRefusal(candidates: ReadonlyArray<Candidate>): ToolFailure | undefined {
  for (const [index, candidate] of candidates.entries()) {
    const earlier = candidates.slice(0, index);
    if (earlier.some((other) => other.label.toLowerCase() === candidate.label.toLowerCase())) return toolError("INVALID_ARGUMENT", `Two candidates are labelled "${candidate.label}"; each label must differ.`);
    if (earlier.some((other) => sameValue(other.value, candidate.value))) return toolError("INVALID_ARGUMENT", `Two candidates hold the same value (${JSON.stringify(candidate.value)}); each must differ.`);
  }
  return undefined;
}

function numberWords(amount: number): string {
  return String(Number(amount.toPrecision(6)));
}

function valueWords(value: VariantValue): string {
  return typeof value === "number" ? numberWords(value) : `[${value.map(numberWords).join(", ")}]`;
}

function summaryOf(names: VariantNames, candidate: Candidate): string {
  return `${names.control} on ${names.layer} to ${valueWords(candidate.value)} (${candidate.label})`.slice(0, 512);
}

function operationFor(target: VariantTarget, value: VariantValue): JsonObject {
  const { compositionId, layerId, effectPath, propertyPath, effectMatchName } = target;
  return { type: "set_effect_control", target: { compositionId, layerId, effectPath, propertyPath }, effectMatchName, value };
}

function planFor(composition: Composition, candidate: Candidate): VariantCandidate | ToolFailure {
  const { base, snapshot, context, request, names, current } = composition;
  const { label, value } = candidate;
  if (sameValue(value, current)) return { label, value, planId: null, current: true };
  const proposal: JsonObject = { summary: summaryOf(names, candidate), operations: [operationFor(request.target, value)] };
  const composed = composeProposal(base, snapshot, { args: proposal, limit: PROPOSAL_OPERATION_LIMIT, retainDraft: false }, context);
  return composed.ok ? { label, value, planId: composed.data.planId, current: false } : composed;
}

function withdrawPlans(context: ToolContext, made: ReadonlyArray<VariantCandidate>): void {
  for (const earlier of made) if (earlier.planId) context.plans?.delete(earlier.planId);
}

function composePlans(composition: Composition): VariantCandidate[] | ToolFailure {
  const made: VariantCandidate[] = [];
  for (const candidate of composition.request.candidates) {
    const planned = planFor(composition, candidate);
    if ("ok" in planned) {
      withdrawPlans(composition.context, made);
      return planned;
    }
    made.push(planned);
  }
  return made;
}

function sameControl(left: VariantTarget, right: VariantTarget): boolean {
  return left.compositionId === right.compositionId && left.layerId === right.layerId && left.propertyPath === right.propertyPath;
}

function supersede(context: ToolContext, target: VariantTarget, keep: string): void {
  for (const set of context.variants?.values() ?? []) {
    if (set.status === "open" && sameControl(set.target, target) && set.setId !== keep) closeVariantSet(context, set, { status: "dismissed", reason: "superseded" });
  }
}

function newSetId(): string {
  return `variants-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function checkedCurrent(request: Request, observed: Observed): { current: VariantValue } | ToolFailure {
  const notStatic = staticRefusal(observed);
  if (notStatic) return notStatic;
  const control = currentValueOf(observed);
  if ("ok" in control) return control;
  return shapeRefusal(request.candidates, control.current) ?? distinctRefusal(request.candidates) ?? control;
}

function prepared(snapshot: ProjectSnapshot, context: ToolContext, args: OfferArgs): Prepared | ToolFailure {
  const { plans, variants } = context;
  if (!plans || !variants) return toolError("VARIANTS_UNAVAILABLE", "This caller keeps no plan store for variants, so there is nowhere to hold the options. Write a normal plan instead.");
  const request = requestOf(args);
  if ("ok" in request) return request;
  const observed = observedControl(snapshot, request.target);
  if ("ok" in observed) return observed;
  const checked = checkedCurrent(request, observed);
  return "ok" in checked ? checked : { request, observed, current: checked.current, variants };
}

function storeSet(context: ToolContext, variants: Map<string, VariantSet>, set: VariantSet): void {
  for (const candidate of set.candidates) {
    const record = candidate.planId ? context.plans?.get(candidate.planId) : undefined;
    if (record) record.variantSetId = set.setId;
  }
  supersede(context, set.target, set.setId);
  variants.set(set.setId, set);
  pruneVariantSets(variants);
}

function offerData(set: VariantSet): JsonObject {
  return {
    setId: set.setId,
    status: set.status,
    question: set.question || null,
    control: { ...set.names },
    currentValue: set.currentValue,
    candidates: set.candidates.map((candidate, index) => ({ index, label: candidate.label, value: candidate.value, current: candidate.current })),
    next: NEXT,
  };
}

/** Offers a set. Refusals name what to change; none of them has created a plan. */
export function offerVariants(base: ToolBase, snapshot: ProjectSnapshot, args: OfferArgs, context: ToolContext): ToolResult {
  const ready = prepared(snapshot, context, args);
  if ("ok" in ready) return ready;
  const { request, observed, current, variants } = ready;
  const candidates = composePlans({ base, snapshot, context, request, names: observed.names, current });
  if ("ok" in candidates) return candidates;
  const set: VariantSet = { setId: newSetId(), status: "open", question: request.question, target: request.target, names: observed.names, currentValue: current, snapshotFingerprint: snapshot.fingerprint, candidates, createdAt: now(context).toISOString() };
  storeSet(context, variants, set);
  return { ...base, data: offerData(set) };
}
