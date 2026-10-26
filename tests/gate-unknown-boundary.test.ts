// scripts/lib/unknown-boundary.ts: unknown is allowed only inside packages/decode/src.
import assert from "node:assert/strict";
import test from "node:test";
import { unknownBoundaryFailures, unknownBoundarySummary, unknownViolations } from "../scripts/lib/unknown-boundary.ts";

const SIDECAR = "apps/sidecar/src/route.ts";
const lines = (text: string, key = SIDECAR) => unknownViolations(key, text).map((violation) => violation.line);
const messages = (text: string) => unknownViolations(SIDECAR, text).map((violation) => violation.message);

test("a type guard, a decoder and a catch callback may not take unknown", () => {
  assert.deepEqual(lines("function isLayer(input: unknown): input is Layer { return true; }\n"), [1]);
  assert.deepEqual(lines("function layerOf(input: unknown): DecodeResult<Layer> { return fail(); }\n"), [1]);
  assert.deepEqual(lines("const parse: Decoder<Plan> = (input: unknown) => ok(input);\n"), [1]);
  assert.deepEqual(lines("interface Codec { accepts(input: unknown): input is Plan; }\n"), [1]);
  assert.deepEqual(lines("run().catch((error: unknown) => report(error));\n"), [1]);
  assert.deepEqual(lines("run().then(done, (error: unknown) => report(error));\n"), [1]);
});

test("an annotated catch binding fails and an implicit one passes", () => {
  assert.deepEqual(lines("try { run(); } catch (error: unknown) { report(error); }\n"), [1]);
  assert.deepEqual(lines("try { run(); } catch (error) { report(error); }\n"), []);
});

test("everything inside packages/decode/src may use unknown", () => {
  const text = "export type Raw = Record<string, unknown>;\nexport function pick(source: unknown[]): unknown { return source; }\n";
  assert.deepEqual(lines(text, "packages/decode/src/record.ts"), []);
  assert.equal(lines(text, "packages/decode/tests/record.test.ts").length, 3);
});

test("exported types, fields, returns and variables carrying unknown fail", () => {
  assert.deepEqual(lines("export type Payload = unknown;\n"), [1]);
  assert.deepEqual(lines("export interface Event {\n  name: string;\n  body: unknown;\n}\n"), [3]);
  assert.deepEqual(lines("export function read(): unknown { return 1; }\n"), [1]);
  assert.deepEqual(lines("let state: unknown = 1;\n"), [1]);
  assert.deepEqual(lines("function local() {\n  const value: unknown = 1;\n  return value;\n}\n"), [2]);
});

test("Record of unknown and arrays of unknown fail", () => {
  assert.deepEqual(messages("const shape: Record<string, unknown> = {};\n"), ["`Record<string, unknown>` is an untyped shape; name the fields"]);
  assert.deepEqual(messages("const list: unknown[] = [];\n"), ["`unknown[]` is an untyped list; decode the element type"]);
  assert.deepEqual(messages("const list: ReadonlyArray<unknown> = [];\n"), ["`unknown[]` is an untyped list; decode the element type"]);
});

test("generic defaults of unknown fail and constraints of unknown are pointless", () => {
  assert.deepEqual(messages("function pass<T = unknown>(input: T) { return input; }\n"), ["a generic defaulting to unknown hides the missing type argument"]);
  assert.deepEqual(messages("function pass<T extends unknown>(input: T) { return input; }\n"), ["`extends unknown` constrains nothing; drop the constraint"]);
});

test("unknown in a decoder parameter is no excuse for unknown elsewhere in the same file", () => {
  const text = "function isLayer(input: unknown): input is Layer { return true; }\nexport type Loose = unknown;\n";
  assert.deepEqual(lines(text), [1, 2]);
});

test("failures are formatted as file:line and summarised per area", () => {
  const entries = [{ key: SIDECAR, text: "export type A = unknown;\nexport type B = unknown;\n" }, { key: "packages/llm/src/a.ts", text: "export type C = unknown;\n" }];
  const failures = unknownBoundaryFailures(entries);
  assert.equal(failures.length, 3);
  assert.match(failures[0] ?? "", /^apps\/sidecar\/src\/route\.ts:1: /);
  assert.deepEqual(unknownBoundarySummary(failures), ["3 unknown(s) outside packages/decode/src in 2 area(s)", "apps/sidecar: 2", "packages/llm: 1"]);
});

test("the word unknown in strings and identifiers is not the type", () => {
  assert.deepEqual(lines('const label = "unknown";\nconst unknownCount = 1;\n'), []);
});
