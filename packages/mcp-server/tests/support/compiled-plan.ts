// Compiles a stored plan for the host adapter, so tests can assert on the commands a plan produces.
import assert from "node:assert/strict";
import type { ActionPlanV2 } from "@extynt/action-plan";
import { compileV2Plan } from "@extynt/host-ae";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { StoredPlan } from "../../src/index.js";
import { jsonFieldsOf } from "../../src/json.js";
import type { JsonObject } from "@extynt/decode";

function isPlanV2<Plan>(plan: Plan): plan is Plan & ActionPlanV2 {
  return typeof plan === "object" && plan !== null && "schemaVersion" in plan && plan.schemaVersion === "0.2" && "digest" in plan && typeof plan.digest === "string" && "freshness" in plan && "bounds" in plan;
}

/** The host command a stored plan compiles to, or the compile refusal; fails the test when the plan is missing or is not a v2 plan. */
export function compiledPlan(record: StoredPlan | undefined, snapshot?: ProjectSnapshot): ReturnType<typeof compileV2Plan> {
  assert.ok(record, "the plan is stored");
  assert.ok(isPlanV2(record.plan), "the stored plan is a v2 plan");
  return compileV2Plan(record.plan, snapshot);
}

/** The host operations a stored plan compiles to, as JSON objects; fails the test when compilation refuses the plan. */
export function compiledOperations(record: StoredPlan | undefined, snapshot?: ProjectSnapshot): ReadonlyArray<JsonObject> {
  const compiled = compiledPlan(record, snapshot);
  assert.ok("operations" in compiled, JSON.stringify(compiled));
  return compiled.operations.map((operation) => jsonFieldsOf(operation));
}
