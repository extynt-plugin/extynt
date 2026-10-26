/** Narrowing for plans read back out of the MCP plan store. */
import { ACTION_PLAN_SCHEMA, type ActionPlan, type ActionPlanV2 } from "@extynt/action-plan";
import { compileV2Plan, type HostPlanCommand } from "@extynt/host-ae";

type PlanCompilation = HostPlanCommand | { ok: false; code: string; message: string };

const isV2Plan = (plan: ActionPlan): plan is ActionPlanV2 =>
  plan.schemaVersion === ACTION_PLAN_SCHEMA &&
  Array.isArray(plan.operations) &&
  plan.operations.length > 0 &&
  plan.bounds !== undefined &&
  plan.preconditions !== undefined &&
  plan.postconditions !== undefined &&
  plan.conflicts !== undefined &&
  plan.digest !== undefined;

const NOT_A_V2_PLAN: PlanCompilation = { ok: false, code: "INVALID_PLAN", message: "the stored plan is not a complete v0.2 plan" };

export const compileStoredPlan = (plan: ActionPlan): PlanCompilation => (isV2Plan(plan) ? compileV2Plan(plan) : NOT_A_V2_PLAN);
