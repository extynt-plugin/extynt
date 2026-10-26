// The plan rules and the plan decoder agree: every operation type has a rule, and a plan the rules accept decodes as a whole plan.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decode } from "@extynt/decode";
import { actionPlanOperation } from "../src/operation-decoder.js";
import { actionPlanV2 } from "../src/plan-decoder.js";
import { isActionPlanV2, validateActionPlanJson } from "../src/plan-validation.js";
import { ruleFor } from "../src/operation-rules.js";
import { buildPlan } from "./plan-builders.js";
import { target } from "./fixtures.js";

function decoderTypes(): string[] {
  const refused = decode(actionPlanOperation, { type: "no_such_operation" });
  assert.ok(!refused.ok);
  return [...refused.error.expected.matchAll(/"([a-z_0-9]+)"/g)].map((match) => match[1] ?? "");
}

test("every operation type the decoder names has a rule, and an unknown type has neither", () => {
  const types = decoderTypes();
  assert.ok(types.length > 80);
  assert.deepEqual(types.filter((type) => ruleFor(type) === undefined), []);
  assert.equal(ruleFor("no_such_operation"), undefined);
});

test("a plan the rules accept is a whole v0.2 plan", () => {
  const plan = buildPlan({ operations: [{ type: "set_layer_name", target, name: "Edited" }] });
  assert.equal(validateActionPlanJson(plan).ok, true);
  assert.ok(isActionPlanV2(plan));
  assert.ok(decode(actionPlanV2, plan).ok);
});

test("a plan with an operation that does not decode is not a whole plan", () => {
  const plan = buildPlan({ operations: [{ type: "set_layer_name", target, name: 7 }] });
  assert.ok(!isActionPlanV2(plan));
  assert.ok(!isActionPlanV2({ ...plan, extra: true }));
});
