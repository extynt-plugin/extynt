/** Tests that the probe's path encoding satisfies the shared vectors. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EXTRA_INPUTS, PROBE_PATH, VECTORS_PATH, checkVectors, extractEncoder, readVectors, readVectorsFile, regenerate, run } from "../path-parity.ts";

const SOURCE = readFileSync(PROBE_PATH, "utf8");

function quiet<Result>(fn: () => Result): Result {
  const { stdout, stderr } = process;
  const originalStdout = stdout.write;
  const originalStderr = stderr.write;
  stdout.write = () => true;
  stderr.write = () => true;
  try { return fn(); } finally {
    stdout.write = originalStdout;
    stderr.write = originalStderr;
  }
}

test("the live aeEncodePathSegment satisfies every shared vector", () => {
  const encode = extractEncoder(SOURCE);
  const vectors = readVectors(readVectorsFile(VECTORS_PATH));
  assert.ok(vectors.length >= 10);
  assert.deepEqual(checkVectors(encode, vectors), []);
  assert.equal(quiet(() => run([])), 0);
});

test("checkVectors reports each mismatching pair", () => {
  const encode = extractEncoder(SOURCE);
  const failures = checkVectors(encode, [{ input: "a/b", encoded: "a/b" }, { input: "a#", encoded: "a%23" }]);
  assert.deepEqual(failures, [{ input: "a/b", expected: "a/b", actual: "a%2Fb" }]);
});

test("extractEncoder fails clearly when host-shared.jsx no longer defines the function on one line", () => {
  assert.throws(() => extractEncoder("function other() {}"), /aeEncodePathSegment/);
  assert.throws(() => extractEncoder("function aeEncodePathSegment(segment) {\n return 1;\n}"), /not found/);
});

test("regenerate keeps existing inputs, adds the script's extras once and recomputes every encoding", () => {
  const encode = (value: string): string => `<${value}>`;
  const [firstExtra = ""] = EXTRA_INPUTS;
  const next = regenerate(encode, { note: "n", encode: [{ input: "custom", encoded: "stale" }, { input: firstExtra, encoded: "stale" }] });
  const vectors = readVectors(next);
  assert.equal(next.note, "n");
  assert.deepEqual(vectors[0], { input: "custom", encoded: "<custom>" });
  assert.equal(vectors.filter((vector) => vector.input === firstExtra).length, 1);
  assert.equal(vectors.length, 1 + EXTRA_INPUTS.length);
});

test("run fails on a corrupted vectors file and --write repairs it", () => {
  const dir = mkdtempSync(join(tmpdir(), "spike-parity-"));
  const vectors = join(dir, "vectors.json");
  writeFileSync(vectors, JSON.stringify({ note: "x", encode: [{ input: "a/b", encoded: "wrong" }] }));
  const paths = { probe: PROBE_PATH, vectors };
  assert.equal(quiet(() => run([], paths)), 1);
  assert.equal(quiet(() => run(["--write"], paths)), 0);
  assert.equal(quiet(() => run([], paths)), 0);
  assert.equal(readVectors(readVectorsFile(vectors))[0]?.encoded, "a%2Fb");
});
