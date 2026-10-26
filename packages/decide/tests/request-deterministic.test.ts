// Scores the request-reading deciders offline against the fixture files, dev and held-out sets, with no decision model: only the deterministic tier answers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { array, boolean, decodeJson, jsonValue, number, object, optional, string } from "@extynt/decode";
import type { JsonValue, Shape } from "@extynt/decode";
import {
  DRAWN_SCENE_REQUEST, LAYER_STYLE_REQUEST, MODEL_TIER, NAMED_OBJECT_ASKED, REQUEST_MISSING, REQUEST_PARTS, REQUEST_ROUTE, REQUEST_SCALE, REQUEST_SPECIALISTS,
} from "../src/index.js";
import type { AppliedStep } from "../src/index.js";

const FIXTURES = new URL("../../../../tools/chat-tests/fixtures/decisions/", import.meta.url);

type Outcome = { readonly suite: string; readonly id: string; readonly lang: string; readonly correct: boolean; readonly got: string; readonly want: string };

const LANG = optional(string());

function readCases<S extends Shape>(name: string, shape: S) {
  const outcome = decodeJson(readFileSync(fileURLToPath(new URL(name, FIXTURES)), "utf8"), object({ cases: array(object(shape)) }));
  if (!outcome.ok) throw new Error(`${name} does not decode`);
  return outcome.value.cases;
}

const stepFacts = object({
  role: optional(string()),
  target: optional(object({ propertyPath: optional(string()) })),
  keyframes: optional(array(object({ value: array(number()) }))),
});

function appliedStep(step: { readonly type: string; readonly payload: JsonValue }): AppliedStep {
  const json = JSON.stringify(step.payload);
  const facts = decodeJson(json, stepFacts);
  const read = facts.ok ? facts.value : {};
  const positionKeys = (read.keyframes ?? []).flatMap(({ value: [x, y] }) => (x === undefined || y === undefined ? [] : [[x, y] as const]));
  return { type: step.type, json, propertyPath: read.target?.propertyPath ?? "", role: read.role ?? "", positionKeys };
}

function setText(values: ReadonlyArray<string>): string {
  const sorted = [...values].sort();
  return sorted.length === 0 ? "(none)" : sorted.join(",");
}

function outcomes<R extends { readonly id: string; readonly lang?: string | undefined }>(suite: string, rows: ReadonlyArray<R>, answer: (row: R) => readonly [string, string]): Outcome[] {
  return rows.map((row) => {
    const [got, want] = answer(row);
    return { suite, id: row.id, lang: row.lang ?? "en", correct: got === want, got, want };
  });
}

const partsRow = { id: string(), lang: LANG, request: string(), parts: array(string()) };
const completionRow = {
  id: string(), lang: LANG, request: string(), applied: array(object({ type: string(), payload: jsonValue })), missing: array(string()),
};
const labelRow = { id: string(), lang: LANG, request: string(), label: string() };
const nameRow = { id: string(), lang: LANG, request: string(), name: string(), asked: boolean() };
const styleRow = { id: string(), lang: LANG, message: string(), goal: string(), asked: boolean() };
const specialistRow = { id: string(), lang: LANG, request: string(), roles: array(string()) };

function runSet(set: "dev" | "heldout"): Outcome[] {
  const dir = set === "dev" ? "" : "heldout/";
  const result: Outcome[] = [];
  if (set === "dev") {
    result.push(...outcomes("request-parts", readCases("request-parts.json", partsRow), (row) => [setText(REQUEST_PARTS.deterministic({ request: row.request })), setText(row.parts)]));
    result.push(...outcomes("request-completion", readCases("request-completion.json", completionRow), (row) =>
      [setText(REQUEST_MISSING.deterministic({ request: row.request, applied: row.applied.map(appliedStep) })), setText(row.missing)]));
    result.push(...outcomes("drawn-scene", readCases("drawn-scene.json", labelRow), (row) => [DRAWN_SCENE_REQUEST.deterministic({ request: row.request }), row.label]));
    result.push(...outcomes("request-scale", readCases("request-scale.json", labelRow), (row) => [REQUEST_SCALE.deterministic({ request: row.request }), row.label]));
    result.push(...outcomes("named-object", readCases("named-objects.json", nameRow), (row) =>
      [String(NAMED_OBJECT_ASKED.deterministic({ request: row.request, name: row.name })), String(row.asked)]));
    result.push(...outcomes("layer-style", readCases("layer-style.json", styleRow), (row) =>
      [String(LAYER_STYLE_REQUEST.deterministic({ message: row.message, goal: row.goal })), String(row.asked)]));
  }
  result.push(...outcomes(`${dir}request-route`, readCases(`${dir}route.json`, labelRow), (row) => [REQUEST_ROUTE.deterministic({ request: row.request }), row.label]));
  result.push(...outcomes(`${dir}request-specialists`, readCases(`${dir}specialists.json`, specialistRow), (row) =>
    [setText(REQUEST_SPECIALISTS.deterministic({ request: row.request })), setText(row.roles)]));
  result.push(...outcomes(`${dir}model-tier`, readCases(`${dir}model-tier.json`, labelRow), (row) => [MODEL_TIER.deterministic({ request: row.request }), row.label]));
  return result;
}

function printReport(title: string, all: ReadonlyArray<Outcome>): void {
  console.log(title);
  for (const suite of new Set(all.map((row) => row.suite))) {
    const rows = all.filter((row) => row.suite === suite);
    const hits = rows.filter((row) => row.correct).length;
    const langs = [...new Set(rows.map((row) => row.lang))].map((lang) => {
      const inLang = rows.filter((row) => row.lang === lang);
      return `${lang} ${inLang.filter((row) => row.correct).length}/${inLang.length}`;
    });
    console.log(`  ${suite.padEnd(26)} ${hits}/${rows.length} (${langs.join(", ")})`);
    for (const row of rows.filter((item) => !item.correct)) console.log(`      miss ${row.id}  got ${row.got} want ${row.want}`);
  }
}

test("the deterministic request deciders score the dev fixtures at 80% or better on every suite", () => {
  const all = runSet("dev");
  printReport("dev", all);
  for (const suite of new Set(all.map((row) => row.suite))) {
    const rows = all.filter((row) => row.suite === suite);
    assert.ok(rows.filter((row) => row.correct).length * 5 >= rows.length * 4, `${suite} is below 80%`);
  }
});

test("the deterministic request deciders score the held-out fixtures", () => {
  const all = runSet("heldout");
  printReport("heldout", all);
  assert.ok(all.length > 0);
});
