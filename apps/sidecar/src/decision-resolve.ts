// Pre-resolution of a request's effects, controls, fonts and named layers: at build-kit time the models read the request once, and what they resolve goes into the kit with its confidence band, so the model spends no steps on search calls; a phrase a model settled before is answered from the learned aliases, and with no model and no alias nothing is resolved and the kit is unchanged.
import { createHash } from "node:crypto";
import {
  EFFECT_INSTRUCTIONS, EFFECT_NONE_MEANING, withFittedBands, asEffectCandidate, controlChoice, effectChoice, type EffectCandidate, type FontRecord, type Habits,
} from "@extynt/decide";
import type { HostCapabilityProfile } from "@extynt/capability-catalogue";
import { layersInScope, type LayerSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { mapWithConcurrency } from "./decision-concurrency.js";
import type { DecisionSite } from "./decision-log.js";
import { highStakes, chatFirstWave } from "./decision-resolve-chat.js";
import { aliasScopeOf, learnTerms, splitLearned, type AliasScope } from "./decision-resolve-aliases.js";
import {
  TITLES, asked, clausesOf, controlAsked, controlHabits, effectHabits, flatControls, fontHabits, installedEffects, propertiesIn, propertyBatch, propertyHabits, siteOf, termOf,
  type ResolvedTerm, type ResolveSources,
} from "./decision-resolve-terms.js";
import type { DecisionService } from "./decision-service.js";
import type { LearnedAliases } from "./learned-aliases.js";
import { requestedNames } from "./request-coverage.js";

export type { ResolvedTerm, ResolveSources } from "./decision-resolve-terms.js";

const FLAT_LIMIT = 254;
const MEMO_LIMIT = 64;

const memo = new Map<string, readonly ResolvedTerm[]>();

/** Forgets the resolutions held, so the next kit asks again. */
export function clearResolutions(): void {
  memo.clear();
}

/** Forgets every learned alias and the resolutions held, so the next kit starts from the word search and the models alone. */
export function forgetLearnedAliases(aliases: LearnedAliases): void {
  aliases.clear();
  clearResolutions();
}

interface Wave {
  readonly service: DecisionService;
  readonly site: DecisionSite;
  readonly scope: AliasScope | undefined;
}

interface Open {
  readonly effects: readonly string[];
  readonly properties: readonly string[];
  readonly fonts: readonly string[];
}

interface Catalogue {
  readonly effects: readonly EffectCandidate[];
  readonly fonts: readonly FontRecord[];
  readonly effectHabits: Habits | undefined;
  readonly fontHabits: Habits | undefined;
  readonly propertyHabits: Habits | undefined;
}

interface Found {
  readonly effects: ResolvedTerm[];
  readonly properties: ResolvedTerm[];
}

async function propertyTerms(wave: Wave, clauses: readonly string[], habits: Habits | undefined): Promise<ResolvedTerm[]> {
  if (clauses.length === 0) return [];
  const results = await wave.service.decideAll({ request: clauses.join("\n") }, propertyBatch(clauses, habits), wave.site);
  return propertiesIn(clauses, results);
}

async function effectTerms(wave: Wave, catalogue: Catalogue, open: Open): Promise<Found> {
  const names = new Map(catalogue.effects.map((effect) => [effect.matchName, effect.displayName]));
  if (catalogue.effects.length <= FLAT_LIMIT) return await flatEffectTerms(wave, { catalogue, open, names });
  const { service, site } = wave;
  const options = { name: "effect", instructions: EFFECT_INSTRUCTIONS, noneMeaning: EFFECT_NONE_MEANING, ...(catalogue.effectHabits === undefined ? {} : { habits: catalogue.effectHabits }) };
  const results = await mapWithConcurrency(open.effects, (clause) => service.tournament(clause, catalogue.effects.map(asEffectCandidate), options, site));
  return { effects: results.flatMap((result, index) => termOf({ kind: "effect", phrase: open.effects[index] ?? "" }, { label: result.key, source: result.final.source, band: result.final.band, abstained: result.final.abstained }, names)), properties: await propertyTerms(wave, open.properties, catalogue.propertyHabits) };
}

async function flatEffectTerms(wave: Wave, { catalogue, open, names }: { readonly catalogue: Catalogue; readonly open: Open; readonly names: ReadonlyMap<string, string> }): Promise<Found> {
  if (catalogue.effects.length === 0 || open.effects.length === 0) return { effects: [], properties: await propertyTerms(wave, open.properties, catalogue.propertyHabits) };
  const spec = effectChoice(catalogue.effects, catalogue.effectHabits);
  const batch = { ...Object.fromEntries(open.effects.map((clause, index) => [`effect:${index}`, asked(spec, clause)])), ...propertyBatch(open.properties, catalogue.propertyHabits) };
  const results = await wave.service.decideAll({ request: open.effects.join("\n") }, batch, wave.site);
  return { effects: open.effects.flatMap((clause, index) => { const result = results[`effect:${index}`]; return result === undefined ? [] : termOf({ kind: "effect", phrase: clause }, result, names); }), properties: propertiesIn(open.properties, results) };
}

async function fontTerms(wave: Wave, catalogue: Catalogue, clauses: readonly string[]): Promise<ResolvedTerm[]> {
  if (catalogue.fonts.length === 0) return [];
  const results = await mapWithConcurrency(clauses, (clause) => wave.service.resolveFont(clause, catalogue.fonts, catalogue.fontHabits, wave.site));
  return results.flatMap((result, index) => termOf({ kind: "font", phrase: clauses[index] ?? "" }, { label: result.key, source: result.final.source, band: result.final.band, abstained: result.final.abstained }, new Map()));
}

async function firstWave(wave: Wave, catalogue: Catalogue, open: Open, request: string): Promise<{ readonly found: Found; readonly fonts: ResolvedTerm[] }> {
  if (!wave.service.hasDecisionModel()) {
    const settled = await chatFirstWave(wave.service, {
      site: wave.site, request, properties: open.properties, propertyHabits: catalogue.propertyHabits,
      effects: { clauses: open.effects, installed: catalogue.effects, habits: catalogue.effectHabits },
      fonts: { clauses: open.fonts, installed: catalogue.fonts, habits: catalogue.fontHabits },
    });
    return { found: { effects: settled.effects, properties: settled.properties }, fonts: settled.fonts };
  }
  const [found, fonts] = await Promise.all([effectTerms(wave, catalogue, open), fontTerms(wave, catalogue, open.fonts)]);
  return { found, fonts };
}

interface ControlTarget {
  readonly term: ResolvedTerm;
  readonly controls: ReturnType<typeof flatControls>;
}

function controlNames({ term, controls }: ControlTarget): Map<string, string> {
  return new Map(controls.map((control) => [control.matchName, `${control.displayName} of ${term.name}`]));
}

function targetsOf(resolved: readonly ResolvedTerm[], profile: HostCapabilityProfile | undefined): ControlTarget[] {
  return resolved.flatMap((term) => {
    const entry = term.kind === "effect" ? profile?.entries.find((candidate) => candidate.matchName === term.key) : undefined;
    const controls = flatControls(entry?.controls);
    return controls.length === 0 ? [] : [{ term, controls }];
  });
}

async function controlTerms(wave: Wave, resolved: readonly ResolvedTerm[], sources: ResolveSources): Promise<ResolvedTerm[]> {
  const learned = targetsOf(resolved, sources.profile).map((target) => ({ target, split: splitLearned(wave.scope, { kind: "control", scope: target.term.key }, [target.term.phrase], controlNames(target)) }));
  const targets = learned.filter(({ split }) => split.left.length > 0).map(({ target }) => target);
  const known = learned.flatMap(({ split }) => split.terms);
  if (targets.length === 0) return known;
  const batch = Object.fromEntries(targets.map(({ term, controls }, index) => [`control:${index}`, withFittedBands(controlAsked(controlChoice(controls, controlHabits(sources.preferences, term.key, controls)), term))]));
  const results = await wave.service.decideAll({ request: targets.map(({ term }) => term.phrase).join("\n") }, wave.service.hasDecisionModel() ? batch : highStakes(batch), wave.site);
  const settled = targets.flatMap((target, index) => { const result = results[`control:${index}`]; return result === undefined ? [] : termOf({ kind: "control", phrase: target.term.phrase, scope: target.term.key }, result, controlNames(target)); });
  return [...known, ...settled];
}

function layerTerms(request: string, snapshot: ProjectSnapshot | undefined): ResolvedTerm[] {
  if (snapshot === undefined) return [];
  return requestedNames(request).flatMap((name) => layersInScope(snapshot, (layer) => layer.name === name).layers.map((layer) => ({ kind: "layer" as const, phrase: name, scope: "", key: layer.id, name: `${layer.name} in ${compositionNameOf(snapshot, layer)}`, band: "exact", taught: false })));
}

function compositionNameOf(snapshot: ProjectSnapshot, layer: LayerSnapshot): string {
  return snapshot.compositions.find((composition) => composition.layers.includes(layer))?.name ?? "";
}

function memoKeyOf(request: string, sources: ResolveSources): string {
  return `${sources.profile?.profileId ?? ""}\u0000${sources.snapshot?.activeCompositionId ?? ""}\u0000${createHash("sha256").update(request).digest("hex").slice(0, 24)}`;
}

function remember(key: string, terms: readonly ResolvedTerm[]): void {
  const [oldest] = memo.keys();
  if (memo.size >= MEMO_LIMIT && oldest !== undefined) memo.delete(oldest);
  memo.set(key, terms);
}

async function modelTerms(wave: Wave, sources: ResolveSources, request: string): Promise<ResolvedTerm[]> {
  const clauses = clausesOf(request), effects = installedEffects(sources.profile), fonts = sources.profile?.fontInventory.items ?? [];
  const effectSplit = splitLearned(wave.scope, { kind: "effect" }, clauses, new Map(effects.map((effect) => [effect.matchName, effect.displayName])));
  const propertySplit = splitLearned(wave.scope, { kind: "property" }, clauses, TITLES);
  const fontSplit = splitLearned(wave.scope, { kind: "font" }, clauses, new Map(fonts.map((font) => [font.family, font.family])));
  const known = [...effectSplit.terms, ...propertySplit.terms, ...fontSplit.terms];
  if (!wave.service.hasModels()) return [...known, ...await controlTerms(wave, effectSplit.terms, sources)];
  const catalogue = { effects, fonts, effectHabits: effectHabits(sources.preferences, effects), fontHabits: fontHabits(sources.preferences, fonts), propertyHabits: propertyHabits(sources.preferences) };
  const first = await firstWave(wave, catalogue, { effects: effectSplit.left, properties: propertySplit.left, fonts: fontSplit.left }, request);
  const controls = await controlTerms(wave, [...effectSplit.terms, ...first.found.effects], sources);
  return [...effectSplit.terms, ...first.found.effects, ...controls, ...fontSplit.terms, ...first.fonts, ...propertySplit.terms, ...first.found.properties];
}

/** Reads the request once and resolves the effects, controls, fonts and existing layers it names: a phrase a model settled before comes from the learned aliases while its entry is still installed, a decision model is asked for the rest, and with only the user's chat model one batched request per wave carries just the phrases the offline tier is unsure of; nothing when no model is configured and no alias applies. */
export async function resolveRequestTerms(service: DecisionService, request: string, sources: ResolveSources): Promise<readonly ResolvedTerm[]> {
  const scope = aliasScopeOf(sources);
  if ((!service.hasModels() && scope === undefined) || request.trim() === "") return [];
  const memoKey = memoKeyOf(request, sources);
  const known = memo.get(memoKey);
  if (known !== undefined) return known;
  const found = await modelTerms({ service, site: siteOf(sources), scope }, sources, request);
  learnTerms(scope, found);
  const terms = [...found, ...layerTerms(request, sources.snapshot)];
  remember(memoKey, terms);
  return terms;
}

/** The kit lines for resolved terms: each id to use directly with its confidence band, and the note that the search tools remain for anything unlisted. */
export function resolvedLines(terms: readonly ResolvedTerm[]): string[] {
  if (terms.length === 0) return [];
  const rows = terms.map((term) => `- ${term.kind} "${term.phrase}" -> ${term.name} (${term.key}) [${term.band}]`);
  return ["Resolved from your request (use these ids directly; [act] is a confident reading, [verify] was checked against the word search, [learned] is a reading chosen for the same words before, [word-search] and [exact] are literal matches):", ...rows, "A thing the request names that is not listed here is unresolved: search for it as before.", ""];
}
