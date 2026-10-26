// Proves completeness checks at seal time: advisory notes never block a seal, a Position-then-parent plan is noted not refused, and a static write under keyframes is refused.
import test from "node:test";
import assert from "node:assert/strict";
import { array, boolean, decodeOrThrow, number, object, optional, string } from "@extynt/decode";
import { callTool } from "../src/index.js";
import type { JsonObject } from "@extynt/decode";
import { authoring, dataOf } from "./support/fixtures.js";
import { succeeded } from "./support/plan-views.js";
import type { ToolOutcome } from "./support/plan-views.js";

const TITLE = { compositionId: "comp-main", layerId: "layer-title" };
const POSITION = "ADBE Transform Group/ADBE Position";

const addedNotesView = object({ notes: optional(array(string())) });
const refusalView = object({
  planId: string(),
  status: string(),
  authored: number(),
  sealed: boolean(),
  problems: array(object({ index: number(), code: string() })),
  verdicts: array(object({ index: number(), status: string(), code: optional(string()), fix: optional(string()) })),
  next: string(),
});
const sealedNotesView = object({ sealed: optional(boolean()), notes: optional(array(object({ code: string(), operationIndexes: array(number()), message: string() }))) });

function positionWrite(value: number[], target: JsonObject = TITLE): JsonObject {
  return { type: "set_layer_property", target, role: "transform.position", propertyPath: POSITION, value };
}

const parentToFootage: JsonObject = { type: "set_layer_parent", target: TITLE, parentLayerId: "layer-footage" };

function positionThenParent(): JsonObject[] {
  return [positionWrite([160, 90]), parentToFootage];
}

function parentThenPosition(): JsonObject[] {
  return [parentToFootage, positionWrite([160, 90])];
}

function notesOf(added: ToolOutcome): ReadonlyArray<string> {
  return decodeOrThrow(addedNotesView, succeeded(added).data).notes ?? [];
}

function completeAuthored(summary: string, operations: JsonObject[]): { sealed: boolean; code: string | null; notes: ReadonlyArray<string> } {
  const context = authoring();
  const planId = dataOf(succeeded(callTool("ae_plan_create", { summary }, context))).planId;
  const added = callTool("ae_plan_add", { planId, operations }, context);
  const sealed = callTool("ae_plan_complete", { planId }, context);
  return { sealed: sealed.ok, code: sealed.ok ? null : sealed.error.code, notes: notesOf(added) };
}

test("a Position write followed by set_layer_parent is accepted and sealed, with a one-line note instead of a refusal", () => {
  const context = authoring();
  const planId = dataOf(succeeded(callTool("ae_plan_create", { summary: "Parent the title" }, context))).planId;
  const added = callTool("ae_plan_add", { planId, operations: positionThenParent() }, context);
  const notes = notesOf(added);
  assert.equal(notes.some((note) => /Position written before set_layer_parent is in composition space; After Effects keeps the layer where it is and rewrites its local Position\./.test(note)), true, `the draft says so: ${JSON.stringify(notes)}`);
  assert.deepEqual(dataOf(succeeded(added)).verdicts?.map((verdict) => verdict.status), ["accepted", "accepted"], "and neither operation is refused for it");

  const sealed = callTool("ae_plan_complete", { planId }, context);
  assert.ok(sealed.ok, "the same plan seals: AE keeps the world position, which is what the author saw");
  const sealedNotes = decodeOrThrow(sealedNotesView, sealed.data).notes ?? [];
  assert.deepEqual(sealedNotes.map((note) => note.code), ["POSITION_THEN_PARENT"]);
  assert.deepEqual(sealedNotes[0]?.operationIndexes, [0, 1]);
});

test("a sealed plan carries advisory completeness notes, and they never block the seal", () => {
  const context = authoring();
  const planId = dataOf(succeeded(callTool("ae_plan_create", { summary: "A null nothing uses" }, context))).planId;
  const handle = { type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:handle" }, layerType: "null", name: "Handle" };
  succeeded(callTool("ae_plan_add", { planId, operations: [handle] }, context));
  const sealed = succeeded(callTool("ae_plan_complete", { planId }, context));
  const view = decodeOrThrow(sealedNotesView, sealed.data);
  assert.equal(view.sealed, true, "notes are advisory: the plan seals anyway");
  const notes = view.notes ?? [];
  assert.deepEqual(notes.map((note) => note.code), ["CREATED_UNUSED_OBJECT"], "the unused null is reported as a note");
  assert.deepEqual(notes[0]?.operationIndexes, [0]);
  assert.match(notes[0]?.message ?? "", /nothing parents to|does nothing/);
});

test("parenting before writing Position, or restating Position after it, is not refused", () => {
  const cases: ReadonlyArray<readonly [string, JsonObject[]]> = [
    ["parent first", parentThenPosition()],
    ["position restated after the parent", [...positionThenParent(), positionWrite([60, 40])]],
  ];
  for (const [label, operations] of cases) {
    const { sealed, code, notes } = completeAuthored(`Title, ${label}`, operations);
    assert.equal(notes.some((note) => /composition space/.test(note)), false, `${label}: a note would be noise about a plan that already does the right thing`);
    assert.equal(sealed, true, `${label} must not be refused: ${String(code)}`);
  }
});

test("a parent on another layer does not rewrite this layer's Position", () => {
  const otherLayer = completeAuthored("Parent something else", [positionWrite([160, 90], { ...TITLE, layerId: "layer-footage" }), parentToFootage]);
  assert.equal(otherLayer.sealed, true);
});

test("a static write and keyframes on one property in one plan are refused at complete, at the static write", () => {
  const write = positionWrite([960, 540]);
  const keys: JsonObject = { type: "animate_property", target: { ...TITLE, propertyPath: POSITION }, keyframes: [{ time: 0, value: [960, 540] }, { time: 2, value: [960, 300] }] };
  for (const operations of [[write, keys], [keys, write]]) {
    const result = completeAuthored("Push the title", operations);
    assert.equal(result.code, "STATIC_WRITE_UNDER_KEYFRAMES", JSON.stringify(result.notes));
  }
  const elsewhere = positionWrite([960, 540], { ...TITLE, layerId: "layer-footage" });
  assert.notEqual(completeAuthored("Different layers", [elsewhere, keys]).code, "STATIC_WRITE_UNDER_KEYFRAMES", "a write on another layer is not the same property");
});

test("a seal refusal carries the plan, its problems and a rejected verdict per problem", () => {
  const context = authoring();
  const planId = dataOf(succeeded(callTool("ae_plan_create", { summary: "Push the title" }, context))).planId;
  const keys: JsonObject = { type: "animate_property", target: { ...TITLE, propertyPath: POSITION }, keyframes: [{ time: 0, value: [960, 540] }, { time: 2, value: [960, 300] }] };
  callTool("ae_plan_add", { planId, operations: [positionWrite([960, 540]), keys] }, context);
  const refused = callTool("ae_plan_complete", { planId }, context);
  assert.ok(!refused.ok && "data" in refused);
  const view = decodeOrThrow(refusalView, refused.data);
  assert.equal(view.planId, planId);
  assert.equal(view.sealed, false);
  assert.equal(view.authored, 2);
  assert.deepEqual(view.problems.map((problem) => problem.code), ["STATIC_WRITE_UNDER_KEYFRAMES"]);
  assert.deepEqual(view.verdicts.map((verdict) => [verdict.index, verdict.status, verdict.code]), [[0, "rejected", "STATIC_WRITE_UNDER_KEYFRAMES"]]);
  assert.match(view.next, /Nothing was sealed/);
});
