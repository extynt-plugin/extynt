#!/usr/bin/env node
/**
 * Font band refit: resolves every font-description case through the tournament with the model's final pick taken raw, then grids the verify and act bands
 * over the final question's confidence against the offline (word-search) answer.
 * Flags: `--out <path>` writes the cases and the grid as JSON, `--timeout-ms <n>`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { argv } from "node:process";
import { parseArgs } from "node:util";
import { DEFAULT_DECISION_TIMEOUT_MS, NO_MATCH, decisionModelsFromEnvironment, fittedBands, route } from "@extynt/decide";
import type { Bands } from "@extynt/decide";
import { answerText } from "./decision-eval-cases.js";
import { loadFontDescriptionCases } from "./decision-fixtures-animation.js";
import { loadSystemFonts, resolveDescription } from "./decision-suites-font-description.js";

const { values } = parseArgs({ args: argv.slice(2), options: { out: { type: "string" }, "timeout-ms": { type: "string" } } });
const options = { models: decisionModelsFromEnvironment(), decisionTimeoutMs: Number(values["timeout-ms"] ?? DEFAULT_DECISION_TIMEOUT_MS) };
const installed = loadSystemFonts();
const RAW: Bands = { verify: 0, act: 0 };

function requireBands(bands: Bands | undefined, name: string): Bands {
  if (bands === undefined) throw new Error(`no fitted bands for ${name}`);
  return bands;
}
const SHIPPED: Bands = requireBands(fittedBands("font"), "font");

interface Row {
  readonly id: string;
  readonly kind: string;
  readonly accepted: ReadonlyArray<string>;
  readonly offline: string;
  readonly model: string;
  readonly confidence: number;
  readonly answered: boolean;
}

const rows: Row[] = [];
for (const item of loadFontDescriptionCases().cases) {
  const offline = await resolveDescription(item.phrase, installed, { ...options, models: [] });
  const raw = await resolveDescription(item.phrase, installed, options, RAW);
  const kind = item.accepted.length === 0 ? "none" : item.lang !== undefined ? item.lang : item.hard === true ? "hard" : "plain";
  rows.push({ id: item.id, kind, accepted: item.accepted, offline: offline.key, model: raw.key, confidence: raw.final.confidence, answered: raw.final.source === "decision-model" });
}

const right = (accepted: ReadonlyArray<string>, key: string): boolean => (accepted.length === 0 ? key === NO_MATCH : accepted.includes(key));

function routedKey(row: Row, bands: Bands): string {
  if (!row.answered) return row.offline;
  const offlineCore = { label: row.offline, confidence: 1, probabilities: { [row.offline]: 1 } };
  const modelCore = { label: row.model, confidence: row.confidence, probabilities: { [row.model]: row.confidence } };
  const routed = route({ model: modelCore, deterministic: offlineCore, bands, high: false, preference: undefined });
  return routed.ok ? answerText(routed.core) : row.offline;
}

const percent = (hits: number, total: number): string => `${Math.round((100 * hits) / Math.max(1, total))}%`;
const count = (pick: (row: Row) => string, among: ReadonlyArray<Row> = rows): number => among.filter((row) => right(row.accepted, pick(row))).length;
const kinds = [...new Set(rows.map((row) => row.kind))];
process.stdout.write(`cases ${rows.length}; word search ${percent(count((row) => row.offline), rows.length)}; model raw ${percent(count((row) => row.model), rows.length)}\n`);
for (const kind of kinds) {
  const among = rows.filter((row) => row.kind === kind);
  process.stdout.write(`  ${kind.padEnd(6)} n=${among.length} word ${percent(count((row) => row.offline, among), among.length)} model ${percent(count((row) => row.model, among), among.length)}\n`);
}
const grid = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].flatMap((verify) => [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.01].filter((act) => act >= verify).map((act) => {
  const bands = { verify, act };
  const answers = rows.map((row) => ({ row, key: routedKey(row, bands) }));
  const acted = answers.filter((entry) => entry.row.answered && entry.row.confidence >= act);
  const actedRight = acted.filter((entry) => right(entry.row.accepted, entry.key)).length;
  return { verify, act, accuracy: count((row) => routedKey(row, bands)) / rows.length, acted: acted.length, actedRight };
}));
grid.sort((left, right_) => right_.accuracy - left.accuracy || left.act - right_.act);
for (const entry of grid.slice(0, 12)) process.stdout.write(`verify ${entry.verify} act ${entry.act}: accuracy ${percent(Math.round(entry.accuracy * rows.length), rows.length)} acted ${entry.acted} (${entry.actedRight} right)\n`);
const shipped = grid.find((entry) => entry.verify === SHIPPED.verify && entry.act === SHIPPED.act);
process.stdout.write(`shipped ${SHIPPED.verify}/${SHIPPED.act}: ${shipped === undefined ? "not in the grid" : percent(Math.round(shipped.accuracy * rows.length), rows.length)}\n`);
if (values.out !== undefined) {
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, JSON.stringify({ rows, grid }, null, 2));
}
