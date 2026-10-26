// Which native features and named parts a request asks for, and whether the project shows each one; the briefing uses the operations they need, completion uses the proof.
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { WorkflowId } from "@extynt/workflow";
import type { AppliedStep } from "@extynt/decide";
import { layersOf, type Evidence } from "./coverage-evidence.js";
import { bookedYesNo } from "./decision-book.js";
import { FEATURE_IDS, featureOf, type CoverageFeature, type FeatureId } from "./coverage-features.js";
import { appliedFacts, type AppliedFact, type AppliedOperation } from "./request-applied.js";

const NEGATION = /\b(no|without|don'?t|do not|avoid|never|not|skip|remove)\b[^.;,]{0,20}$/i;
const NEGATION_WINDOW = 30;
const NAMED_OBJECT = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9]\b/g;
const NATIVE_NAME_PREFIX = "ADBE_";
const MAX_COVERAGE_REFUSALS = 2;
const MEMO_LIMIT = 32;
const DRAWN_FEATURES: ReadonlySet<FeatureId> = new Set(["text-animator", "selector-offset", "blur", "glow", "drop-shadow", "ramp", "wiggle", "repeater", "trim-paths"]);

/** The answers to whether a request asks for something: it does, or it does not (absent or negated). */
export const ASK_LABELS = ["asked", "not-asked"] as const;

type AskLabel = (typeof ASK_LABELS)[number];

/** The answers to whether the project shows a feature: it does, it does not, or only a layer that is not drawn does. */
export const COVERAGE_LABELS = ["covered", "missing", "hidden"] as const;

type CoverageLabel = (typeof COVERAGE_LABELS)[number];

const flatten = (text: string): string => text.replace(/\s+/g, " ");
const negatedAt = (text: string, index: number): boolean => NEGATION.test(text.slice(Math.max(0, index - NEGATION_WINDOW), index));

/** Whether single-spaced request text asks for a feature: a mention of it that no negation shortly before cancels. */
export function decideFeatureAsk(input: { goal: string; feature: FeatureId }): AskLabel {
  const booked = bookedYesNo({ decision: "request-parts", text: input.goal, item: input.feature });
  if (booked !== undefined) return booked ? "asked" : "not-asked";
  for (const match of input.goal.matchAll(featureOf(input.feature).pattern)) if (!negatedAt(input.goal, match.index)) return "asked";
  return "not-asked";
}

/** Whether single-spaced request text asks for the UPPER_SNAKE name found at an index: native match names and negated mentions are not asked for. */
export function decideNameAsk(input: { goal: string; name: string; index: number }): AskLabel {
  const booked = bookedYesNo({ decision: "named-object", text: input.goal, item: input.name });
  if (booked !== undefined) return booked ? "asked" : "not-asked";
  return input.name.startsWith(NATIVE_NAME_PREFIX) || negatedAt(input.goal, input.index) ? "not-asked" : "asked";
}

const renderingViews = new WeakMap<ProjectSnapshot, ProjectSnapshot>();

function renderingView(snapshot: ProjectSnapshot): ProjectSnapshot {
  const known = renderingViews.get(snapshot);
  if (known) return known;
  const view = { ...snapshot, compositions: snapshot.compositions.map((composition) => ({ ...composition, layers: composition.layers.filter((layer) => layer.enabled !== false) })) };
  renderingViews.set(snapshot, view);
  return view;
}

function hiddenCarriers(feature: CoverageFeature, snapshot: ProjectSnapshot): string[] {
  if (!feature.present({ snapshot, applied: [] }) || feature.present({ snapshot: renderingView(snapshot), applied: [] })) return [];
  return snapshot.compositions.flatMap((composition) => composition.layers.filter((layer) => layer.enabled === false && feature.present({ snapshot: { ...snapshot, compositions: [{ ...composition, layers: [layer] }] }, applied: [] })).map((layer) => {
    const user = composition.layers.find((other) => other.matteLayerId === layer.id);
    return `layer "${layer.name}", which is hidden (video off)${user ? `: After Effects hides a layer used as a matte, so set showMatteLayer: true on the set_track_matte for "${user.name}"` : ""}`;
  }));
}

/** Whether the project shows a feature; for a feature drawn on a layer, evidence on a layer whose video switch is off does not count and an executed operation cannot outvote what the project shows. */
export function decideFeatureCoverage(input: { feature: FeatureId; evidence: Evidence }): CoverageLabel {
  const feature = featureOf(input.feature);
  const { snapshot, applied } = input.evidence;
  if (!DRAWN_FEATURES.has(input.feature)) return feature.present(input.evidence) ? "covered" : "missing";
  if (hiddenCarriers(feature, snapshot).length > 0) return "hidden";
  return feature.present({ snapshot: renderingView(snapshot), applied }) ? "covered" : "missing";
}

const featureMemo = new Map<string, readonly CoverageFeature[]>();

