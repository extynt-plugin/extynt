// Shared readers for the plan tests: a catalogue-backed tool context, narrowing of tool results, and decoded views of the plan tools' answers.
import assert from "node:assert/strict";
import { BASE_CATALOGUE } from "@extynt/capability-catalogue";
import { array, boolean, decodeOrThrow, jsonValue, nullable, number, object, optional, string } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import { representativeSnapshot } from "@extynt/project-graph";
import { jsonItems, objectAt, objectsIn, stringAt } from "../../src/json.js";
import { callTool } from "../../src/index.js";
import type { StoredPlan, ToolContext } from "../../src/index.js";

/** What a tool call answers with. */
export type ToolOutcome = ReturnType<typeof callTool>;

/** A tool context with a plan store the test can read and mutate. */
export type PlanContext = ToolContext & { plans: Map<string, StoredPlan> };

/** A fresh context over the representative snapshot and the base catalogue with an empty plan store. */
export function planContext(): PlanContext {
  return { snapshot: representativeSnapshot, catalogue: BASE_CATALOGUE, panelSessionId: "panel-test", plans: new Map<string, StoredPlan>() };
}

/** The plan held under an id; fails the test when the store does not hold it. */
export function planIn(plans: ReadonlyMap<string, StoredPlan>, planId: string): StoredPlan {
  const record = plans.get(planId);
  assert.ok(record, `plan ${planId} is stored`);
  return record;
}

/** The result of a call the test expects to have answered; fails the test with the refusal otherwise. */
export function succeeded(result: ToolOutcome): Extract<ToolOutcome, { ok: true }> {
  assert.ok(result.ok, result.ok ? "" : `${result.error.code}: ${result.error.message}`);
  return result;
}

/** Prepares the demonstration change on the context and returns the stored plan. */
export function preparedPlan(context: PlanContext): StoredPlan {
  const planId = decodeOrThrow(object({ planId: string() }), succeeded(callTool("ae_prepare_change", {}, context)).data).planId;
  return planIn(context.plans, planId);
}

const operationHead = object({ type: string(), comment: optional(string()) });

const recallShape = object({
  planId: string(), status: string(), editable: boolean(), summary: string(), operationCount: number(), fromIndex: number(),
  operations: array(operationHead), nextCursor: nullable(number()), next: optional(string()),
});

/** One page of `ae_recall_plan` as tests read it. */
export type RecallPage = Infer<typeof recallShape>;

/** The page a successful `ae_recall_plan` answered with. */
export function recallPageOf(result: ToolOutcome): RecallPage {
  return decodeOrThrow(recallShape, succeeded(result).data);
}

const planStatusShape = object({
  status: string(), verified: optional(boolean()), postcondition: optional(nullable(string())), warning: optional(string()),
  operations: optional(array(jsonValue)),
});

/** The fields `ae_get_plan_status` reports that these tests read. */
export type PlanStatus = Infer<typeof planStatusShape>;

/** The status a successful `ae_get_plan_status` or `ae_approve_plan` answered with. */
export function planStatusOf(result: ToolOutcome): PlanStatus {
  return decodeOrThrow(planStatusShape, succeeded(result).data);
}

const planRowShape = object({
  planId: string(), status: string(), summary: string(), postcondition: nullable(string()), mayHaveMutated: boolean(),
});

/** One row of `ae_list_plans` as tests read it. */
export type PlanRow = Infer<typeof planRowShape>;

/** The rows a successful `ae_list_plans` answered with. */
export function planRowsOf(result: ToolOutcome): ReadonlyArray<PlanRow> {
  return decodeOrThrow(array(planRowShape), succeeded(result).data);
}

/** The operations of a plan's body, in order, as JSON objects. */
export function planBodyOperations(record: StoredPlan): ReadonlyArray<JsonObject> {
  return objectsIn(jsonItems(record.plan.operations));
}

/** The `target.layerId` of an operation, or `undefined` when it names none. */
export function targetLayerId(operation: JsonObject | undefined): string | undefined {
  return stringAt(objectAt(operation, "target"), "layerId");
}
