// Renders the evaluation: a per-decision table, the tournament table, the fitted bands and the cases each tier got wrong; and the full results as JSON.
import { answerText } from "./decision-eval-cases.js";
import { gateOf } from "./decision-eval-gate.js";
import { routedAnswer } from "./decision-eval-routing.js";
import type { CaseRun, Fit } from "./decision-eval-routing.js";
import type { ResolveOutcome } from "./decision-eval-run.js";
import { statsOf } from "./decision-eval-stats.js";
import type { SuiteStats, Tally } from "./decision-eval-stats.js";
import type { ResolveSuite, SpecSuite } from "./decision-eval-types.js";

/** One spec suite with its runs and the bands fitted on them. */
export interface SpecResult {
  readonly suite: SpecSuite;
  readonly runs: ReadonlyArray<CaseRun>;
  readonly fit: Fit | null;
}

/** One tournament suite with its outcomes. */
export interface ResolveResult {
  readonly suite: ResolveSuite;
  readonly outcomes: ReadonlyArray<ResolveOutcome>;
}

const percent = (tally: Tally | null): string => (tally === null || tally.cases === 0 ? "-" : `${Math.round((100 * tally.correct) / tally.cases)}%`);

const share = (tally: Tally | null, of: number): string => (tally === null ? "-" : `${Math.round((100 * tally.cases) / Math.max(1, of))}%/${percent(tally)}`);

