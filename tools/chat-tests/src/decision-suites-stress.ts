// Stress suites for the offline tier: each dev case is made unanswerable by removing the wanted candidate.
// The right answer is then "none", and a confident pick of a near candidate is a wrong guess.
// Extension rule of the font rows: a pick whose family name begins with the removed family's full name and goes on
// ("Helvetica Neue" for a missing "Helvetica") is what a designer accepts, so it counts as correct.
import { NO_MATCH, controlChoice, deterministicCore, effectChoice, fontChoice, propertyChoice } from "@extynt/decide";
import type { EffectCandidate } from "@extynt/decide";
import { answerText, specCase } from "./decision-eval-cases.js";
import { loadControlCases, loadEffectCases, loadEffectCatalogue, loadFontCases, loadInstalledFonts, tagsOf } from "./decision-fixtures.js";
import { loadPropertyCases } from "./decision-fixtures-animation.js";
import type { SpecSuite } from "./decision-eval-types.js";

function withoutWanted(suite: string): string {
  return `${suite}-dropped`;
}

function effectDropped(): SpecSuite {
  const catalogue = new Map(loadEffectCatalogue().map((effect) => [effect.matchName, effect]));
  const rows = loadEffectCases().cases.filter((row) => row.wanted !== null && row.candidates.includes(row.wanted));
  return {
    name: withoutWanted("effect-pick"),
    cases: rows.map((row) => {
      const kept = row.candidates.filter((name) => name !== row.wanted);
      const shortlist = kept.flatMap((name): EffectCandidate[] => { const found = catalogue.get(name); return found === undefined ? [] : [found]; });
      return specCase({ id: row.id, tags: tagsOf(row), spec: effectChoice(shortlist), state: { phrase: row.phrase }, expected: NO_MATCH });
    }),
  };
}

function controlDropped(): SpecSuite {
  const { effects, cases } = loadControlCases();
  return {
    name: withoutWanted("control-resolution"),
    cases: cases.filter((row) => row.wanted !== null).map((row) => {
      const effect = effects[row.effect];
      const controls = (effect?.controls ?? []).filter((control) => control.matchName !== row.wanted);
      const state = { phrase: row.phrase, effect: effect?.displayName ?? row.effect };
      return specCase({ id: row.id, tags: tagsOf(row), spec: controlChoice(controls), state, expected: NO_MATCH });
    }),
  };
}

function isExtensionOfRemovedFamily(wanted: string, picked: string): boolean {
  return picked.startsWith(`${wanted} `);
}

function fontDropped(): SpecSuite {
  const installed = loadInstalledFonts();
  return {
    name: withoutWanted("font-matching"),
    cases: loadFontCases().cases.filter((row) => row.wanted !== null).map((row) => {
      const remaining = installed.filter((record) => record.family !== row.wanted);
      const spec = fontChoice(row.phrase, remaining);
      const state = { phrase: row.phrase };
      const picked = answerText(deterministicCore(spec, state));
      return specCase({ id: row.id, tags: tagsOf(row), spec, state, expected: isExtensionOfRemovedFamily(row.wanted ?? "", picked) ? picked : NO_MATCH });
    }),
  };
}

function propertyDropped(): SpecSuite {
  return {
    name: withoutWanted("property-choice"),
    cases: loadPropertyCases().cases.filter((row) => row.wanted !== null).map((row) => specCase({
      id: row.id, tags: tagsOf(row), spec: propertyChoice(row.candidates.filter((property) => property.key !== row.wanted)),
      state: { phrase: row.phrase, target: row.target }, expected: NO_MATCH,
    })),
  };
}

/** The stress suites: the wanted candidate removed from every choice case that has one. */
export function stressSuites(): ReadonlyArray<SpecSuite> {
  return [effectDropped(), controlDropped(), fontDropped(), propertyDropped()];
}
