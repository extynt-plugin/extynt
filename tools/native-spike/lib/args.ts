/** Parses the native-spike command line. */
import { parseArgs } from "node:util";
import { SpikeError } from "./errors.ts";

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  json: { type: "boolean" },
  out: { type: "string" },
  discovery: { type: "string" },
  "timeout-ms": { type: "string" },
  "no-pid-check": { type: "boolean" },
  runs: { type: "string" },
  "comp-id": { type: "string" },
  "comp-name": { type: "string" },
  "layer-name": { type: "string" },
  "layer-id": { type: "string" },
  path: { type: "string" },
  probe: { type: "string" },
  sidecar: { type: "string" },
  "sidecar-token": { type: "string" },
  "session-file": { type: "string" },
  "max-diffs": { type: "string" },
  "max-properties": { type: "string" },
  "max-depth": { type: "string" },
  "cpu-sample": { type: "boolean" },
  "cpu-seconds": { type: "string" },
  "debug-flags": { type: "boolean" },
  details: { type: "boolean" },
} as const;

/** The three commands of the command line. */
export type Command = "bench" | "compare" | "dump";

const COMMANDS: ReadonlySet<string> = new Set<Command>(["bench", "compare", "dump"]);

/** Every option of the command line, with defaults applied; an option never given is undefined. */
export interface CliOptions {
  readonly help: boolean;
  readonly json: boolean;
  readonly out: string | undefined;
  readonly discovery: string | undefined;
  readonly skipPidCheck: boolean;
  readonly timeoutMs: number;
  readonly runs: number;
  readonly compId: string | undefined;
  readonly compName: string | undefined;
  readonly layerName: string | undefined;
  readonly layerId: string | undefined;
  readonly path: string | undefined;
  readonly probe: string | undefined;
  readonly sidecar: string | undefined;
  readonly sidecarToken: string | undefined;
  readonly sessionFile: string | undefined;
  readonly maxDiffs: number;
  readonly maxProperties: number | undefined;
  readonly maxDepth: number | undefined;
  readonly cpuSample: boolean;
  readonly cpuSeconds: number;
  readonly debugFlags: boolean;
  readonly details: boolean;
  readonly commandGiven: boolean;
}

/** The parsed command line: the command, its options and the arguments after the command. */
export interface ParsedCli {
  readonly command: Command;
  readonly options: CliOptions;
  readonly positionals: ReadonlyArray<string>;
}

interface IntegerBounds {
  readonly min: number;
  readonly max: number;
  readonly fallback: number;
}

type IntegerOption = "timeout-ms" | "runs" | "max-diffs" | "max-properties" | "max-depth" | "cpu-seconds";

function readValues(argv: ReadonlyArray<string>) {
  return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
}

type ParsedValues = ReturnType<typeof readValues>["values"];

function positiveInt(raw: string, name: IntegerOption): number {
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1) throw new SpikeError("USAGE", `--${name} must be a positive integer, got "${raw}".`);
  return number;
}

function positiveOr(raw: string | undefined, name: IntegerOption, fallback: number): number {
  return raw === undefined ? fallback : positiveInt(raw, name);
}

function boundedInt(raw: string | undefined, name: IntegerOption, bounds: IntegerBounds): number {
  if (raw === undefined) return bounds.fallback;
  const number = Number(raw);
  if (raw === "" || !Number.isInteger(number) || number < bounds.min || number > bounds.max) {
    throw new SpikeError("USAGE", `--${name} must be an integer from ${bounds.min} to ${bounds.max}, got "${raw}".`);
  }
  return number;
}

function optionalInt(raw: string | undefined, name: IntegerOption): number | undefined {
  return raw === undefined ? undefined : positiveInt(raw, name);
}

function normalize(values: ParsedValues): Omit<CliOptions, "commandGiven"> {
  return {
    help: values.help === true,
    json: values.json === true,
    out: values.out,
    discovery: values.discovery,
    skipPidCheck: values["no-pid-check"] === true,
    timeoutMs: positiveOr(values["timeout-ms"], "timeout-ms", 30000),
    runs: positiveOr(values.runs, "runs", 20),
    compId: values["comp-id"],
    compName: values["comp-name"],
    layerName: values["layer-name"],
    layerId: values["layer-id"],
    path: values.path,
    probe: values.probe,
    sidecar: values.sidecar,
    sidecarToken: values["sidecar-token"],
    sessionFile: values["session-file"],
    maxDiffs: positiveOr(values["max-diffs"], "max-diffs", 5),
    maxProperties: optionalInt(values["max-properties"], "max-properties"),
    maxDepth: optionalInt(values["max-depth"], "max-depth"),
    cpuSample: values["cpu-sample"] === true,
    cpuSeconds: boundedInt(values["cpu-seconds"], "cpu-seconds", { min: 1, max: 3000, fallback: 10 }),
    debugFlags: values["debug-flags"] === true,
    details: values.details === true,
  };
}

function isCommand(text: string): text is Command {
  return COMMANDS.has(text);
}

/** Parses argv into {command, options, positionals}; any problem is a USAGE SpikeError (exit 2). */
export function parseCli(argv: ReadonlyArray<string>): ParsedCli {
  let parsed: ReturnType<typeof readValues>;
  try { parsed = readValues(argv); } catch (error) {
    throw new SpikeError("USAGE", `${error instanceof Error ? error.message : String(error)}. Run with --help for usage.`);
  }
  const [first, ...rest] = parsed.positionals;
  const command = first === undefined ? "bench" : first;
  if (!isCommand(command)) throw new SpikeError("USAGE", `Unknown command "${command}". Commands: bench, compare, dump. Run with --help for usage.`);
  return { command, options: { ...normalize(parsed.values), commandGiven: first !== undefined }, positionals: first === undefined ? [] : rest };
}