/** The features a request asks for, in listing order. */
export function requestedFeatures(goal: string): readonly CoverageFeature[] {
  const known = featureMemo.get(goal);
  if (known) return known;
  const flat = flatten(goal);
  const features = FEATURE_IDS.filter((feature) => decideFeatureAsk({ goal: flat, feature }) === "asked").map(featureOf);
  const [oldest] = featureMemo.keys();
  if (featureMemo.size >= MEMO_LIMIT && oldest !== undefined) featureMemo.delete(oldest);
  featureMemo.set(goal, features);
  return features;
}

/** Forgets the features worked out for a request, so the next reading sees what a decision model has since answered. */
export function forgetRequestedFeatures(goal: string): void {
  featureMemo.delete(goal);
}

/** The operations a request needs, for the briefing's full-schema disclosure. */
export function requestedOperationTypes(goal: string): string[] {
  return [...new Set(requestedFeatures(goal).flatMap((feature) => feature.operations))];
}

/** The UPPER_SNAKE names a request gives its layers and compositions, once each ("PLAN_CARD", "BEAT_GRID"). */
export function requestedNames(goal: string): string[] {
  const flat = flatten(goal);
  const asked = [...flat.matchAll(NAMED_OBJECT)].filter((match) => decideNameAsk({ goal: flat, name: match[0], index: match.index }) === "asked");
  return [...new Set(asked.map((match) => match[0]))];
}

function missingNames(goal: string, { snapshot, applied }: Evidence): string[] {
  const present = new Set([...snapshot.compositions.map((composition) => composition.name), ...layersOf(snapshot).map((layer) => layer.name)]);
  const appliedText = applied.map((operation) => operation.json).join("\n");
  return requestedNames(goal).filter((name) => !present.has(name) && !appliedText.includes(`"${name}"`)).map((name) => `a layer or composition named "${name}", built as the request describes it`);
}

/** The text the request-missing answers are booked under: the request and the JSON of every executed operation, so new work asks again. */
export function progressText(goal: string, applied: readonly AppliedFact[]): string {
  return `${goal}\n${applied.map((fact) => fact.json).join("\n")}`;
}

/** The executed operations in the shape the request-missing decision reads. */
export function progressSteps(applied: readonly AppliedFact[]): AppliedStep[] {
  return applied.map((fact) => ({ type: fact.type, json: fact.json, propertyPath: fact.propertyPath ?? "", role: fact.role ?? "", positionKeys: fact.positionKeys }));
}

function modelSaysMade(goal: string, feature: CoverageFeature, evidence: Evidence): boolean {
  return bookedYesNo({ decision: "request-missing", text: progressText(goal, evidence.applied), item: feature.id }) === false;
}

function missingLabels(goal: string, feature: CoverageFeature, evidence: Evidence): string[] {
  const label = decideFeatureCoverage({ feature: feature.id, evidence });
  if (label === "covered" || (label === "missing" && modelSaysMade(goal, feature, evidence))) return [];
  if (label === "missing") return [feature.label];
  return [`${feature.label} (present only on ${hiddenCarriers(feature, evidence.snapshot).join("; ")})`];
}

/** Labels of the named features and parts the project does not show. A snapshot that did not read properties is not judged. */
export function missingFeatures<Payload>(goal: string, snapshot: ProjectSnapshot, applied: readonly AppliedOperation<Payload>[]): string[] {
  if (snapshot.coverage?.properties === "unknown") return [];
  const evidence = { snapshot, applied: appliedFacts(applied) };
  return [...missingNames(goal, evidence), ...requestedFeatures(goal).flatMap((feature) => missingLabels(goal, feature, evidence))];
}

const refusals = new Map<WorkflowId, { count: number; missing: number }>();
const pending = new Map<WorkflowId, string[]>();

/** The missing features when completion should be refused now, recording the refusal; null when completion may proceed. Refusals stop after two in a row without progress, so a misread request cannot hold a job open. */
export function coverageRefusal<Payload>(jobId: WorkflowId, goal: string, snapshot: ProjectSnapshot, applied: readonly AppliedOperation<Payload>[]): string[] | null {
  const missing = missingFeatures(goal, snapshot, applied);
  if (missing.length === 0) { pending.delete(jobId); return null; }
  const previous = refusals.get(jobId);
  const count = previous && missing.length >= previous.missing ? previous.count : 0;
  if (count >= MAX_COVERAGE_REFUSALS) return null;
  refusals.set(jobId, { count: count + 1, missing: missing.length });
  pending.set(jobId, missing);
  return missing;
}

/** The message that tells the model what the project still lacks. */
export function coverageMessage(missing: readonly string[]): string {
  return `The request names features the project does not show yet: ${missing.join("; ")}. Add them in one bounded batch on the layers the request describes, then complete. If one cannot be made in this build, say which and why in the answer.`;
}

/** Whether a coverage refusal is waiting for the next continuation cycle, without handing it over. */
export function hasPendingCoverage(jobId: WorkflowId | null): boolean {
  return !!jobId && (pending.get(jobId)?.length ?? 0) > 0;
}

/** The refusal the next continuation cycle must act on, if any; it is handed over once. */
export function takePendingCoverage(jobId: WorkflowId | null): string[] | undefined {
  const missing = jobId ? pending.get(jobId) : undefined;
  if (jobId) pending.delete(jobId);
  return missing;
}
