// Proves that ae_propose_plan bounds and discloses expressions, accepts and compiles easing curves, normalizes text line breaks, and describes render and puppet plans.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { homedir } from "node:os";
import { array, decodeOrThrow, type JsonObject, jsonValue, object, optional, string } from "@extynt/decode";
import { metadataReadSet } from "@extynt/action-plan";
import { compileCommand } from "@extynt/host-ae";
import { representativeSnapshot } from "@extynt/project-graph";
import { callTool } from "../src/index.js";
import type { StoredPlan } from "../src/index.js";
import { arrayAt, integerAt, numberAt, objectAt, objectsIn, stringAt } from "../src/json.js";
import { refusalOf } from "./support/json-results.js";
import { VERIFIED_HOST } from "./support/fixtures.js";
import { cardLines, noticesOf, planContext, presentationOf, proposedOperations, propose, storedPlanOf, successArray, successObject } from "./support/proposal-views.js";
import type { CallResult, PlanContext } from "./support/proposal-views.js";

const TITLE = { compositionId: "comp-main", layerId: "layer-title" };
const POSITION = "ADBE Transform Group/ADBE Position";
const OPACITY = "ADBE Transform Group/ADBE Opacity";
const setExpression = (propertyPath: string, source: string, enabled = true): JsonObject => ({ type: "set_expression", target: { ...TITLE, propertyPath }, source, enabled });
const compiledKeyframes = object({ operations: array(object({ keyframeMode: optional(string()), keyframes: optional(array(object({ curve: optional(jsonValue) }))) })) });

function compiledCommand(plan: StoredPlan["plan"]): ReturnType<typeof compileCommand> {
  const readSetDigest = metadataReadSet(plan, representativeSnapshot)?.digest;
  const approval = { planId: plan.planId, snapshotFingerprint: representativeSnapshot.fingerprint, selectionFingerprint: representativeSnapshot.selectionFingerprint, freshness: representativeSnapshot.freshness, approvedAt: plan.provenance?.createdAt ?? "", approvalId: "approval-test", panelSessionId: "panel-test", oneTime: true as const, ...(readSetDigest ? { readSetDigest } : {}) };
  return compileCommand(plan, representativeSnapshot, approval);
}

test("ae_propose_plan derives the expression bound from the source", () => {
  const normal = propose("Animate expression", [setExpression(POSITION, "value + [10, 0]")], planContext());
  assert.equal(numberAt(objectAt(objectAt(successObject(normal), "plan"), "bounds"), "maxExpressionLength"), "value + [10, 0]".length);
});

test("ae_propose_plan takes a long hand-written rig and rejects sources above 65536 characters", () => {
  const rig = propose("Long rig", [setExpression(POSITION, `// rig\n${"var a = 1;\n".repeat(2000)}value`)], planContext());
  assert.ok(rig.ok, JSON.stringify(rig).slice(0, 300));
  const oversized = propose("Too long expression", [setExpression(POSITION, "x".repeat(65_537))], planContext());
  assert.equal(refusalOf(oversized).code, "INVALID_ARGUMENT");
});

function assertCardLineShowsExpression(result: CallResult, source: string): void {
  const lines = cardLines(result);
  assert.ok(lines.some((line) => line.includes(source)), `the expression source is on the card line: ${JSON.stringify(lines)}`);
  const expressionLine = lines.find((line) => line.includes("expression: "));
  assert.ok(expressionLine);
  const excerpt = expressionLine.slice(expressionLine.indexOf("expression: ") + "expression: ".length);
  assert.ok(excerpt.length <= 240, `a 4096-character script is bounded on the card line (${excerpt.length})`);
  assert.ok(lines.some((line) => line.endsWith("…")), "the excerpt is marked as truncated");
}

