// The vocabulary of request pre-resolution: what a resolved term is, how the clauses of a request and the installed catalogue are read, and how a batch of questions about one phrase is worded.
import { withFittedBands, propertyChoice, NO_MATCH, type ChoiceSpec, type ControlCandidate, type EffectCandidate, type FontRecord, type Habits } from "@extynt/decide";
import type { ControlSchema, HostCapabilityProfile } from "@extynt/capability-catalogue";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { TRANSFORM_PROPERTIES } from "./animation-inputs.js";
import type { DecisionSite } from "./decision-log.js";
import type { LearnedAliases } from "./learned-aliases.js";
import type { PreferenceTally } from "./preference-tally.js";

export interface ResolvedTerm {
  readonly kind: "effect" | "control" | "font" | "layer" | "property";
  readonly phrase: string;
  readonly scope: string;
  readonly key: string;
  readonly name: string;
  readonly band: string;
  readonly taught: boolean;
}

export interface ResolveSources {
  readonly profile: HostCapabilityProfile | undefined;
  readonly snapshot: ProjectSnapshot | undefined;
  readonly preferences: PreferenceTally | undefined;
  readonly aliases?: LearnedAliases | undefined;
  readonly signal?: AbortSignal | undefined;
}

type Phrase = { readonly phrase: string };
export type Asked = { readonly request: string };
type Pick = { readonly label: string; readonly source: string; readonly band: string | null; readonly abstained: boolean };
export type TermKind = Exclude<ResolvedTerm["kind"], "layer">;

const MAX_CLAUSES = 4;
const MIN_CLAUSE_CHARS = 4;
const MAX_CLAUSE_CHARS = 160;

export const TITLES: ReadonlyMap<string, string> = new Map(TRANSFORM_PROPERTIES.map((property) => [property.key, property.title]));

export function siteOf(sources: ResolveSources): DecisionSite {
  return { moment: "build-kit", jobId: null, ...(sources.signal === undefined ? {} : { signal: sources.signal }) };
}

export function clausesOf(request: string): string[] {
  const parts = request.split(/[.;!?\n,]+|\s(?:and|und|et|y|e|en)\s/iu).map((part) => part.trim().replace(/\s+/gu, " "));
  return [...new Set(parts.filter((part) => part.length >= MIN_CLAUSE_CHARS && part.length <= MAX_CLAUSE_CHARS))].slice(0, MAX_CLAUSES);
}

export function asked(spec: ChoiceSpec<Phrase, string>, phrase: string): ChoiceSpec<Asked, string> {
  return withFittedBands({ ...spec, instructions: `${spec.instructions} The phrase to decide on is "${phrase}".`, deterministic: () => spec.deterministic({ phrase }), deterministicConfidence: (_state, answer) => spec.deterministicConfidence?.({ phrase }, answer) ?? 1 });
}

export function installedEffects(profile: HostCapabilityProfile | undefined): EffectCandidate[] {
  return (profile?.entries ?? []).flatMap((entry) => (entry.kind === "effect" && entry.availability === "available" && entry.matchName !== undefined ? [{ matchName: entry.matchName, displayName: entry.displayName, category: entry.category ?? "" }] : []));
}

export function flatControls(controls: readonly ControlSchema[] | undefined): ControlCandidate[] {
  return (controls ?? []).flatMap((control) => [{ matchName: control.matchName, displayName: control.displayName, valueType: control.valueType }, ...flatControls(control.children)]);
}

export function effectHabits(preferences: PreferenceTally | undefined, effects: readonly EffectCandidate[]): Habits | undefined {
  return preferences?.habits("effect", effects.map((effect) => ({ key: effect.matchName, stored: [effect.matchName] })));
}

export function fontHabits(preferences: PreferenceTally | undefined, fonts: readonly FontRecord[]): Habits | undefined {
  const byFamily = new Map<string, string[]>();
  for (const font of fonts) byFamily.set(font.family, [...(byFamily.get(font.family) ?? []), font.postScriptName]);
  return preferences?.habits("font", [...byFamily].map(([key, stored]) => ({ key, stored })));
}

export function propertyHabits(preferences: PreferenceTally | undefined): Habits | undefined {
  return preferences?.habits("property", TRANSFORM_PROPERTIES.map((property) => ({ key: property.key, stored: [property.key] })));
}

export function controlHabits(preferences: PreferenceTally | undefined, effect: string, controls: readonly ControlCandidate[]): Habits | undefined {
  return preferences?.habits("control", controls.map((control) => ({ key: control.matchName, stored: [`${effect}/${control.matchName}`] })));
}

function bandOf(result: Pick): string {
  if (result.abstained) return "unsure";
  return result.source === "deterministic" ? "word-search" : result.band ?? "model";
}

export function termOf(about: { readonly kind: TermKind; readonly phrase: string; readonly scope?: string }, result: Pick, names: ReadonlyMap<string, string>): ResolvedTerm[] {
  if (result.label === NO_MATCH) return [];
  const taught = result.source !== "deterministic" && !result.abstained;
  return [{ kind: about.kind, phrase: about.phrase, scope: about.scope ?? "", key: result.label, name: names.get(result.label) ?? result.label, band: bandOf(result), taught }];
}

export function propertyBatch(clauses: readonly string[], habits?: Habits): Record<string, ChoiceSpec<Asked, string>> {
  const spec = propertyChoice(TRANSFORM_PROPERTIES, habits);
  return Object.fromEntries(clauses.map((clause, index) => [`property:${index}`, withFittedBands({ ...spec, instructions: `${spec.instructions} The phrase to decide on is "${clause}" and the target is a layer's transform.`, deterministic: (): string => spec.deterministic({ phrase: clause, target: "layer" }), deterministicConfidence: (_state, answer) => spec.deterministicConfidence?.({ phrase: clause, target: "layer" }, answer) ?? 1 })]));
}

export function propertiesIn(clauses: readonly string[], results: Readonly<Record<string, Pick | undefined>>): ResolvedTerm[] {
  return clauses.flatMap((clause, index) => { const result = results[`property:${index}`]; return result === undefined ? [] : termOf({ kind: "property", phrase: clause }, result, TITLES); });
}

export function controlAsked(spec: ChoiceSpec<{ readonly phrase: string; readonly effect: string }, string>, term: ResolvedTerm): ChoiceSpec<Asked, string> {
  return { ...spec, instructions: `${spec.instructions} The phrase to decide on is "${term.phrase}" and the effect is "${term.name}".`, deterministic: () => spec.deterministic({ phrase: term.phrase, effect: term.name }), deterministicConfidence: (_state, answer) => spec.deterministicConfidence?.({ phrase: term.phrase, effect: term.name }, answer) ?? 1 };
}
