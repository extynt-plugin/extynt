// The file-based gate stages: each takes the --paths predicate and checks only the matching files.
import { readFileSync } from "node:fs";
import { bannedTokenFailures } from "./banned-tokens.ts";
import { headerLengthReport } from "./census.ts";
import { commentFailures } from "./comment-rules.ts";
import { deadExportFailures } from "./dead-exports.ts";
import { formatFailures } from "./format-check.ts";
import { innoMetricFailures } from "./inno-rules.ts";
import { metricFailures } from "./metric-checks.ts";
import { nativeMetricFailures } from "./native-metrics.ts";
import { unknownBoundaryFailures, unknownBoundarySummary } from "./unknown-boundary.ts";
import { unusedLocals, unusedLocalVerdict } from "./unused-locals.ts";
import { shellFailures } from "./shell-check.ts";
import { GENERATED_FILES, ROOT, innoFiles, isExcludedPath, maintainedFiles, nativeFiles, powershellFiles, rel, shellFiles, statFile, trackedWorktreeFiles } from "./sources.ts";
import type { PathScope } from "./path-filter.ts";
import type { SourceEntry } from "./source-entry.ts";
import { failOn, passed } from "./stage-runner.ts";
import type { StageResult, StageTask } from "./stage-runner.ts";

/** The labels of the file-based stages, in no particular order. */
export type FileStageLabel =
  | "metrics" | "comments" | "header-length" | "dead-exports" | "unknown-boundary"
  | "native-metrics" | "whitespace" | "format" | "banned-tokens" | "shell";

type FileStage = (keep: PathScope) => StageResult | Promise<StageResult>;

const SKIPPED_PARTS = new Set([".git", "node_modules", "dist", ".check-logs"]);

function matching(files: ReadonlyArray<string>, keep: PathScope): string[] {
  return files.filter((file) => keep(rel(file)));
}

function entriesOf(files: ReadonlyArray<string>): SourceEntry[] {
  return [...new Set(files)].map((file) => ({ key: rel(file), text: readFileSync(file, "utf8") }));
}

function allSources(): string[] {
  return [...maintainedFiles(), ...nativeFiles(), ...shellFiles(), ...powershellFiles(), ...innoFiles()];
}

function whitespaceFailures(file: string): string[] {
  if (!statFile(file)) return [];
  const text = readFileSync(file, "utf8");
  if (text.includes("\0")) return [];
  const failures: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (/[ \t]+$/.test(line)) failures.push(`${rel(file)}:${index + 1}: trailing whitespace`);
    if (/^\t+$/.test(line)) failures.push(`${rel(file)}:${index + 1}: tab-only blank line`);
  });
  return failures;
}

function isWhitespaceChecked(file: string): boolean {
  const key = rel(file);
  return !key.split("/").some((part) => SKIPPED_PARTS.has(part)) && !GENERATED_FILES.has(key) && !isExcludedPath(key);
}

function whitespaceStage(keep: PathScope): StageResult {
  const files = matching(trackedWorktreeFiles().filter(isWhitespaceChecked), keep);
  return passed("whitespace", failOn(files.flatMap(whitespaceFailures), files.length));
}

function metricsStage(keep: PathScope): StageResult {
  const files = matching(maintainedFiles(), keep);
  return passed("metrics", failOn(metricFailures(files), files.length));
}

function commentsStage(keep: PathScope): StageResult {
  const entries = entriesOf(matching(allSources(), keep));
  return passed("comments", failOn(entries.flatMap(commentFailures), entries.length));
}

function headerLengthStage(keep: PathScope): StageResult {
  const entries = entriesOf(matching(allSources(), keep));
  return passed("header-length", failOn(headerLengthReport(entries).files, entries.length));
}

async function deadExportsStage(keep: PathScope): Promise<StageResult> {
  const { failures, summary } = unusedLocalVerdict(await unusedLocals(keep));
  const result = passed("dead-exports", failOn([...deadExportFailures(keep), ...failures], 0, [summary]));
  return { ...result, summary };
}

function unknownBoundaryStage(keep: PathScope): StageResult {
  const entries = entriesOf(matching(maintainedFiles(), keep).filter((file) => /\.tsx?$/.test(file)));
  const failures = unknownBoundaryFailures(entries);
  return passed("unknown-boundary", failOn(failures, entries.length, unknownBoundarySummary(failures)));
}

function nativeMetricsStage(keep: PathScope): StageResult {
  const files = matching(nativeFiles(), keep).map(rel);
  const inno = entriesOf(matching(innoFiles(), keep));
  const failures = files.length ? nativeMetricFailures({ root: ROOT, files }) : [];
  return passed("native-metrics", failOn([...failures, ...inno.flatMap(({ key, text }) => innoMetricFailures(key, text))], files.length + inno.length));
}

function formatStage(keep: PathScope): StageResult {
  const files = matching(nativeFiles(), keep).map(rel);
  const failures = files.length ? formatFailures({ root: ROOT, files }) : [];
  return passed("format", failOn(failures, files.length));
}

function bannedTokensStage(keep: PathScope): StageResult {
  const entries = entriesOf(matching(allSources(), keep));
  return passed("banned-tokens", failOn(bannedTokenFailures(entries), entries.length));
}

function shellStage(keep: PathScope): StageResult {
  const shell = matching(shellFiles(), keep).map(rel);
  const powershell = matching(powershellFiles(), keep).map(rel);
  return passed("shell", failOn(shellFailures({ root: ROOT, shellFiles: shell, powershellFiles: powershell }), shell.length + powershell.length));
}

/** The file-based stages as [label, task] pairs, in gate order, each limited by the `keep` predicate. */
export function fileStages(keep: PathScope): Readonly<Record<FileStageLabel, StageTask>> {
  const stage = (task: FileStage): StageTask => () => task(keep);
  return {
    metrics: stage(metricsStage),
    comments: stage(commentsStage),
    "header-length": stage(headerLengthStage),
    "dead-exports": stage(deadExportsStage),
    "unknown-boundary": stage(unknownBoundaryStage),
    "native-metrics": stage(nativeMetricsStage),
    whitespace: stage(whitespaceStage),
    format: stage(formatStage),
    "banned-tokens": stage(bannedTokensStage),
    shell: stage(shellStage),
  };
}