function table(header: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>): string {
  const widths = header.map((_, column) => Math.max(...[header, ...rows].map((row) => (row[column] ?? "").length)));
  return [header, ...rows].map((row) => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ").trimEnd()).join("\n");
}

function statsFor(result: SpecResult): SuiteStats {
  const bands = result.fit?.bands;
  return statsOf(result.runs, (run) => bands ?? run.spec.bands);
}

function nonEnglish(stats: SuiteStats): string {
  const others = Object.entries(stats.languages).filter(([lang]) => lang !== "en");
  return others.length === 0 ? "-" : others.map(([lang, row]) => `${lang} ${percent(row.deterministic)}>${percent(row.routed)}`).join(" ");
}

function orderText(stats: SuiteStats): string {
  if (stats.order === null) return "-";
  return `${stats.order.asShown - stats.order.reversed >= 0 ? "+" : ""}${stats.order.asShown - stats.order.reversed} (${stats.order.flips} flips)`;
}

function latencyText(stats: SuiteStats): string {
  return stats.medianMs === null ? "-" : `${Math.round(stats.medianMs)}/${Math.round(stats.p95Ms ?? 0)}`;
}

function bandShares(stats: SuiteStats): ReadonlyArray<string> {
  return [stats.bands?.act ?? null, stats.bands?.verify ?? null, stats.bands?.escalate ?? null].map((tally) => share(tally, stats.cases));
}

function specRow(result: SpecResult): ReadonlyArray<string> {
  const stats = statsFor(result);
  const bands = result.fit?.bands;
  return [
    result.suite.name, String(stats.cases), percent(stats.deterministic), percent(stats.raw), percent(stats.routed), ...bandShares(stats),
    bands === undefined ? "-" : `${bands.verify}/${bands.act}`, orderText(stats), nonEnglish(stats), latencyText(stats), gateOf(stats),
  ];
}

const SPEC_HEADER = ["decision", "n", "det", "jev raw", "routed", "act", "verify", "escalate", "bands v/a", "order", "non-en det>routed", "ms med/p95", "gate"];

const wholePercent = (hits: number, of: number): string => (of === 0 ? "-" : `${Math.round((100 * hits) / of)}%`);

function abstentionRow(name: string, answered: Tally, abstained: Tally): ReadonlyArray<string> {
  const total = answered.cases + abstained.cases;
  const hits = answered.correct + abstained.correct;
  return [
    name, String(total), wholePercent(answered.cases, total), percent(answered), percent(abstained),
    wholePercent(answered.correct, total), wholePercent(hits, total),
  ];
}

const ABSTENTION_HEADER = ["offline abstention", "n", "coverage", "answered acc", "abstained acc", "answered x coverage", "if never abstained"];

function sum(tallies: ReadonlyArray<Tally>): Tally {
  return { cases: tallies.reduce((total, tally) => total + tally.cases, 0), correct: tallies.reduce((total, tally) => total + tally.correct, 0) };
}

function abstentionTable(specs: ReadonlyArray<SpecResult>): string {
  const stats = specs.map((result) => ({ name: result.suite.name, ...statsFor(result).abstention }));
  const rows = stats.map((row) => abstentionRow(row.name, row.answered, row.abstained));
  return table(ABSTENTION_HEADER, [...rows, abstentionRow("all", sum(stats.map((row) => row.answered)), sum(stats.map((row) => row.abstained)))]);
}

function wrong(result: SpecResult): ReadonlyArray<string> {
  const bands = result.fit?.bands;
  const lines = result.runs.flatMap((run) => {
    const routed = routedAnswer(run, bands ?? run.spec.bands);
    const routedText = run.raw === null ? [] : [`routed ${routed.answer} (${routed.band ?? "no model"})`];
    const unsure = `confidence ${run.spec.deterministic.confidence.toFixed(2)}${run.spec.abstained ? ", unsure" : ""}`;
    const own = [`deterministic ${answerText(run.spec.deterministic)} (${unsure})`, ...routedText];
    const bad = answerText(run.spec.deterministic) !== run.spec.expected || (run.raw !== null && routed.answer !== run.spec.expected);
    return bad ? [`  ${run.spec.id}: expected ${run.spec.expected}; ${own.join("; ")}`] : [];
  });
  return lines.length === 0 ? [] : [result.suite.name, ...lines];
}

function resolveTally(outcomes: ReadonlyArray<ResolveOutcome>, pick: (outcome: ResolveOutcome) => string | null): Tally {
  const asked = outcomes.filter((outcome) => pick(outcome) !== null);
  return { cases: asked.length, correct: asked.filter((outcome) => pick(outcome) === outcome.case.expected).length };
}

function median(values: ReadonlyArray<number>): number | null {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length === 0 ? null : (sorted[Math.floor(sorted.length / 2)] ?? null);
}

function heldText(models: ReadonlyArray<{ readonly held: boolean }>, wanted: number): string {
  return models.length === 0 ? "-" : `${Math.round((100 * models.filter((run) => run.held).length) / Math.max(1, wanted))}%`;
}

function resolveRow(result: ResolveResult): ReadonlyArray<string> {
  const { outcomes, suite } = result;
  const models = outcomes.flatMap((outcome) => (outcome.model === null ? [] : [outcome.model]));
  const wanted = outcomes.filter((outcome) => outcome.case.expected !== "none");
  const requests = models.length === 0 ? "-" : (models.reduce((sum, run) => sum + run.requests, 0) / models.length).toFixed(1);
  const latency = median(models.map((run) => run.latencyMs));
  const word = percent(resolveTally(outcomes, (outcome) => outcome.offline.key));
  const jev = percent(resolveTally(outcomes, (outcome) => outcome.model?.key ?? null));
  const held = heldText(wanted.flatMap((outcome) => (outcome.model === null ? [] : [outcome.model])), wanted.length);
  return [
    suite.name, String(suite.size), String(outcomes.length), word, jev, held, requests, latency === null ? "-" : `${Math.round(latency)}`,
    String(models.reduce((sum, run) => sum + run.failures, 0)),
  ];
}

const RESOLVE_HEADER = ["tournament", "catalogue", "n", "word search", "jev", "recall", "requests", "ms med", "fallbacks"];

/** The per-decision table, the tournament table, and the cases each tier got wrong. */
export function renderReport(specs: ReadonlyArray<SpecResult>, resolves: ReadonlyArray<ResolveResult>): string {
  const wrongs = specs.flatMap(wrong);
  return [table(SPEC_HEADER, specs.map(specRow)), "", abstentionTable(specs), "", table(RESOLVE_HEADER, resolves.map(resolveRow)), "", ...wrongs].join("\n");
}

interface CaseJson {
  readonly id: string;
  readonly lang: string;
  readonly hard: boolean;
  readonly expected: string;
  readonly deterministic: string;
  readonly confidence: number;
  readonly abstained: boolean;
  readonly raw: { readonly answer: string; readonly confidence: number } | null;
  readonly failure: string | null;
  readonly reversed: string | null;
  readonly routed: string;
  readonly band: string | null;
  readonly latencyMs: number | null;
  readonly inputTokens: number | null;
}

function rawJson(run: CaseRun): CaseJson["raw"] {
  return run.raw === null || run.raw.core === null ? null : { answer: answerText(run.raw.core), confidence: run.raw.core.confidence };
}

function reversedJson(run: CaseRun): string | null {
  return run.reversed === null || run.reversed.core === null ? null : answerText(run.reversed.core);
}

function rawFacts(run: CaseRun): Pick<CaseJson, "failure" | "latencyMs" | "inputTokens"> {
  return { failure: run.raw?.failure ?? null, latencyMs: run.raw?.latencyMs ?? null, inputTokens: run.raw?.inputTokens ?? null };
}

function caseJson(run: CaseRun, fit: Fit | null): CaseJson {
  const routed = routedAnswer(run, fit?.bands ?? run.spec.bands);
  const { spec } = run;
  return {
    id: spec.id, lang: spec.tags.lang, hard: spec.tags.hard, expected: spec.expected, deterministic: answerText(spec.deterministic),
    confidence: spec.deterministic.confidence, abstained: spec.abstained, raw: rawJson(run),
    reversed: reversedJson(run), routed: routed.answer, band: routed.band, ...rawFacts(run),
  };
}

interface ResolveCaseJson {
  readonly id: string;
  readonly lang: string;
  readonly hard: boolean;
  readonly expected: string;
  readonly offline: ResolveOutcome["offline"];
  readonly model: ResolveOutcome["model"];
}

interface ResolveJson {
  readonly name: string;
  readonly catalogue: number;
  readonly cases: ReadonlyArray<ResolveCaseJson>;
}

function resolveJson(result: ResolveResult): ResolveJson {
  const rows = result.outcomes.map((outcome) => ({
    id: outcome.case.id, lang: outcome.case.tags.lang, hard: outcome.case.tags.hard, expected: outcome.case.expected,
    offline: outcome.offline, model: outcome.model,
  }));
  return { name: result.suite.name, catalogue: result.suite.size, cases: rows };
}

/** The full results as JSON text: per suite its stats, fitted bands, gate and every case. */
export function reportJson(specs: ReadonlyArray<SpecResult>, resolves: ReadonlyArray<ResolveResult>, generatedAt: string): string {
  const suites = specs.map((result) => {
    const stats = statsFor(result);
    return { name: result.suite.name, fit: result.fit, gate: gateOf(stats), stats, cases: result.runs.map((run) => caseJson(run, result.fit)) };
  });
  return JSON.stringify({ generatedAt, suites, tournaments: resolves.map(resolveJson) }, null, 2);
}
