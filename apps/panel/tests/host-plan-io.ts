/**
 * Sends apply_plan requests to a loaded fake host and reads the reply as JSON, so host tests state their operations as
 * data and never build request text by hand. Also the reply assertions and the operation builders the suites share.
 */
import assert from "node:assert/strict";
import { fieldOf, readJson, recordOf, recordsAt, type Found } from "./json-narrow.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

/** The `aeApplyPlan` entry point of a loaded fake host. */
export type PlanApply = (raw: string) => string;

/** The composition and layer every title-layer operation addresses. */
export const TITLE_TARGET = { compositionId: "comp-main", layerId: "layer-title" } as const;

/** Sends one JSON request to a host entry point and decodes its reply. */
export function requestJson(entry: PlanApply, request: JsonObject): JsonObject {
  return recordOf(readJson(entry(JSON.stringify(request))));
}

/** Applies one plan and returns its parsed reply; `envelope` adds fields such as `batchSize` beside the operations. */
export function applyPlan(apply: PlanApply, planId: string, operations: ReadonlyArray<JsonValue>, envelope: JsonObject = {}): JsonObject {
  return requestJson(apply, { operation: "apply_plan", planId, undoGroup: `extynt — ${planId}`, ...envelope, operations });
}

/** An operation aimed at a layer of the main composition, with its remaining fields. */
export function onLayer(operation: string, layerId: string, fields: JsonObject = {}): JsonObject {
  return { operation, compositionId: "comp-main", layerId, ...fields };
}

/** The `set_layer_property` operation for a transform role at a property path. */
export function setLayerProperty(layerId: string, role: string, propertyPath: string, value: JsonValue): JsonObject {
  return onLayer("set_layer_property", layerId, { role, propertyPath, value });
}

/** A set_expression operation on a title-layer property, enabled. */
export function setExpressionOperation(propertyPath: string, source: string): JsonObject {
  return { operation: "set_expression", ...TITLE_TARGET, propertyPath, source, enabled: true };
}

/** A sender of set_text_document plans on the title layer; each call uses a fresh plan id under `planPrefix`. */
export function textDocumentSender(apply: PlanApply, planPrefix: string): (fields: JsonObject) => JsonObject {
  let sent = 0;
  return (fields) => {
    sent += 1;
    return applyPlan(apply, `${planPrefix}-${sent}`, [{ operation: "set_text_document", ...TITLE_TARGET, ...fields }]);
  };
}

/** The error code of a refused plan, or undefined when the plan carried no error. */
export function errorCode(reply: JsonObject): Found {
  return fieldOf(reply, "error", "code");
}

/** Asserts the reply applied, showing its error if it did not; `label` prefixes that message. */
export function assertApplied(reply: JsonObject, label = ""): void {
  assert.equal(fieldOf(reply, "ok"), true, label + JSON.stringify(fieldOf(reply, "error")));
}

/** Asserts the reply was refused with the given error code. */
export function assertRefused(reply: JsonObject, code: string): void {
  assert.equal(fieldOf(reply, "ok"), false);
  assert.equal(errorCode(reply), code);
}

/** One field read from every step of a reply. */
export function stepField(reply: JsonObject, field: string): Found[] {
  return recordsAt(reply, "steps").map((step) => fieldOf(step, field));
}
