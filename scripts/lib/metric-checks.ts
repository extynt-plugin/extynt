// The metrics stage: file size, function size, complexity, nesting, parameters and unsafe syntax for TS, JS, MJS and JSX files.
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { MAX_COMPLEXITY, MAX_FILE_LINES, MAX_FUNCTION_LINES, MAX_NESTING, MAX_PARAMS, functionMetrics, logicalLines, parseSource, tokenSpans, unsafeSyntax } from "./measure.ts";
import type { FunctionMetric } from "./measure.ts";
import { ROOT, rel } from "./sources.ts";

type LimitedField = "lines" | "complexity" | "nesting";
type LimitRow = readonly [field: LimitedField, limit: number, message: (metric: FunctionMetric) => string];

const LIMITS: ReadonlyArray<LimitRow> = [
  ["lines", MAX_FUNCTION_LINES, (metric) => `has ${metric.lines} logical LOC > ${MAX_FUNCTION_LINES}`],
  ["complexity", MAX_COMPLEXITY, (metric) => `complexity ${metric.complexity} > ${MAX_COMPLEXITY}`],
  ["nesting", MAX_NESTING, (metric) => `nesting ${metric.nesting} > ${MAX_NESTING}`],
];

function functionFailures(key: string, metric: FunctionMetric): string[] {
  const where = `${key}:${metric.line} ${metric.name}`;
  const failures = LIMITS.filter(([field, limit]) => metric[field] > limit).map(([, , message]) => `${where} ${message(metric)}`);
  if (metric.params > MAX_PARAMS && !metric.objectParam) failures.push(`${where} has ${metric.params} parameters; use a typed parameter object`);
  return failures;
}

/** Limit failures for one file on disk. */
export function fileFailures(file: string): string[] {
  const key = rel(file);
  const { text, source } = parseSource(file);
  const spans = tokenSpans(source);
  const failures = unsafeSyntax(source).map((failure) => `${key}: ${failure}`);
  const logical = logicalLines(spans, 0, text.length);
  if (logical > MAX_FILE_LINES) failures.push(`${key}: ${logical} logical LOC > ${MAX_FILE_LINES}`);
  for (const metric of functionMetrics(source, spans, { moduleIife: extname(file) === ".jsx" })) failures.push(...functionFailures(key, metric));
  return failures;
}

/** Failures for the given files; the limits have no baseline and no exceptions. */
export function metricFailures(files: ReadonlyArray<string>): string[] {
  if (existsSync(join(ROOT, "scripts", "metric-baseline.json"))) throw new Error("scripts/metric-baseline.json exists; this repository has no metric exceptions");
  return files.flatMap(fileFailures);
}
