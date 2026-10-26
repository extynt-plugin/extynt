// Pre-resolution when the user's own chat model is the only model: the phrases the offline resolvers are unsure of are batched into one structured request per wave, each question listing its own few candidates.
import { effectChoice, fontChoice, shortlistEffects, shortlistFamilies, type ChoiceSpec, type EffectCandidate, type FontRecord, type Habits } from "@extynt/decide";
import type { DecisionSite } from "./decision-log.js";
import type { DecisionService } from "./decision-service.js";
import { asked, propertiesIn, propertyBatch, termOf, type Asked, type ResolvedTerm } from "./decision-resolve-terms.js";

interface FirstWave {
  readonly site: DecisionSite;
  readonly request: string;
  readonly effects: { readonly clauses: readonly string[]; readonly installed: readonly EffectCandidate[]; readonly habits: Habits | undefined };
  readonly fonts: { readonly clauses: readonly string[]; readonly installed: readonly FontRecord[]; readonly habits: Habits | undefined };
  readonly properties: readonly string[];
  readonly propertyHabits: Habits | undefined;
}

interface FirstWaveTerms {
  readonly effects: ResolvedTerm[];
  readonly fonts: ResolvedTerm[];
  readonly properties: ResolvedTerm[];
}

type Batch = Record<string, ChoiceSpec<Asked, string>>;

/** The batch with every question marked high-stakes, so that the offline answers the resolvers are unsure of go to the chat model together and the confident ones stay offline. */
export function highStakes(batch: Batch): Batch {
  return Object.fromEntries(Object.entries(batch).map(([key, spec]) => [key, { ...spec, stakes: "high" as const }]));
}

function effectRows(wave: FirstWave): Batch {
  const { clauses, installed, habits } = wave.effects;
  return Object.fromEntries(clauses.flatMap((clause, index) => {
    const shortlist = shortlistEffects(clause, installed);
    return shortlist.length === 0 ? [] : [[`effect:${index}`, asked(effectChoice(shortlist, habits), clause)]];
  }));
}

function fontRows(wave: FirstWave): Batch {
  const { clauses, installed, habits } = wave.fonts;
  return Object.fromEntries(clauses.flatMap((clause, index) => (shortlistFamilies(clause, installed).length === 0 ? [] : [[`font:${index}`, asked(fontChoice(clause, installed, habits), clause)]])));
}

/** Resolves effects, fonts and transform properties in one decision batch: the chat model is asked once, and only about what the offline tier abstained on. */
export async function chatFirstWave(service: DecisionService, wave: FirstWave): Promise<FirstWaveTerms> {
  const batch = highStakes({ ...effectRows(wave), ...fontRows(wave), ...propertyBatch(wave.properties, wave.propertyHabits) });
  if (Object.keys(batch).length === 0 || wave.site.signal?.aborted === true) return { effects: [], fonts: [], properties: [] };
  const results = await service.decideAll({ request: wave.request }, batch, wave.site);
  const names = new Map(wave.effects.installed.map((effect) => [effect.matchName, effect.displayName]));
  const termsOf = (kind: "effect" | "font", clauses: readonly string[]): ResolvedTerm[] => clauses.flatMap((clause, index) => { const result = results[`${kind}:${index}`]; return result === undefined ? [] : termOf({ kind, phrase: clause }, result, names); });
  return { effects: termsOf("effect", wave.effects.clauses), fonts: termsOf("font", wave.fonts.clauses), properties: propertiesIn(wave.properties, results) };
}
