// C++ / Objective-C++ metrics through lizard, with the same limits as TS/JS/JSX (the MAX_* constants in measure.ts).
// A sdk_* wrapper file may define a function whose parameter list the platform fixes (the AEGP entry point); no other function is exempt.
// Nesting is owned by clang-tidy (readability-function-size), not lizard.
import { spawnSync } from "node:child_process";
import { MAX_COMPLEXITY, MAX_FILE_LINES, MAX_FUNCTION_LINES, MAX_PARAMS } from "./measure.ts";
import { SDK_WRAPPER_FILE } from "./native-wrapper-tidy.ts";
import { missingToolMessage, requireTools } from "./tools.ts";

interface LizardFunction {
  readonly nloc: number;
  readonly ccn: number;
  readonly params: number;
  readonly name: string;
  readonly line: number;
  readonly file: string;
}

interface LizardFile {
  readonly nloc: number;
  readonly file: string;
}

interface LizardReport {
  readonly functions: readonly LizardFunction[];
  readonly files: readonly LizardFile[];
}

interface NativeMetricsRequest {
  readonly root: string;
  readonly files: readonly string[];
}

const FUNCTION_ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+?)@(\d+)-(\d+)@(\S+)\s*$/;
const FILE_ROW = /^\s*(\d+)\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+(\d+)\s+(\S+)\s*$/;

/** Reads lizard's default report into function rows and per-file NLOC rows. */
export function parseLizard(output: string): LizardReport {
  const functions: LizardFunction[] = [];
  const files: LizardFile[] = [];
  for (const line of output.split("\n")) {
    const row = FUNCTION_ROW.exec(line);
    const fileRow = FILE_ROW.exec(line);
    if (row) functions.push({ nloc: Number(row[1]), ccn: Number(row[2]), params: Number(row[4]), name: row[6] ?? "", line: Number(row[7]), file: row[9] ?? "" });
    else if (fileRow) files.push({ nloc: Number(fileRow[1]), file: fileRow[3] ?? "" });
  }
  return { functions, files };
}

const PLATFORM_FIXED_SIGNATURES = new Set(["EntryPointFunc", "extynt::ae::sdkwin::foregroundEvent"]);

function parameterLimit(item: LizardFunction): number {
  return SDK_WRAPPER_FILE.test(item.file) && PLATFORM_FIXED_SIGNATURES.has(item.name) ? Infinity : MAX_PARAMS;
}

function functionFailures(item: LizardFunction): string[] {
  const where = `${item.file}:${item.line} ${item.name}`;
  const failures: string[] = [];
  if (item.nloc > MAX_FUNCTION_LINES) failures.push(`${where} has ${item.nloc} NLOC > ${MAX_FUNCTION_LINES}`);
  if (item.ccn > MAX_COMPLEXITY) failures.push(`${where} complexity ${item.ccn} > ${MAX_COMPLEXITY}`);
  if (item.params > parameterLimit(item)) failures.push(`${where} has ${item.params} parameters; pass one struct`);
  return failures;
}

export function lizardFailures({ functions, files }: LizardReport): string[] {
  const failures = functions.flatMap(functionFailures);
  for (const file of files) if (file.nloc > MAX_FILE_LINES) failures.push(`${file.file}: ${file.nloc} NLOC > ${MAX_FILE_LINES}`);
  return failures;
}

/** Runs lizard on repo-relative native files and returns the limit failures. */
export function nativeMetricFailures({ root, files }: NativeMetricsRequest): string[] {
  const lizard = requireTools(["lizard"]).get("lizard");
  if (!lizard) throw new Error(missingToolMessage(["lizard"]));
  const result = spawnSync(lizard, ["-l", "cpp", "-l", "objectivec", "-C", "1000", ...files], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0 && !result.stdout) throw new Error(`lizard failed: ${result.stderr}`);
  const parsed = parseLizard(result.stdout);
  if (!parsed.files.length) throw new Error("lizard reported no files; the native metrics gate measured nothing");
  return lizardFailures(parsed);
}
