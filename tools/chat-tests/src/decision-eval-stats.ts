// Reduces a suite's runs to the numbers the report prints: accuracy of each tier, bands, hard cases, languages, order sensitivity and cost.
import type { Band, Bands, FailureReason } from "@extynt/decide";
import { answerText } from "./decision-eval-cases.js";
import { correct, routedAnswer } from "./decision-eval-routing.js";
import type { CaseRun } from "./decision-eval-routing.js";
import type { Language } from "./decision-eval-types.js";

/** Counts of cases and of those answered correctly. */
export interface Tally {
  readonly cases: number;
  readonly correct: number;
}

interface OrderStats {
  readonly cases: number;
  readonly asShown: number;
  readonly reversed: number;
  readonly flips: number;
}

interface Abstention {
  readonly answered: Tally;
  readonly abstained: Tally;
}

/** Everything the report says about one suite under one set of bands. */
export interface SuiteStats {
  readonly cases: number;
  readonly deterministic: Tally;
  readonly abstention: Abstention;
  readonly raw: Tally | null;
  readonly routed: Tally | null;
  readonly bands: Readonly<Record<Band, Tally>> | null;
  readonly hard: { readonly deterministic: Tally; readonly routed: Tally | null };
  readonly languages: Readonly<Partial<Record<Language, { readonly deterministic: Tally; readonly routed: Tally | null }>>>;
  readonly order: OrderStats | null;
  readonly medianMs: number | null;
  readonly p95Ms: number | null;
  readonly meanTokens: number | null;
  readonly failures: Readonly<Partial<Record<FailureReason, number>>>;
}

function tally(runs: ReadonlyArray<CaseRun>, answerOf: (run: CaseRun) => string): Tally {
  return { cases: runs.length, correct: runs.filter((run) => correct(run, answerOf(run))).length };
}

function percentile(values: ReadonlyArray<number>, fraction: number): number | null {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length === 0 ? null : (sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? null);
}

function rawAnswer(run: CaseRun): string {
  return run.raw === null || run.raw.core === null ? answerText(run.spec.deterministic) : answerText(run.raw.core);
}

function reversedAnswer(run: CaseRun): string {
  return run.reversed === null || run.reversed.core === null ? answerText(run.spec.deterministic) : answerText(run.reversed.core);
}

function orderOf(runs: ReadonlyArray<CaseRun>): OrderStats | null {
  const asked = runs.filter((run) => run.reversed !== null && run.raw !== null);
  if (asked.length === 0) return null;
  return {
    cases: asked.length,
    asShown: tally(asked, rawAnswer).correct,
    reversed: tally(asked, reversedAnswer).correct,
    flips: asked.filter((run) => rawAnswer(run) !== reversedAnswer(run)).length,
  };
}

function failuresOf(runs: ReadonlyArray<CaseRun>): Partial<Record<FailureReason, number>> {
  const counts = new Map<FailureReason, number>();
  for (const run of runs) if (run.raw !== null && run.raw.failure !== null) counts.set(run.raw.failure, (counts.get(run.raw.failure) ?? 0) + 1);
  return Object.fromEntries(counts);
}

function languagesOf(runs: ReadonlyArray<CaseRun>, bands: (run: CaseRun) => Bands, asked: boolean): SuiteStats["languages"] {
  const result: Partial<Record<Language, { deterministic: Tally; routed: Tally | null }>> = {};
  for (const lang of new Set(runs.map((run) => run.spec.tags.lang))) {
    const own = runs.filter((run) => run.spec.tags.lang === lang);
    result[lang] = {
      deterministic: tally(own, (run) => answerText(run.spec.deterministic)), routed: asked ? tally(own, (run) => routedAnswer(run, bands(run)).answer) : null,
    };
  }
  return result;
}

/** The numbers for a suite, routed with `bandsFor` (a case's own bands, or fitted ones); the model figures are null when no model took part. */
export function statsOf(runs: ReadonlyArray<CaseRun>, bandsFor: (run: CaseRun) => Bands): SuiteStats {
  const asked = runs.some((run) => run.raw !== null);
  const routed = (run: CaseRun): string => routedAnswer(run, bandsFor(run)).answer;
  const deterministic = (run: CaseRun): string => answerText(run.spec.deterministic);
  const inBand = (band: Band): Tally => tally(runs.filter((run) => routedAnswer(run, bandsFor(run)).band === band), routed);
  const hard = runs.filter((run) => run.spec.tags.hard);
  const times = runs.flatMap((run) => (run.raw === null ? [] : [run.raw.latencyMs]));
  const tokens = runs.flatMap((run) => (run.raw === null || run.raw.inputTokens === null ? [] : [run.raw.inputTokens]));
  return {
    cases: runs.length,
    deterministic: tally(runs, deterministic),
    abstention: {
      answered: tally(runs.filter((run) => !run.spec.abstained), deterministic),
      abstained: tally(runs.filter((run) => run.spec.abstained), deterministic),
    },
    raw: asked ? tally(runs, rawAnswer) : null,
    routed: asked ? tally(runs, routed) : null,
    bands: asked ? { act: inBand("act"), verify: inBand("verify"), escalate: inBand("escalate") } : null,
    hard: { deterministic: tally(hard, deterministic), routed: asked ? tally(hard, routed) : null },
    languages: languagesOf(runs, bandsFor, asked),
    order: orderOf(runs),
    medianMs: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    meanTokens: tokens.length === 0 ? null : tokens.reduce((sum, value) => sum + value, 0) / tokens.length,
    failures: failuresOf(runs),
  };
}
