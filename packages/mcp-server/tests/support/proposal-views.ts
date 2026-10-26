// Builders and typed readers shared by the ae_propose_plan suites: a context, a proposal call, and accessors over what a proposal answers.
import assert from "node:assert/strict";
import { decodeOrThrow, jsonObject, jsonValue } from "@extynt/decode";
import { BASE_CATALOGUE } from "@extynt/capability-catalogue";
import { representativeSnapshot } from "@extynt/project-graph";
import { callTool } from "../../src/index.js";
import type { StoredPlan, ToolContext } from "../../src/index.js";
import { arrayAt, objectAt, objectsIn, stringAt } from "../../src/json.js";
import type { JsonArray, JsonObject, JsonValue } from "@extynt/decode";

/** What `callTool` answers. */
export type CallResult = ReturnType<typeof callTool>;

/** A tool context that keeps its plan store where the test can read it. */
export type PlanContext = ToolContext & { readonly plans: Map<string, StoredPlan> };

/** A fresh context over the representative snapshot and the bundled catalogue, with an empty plan store and any extra fields. */
export function planContext(extra: ToolContext = {}): PlanContext {
  return { snapshot: representativeSnapshot, catalogue: BASE_CATALOGUE, panelSessionId: "panel-test", ...extra, plans: new Map<string, StoredPlan>() };
}

/** Calls `ae_propose_plan` with a summary and its operations. */
export function propose(summary: string, operations: ReadonlyArray<JsonObject>, context: ToolContext): CallResult {
  return callTool("ae_propose_plan", { summary, operations }, context);
}

/** The payload of a call the test expects to have succeeded; the failure text is the assertion message. */
export function successValue(result: CallResult): JsonValue {
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.error));
  return decodeOrThrow(jsonValue, result.data);
}

/** The payload of a successful call as a JSON object; fails the test for any other shape. */
export function successObject(result: CallResult): JsonObject {
  return decodeOrThrow(jsonObject, successValue(result));
}

/** The payload of a successful call as a JSON array; fails the test for any other shape. */
export function successArray(result: CallResult): ReadonlyArray<JsonObject> {
  const value = successValue(result);
  assert.ok(Array.isArray(value), "the payload is an array");
  const items: JsonArray = value;
  return objectsIn(items);
}

/** The operations of the plan a successful proposal answers with. */
export function proposedOperations(result: CallResult): ReadonlyArray<JsonObject> {
  return objectsIn(arrayAt(objectAt(successObject(result), "plan"), "operations"));
}

/** The presentation of a successful proposal. */
export function presentationOf(result: CallResult): JsonObject {
  const presentation = objectAt(successObject(result), "presentation");
  assert.ok(presentation, "the answer carries a presentation");
  return presentation;
}

/** The notices of a successful proposal's presentation. */
export function noticesOf(result: CallResult): ReadonlyArray<JsonObject> {
  return objectsIn(arrayAt(presentationOf(result), "notices"));
}

/** The `after` text of every value row of a successful proposal's presentation. */
export function cardLines(result: CallResult): ReadonlyArray<string> {
  return objectsIn(arrayAt(presentationOf(result), "values")).map((row) => String(row.after));
}

/** The placeholder renames a successful proposal reports. */
export function renamedPlaceholders(result: CallResult): JsonObject {
  const renamed = objectAt(successObject(result), "renamedPlaceholders");
  assert.ok(renamed, "the answer reports renamed placeholders");
  return renamed;
}

/** One string field of an operation's `target`. */
export function targetField(operation: JsonObject | undefined, key: string): string | undefined {
  return stringAt(objectAt(operation, "target"), key);
}

/** The plan a successful proposal stored, found by the id the answer carries. */
export function storedPlanOf(context: PlanContext, result: CallResult): StoredPlan {
  const planId = stringAt(successObject(result), "planId");
  const stored = planId === undefined ? undefined : context.plans.get(planId);
  assert.ok(stored, "the proposed plan is stored");
  return stored;
}