function assertDurableExpressionsAreBounded(result: CallResult, source: string): void {
  const expressions = objectsIn(arrayAt(presentationOf(result), "expressions"));
  assert.deepEqual(expressions[0], { propertyPath: POSITION, source });
  const bounded = stringAt(expressions[1], "source");
  assert.equal(bounded?.length, 400, "the durable source is bounded to what the panel persists");
  assert.ok(bounded?.endsWith("…"), "the truncated durable source is marked");
}

function assertStoredAndPresentedKeepExpressions(context: PlanContext, result: CallResult): void {
  const planId = stringAt(successObject(result), "planId");
  const expected = presentationOf(result).expressions;
  const stored = successArray(callTool("ae_list_plans", {}, context)).find((row) => stringAt(row, "planId") === planId);
  assert.deepEqual(objectAt(stored, "presentation")?.expressions, expected, "the stored plan keeps the field the panel reads");
  const presented = successObject(callTool("ae_present_plan", { planId: planId ?? "" }, context));
  assert.deepEqual(objectAt(presented, "presentation")?.expressions, expected);
}

test("a composed plan carries the expression source it will write on the card line and in the durable presentation", () => {
  const context = planContext();
  const source = "var h = thisLayer.sourceRectAtTime(time, false).height;\nlinear(time, 0, 2, [960, 1180], [960, -100]);";
  const result = propose("Roll the credits", [setExpression(POSITION, source), setExpression(OPACITY, "x".repeat(4096))], context);
  assertCardLineShowsExpression(result, source);
  assertDurableExpressionsAreBounded(result, source);
  assertStoredAndPresentedKeepExpressions(context, result);
});

test("a plan without an enabled expression exposes no expression detail and no expression card line", () => {
  const result = propose("Fade and clear", [
    { type: "animate_property", target: { ...TITLE, propertyPath: POSITION }, role: "transform.position", keyframes: [{ time: 0, value: [0, 0] }, { time: 1, value: [10, 10] }] },
    setExpression(OPACITY, "", false),
  ], planContext());
  assert.deepEqual(arrayAt(presentationOf(result), "expressions"), [], "clearing an expression is not an expression to show");
  assert.equal(cardLines(result).some((line) => line.includes("expression: ")), false);
});

test("ae_propose_plan accepts easing curves, keyframe modes and split batches on one property, and compiles numeric curves", () => {
  const context = planContext();
  const opacity = { ...TITLE, propertyPath: OPACITY };
  const result = propose("Eased fade in chunks", [
    { type: "animate_property", target: opacity, role: "transform.opacity", keyframeMode: "replace", keyframes: [{ time: 0, value: 0, curve: "in-out-back" }, { time: 1, value: 100, ease: { in: { speed: 0, influence: 60 } } }] },
    { type: "animate_property", target: opacity, role: "transform.opacity", keyframes: [{ time: 2, value: 50, curve: { x1: 0.2, y1: 0, x2: 0.1, y2: 1 } }, { time: 11.5, value: 0 }] },
  ], context);
  const compiled = compiledCommand(storedPlanOf(context, result).plan);
  assert.ok("operations" in compiled, "the plan compiles for the host");
  const first = decodeOrThrow(compiledKeyframes, compiled).operations[0];
  assert.equal(first?.keyframeMode, "replace");
  assert.deepEqual(first?.keyframes?.[0]?.curve, { x1: 0.68, y1: -0.6, x2: 0.32, y2: 1.6 });
});

test("ae_propose_plan refuses a bare ease curve and an unknown curve preset", () => {
  const opacity = { ...TITLE, propertyPath: OPACITY };
  const withCurve = (curve: string): JsonObject => ({ type: "animate_property", target: opacity, role: "transform.opacity", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100, curve }] });
  assert.ok(!propose("Bad curve", [withCurve("ease")], planContext()).ok);
  assert.ok(!propose("Unknown preset", [withCurve("wobble")], planContext()).ok);
});

