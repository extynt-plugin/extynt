#!/usr/bin/env node

/** Command line for generating the host verification kit and analysing its report. */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { renderVerificationCoverage, SUPPORTED_HOSTS, supportedHostKey, verificationCoverage } from "@extynt/capability-catalogue";
import { hostLedgerPath, readLocalHostLedger, writeLocalHostLedgerEntry } from "@extynt/mcp-server";
import type { JsonObject } from "./json.js";
import { analyzeReport, ledgerEntryOf, renderSummary, type AnalysisResult } from "./analyze.js";
import { buildPack, renderRunner } from "./generate.js";
import { analyzeOpenQuestions, renderQuestionsSummary } from "./questions.js";
import { finalProvenanceProblems, parseLiveReport, parseOpenQuestionsReport, parseProgressRecords, progressReport, type LiveReport } from "./report-parse.js";

const USAGE = "usage: extynt-host-verification generate [--out file.jsx] [--no-effect-sweep] | analyze <report> [--summary out.md] [--write-ledger] | questions <open-questions.json> [--summary out.md] | coverage [--host-key key] [--summary out.md]";

function withFinalReport(report: LiveReport, finalPath: string): LiveReport {
  if (!existsSync(finalPath) || statSync(finalPath).size === 0) return report;
  const finished = parseLiveReport(readFileSync(finalPath, "utf8"));
  const provenanceProblems = [...(report.provenanceProblems ?? []), ...finalProvenanceProblems(report, finished)];
  return { ...report, finishedAt: finished.finishedAt, runnerErrors: [...finished.runnerErrors, ...provenanceProblems], provenanceProblems };
}

function readDirectory(path: string): LiveReport {
  const progress = join(path, "progress.jsonl"), final = join(path, "live-report.json");
  return existsSync(progress) ? withFinalReport(readReport(progress), final) : readReport(final);
}

/** Accepts the final live-report.json or a progress.jsonl from an interrupted run. */
export function readReport(path: string): LiveReport {
  if (statSync(path).isDirectory()) return readDirectory(path);
  const text = readFileSync(path, "utf8");
  if (!path.endsWith(".jsonl")) return parseLiveReport(text);
  const lines = parseProgressRecords(text);
  const headers = lines.filter((line) => line.header === true);
  return progressReport(headers[0] ?? {}, mergeCaseLines(lines), headers.length ? headers : [{}]);
}

function crashedLine(previous: JsonObject, line: JsonObject): JsonObject {
  const merged: JsonObject = { ...previous, status: "host-crashed" };
  for (const key of ["crashPhase", "error"]) {
    const value = line[key];
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

function mergeCaseLines(lines: JsonObject[]): JsonObject[] {
  const byId = new Map<string, JsonObject>();
  for (const line of lines) {
    if (line.header === true || typeof line.id !== "string") continue;
    const previous = byId.get(line.id);
    if (previous && line.status === "host-crashed" && previous.host) byId.set(line.id, crashedLine(previous, line));
    else byId.set(line.id, line);
  }
  return [...byId.values()];
}

const flag = (args: string[], name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const reportArgument = (args: string[], summaryFlag: string | undefined): string | undefined => args.find((arg) => !arg.startsWith("--") && arg !== summaryFlag);

function writeSummary(summary: string, summaryPath: string | undefined): void {
  if (summaryPath) writeFileSync(resolve(summaryPath), summary);
  else process.stdout.write(summary);
}

function runGenerate(rest: string[]): number {
  const out = resolve(flag(rest, "--out") ?? "extynt-live-verification.jsx");
  const { pack, issues } = buildPack({ effectSweep: !rest.includes("--no-effect-sweep") });
  if (issues.length) { for (const issue of issues) console.error(`broken case ${issue.id}: ${issue.problem}`); if (!rest.includes("--allow-broken")) return 2; }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderRunner(pack));
  console.log(`${out}\n${pack.cases.length} cases (${pack.cases.filter((entry) => entry.plannerOnly).length} planner-only), pack ${pack.kit.packDigest.slice(0, 16)}\nRun it from After Effects and type PROBE for the open host questions (writes open-questions.json), then: extynt-host-verification questions <open-questions.json>`);
  return 0;
}

function runQuestions(rest: string[]): number {
  const summaryPath = flag(rest, "--summary");
  const reportPath = reportArgument(rest, summaryPath);
  if (!reportPath) { console.error("usage: questions <open-questions.json> [--summary out.md]"); return 2; }
  const result = analyzeOpenQuestions(parseOpenQuestionsReport(readFileSync(resolve(reportPath), "utf8")));
  writeSummary(renderQuestionsSummary(result), summaryPath);
  return result.counts.missing || result.counts.error || result.counts.unanswered ? 1 : 0;
}

function writeLedger(result: AnalysisResult): void {
  writeLocalHostLedgerEntry(ledgerEntryOf(result, new Date().toISOString()));
  console.error(`ledger updated for ${result.hostKey}: ${hostLedgerPath()}`);
}

const isIncomplete = (result: AnalysisResult, report: LiveReport): boolean => Boolean(result.counts.fail || result.counts["broken-case"] || result.counts["not-run"] || result.runnerErrors.length || report.finishedAt === null);

function writeLedgerIfComplete(result: AnalysisResult, incomplete: boolean): void {
  if (incomplete) console.error("ledger not updated: host verification is incomplete");
  else writeLedger(result);
}

function runAnalyze(rest: string[]): number {
  const summaryPath = flag(rest, "--summary");
  const reportPath = reportArgument(rest, summaryPath);
  if (!reportPath) { console.error("usage: analyze <live-report.json|progress.jsonl> [--summary out.md] [--write-ledger]"); return 2; }
  const report = readReport(resolve(reportPath));
  const result = analyzeReport(report);
  writeSummary(renderSummary(result), summaryPath);
  const incomplete = isIncomplete(result, report);
  if (rest.includes("--write-ledger")) writeLedgerIfComplete(result, incomplete);
  return incomplete ? 1 : 0;
}

function runCoverage(rest: string[]): number {
  const summaryPath = flag(rest, "--summary");
  const ledger = readLocalHostLedger();
  const named = flag(rest, "--host-key");
  const keys = named ? [named] : SUPPORTED_HOSTS.map(supportedHostKey);
  writeSummary(keys.map((hostKey) => renderVerificationCoverage(verificationCoverage({ hostKey, ledger }))).join("\n"), summaryPath);
  return 0;
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (command === "generate") return runGenerate(rest);
  if (command === "questions") return runQuestions(rest);
  if (command === "analyze") return runAnalyze(rest);
  if (command === "coverage") return runCoverage(rest);
  console.error(USAGE);
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
