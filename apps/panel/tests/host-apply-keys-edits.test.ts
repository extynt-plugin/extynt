/**
 * Apply-plan host contract: editing, reading and copying existing keyframes, effect stacks and Source Text keys.
 * The fake host and payload builders live in host-apply-harness.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { FakeEffectParade, FakeProperty, loadExtended, withFreshTextDocuments } from "./host-apply-harness.js";
import { childAt, childNamed, layerProperty, positionOf } from "./host-fake-lookup.js";
import { type PlanApply, TITLE_TARGET, applyPlan, assertApplied, errorCode } from "./host-plan-io.js";
import { fieldOf, listAt } from "./json-narrow.js";
import { decodeOrThrow, object, string, type JsonObject, type JsonValue } from "@extynt/decode";

const POSITION = "ADBE Transform Group/ADBE Position";
const ANCHOR = "ADBE Transform Group/ADBE Anchor Point";

type KeyEdit = (fields: JsonObject) => JsonObject;

function keyTimes(property: FakeProperty): number[] {
  return property.keyframes.map((key) => key.time);
}

function editPosition(apply: PlanApply): KeyEdit {
  return (fields) => applyPlan(apply, "extended", [{ operation: "edit_keyframes", ...TITLE_TARGET, propertyPath: POSITION, ...fields }]);
}

function assertKeysEdited(edit: KeyEdit, position: FakeProperty): void {
  assertApplied(edit({ action: "move", times: [1], offset: 0.5 }));
  assert.deepEqual(keyTimes(position), [0, 1.5, 2]);
  assert.deepEqual(position.keyframes[1]?.value, [10, 0]);
  assertApplied(edit({ action: "scale", about: 0, factor: 2 }));
  assert.deepEqual(keyTimes(position), [0, 3, 4]);
  assertApplied(edit({ action: "delete", indices: [1] }));
  assert.deepEqual(keyTimes(position), [3, 4]);
  const step = fieldOf(edit({ action: "delete", times: [4] }), "steps", 0);
  assert.deepEqual({ selectedKeys: fieldOf(step, "selectedKeys"), afterKeys: fieldOf(step, "afterKeys") }, { selectedKeys: 1, afterKeys: 1 });
}

function assertKeyEditsRefused(apply: PlanApply, edit: KeyEdit, position: FakeProperty): void {
  position.setValueAtTime(5, [50, 0]);
  const collision = edit({ action: "move", times: [3], offset: 2 });
  assert.equal(fieldOf(collision, "ok"), false);
  assert.match(String(fieldOf(collision, "error", "message") ?? errorCode(collision)), /KEY_TIME_COLLISION/);
  assert.deepEqual(keyTimes(position), [3, 5]);
  assert.match(String(errorCode(edit({ action: "delete", times: [4] }))), /KEY_NOT_FOUND/);
  assert.match(String(errorCode(edit({ action: "delete", indices: [9] }))), /KEY_NOT_FOUND/);
  assert.equal(errorCode(edit({ action: "delete" })), "INVALID_VALUE");
  assert.equal(errorCode(edit({ action: "move", times: [3], offset: 1, factor: 2 })), "INVALID_VALUE");
  const missing = applyPlan(apply, "extended", [{ operation: "edit_keyframes", ...TITLE_TARGET, propertyPath: "ADBE Transform Group/ADBE Nothing", action: "move", offset: 1 }]);
  assert.equal(errorCode(missing), "PROPERTY_NOT_FOUND");
}

test("apply_plan edit_keyframes deletes, moves, scales and copies existing keys and refuses what cannot be edited", () => {
  const { apply, title } = loadExtended();
  const transform = layerProperty(title, "ADBE Transform Group");
  const position = childAt(transform, 0);
  const anchor = new FakeProperty("ADBE Anchor Point", "Anchor Point", [], [0, 0], true);
  transform.children.push(anchor);
  position.setValueAtTime(0, [0, 0]);
  position.setValueAtTime(1, [10, 0]);
  position.setValueAtTime(2, [20, 0]);
  const edit = editPosition(apply);
  assertKeysEdited(edit, position);
  assertKeyEditsRefused(apply, edit, position);
  const source = { ...TITLE_TARGET, propertyPath: POSITION };
  const copyOnto = applyPlan(apply, "extended", [{ operation: "edit_keyframes", ...TITLE_TARGET, propertyPath: ANCHOR, action: "copy", source, times: [5], timeOffset: 1 }]);
  assertApplied(copyOnto);
  assert.deepEqual(keyTimes(anchor), [6]);
  assert.deepEqual(anchor.keyframes[0]?.value, [50, 0]);
});

class StackEffect extends FakeProperty {
  public constructor(matchName: string, name: string, private readonly stack: FakeProperty[]) {
    super(matchName, name, [], null, false);
  }

  public remove(): void {
    this.stack.splice(this.stack.indexOf(this), 1);
  }

  public moveTo(index: number): void {
    this.remove();
    this.stack.splice(index - 1, 0, this);
  }

  public get propertyIndex(): number {
    return this.stack.indexOf(this) + 1;
  }
}

test("apply_plan remove_effect and reorder_effect edit the live effect stack and refuse an effect that is not there", () => {
  const { apply, title } = loadExtended();
  const parade = layerProperty(title, "ADBE Effect Parade");
  for (const [matchName, name] of [["ADBE Gaussian Blur 2", "Blur"], ["ADBE Glo2", "Glow"], ["ADBE Fill", "Fill"]] as const) {
    parade.children.push(new StackEffect(matchName, name, parade.children));
  }
  const names = () => parade.children.map((child) => child.matchName);
  const stack = (operation: string, effect: string, fields: JsonObject = {}) =>
    applyPlan(apply, "extended", [{ operation, ...TITLE_TARGET, effectPath: `ADBE Effect Parade/${effect}`, ...fields }]);

  const moved = stack("reorder_effect", "ADBE Fill", { index: 1 });
  assertApplied(moved);
  assert.deepEqual(names(), ["ADBE Fill", "ADBE Gaussian Blur 2", "ADBE Glo2"]);
  assert.equal(fieldOf(moved, "steps", 0, "observedIndex"), 1);
  assert.equal(errorCode(stack("reorder_effect", "ADBE Fill", { index: 9 })), "INVALID_VALUE");
  const removed = stack("remove_effect", "ADBE Gaussian Blur 2", { destructive: true });
  assertApplied(removed);
  assert.deepEqual(names(), ["ADBE Fill", "ADBE Glo2"]);
  assert.deepEqual(fieldOf(removed, "steps", 0, "stackAfter"), ["Fill", "Glow"]);
  assert.equal(errorCode(stack("remove_effect", "ADBE Gaussian Blur 2", { destructive: true })), "EFFECT_NOT_FOUND");
  assert.equal(errorCode(stack("remove_effect", "ADBE Glo2")), "DESTRUCTIVE_CONFIRMATION_REQUIRED");
  assert.deepEqual(names(), ["ADBE Fill", "ADBE Glo2"]);
});

interface TextDocument {
  readonly text: string;
  readonly font: string;
}

const textDocument = object({ text: string(), font: string() });

function textDocumentAt(property: FakeProperty, index: number): TextDocument {
  return decodeOrThrow(textDocument, property.keyframes[index]?.value);
}

test("apply_plan keys Source Text with held text keys, keeps the styling, and honours keyframeMode", () => {
  const { apply, title } = loadExtended();
  const sourceText = childNamed(layerProperty(title, "ADBE Text Properties"), "ADBE Text Document");
  withFreshTextDocuments(sourceText);
  const key = (keyframes: ReadonlyArray<JsonValue>, extra: JsonObject = {}) =>
    applyPlan(apply, "extended", [{ operation: "animate_property", ...TITLE_TARGET, propertyPath: "ADBE Text Properties/ADBE Text Document", keyframes, ...extra }]);
  const result = key([{ time: 0, value: "One" }, { time: 1, value: "Two\nlines" }, { time: 2, value: "" }]);
  assertApplied(result);
  const texts = sourceText.keyframes.map((entry, index) => [entry.time, textDocumentAt(sourceText, index).text]);
  assert.deepEqual(texts, [[0, "One"], [1, "Two\nlines"], [2, ""]]);
  assert.equal(textDocumentAt(sourceText, 1).font, "ArialMT");
  assert.deepEqual(sourceText.interpolation.map((entry) => entry !== undefined), [true, true, true]);
  assert.equal(errorCode(key([{ time: 3, value: "Again" }])), "CONFLICTING_KEYS");
  assertApplied(key([{ time: 3, value: "Again" }], { keyframeMode: "merge" }));
  assert.equal(sourceText.numKeys, 4);
  assertApplied(key([{ time: 0, value: "Only" }], { keyframeMode: "replace" }));
  assert.equal(sourceText.numKeys, 1);
  assert.equal(errorCode(key([{ time: 0, value: 5 }], { keyframeMode: "replace" })), "INVALID_VALUE");
});

test("apply_plan copy_effects adds the effect on the target with its value, keys and expression", () => {
  const { apply, title, shapeLayer } = loadExtended();
  const sourceParade = layerProperty(title, "ADBE Effect Parade");
  const blur = new FakeProperty("ADBE Gaussian Blur 2", "Gaussian Blur", [new FakeProperty("ADBE Gaussian Blur 2-0001", "Blurriness", [], 25, true)], null, false);
  const control = childAt(blur, 0);
  control.setValueAtTime(0, 10);
  control.setValueAtTime(2, 40);
  sourceParade.children.push(blur);
  const targetParade = new FakeEffectParade();
  shapeLayer.properties.push(targetParade);
  const copy = { operation: "copy_effects", compositionId: "comp-main", layerId: "layer-shape", source: TITLE_TARGET };
  const copied = applyPlan(apply, "extended", [copy]);
  assertApplied(copied);
  assert.deepEqual(fieldOf(copied, "steps", 0, "copiedEffects"), ["ADBE Gaussian Blur 2"]);
  const added = childAt(childAt(targetParade, 0), 0);
  assert.equal(added.keyframes.length, 2);
  assert.equal(added.keyframes[1]?.value, 40);
  assert.equal(fieldOf(copied, "steps", 0, "propertiesKeyed"), 1);
  const missing = applyPlan(apply, "extended", [{ ...copy, effectPaths: ["ADBE Effect Parade/ADBE Missing"] }]);
  assert.equal(errorCode(missing), "EFFECT_NOT_FOUND");
});

test("apply_plan read_keyframes returns every key with value, interpolation and ease, and changes nothing", () => {
  const { apply, title, calls } = loadExtended();
  const position = positionOf(title);
  position.setValueAtTime(0, [0, 0]);
  position.setValueAtTime(1, [10, 20]);
  position.setValueAtTime(2, [30, 40]);
  const before = JSON.stringify(position.keyframes);
  const read = (fields: JsonObject = {}) => applyPlan(apply, "extended", [{ operation: "read_keyframes", ...TITLE_TARGET, propertyPath: POSITION, ...fields }]);
  const done = read();
  assertApplied(done);
  assert.equal(calls.begin.length, 0);
  assert.equal(fieldOf(done, "undoGroups"), 0);
  assert.equal(fieldOf(done, "receipt", "mayHaveMutated"), false);
  assert.equal(fieldOf(done, "receipt", "mutationState"), "not-applied");
  const keys = listAt(done, "steps", 0, "keys");
  assert.equal(keys.length, 3);
  assert.equal(fieldOf(keys[1], "time"), 1);
  assert.equal(JSON.stringify(fieldOf(keys[1], "value")), "[10,20]");
  assert.equal(fieldOf(done, "steps", 0, "totalKeys"), 3);
  assert.equal(fieldOf(done, "steps", 0, "truncated"), false);
  assert.equal(JSON.stringify(position.keyframes), before, "reading changes no key");
  const limited = read({ maxKeys: 2 });
  assert.equal(listAt(limited, "steps", 0, "keys").length, 2);
  assert.equal(fieldOf(limited, "steps", 0, "truncated"), true);
  assert.equal(errorCode(read({ propertyPath: "ADBE Transform Group/ADBE Nothing" })), "PROPERTY_NOT_FOUND");
});
