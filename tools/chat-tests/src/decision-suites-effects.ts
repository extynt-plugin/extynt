// The suites over runtime-built choices: effects, controls and fonts, each as the flat closed choice a shortlist makes.
import { NO_MATCH, controlChoice, effectChoice, fontChoice } from "@extynt/decide";
import type { EffectCandidate, Habits } from "@extynt/decide";
import { specCase } from "./decision-eval-cases.js";
import { loadControlCases, loadControlHabitCases, loadEffectCases, loadEffectCatalogue, loadFontCases, loadHabitCases, loadInstalledFonts, tagsOf } from "./decision-fixtures.js";
import type { SpecSuite } from "./decision-eval-types.js";

/** The habits a fixture row's use counts stand for, each with the sentence a decision model reads. */
export function habitsOf(counts: Readonly<Record<string, number>>): Habits {
  return { score: counts, note: Object.fromEntries(Object.entries(counts).map(([key, uses]) => [key, `the user's usual choice, used ${uses} times`])) };
}

function effectPick(): SpecSuite {
  const catalogue = new Map(loadEffectCatalogue().map((effect) => [effect.matchName, effect]));
  const shortlistOf = (names: ReadonlyArray<string>): ReadonlyArray<EffectCandidate> => names.flatMap((name) => catalogue.get(name) ?? []);
  return {
    name: "effect-pick",
    cases: loadEffectCases().cases.map((row) => specCase({
      id: row.id, tags: tagsOf(row), spec: effectChoice(shortlistOf(row.candidates)), state: { phrase: row.phrase },
      expected: row.wanted !== null && row.candidates.includes(row.wanted) ? row.wanted : NO_MATCH,
    })),
  };
}

function effectHabits(): SpecSuite {
  const catalogue = new Map(loadEffectCatalogue().map((effect) => [effect.matchName, effect]));
  return {
    name: "effect-habits",
    cases: loadHabitCases().cases.map((row) => specCase({
      id: row.id, tags: tagsOf(row), state: { phrase: row.phrase }, expected: row.wanted ?? NO_MATCH,
      spec: effectChoice(row.candidates.flatMap((name) => catalogue.get(name) ?? []), Object.keys(row.habit).length === 0 ? undefined : habitsOf(row.habit)),
    })),
  };
}

function controlPick(): SpecSuite {
  const { effects, cases } = loadControlCases();
  return {
    name: "control-resolution",
    cases: cases.map((row) => specCase({
      id: row.id, tags: tagsOf(row), spec: controlChoice(effects[row.effect]?.controls ?? []),
      state: { phrase: row.phrase, effect: effects[row.effect]?.displayName ?? row.effect }, expected: row.wanted ?? NO_MATCH,
    })),
  };
}

function controlHabits(): SpecSuite {
  const { effects, cases } = loadControlHabitCases();
  return {
    name: "control-habits",
    cases: cases.map((row) => specCase({
      id: row.id, tags: tagsOf(row), state: { phrase: row.phrase, effect: effects[row.effect]?.displayName ?? row.effect }, expected: row.wanted ?? NO_MATCH,
      spec: controlChoice(effects[row.effect]?.controls ?? [], Object.keys(row.habit).length === 0 ? undefined : habitsOf(row.habit)),
    })),
  };
}

function fontPick(): SpecSuite {
  const installed = loadInstalledFonts();
  return {
    name: "font-matching",
    cases: loadFontCases().cases.map((row) => specCase({
      id: row.id, tags: tagsOf(row), spec: fontChoice(row.phrase, installed), state: { phrase: row.phrase }, expected: row.wanted ?? NO_MATCH,
    })),
  };
}

/** The suites over runtime-built choices. */
export function effectSuites(): ReadonlyArray<SpecSuite> {
  return [effectPick(), effectHabits(), controlPick(), controlHabits(), fontPick()];
}
