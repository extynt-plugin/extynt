// Scores the offline resolvers against the labelled decision fixtures: loads each fixture file and counts the cases the deterministic answer gets right.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { array, boolean, decodeJson, nullable, number, object, optional, record, string } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import { NO_MATCH, controlCandidates, controlChoice, effectCandidates, effectChoice, fontChoice, fontRecords, propertyCandidates, propertyChoice, resolveFont } from "../src/index.js";
import type { EffectCandidate, FontRecord } from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "..", "tools", "chat-tests", "fixtures", "decisions");

/** The tally of one suite: right and total, and the ids of the cases it got wrong. */
export interface Tally {
  readonly right: number;
  readonly total: number;
  readonly wrong: ReadonlyArray<string>;
}

function load<T>(name: string, decoder: Decoder<T>): T {
  const decoded = decodeJson(readFileSync(join(FIXTURES, name), "utf8"), decoder);
  if (!decoded.ok) throw new Error(`${name}: ${decoded.error.message}`);
  return decoded.value;
}

function tally(rows: ReadonlyArray<{ readonly id: string; readonly right: boolean }>): Tally {
  return { right: rows.filter((row) => row.right).length, total: rows.length, wrong: rows.filter((row) => !row.right).map((row) => row.id) };
}

const tags = { id: string(), lang: optional(string()), hard: optional(boolean()) };

const effectRows = object({ cases: array(object({ ...tags, phrase: string(), candidates: array(string()), wanted: nullable(string()) })) });
const habitRows = object({ cases: array(object({ ...tags, phrase: string(), candidates: array(string()), habit: record(string(), number()), wanted: nullable(string()) })) });
const controlRows = object({
  effects: record(string(), object({ displayName: string(), controls: controlCandidates })),
  cases: array(object({ ...tags, effect: string(), phrase: string(), wanted: nullable(string()) })),
});
const fontRows = object({ cases: array(object({ ...tags, phrase: string(), wanted: nullable(string()) })) });
const propertyRows = object({ cases: array(object({ ...tags, phrase: string(), target: string(), candidates: propertyCandidates, wanted: nullable(string()) })) });
const descriptionRows = object({ cases: array(object({ ...tags, phrase: string(), accepted: array(string()) })) });

function shortlistOf(catalogue: ReadonlyArray<EffectCandidate>, names: ReadonlyArray<string>): ReadonlyArray<EffectCandidate> {
  const byName = new Map(catalogue.map((effect) => [effect.matchName, effect]));
  return names.flatMap((name) => byName.get(name) ?? []);
}

function expectedEffect(wanted: string | null, names: ReadonlyArray<string>): string {
  return wanted !== null && names.includes(wanted) ? wanted : NO_MATCH;
}

/** The effect-pick suite. */
export function effectPick(catalogue: ReadonlyArray<EffectCandidate> = load("effects-catalogue.json", effectCandidates)): Tally {
  return tally(load("effect-resolution.json", effectRows).cases.map((row) => ({
    id: row.id, right: effectChoice(shortlistOf(catalogue, row.candidates)).deterministic({ phrase: row.phrase }) === expectedEffect(row.wanted, row.candidates),
  })));
}

/** The effect-habits suite. */
export function effectHabits(): Tally {
  const catalogue = load("effects-catalogue.json", effectCandidates);
  return tally(load("effect-habits.json", habitRows).cases.map((row) => {
    const habits = { score: row.habit, note: {} };
    const spec = effectChoice(shortlistOf(catalogue, row.candidates), Object.keys(row.habit).length === 0 ? undefined : habits);
    return { id: row.id, right: spec.deterministic({ phrase: row.phrase }) === (row.wanted ?? NO_MATCH) };
  }));
}

/** The control-resolution suite. */
export function controlPick(): Tally {
  const { effects, cases } = load("control-resolution.json", controlRows);
  return tally(cases.map((row) => ({
    id: row.id,
    right: controlChoice(effects[row.effect]?.controls ?? []).deterministic({ phrase: row.phrase, effect: effects[row.effect]?.displayName ?? row.effect }) === (row.wanted ?? NO_MATCH),
  })));
}

/** The font-matching suite over the fixture host's installed fonts. */
export function fontPick(installed: ReadonlyArray<FontRecord> = load("fonts-installed.json", fontRecords)): Tally {
  return tally(load("fonts.json", fontRows).cases.map((row) => ({ id: row.id, right: fontChoice(row.phrase, installed).deterministic({ phrase: row.phrase }) === (row.wanted ?? NO_MATCH) })));
}

/** The property-choice suite, from the fit file or the heldout one. */
export function propertyPick(file: string): Tally {
  return tally(load(file, propertyRows).cases.map((row) => ({
    id: row.id, right: propertyChoice(row.candidates).deterministic({ phrase: row.phrase, target: row.target }) === (row.wanted ?? NO_MATCH),
  })));
}

/** The font-description suite, from the fit file or the heldout one, resolved with no decision model. */
export async function descriptionPick(file: string): Promise<Tally> {
  const installed = load("fonts-system-installed.json", fontRecords);
  const rows = load(file, descriptionRows).cases;
  const results = await Promise.all(rows.map((row) => resolveFont(row.phrase, installed, { models: [] })));
  return tally(rows.map((row, index) => {
    const key = results[index]?.key ?? NO_MATCH;
    return { id: row.id, right: row.accepted.length === 0 ? key === NO_MATCH : row.accepted.includes(key) };
  }));
}
