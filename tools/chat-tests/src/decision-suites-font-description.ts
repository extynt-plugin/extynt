// The font-by-description tournament suite: described looks, names and typos resolved over a system-font inventory; any accepted family is right.
import { performance } from "node:perf_hooks";
import { NO_MATCH, fontRecords, resolveFont } from "@extynt/decide";
import type { Bands, FontRecord } from "@extynt/decide";
import { shippedBands } from "./decision-heldout.js";
import { load, tagsOf } from "./decision-fixtures.js";
import { loadFontDescriptionCases, type FixtureSet } from "./decision-fixtures-animation.js";
import type { AskOptions, ResolveCase, ResolveRun, ResolveSuite } from "./decision-eval-types.js";

/** The installed system fonts the description cases are resolved against. */
export const loadSystemFonts = (): ReadonlyArray<FontRecord> => load("fonts-system-installed.json", fontRecords);

function expectedFamily(accepted: ReadonlyArray<string>): string {
  return accepted[0] ?? NO_MATCH;
}

/** One description case resolved with the given bands (the shipped ones when omitted). */
export async function resolveDescription(phrase: string, installed: ReadonlyArray<FontRecord>, options: AskOptions, bands?: Bands) {
  return resolveFont(phrase, installed, { models: options.models, decisionTimeoutMs: options.decisionTimeoutMs }, bands === undefined ? {} : { bands });
}

function descriptionCase(bands: Bands | undefined, row: { readonly id: string; readonly phrase: string; readonly accepted: ReadonlyArray<string>; readonly lang?: "en" | "es" | "de" | "fr" | "ja" | "zh" | undefined; readonly hard?: boolean | undefined }, installed: ReadonlyArray<FontRecord>): ResolveCase {
  const expected = expectedFamily(row.accepted);
  return {
    id: row.id, tags: tagsOf(row), expected,
    async resolve(options): Promise<ResolveRun> {
      const started = performance.now();
      const result = await resolveDescription(row.phrase, installed, options, bands);
      const accepted = row.accepted.length === 0 ? result.key === NO_MATCH : row.accepted.includes(result.key);
      return {
        key: accepted ? expected : result.key, rounds: result.rounds, requests: result.requests, failures: result.fallbacks,
        held: row.accepted.length === 0 || result.shortlist.some((candidate) => row.accepted.includes(candidate.key)), latencyMs: performance.now() - started,
      };
    },
  };
}

/** The font-description suite over the system-font inventory. */
export function fontDescriptionSuites(set: FixtureSet = "fit"): ReadonlyArray<ResolveSuite> {
  const installed = loadSystemFonts();
  return [{ name: "font-description", size: new Set(installed.map((font) => font.family)).size, cases: loadFontDescriptionCases(set).cases.map((row) => descriptionCase(set === "heldout" ? shippedBands("font-description") : undefined, row, installed)) }];
}
