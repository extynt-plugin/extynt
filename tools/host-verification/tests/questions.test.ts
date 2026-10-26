/** Tests the open-questions probe and the script generated around it. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { array, decodeOrThrow, nullable, object, string, type Infer } from "@extynt/decode";
import { QUESTIONS_TEMPLATES, buildPack, readTemplates, renderRunner } from "../src/generate.js";
import { OPEN_QUESTIONS, analyzeOpenQuestions, renderQuestionsSummary, type OpenQuestionsReport } from "../src/questions.js";
import { createFakeHost, FakeDiskFile, FakeDiskFolder, LAYER_ROLES, reportPrecision } from "./fake-ae.js";
import { isJsonObject, jsonObject, jsonValue, type JsonObject, type JsonValue } from "../src/json.js";
import { ambiguousGroupings } from "./fixtures/ambiguous-groupings.js";

const PROBE_JSX = new URL("../../../../apps/panel/host/apply-layers.jsx", import.meta.url);
const CLI = new URL("../src/cli.js", import.meta.url).pathname;

const probeEntry = object({ id: string(), title: string(), answers: array(string()), state: string(), error: nullable(string()), data: jsonObject });
const probeOutput = object({
  questions: array(probeEntry),
  errors: array(object({ group: string(), error: string() })),
  startedAt: string(),
  finishedAt: string(),
});
type ProbeOutput = Infer<typeof probeOutput>;

function runProbe(): { output: ProbeOutput; host: ReturnType<typeof createFakeHost> } {
  const source = readTemplates(QUESTIONS_TEMPLATES);
  const host = createFakeHost();
  const globals = { app: host.app, $: { global: host.globals, os: "Test OS", locale: "en_US", sleep: () => undefined }, Folder: FakeDiskFolder, File: FakeDiskFile, context: host.context };
  const recorded = decodeOrThrow(jsonValue, JSON.parse(decodeOrThrow(string(), vm.runInNewContext(`${source}\nJSON.stringify(extyntOpenQuestions(context));`, globals))));
  return { output: decodeOrThrow(probeOutput, reportPrecision(recorded)), host };
}

const present = <T>(value: T | undefined, what: string): T => {
  assert.ok(value !== undefined, what);
  return value;
};

function reportFrom(output: ProbeOutput): OpenQuestionsReport {
  return {
    schemaVersion: "0.1", kind: "extynt-open-questions", kit: { generatedAt: "2026-01-01T00:00:00Z", packDigest: "d", extyntVersion: "0.8.0" },
    runtime: { appVersion: "26.2.1", buildNumber: "2", platform: "TestOS", architecture: "arm64", os: "Test OS", locale: "en_US" },
    hostKey: "26.2.1 (2) TestOS/arm64", startedAt: output.startedAt, finishedAt: output.finishedAt, cleanup: "removed 9 item(s)",
    questions: [...output.questions], probeErrors: [...output.errors], errors: [],
  };
}

const question = (output: ProbeOutput, id: string): JsonObject => {
  const entry = output.questions.find((candidate) => candidate.id === id);
  assert.ok(entry, `the probe did not record ${id}`);
  return asRecord(entry.data);
};
const asRecord = (value: JsonValue | undefined): JsonObject => (isJsonObject(value) ? value : {});
const asRows = (value: JsonValue | undefined): JsonObject[] => (Array.isArray(value) ? value.filter(isJsonObject) : []);
const asNumbers = (value: JsonValue | undefined): number[] => (Array.isArray(value) ? value : []).filter((entry): entry is number => typeof entry === "number");
const caseNamed = (data: JsonObject, fragment: string): JsonObject => {
  const found = asRows(data.cases).find((entry) => String(entry.label).includes(fragment));
  assert.ok(found, `the probe recorded no case matching "${fragment}"`);
  return found;
};

test("the open-questions probe is ES3 and groups ternaries and mixed && / || explicitly", () => {
  const source = readTemplates(QUESTIONS_TEMPLATES);
  assert.doesNotThrow(() => new Function(source), "the questions files must parse as one script");
  assert.deepEqual(ambiguousGroupings(source, "runner/questions*.jsx"), []);
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const banned: Array<[RegExp, string]> = [
    [/\bconst\s/, "const"],
    [/\blet\s/, "let"],
    [/=>/, "arrow function"],
    [/\.forEach\s*\(/, "forEach"],
    [/\.map\s*\(/, "map"],
    [/\.filter\s*\(/, "filter"],
    [/Array\.isArray/, "Array.isArray"],
    [/`/, "template literal"],
    [/\bclass\s/, "class"],
    [/\.\.\./, "spread"],
  ];
  for (const [pattern, why] of banned) assert.ok(!pattern.test(code), `the questions files must not use ${why}`);
  assert.ok(!/\.indexOf\s*\(/.test(code), "the questions files must not use indexOf (ES3-safe manual scans instead)");
});

test("the generated script embeds the probe and the PROBE mode", () => {
  const { pack } = buildPack({ effectSweep: false, now: "2026-01-01T00:00:00Z" });
  const script = renderRunner(pack);
  assert.ok(script.includes("function extyntOpenQuestions"));
  assert.doesNotThrow(() => new Function(script));
  assert.ok(script.includes("open-questions.json"));
  assert.ok(script.includes('"PROBE"') || script.includes("PROBE"));
});

test("the probe's question ids match the analyzer catalogue", () => {
  const source = readTemplates(QUESTIONS_TEMPLATES);
  const ids = [...source.matchAll(/id: "([a-z0-9-]+)"/g)].map((match) => present(match[1], "the id capture"));
  assert.deepEqual([...OPEN_QUESTIONS.map((entry) => entry.id)].sort(), [...ids].sort());
});

test("the probe answers all five questions against a fake host", () => {
  const { output } = runProbe();
  assert.deepEqual(output.questions.map((entry) => entry.id), OPEN_QUESTIONS.map((entry) => entry.id));
  assert.deepEqual(output.questions.filter((entry) => entry.state !== "answered").map((entry) => [entry.id, entry.state, entry.error]), []);
  assert.deepEqual(
    output.questions.map((entry) => [entry.id, entry.title, entry.answers]),
    OPEN_QUESTIONS.map((entry) => [entry.id, entry.title, entry.answers]),
  );
  assert.deepEqual(output.errors, []);
});

test("Q1 measures world-preserving parenting with the anchor term, and the origin case is not a no-op", () => {
  const { output } = runProbe();
  const data = question(output, "q1-parent-compensation-scope");
  assert.equal(asRows(data.cases).length, 3);
  const away = caseNamed(data, "parent at [100,50]"), origin = caseNamed(data, "parent at [0,0]"), reparent = caseNamed(data, "re-parent");
  assert.deepEqual(asRecord(away.after).position, [220, 130, 0]);
  assert.deepEqual(asRecord(origin.after).position, [320, 180, 0], "a parent at [0,0] is not a no-op: world + anchor, not world - parent");
  assert.deepEqual(asRecord(reparent.before).position, [220, 130, 0], "the re-parent case starts from the Position the first parenting wrote");
  assert.deepEqual(asRecord(reparent.after).position, [280, 160, 0], "the compensation re-runs from the world position, not from the current local value");
  for (const entry of asRows(data.cases)) {
    const before = asRecord(entry.before), after = asRecord(entry.after);
    assert.notDeepEqual(after.position, before.position, `${String(entry.label)} must move Position`);
    for (const field of ["scale", "rotation", "anchor", "opacity"]) assert.deepEqual(after[field], before[field], `${String(entry.label)} must leave ${field} untouched`);
  }
  assert.deepEqual(asRecord(away.before).anchor, [160, 90, 0]);
});

test("Q2 measures that the first keyframe's value extends backwards and the static write is gone", () => {
  const { output } = runProbe();
  const data = question(output, "q2-value-outside-the-key-range");
  const late = caseNamed(data, "static [10,10] then keys from t=1"), zero = caseNamed(data, "static [10,10] then keys from t=0"), noStatic = caseNamed(data, "no static write");
  assert.deepEqual(asRecord(late.afterStatic).value, [10, 10, 0]);
  assert.equal(asRecord(late.afterStatic).numKeys, 0);
  const sampled = asRecord(late.sampled);
  assert.equal(sampled.numKeys, 2);
  assert.equal(sampled.isTimeVarying, true);
  assert.deepEqual(asRows(sampled.keys), [{ t: 1, v: [100, 100, 0] }, { t: 2, v: [200, 200, 0] }]);
  const at = (time: number) => {
    const row = asRows(sampled.rows).find((entry) => entry.t === time);
    assert.ok(row, `the probe must sample t=${time}`);
    return row;
  };
  for (const time of [-1, 0, 0.5, 1]) assert.deepEqual(at(time).propertyValue, [100, 100, 0], `t=${time} holds the first keyframe's value`);
  for (const row of asRows(sampled.rows)) for (const field of ["preExpression", "postExpression", "propertyValue"]) assert.notDeepEqual(row[field], [10, 10, 0], `the static write must not survive at t=${String(row.t)}`);
  for (const row of asRows(asRecord(zero.sampled).rows)) assert.notDeepEqual(row.propertyValue, [10, 10, 0]);
  assert.equal(noStatic.staticValue, null);
  assert.deepEqual(
    asRows(asRecord(noStatic.sampled).rows).map((row) => row.propertyValue),
    asRows(sampled.rows).map((row) => row.propertyValue),
  );
  const middle = asNumbers(at(1.5).propertyValue);
  const [midpoint = NaN] = middle;
  assert.ok(midpoint > 100 && midpoint < 200, `t=1.5 must interpolate, read ${JSON.stringify(middle)}`);
  assert.ok(Math.abs(midpoint - 150) < 1e-3);
});

test("Q3 measures that a static write over keyframes is refused, not applied", () => {
  const { output } = runProbe();
  const data = question(output, "q3-static-write-over-keyframes");
  assert.deepEqual(data.keysBefore, { numKeys: 2, keys: [{ t: 1, v: [100, 100, 0] }, { t: 2, v: [200, 200, 0] }] });
  const cases = asRows(data.cases);
  assert.equal(cases.length, 2);
  for (const entry of cases) {
    const host = asRecord(entry.host);
    assert.equal(host.ok, false, `${String(entry.label)} must be refused`);
    assert.equal(host.errorCode, "CONFLICTING_KEYS");
    assert.equal(host.errorMessage, "CONFLICTING_KEYS: ADBE Transform Group/ADBE Position has 2 keyframe(s); a static value would be refused.");
    assert.equal(host.mutationState, "mutation-unknown");
    assert.equal(entry.numKeysAfter, 2);
    assert.deepEqual(entry.keysAfter, [{ t: 1, v: [100, 100, 0] }, { t: 2, v: [200, 200, 0] }]);
  }
  const sameValue = caseNamed(data, "value the t=1 key holds");
  assert.equal(asRecord(sameValue.host).errorCode, "CONFLICTING_KEYS");
  assert.deepEqual(sameValue.keysAfter, [{ t: 1, v: [100, 100, 0] }, { t: 2, v: [200, 200, 0] }]);
  const sampled = asRecord(cases[0]?.sampled);
  assert.deepEqual(
    asRows(sampled.rows).map((row) => [row.t, row.propertyValue]).filter(([time]) => time !== 1.5),
    [[0, [100, 100, 0]], [1, [100, 100, 0]], [2, [200, 200, 0]]],
  );
  for (const row of asRows(sampled.rows)) assert.notDeepEqual(row.propertyValue, [500, 500, 0]);
});

test("Q4 measures empty content bounds for a path with no paint", () => {
  const { output } = runProbe();
  const data = question(output, "q4-shape-path-without-paint");
  const bare = caseNamed(data, "no fill or stroke"), painted = caseNamed(data, "ensure_shape_fill");
  assert.equal(asRecord(bare.host).ok, true);
  assert.deepEqual(bare.rect, { top: 0, left: 0, width: 0, height: 0 }, "a path with no paint reports an empty rect");
  assert.equal(asRecord(painted.host).ok, true);
  assert.deepEqual(painted.rect, { top: -20, left: -20, width: 40, height: 40 }, "the same 40x40 ellipse centred on the origin, once a fill exists");
  const census = (value: JsonValue | undefined) => asRows(value).map((group) => [group.matchName, asRows(group.children).map((child) => child.matchName)]);
  assert.deepEqual(census(painted.contents), census(bare.contents));
  assert.deepEqual(asRows(bare.contents).map((group) => group.name), ["Bare group"]);
  assert.deepEqual(asRows(painted.contents).map((group) => group.name), ["Painted group"]);
  assert.deepEqual(asRows(asRows(bare.contents)[0]?.children).map((child) => child.name), ["Blend Mode", "Contents", "Transform", "Material Options"]);
});

test("Q5 measures Float32 RGBA effect-control colour against an 8-bit composition background", () => {
  const { output } = runProbe();
  const data = question(output, "q5-effect-control-colour-precision");
  assert.deepEqual(data.sent, [0.1, 0.2, 0.3]);
  const composition = asRecord(data.composition);
  assert.equal(asRecord(composition.write).ok, true);
  assert.deepEqual(composition.readBack, [0.10196078431373, 0.2, 0.30196078431373]);
  const compositionRead = asNumbers(composition.readBack);
  for (const [index, sent] of [0.1, 0.2, 0.3].entries()) assert.ok(Math.abs(present(compositionRead[index], "composition channel") - Math.round(sent * 255) / 255) < 1e-12, `composition channel ${index} is 1/255-quantised`);
  const control = asRows(data.cases).find((entry) => entry.readBack !== undefined);
  assert.ok(control, "the probe must record the effect-control read-back");
  assert.equal(asRecord(control.host).ok, true);
  assert.equal(asRecord(asRecord(asRows(data.cases)[0]).host).ok, true, "ensure_effect Ramp must apply");
  assert.deepEqual(control.readBack, [0.10000000149012, 0.20000000298023, 0.30000001192093, 1]);
  assert.equal(control.dimensions, 4);
  assert.deepEqual(control.eightBitPrediction, [0.10196078431373, 0.2, 0.30196078431373]);
  const readBack = asNumbers(control.readBack);
  for (const [index, sent] of [0.1, 0.2, 0.3].entries()) assert.ok(Math.abs(present(readBack[index], "effect channel") - Math.fround(sent)) < 1e-9, `effect-control channel ${index} is the Float32 rounding of what was sent`);
  for (const index of [0, 2]) assert.ok(Math.abs(present(readBack[index], "effect channel") - Math.round(present([0.1, 0.2, 0.3][index], "sent channel") * 255) / 255) > 1e-3, `effect-control channel ${index} is NOT 8-bit quantised`);
  assert.equal(readBack[3], 1, "the alpha the adapter appended");
});

test("the fake host models the production adapter's allowlist rather than agreeing with its bugs", () => {
  const block = /function aeApplyNativeLayerProperty\(operation\) \{ var allowed = \{([^}]*)\}/.exec(readFileSync(PROBE_JSX, "utf8"));
  assert.ok(block, "the adapter's allowlist must stay a literal object this test can read");
  const production: Record<string, string> = {};
  for (const pair of present(block[1], "allowlist body").matchAll(/"([^"]+)": "([^"]+)"/g)) production[present(pair[1], "role")] = present(pair[2], "path");
  assert.deepEqual(Object.keys(production).sort(), Object.keys(LAYER_ROLES).sort(), "the double and the adapter allow the same roles");
  for (const [role, path] of Object.entries(production)) assert.equal(LAYER_ROLES[role], path, `${role} must point at the same path in both`);
});

test("the analyzer turns the probe data into the five answers", () => {
  const { output } = runProbe();
  const result = analyzeOpenQuestions(reportFrom(output));
  assert.deepEqual(result.counts, { answered: 5, partial: 0, error: 0, unanswered: 0, missing: 0 });
  const summary = renderQuestionsSummary(result);
  for (const [index, definition] of OPEN_QUESTIONS.entries()) {
    const ordinal = Number(/^q(\d+)/.exec(definition.id)?.[1]) || index + 1;
    assert.ok(summary.includes(`## Q${ordinal} — ${definition.title} — answered`), `the summary must answer ${definition.id}`);
  }
  assert.match(summary, /Position is the only transform property any of the 3 cases rewrote/);
  assert.match(summary, /world-preserving "world − parent \+ anchor" predicts \[220,130,0\] and the host holds exactly that/);
  assert.match(summary, /the recorded "world − parent" rule predicts \[60,40,0\], which the host does not hold/);
  assert.match(summary, /parenting to a parent at the origin is NOT a no-op/);
  assert.match(summary, /the compensation re-runs on a second parenting rather than being a one-shot/);
  assert.match(summary, /local_after = world_before − parent\.position \+ child\.anchor/);
  assert.match(summary, /a statically written value is NOT held outside the key range/);
  assert.match(summary, /the property reads the FIRST KEYFRAME'S value at every time before that key, negative times included/);
  assert.match(summary, /the statically written \[10,10\] is not observable at any sampled time/);
  assert.match(
    summary,
    /REFUSED CONFLICTING_KEYS — CONFLICTING_KEYS: ADBE Transform Group\/ADBE Position has 2 keyframe\(s\); a static value would be refused\./,
  );
  assert.match(summary, /the refusal cleared and overwrote nothing/);
  assert.match(summary, /a safety rule the host enforces, not a fidelity preference/);
  assert.match(summary, /reports EMPTY content bounds/);
  assert.match(summary, /"a path with no paint draws nothing" is now measured, not assumed/);
  assert.match(summary, /that is 1\/255 quantisation exactly/);
  assert.match(summary, /NOT 1\/255 quantisation — the effect-control surface is Float32/);
  assert.match(summary, /the read-back carries FOUR components where three were written/);
  assert.match(summary, /One tolerance cannot be right for both/);
  assert.match(summary, /Host key: `26\.2\.1 \(2\) TestOS\/arm64`/);
});

test("the analyzer reports missing and errored questions instead of inventing answers", () => {
  const empty = analyzeOpenQuestions({ questions: [] });
  assert.deepEqual(empty.counts, { answered: 0, partial: 0, error: 0, unanswered: 0, missing: 5 });
  assert.match(renderQuestionsSummary(empty), /no observation was recorded/);
  const missing = empty.questions.find((entry) => entry.id === "q3-static-write-over-keyframes");
  assert.ok(missing, "every catalogue id must have a verdict");
  assert.deepEqual(missing.facts, [], "a missing question gets no invented answer");
  assert.match(String(missing.error), /no entry/);
  const failed = analyzeOpenQuestions({
    hostKey: null,
    questions: [
      { id: "q1-parent-compensation-scope", state: "error", error: "SHAPE_UNSUPPORTED" },
      { id: "q2-value-outside-the-key-range", state: "partial", data: { unanswered: ["the sampled property could not be read"] } },
    ],
  });
  assert.equal(failed.counts.error, 1);
  assert.equal(failed.counts.partial, 1);
  assert.equal(failed.counts.missing, 3);
  assert.match(renderQuestionsSummary(failed), /SHAPE_UNSUPPORTED/);
  assert.match(renderQuestionsSummary(failed), /Unread on this host/);
});

const containing = (id: string, data: JsonObject) =>
  present(analyzeOpenQuestions({ questions: [{ id, state: "answered", data }] }).questions.find((entry) => entry.id === id), `the analyzer must answer ${id}`);

test("the compensation analyzer reports a rewritten scale", () => {
  const compensation = containing("q1-parent-compensation-scope", {
    cases: [{ label: "child [160,90] under a parent at [100,50]", host: { ok: true }, before: { position: [160, 90, 0], scale: [100, 100, 100], rotation: 0, anchor: [160, 90, 0], opacity: 100 }, after: { position: [160, 90, 0], scale: [50, 100, 100], rotation: 0, anchor: [160, 90, 0], opacity: 100 } }],
  });
  assert.match(compensation.facts.join("\n"), /the compensation is NOT Position-only on this host: it also rewrote scale/);
  assert.doesNotMatch(compensation.facts.join("\n"), /Position is the only transform property/);
});

test("the key-range analyzer reports a surviving static value", () => {
  const survived = containing("q2-value-outside-the-key-range", {
    cases: [
      {
        label: "static [10,10] then keys from t=1",
        staticValue: [10, 10],
        afterStatic: { value: [10, 10, 0], numKeys: 0 },
        keyframes: [{ time: 1, value: [100, 100] }],
        sampled: {
          numKeys: 1,
          isTimeVarying: true,
          keys: [{ t: 1, v: [100, 100, 0] }],
          rows: [
            { t: -1, preExpression: [10, 10, 0], postExpression: [10, 10, 0], propertyValue: [10, 10, 0] },
            { t: 1, preExpression: [100, 100, 0], postExpression: [100, 100, 0], propertyValue: [100, 100, 0] },
          ],
        },
      },
    ],
  });
  assert.match(survived.facts.join("\n"), /the static value survives in 1 of 1 cases/);
  assert.doesNotMatch(survived.facts.join("\n"), /is NOT held outside the key range/);
});

test("the static-write analyzer reports an accepted write", () => {
  const accepted = containing("q3-static-write-over-keyframes", {
    keyWrite: { ok: true }, keysBefore: { numKeys: 1, keys: [{ t: 1, v: [100, 100, 0] }] },
    cases: [{ label: "set_layer_property [500,500] over the keys", host: { ok: true }, numKeysAfter: 1, keysAfter: [{ t: 1, v: [500, 500, 0] }] }],
  });
  assert.match(accepted.facts.join("\n"), /this host ACCEPTED the static write over the keyframes/);
});

test("the shape-bounds analyzer reports non-empty bounds", () => {
  const equalBounds = containing("q4-shape-path-without-paint", {
    cases: [
      { label: "one ellipse, no fill or stroke", host: { ok: true }, rect: { top: -20, left: -20, width: 40, height: 40 }, contents: [] },
      { label: "one ellipse plus ensure_shape_fill", host: { ok: true }, rect: { top: -20, left: -20, width: 40, height: 40 }, contents: [] },
    ],
  });
  assert.match(equalBounds.facts.join("\n"), /every case reported NON-empty bounds/);
  assert.doesNotMatch(equalBounds.facts.join("\n"), /reports EMPTY content bounds/);
});

test("the colour analyzer reports a non-Float32 write", () => {
  const quantised = containing("q5-effect-control-colour-precision", {
    sent: [0.1, 0.2, 0.3], composition: { write: { ok: true }, readBack: [0.10196078431373, 0.2, 0.30196078431373] },
    cases: [{ label: "set_effect_control Start Color", host: { ok: true }, readBack: [0.10196078431373, 0.2, 0.30196078431373, 1], eightBitPrediction: [0.10196078431373, 0.2, 0.30196078431373], dimensions: 4 }],
  });
  assert.match(quantised.facts.join("\n"), /the components are not the Float32 roundings of what was sent/);
  assert.match(quantised.facts.join("\n"), /the two surfaces were not both measured as expected/);
  assert.doesNotMatch(quantised.facts.join("\n"), /the effect-control surface is Float32/);
});

test("the questions CLI reads a probe report and writes the summary", () => {
  const { output } = runProbe();
  const dir = mkdtempSync(join(tmpdir(), "extynt-questions-"));
  const reportPath = join(dir, "open-questions.json"), summaryPath = join(dir, "summary.md");
  writeFileSync(reportPath, JSON.stringify(reportFrom(output)));
  const printed = execFileSync(process.execPath, [CLI, "questions", reportPath, "--summary", summaryPath], { encoding: "utf8" });
  assert.equal(printed, "");
  const summary = readFileSync(summaryPath, "utf8");
  assert.match(summary, /# Open questions — After Effects 26\.2\.1/);
  assert.match(summary, /Questions: 5 answered/);
});