test("ae_propose_plan resolves caller-chosen composition and layer ids and names unknown curve presets", () => {
  const ok = propose("Comp with a centered title", [
    { type: "create_composition", newCompositionId: "variant-a", name: "Variant A", width: 1920, height: 1080, durationSeconds: 5, frameRate: 30 },
    { type: "create_layer", target: { compositionId: "variant-a", layerId: "title-a" }, layerType: "text", name: "Title A", text: "Hello" },
    { type: "set_text_document", target: { compositionId: "variant-a", layerId: "title-a" }, justification: "CENTER_JUSTIFY" },
  ], planContext());
  assert.ok(ok.ok, JSON.stringify(ok));
  const missing = propose("Missing comp", [{ type: "create_layer", target: { compositionId: "never-created" }, layerType: "text", name: "Title", text: "Hi" }], planContext());
  assert.match(refusalOf(missing).message, /never-created.*newCompositionId/);
  const preset = propose("Bad preset", [{ type: "animate_property", target: { ...TITLE, propertyPath: OPACITY }, role: "transform.opacity", keyframes: [{ time: 0, value: 0, curve: "wobble" }, { time: 1, value: 100 }] }], planContext());
  assert.match(refusalOf(preset).message, /unknown curve preset "wobble".*ease-in-out/);
});

test("line breaks in text are normalized to the CR After Effects actually stores", () => {
  const context = planContext(VERIFIED_HOST);
  const created = propose("Credits", [{ type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:credits" }, layerType: "text", name: "Credits", text: "CREW\n\nJane Doe\r\nDirector" }], context);
  const createdText = stringAt(proposedOperations(created)[0], "text") ?? "";
  assert.equal(createdText, "CREW\r\rJane Doe\rDirector");
  assert.equal(/\n/.test(createdText), false, "no LF may survive into an approved plan");
  const retitled = propose("Retitle", [{ type: "set_text_document", target: TITLE, text: "One\nTwo" }], context);
  assert.equal(stringAt(proposedOperations(retitled)[0], "text"), "One\rTwo");
});

test("a render plan can be proposed, and says what it writes and what it only queues", () => {
  const outputPath = join(homedir(), "extynt-render-test.mov");
  const render = (extra: JsonObject): CallResult => propose("Render it", [{ type: "render_composition", compositionId: "comp-main", outputPath, destinationPolicy: "explicit-local-path", ...extra }], planContext());
  const queued = noticesOf(render({}));
  assert.equal(queued.some((notice) => stringAt(notice, "code") === "NOT_UNDOABLE"), false, `a queued render is not irreversible: ${JSON.stringify(queued)}`);
  assert.equal(stringAt(queued.find((notice) => stringAt(notice, "code") === "UNDO_ONLY"), "severity"), "note");
  const permanent = noticesOf(render({ executeAuthorization: "RENDER_NOW" })).find((notice) => stringAt(notice, "code") === "NOT_UNDOABLE");
  assert.ok(permanent, "a started render is the clearest case of something Undo cannot take back");
  assert.equal(stringAt(permanent, "severity"), "unverified", "it is a warning, not an error: the render is what the user asked for");
  assert.match(stringAt(permanent, "title") ?? "", /Nothing takes/);
});

test("ae_propose_plan counts puppet pin keyframes toward the plan's keyframe bound and infers an edit_keyframes action", () => {
  const footage = { compositionId: "comp-main", layerId: "layer-footage" };
  const result = propose("Rig a card", [
    { type: "set_puppet_pins", target: footage, pins: [
      { x: 40, y: 150, keyframes: [{ time: 0, x: 40, y: 150 }, { time: 1, x: 60, y: 150 }, { time: 2, x: 40, y: 150 }] },
      { x: 200, y: 60, keyframes: [{ time: 0, x: 200, y: 60 }, { time: 1, x: 200, y: 80 }] },
    ] },
    { type: "edit_keyframes", target: { ...footage, propertyPath: POSITION }, offset: 0.5 },
  ], planContext());
  assert.equal(integerAt(objectAt(objectAt(successObject(result), "plan"), "bounds"), "maxKeyframes"), 5);
});
