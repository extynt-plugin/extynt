// The tournament suites: the same phrases resolved against the installed catalogue padded with neutral filler to 300 and 2000 candidates.
import { performance } from "node:perf_hooks";
import { NO_MATCH, resolveEffect, resolveFont } from "@extynt/decide";
import type { EffectCandidate, FontRecord } from "@extynt/decide";
import { loadEffectCases, loadEffectCatalogue, loadFontCases, loadInstalledFonts, tagsOf } from "./decision-fixtures.js";
import type { CaseTags, ResolveCase, ResolveRun, ResolveSuite } from "./decision-eval-types.js";

const SCALE_SIZES: ReadonlyArray<number> = [300, 2000];

const FILLER_CATEGORIES: ReadonlyArray<string> = ["Blur & Sharpen", "Color Correction", "Distort", "Generate", "Stylize", "Transition"];

function fillerEffects(count: number): ReadonlyArray<EffectCandidate> {
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(4, "0");
    const category = index % 2 === 0 ? (FILLER_CATEGORIES[index % FILLER_CATEGORIES.length] ?? "Stylize") : `Example Pack ${index % 17}`;
    return { matchName: `EX Effect ${number}`, displayName: `Example Effect ${number}`, category };
  });
}

function fillerFonts(count: number): ReadonlyArray<FontRecord> {
  return Array.from({ length: count }, (_, index) => {
    const family = `Example Font ${String(index + 1).padStart(4, "0")}`;
    return { family, style: "Regular", postScriptName: family.replace(/ /g, "") };
  });
}

interface Settled {
  readonly key: string;
  readonly rounds: number;
  readonly requests: number;
  readonly held: boolean;
  readonly fallbacks: number;
}

interface Finished {
  readonly key: string;
  readonly rounds: number;
  readonly requests: number;
  readonly fallbacks: number;
  readonly shortlist: ReadonlyArray<{ readonly key: string }>;
}

function settled(result: Finished, expected: string): Settled {
  const { key, rounds, requests, fallbacks } = result;
  return { key, rounds, requests, fallbacks, held: expected === NO_MATCH || result.shortlist.some((candidate) => candidate.key === expected) };
}

function timed(run: () => Promise<Settled>): Promise<ResolveRun> {
  const started = performance.now();
  return run().then((result) => ({
    key: result.key, rounds: result.rounds, requests: result.requests, held: result.held, failures: result.fallbacks, latencyMs: performance.now() - started,
  }));
}

interface EffectRow {
  readonly id: string;
  readonly phrase: string;
  readonly candidates: ReadonlyArray<string>;
  readonly wanted: string | null;
}

interface FontRow {
  readonly id: string;
  readonly phrase: string;
  readonly wanted: string | null;
}

function effectCase(row: EffectRow, tags: CaseTags, installed: ReadonlyArray<EffectCandidate>): ResolveCase {
  const present = row.wanted !== null && row.candidates.includes(row.wanted);
  const expected = present && row.wanted !== null ? row.wanted : NO_MATCH;
  const pool = installed.filter((effect) => present || effect.matchName !== row.wanted);
  return {
    id: row.id, tags, expected,
    resolve: (options) => timed(async () => {
      const result = await resolveEffect(row.phrase, pool, { models: options.models, decisionTimeoutMs: options.decisionTimeoutMs });
      return settled(result, expected);
    }),
  };
}

function fontCase(row: FontRow, tags: CaseTags, installed: ReadonlyArray<FontRecord>): ResolveCase {
  const expected = row.wanted ?? NO_MATCH;
  return {
    id: row.id, tags, expected,
    resolve: (options) => timed(async () => {
      const result = await resolveFont(row.phrase, installed, { models: options.models, decisionTimeoutMs: options.decisionTimeoutMs });
      return settled(result, expected);
    }),
  };
}

function sized(base: number, size: number): number {
  return Math.max(0, size - base);
}

/** The tournament suites: effect resolution over the installed catalogue and at each scale size, then font resolution the same way. */
export function scaleSuites(): ReadonlyArray<ResolveSuite> {
  const effects = loadEffectCatalogue();
  const fonts = loadInstalledFonts();
  const effectRows = loadEffectCases().cases;
  const fontRows = loadFontCases().cases;
  const effectSuite = (name: string, size: number): ResolveSuite => ({
    name, size: Math.max(size, effects.length),
    cases: effectRows.map((row) => effectCase(row, tagsOf(row), [...effects, ...fillerEffects(sized(effects.length, size))])),
  });
  const fontSuite = (name: string, size: number): ResolveSuite => ({
    name, size: Math.max(size, new Set(fonts.map((font) => font.family)).size),
    cases: fontRows.map((row) => fontCase(row, tagsOf(row), [...fonts, ...fillerFonts(sized(fonts.length, size))])),
  });
  return [
    effectSuite("effect-resolution", 0),
    ...SCALE_SIZES.map((size) => effectSuite(`effect-scale-${size}`, size)),
    fontSuite("font-resolution", 0),
    ...SCALE_SIZES.map((size) => fontSuite(`font-scale-${size}`, size)),
  ];
}
