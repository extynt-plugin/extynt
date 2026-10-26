// Simulates routing offline from raw model runs, and fits the bands that maximise routed accuracy while the model alone is trusted only where it is right.
import { route } from "@extynt/decide";
import type { Band, Bands } from "@extynt/decide";
import { answerText } from "./decision-eval-cases.js";
import type { RawRun, SpecCase } from "./decision-eval-types.js";

/** A case with what the model said when asked raw, and when asked with the label order reversed (null when not asked). */
export interface CaseRun {
  readonly spec: SpecCase;
  readonly raw: RawRun | null;
  readonly reversed: RawRun | null;
}

interface RoutedAnswer {
  readonly answer: string;
  readonly band: Band | null;
  readonly fromModel: boolean;
}

const NEVER_ACT = 1.01;

const VERIFY_GRID: ReadonlyArray<number> = [0, 0.5, 0.6, 0.7, 0.8, 0.9];

const ACT_GRID: ReadonlyArray<number> = [0.7, 0.8, 0.9, 0.95, 0.99, NEVER_ACT];

const ACT_ACCURACY_FLOOR = 0.95;

/** The answer a case would get through routing with the given bands. */
export function routedAnswer(run: CaseRun, bands: Bands): RoutedAnswer {
  const deterministic = answerText(run.spec.deterministic);
  if (run.raw === null || run.raw.core === null) return { answer: deterministic, band: null, fromModel: false };
  if (run.spec.vetoes(run.raw.core)) return { answer: deterministic, band: "verify", fromModel: false };
  const { deterministic: fallback, abstained, high, preference, guarded } = run.spec;
  const routed = route({ model: run.raw.core, deterministic: fallback, deterministicAbstained: abstained, bands, high, preference, guarded });
  if (routed.ok) return { answer: answerText(routed.core), band: routed.band, fromModel: true };
  return { answer: deterministic, band: routed.band, fromModel: false };
}

/** Whether a case's answer matches the label. */
export function correct(run: CaseRun, answer: string): boolean {
  return answer === run.spec.expected;
}

function rate(hits: number, total: number): number {
  return total === 0 ? 1 : hits / total;
}

/** The fitted bands with what they score on the runs they were fitted on. */
export interface Fit {
  readonly bands: Bands;
  readonly routedAccuracy: number;
  readonly routedCost: number;
  readonly actAccuracy: number | null;
  readonly actShare: number;
}

/** What the runs score under the given bands. */
export function score(runs: ReadonlyArray<CaseRun>, bands: Bands): Fit {
  const answers = runs.map((run) => ({ run, routed: routedAnswer(run, bands) }));
  const acted = answers.filter((entry) => entry.routed.band === "act");
  const actHits = acted.filter((entry) => correct(entry.run, entry.routed.answer)).length;
  return {
    bands,
    routedCost: answers.reduce((sum, entry) => sum + entry.run.spec.cost(entry.routed.answer), 0),
    routedAccuracy: rate(answers.filter((entry) => correct(entry.run, entry.routed.answer)).length, answers.length),
    actAccuracy: acted.length === 0 ? null : actHits / acted.length,
    actShare: rate(acted.length, answers.length),
  };
}

function better(left: Fit, right: Fit): boolean {
  if (left.routedCost !== right.routedCost) return left.routedCost < right.routedCost;
  if (left.routedAccuracy !== right.routedAccuracy) return left.routedAccuracy > right.routedAccuracy;
  if (left.actShare !== right.actShare) return left.actShare > right.actShare;
  return left.bands.act < right.bands.act;
}

/**
 * Chooses the bands on a grid: the lowest routed cost (the highest routed accuracy when every mistake costs the same)
 * among those whose Act band is at least as accurate as the deterministic tier and 95%,
 * then the larger Act share. A grid that no band satisfies falls back to never acting on the model alone.
 */
export function fitBands(runs: ReadonlyArray<CaseRun>): Fit {
  const deterministicHits = runs.filter((run) => correct(run, answerText(run.spec.deterministic))).length;
  const floor = Math.max(rate(deterministicHits, runs.length), ACT_ACCURACY_FLOOR);
  const fits = VERIFY_GRID.flatMap((verify) => ACT_GRID.filter((act) => act >= verify).map((act) => score(runs, { verify, act })));
  const allowed = fits.filter((fit) => fit.actAccuracy === null || fit.actAccuracy >= floor);
  return (allowed.length === 0 ? fits : allowed).reduce((best, fit) => (better(fit, best) ? fit : best));
}
