#!/usr/bin/env node
// Checks that native/extynt-core/tests/vectors/path_segments.json (shared with the C++ tests) matches the live
// aeEncodePathSegment in apps/panel/host/host-shared.jsx. `--write` regenerates the "encode" array from that function.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { array, decode, decodeJson, decodeOrThrow, jsonObject, object, string } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";

/** The host script that defines the live encoder. */
export const PROBE_PATH = fileURLToPath(new URL("../../apps/panel/host/host-shared.jsx", import.meta.url));

/** The vectors file shared with the C++ tests. */
export const VECTORS_PATH = fileURLToPath(new URL("../../native/extynt-core/tests/vectors/path_segments.json", import.meta.url));

/** Inputs added on top of those already in the vectors file when --write regenerates it. Edit here to widen coverage. */
export const EXTRA_INPUTS: ReadonlyArray<string> = Object.freeze([
  "ADBE Transform Group", "dropShadow/mode2", "50%", "a#b", "%2F", "x/y%z#w", "", "é ü 日本語", "100%/#", "//", "%%",
  "ADBE Vector Group", "ADBE Effect Parade", "Fill #1", "tab\tand\u0001ctl",
  "%23", "#/%", "ADBE Layer Styles", "dropShadow/distance", "ADBE Text Properties", "a b", "100%25",
]);

const VECTOR = object({ input: string(), encoded: string() });
const VECTOR_LIST = array(VECTOR);

/** One encoder vector: an input segment and its expected encoding. */
export type Vector = Infer<typeof VECTOR>;

/** The live encoder. */
export type PathEncoder = (segment: string) => string;

/** A vector the live encoder disagrees with. */
export interface Mismatch {
  readonly input: string;
  readonly expected: string;
  readonly actual: string;
}

/** Where the encoder source and the vectors file live. */
export interface ParityPaths {
  readonly probe: string;
  readonly vectors: string;
}

const FUNCTION_PATTERN = /^[ \t]*(function aeEncodePathSegment\(segment\)\s*\{.*\})[ \t]*$/m;

/** The `aeEncodePathSegment` defined on one line of the host script, evaluated in an isolated context. */
export function extractEncoder(source: string): PathEncoder {
  const match = FUNCTION_PATTERN.exec(source);
  if (!match) throw new Error("function aeEncodePathSegment(segment) { ... } was not found as a single line in host-shared.jsx; update tools/native-spike/path-parity.ts.");
  const context = createContext({});
  runInContext(match[1] ?? "", context);
  return (segment) => {
    Reflect.set(context, "pathSegment", segment);
    return decodeOrThrow(string(), runInContext("aeEncodePathSegment(pathSegment)", context));
  };
}

/** The vectors file as JSON, keeping every member (the "note" travels with the "encode" array). */
export function readVectorsFile(path: string): JsonObject {
  const decoded = decodeJson(readFileSync(path, "utf8"), jsonObject);
  if (!decoded.ok) throw new Error(`${path} is not a JSON object: ${decoded.error.message}`);
  return decoded.value;
}

/** The "encode" vectors of the vectors file. */
export function readVectors(file: JsonObject): ReadonlyArray<Vector> {
  const decoded = decode(VECTOR_LIST, file.encode);
  if (!decoded.ok) throw new Error(`the "encode" member of the vectors file is not a list of {input, encoded} strings: ${decoded.error.message}`);
  return decoded.value;
}

/** The vectors whose encoding the function does not reproduce. */
export function checkVectors(encode: PathEncoder, vectors: ReadonlyArray<Vector>): ReadonlyArray<Mismatch> {
  const failures: Mismatch[] = [];
  for (const { input, encoded } of vectors) {
    const actual = encode(input);
    if (actual !== encoded) failures.push({ input, expected: encoded, actual });
  }
  return failures;
}

/** The vectors file with its "encode" array recomputed over the existing inputs plus EXTRA_INPUTS. */
export function regenerate(encode: PathEncoder, existing: JsonObject): JsonObject {
  const inputs = [...new Set([...readVectors(existing).map((vector) => vector.input), ...EXTRA_INPUTS])];
  return { ...existing, encode: inputs.map((input) => ({ input, encoded: encode(input) })) };
}

function report(failures: ReadonlyArray<Mismatch>, total: number): number {
  for (const failure of failures) {
    process.stderr.write(`MISMATCH input=${JSON.stringify(failure.input)} vectors=${JSON.stringify(failure.expected)} host-shared.jsx=${JSON.stringify(failure.actual)}\n`);
  }
  if (failures.length) {
    process.stderr.write(`path-parity FAILED: ${failures.length} of ${total} vectors differ. Fix the C++ encoder or run: node tools/native-spike/path-parity.ts --write\n`);
    return 1;
  }
  process.stdout.write(`path-parity OK: ${total} vectors match aeEncodePathSegment in host-shared.jsx\n`);
  return 0;
}

/** Checks the vectors (exit code 0 or 1), or with `--write` regenerates them. */
export function run(argv: ReadonlyArray<string>, paths: ParityPaths = { probe: PROBE_PATH, vectors: VECTORS_PATH }): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write("usage: node tools/native-spike/path-parity.ts [--write]\n  checks native/extynt-core/tests/vectors/path_segments.json against aeEncodePathSegment in apps/panel/host/host-shared.jsx\n  --write  regenerate the \"encode\" array from the live function (inputs: those in the file plus EXTRA_INPUTS in this script)\n");
    return 0;
  }
  const encode = extractEncoder(readFileSync(paths.probe, "utf8"));
  const existing = readVectorsFile(paths.vectors);
  if (argv.includes("--write")) {
    const next = regenerate(encode, existing);
    writeFileSync(paths.vectors, `${JSON.stringify(next, null, 1)}\n`);
    process.stdout.write(`path-parity: wrote ${readVectors(next).length} vectors to ${paths.vectors}\n`);
    return 0;
  }
  const vectors = readVectors(existing);
  return report(checkVectors(encode, vectors), vectors.length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exitCode = run(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`path-parity error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
