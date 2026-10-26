// What is wrong with a plan, in one pass: schema problems, host problems and applicability problems per
// operation, and the message the model repairs from.
import { collectOperationProblems } from "@extynt/action-plan";
import type { ActionPlan, ActionPlanV2Operation } from "@extynt/action-plan";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { ToolContext } from "./contracts.js";
import { hostOperationProblems } from "./host-problems.js";
import { operationJson } from "./operations.js";
import { applicabilityProblems } from "./plan-applicability.js";
import { createdIdsOf, operationStrings } from "./plan-problem.js";
import type { PlanProblem } from "./plan-problem.js";

type SchemaProblem = { index: number; code: string; message: string };
type ProblemGroup = { type: string; code: string; message: string; indexes: number[]; dependents: number[] };

function mergePlanProblems(schema: readonly SchemaProblem[], operations: readonly ActionPlanV2Operation[], later: readonly PlanProblem[]): PlanProblem[] {
  const merged = new Map<number, PlanProblem>();
  const typed = schema.map((problem): PlanProblem => ({ ...problem, type: operations[problem.index]?.type ?? "unknown" }));
  for (const problem of [...typed, ...later]) if (!merged.has(problem.index)) merged.set(problem.index, problem);
  return [...merged.values()].sort((left, right) => left.index - right.index);
}

function dependentsOf(operations: readonly ActionPlanV2Operation[], index: number, created: readonly string[]): number[] {
  return operations.flatMap((operation, position) => position > index && operationStrings(operationJson(operation)).some((value) => created.includes(value)) ? [position] : []);
}

function withDependents(problem: PlanProblem, operations: readonly ActionPlanV2Operation[]): PlanProblem {
  const operation = operations[problem.index];
  const created = operation ? createdIdsOf(operation) : [];
  const dependents = created.length ? dependentsOf(operations, problem.index, created) : [];
  return dependents.length ? { ...problem, dependents } : problem;
}

/**
 * Every reason this plan cannot run, per operation, in one pass: whether each operation is well formed,
 * whether this host can do it, and whether it applies to that kind of layer.
 */
export function planProblems(plan: ActionPlan, operations: readonly ActionPlanV2Operation[], snapshot: ProjectSnapshot, context: ToolContext): PlanProblem[] {
  const later = [...hostOperationProblems(operations, context), ...applicabilityProblems(operations, snapshot)];
  return mergePlanProblems(collectOperationProblems(plan, snapshot), operations, later).map((problem) => withDependents(problem, operations));
}

function groupProblems(problems: readonly PlanProblem[]): ProblemGroup[] {
  const groups = new Map<string, ProblemGroup>();
  for (const problem of problems) {
    const key = `${problem.type}\u0000${problem.code}\u0000${problem.message}`;
    const group = groups.get(key) ?? { type: problem.type, code: problem.code, message: problem.message, indexes: [], dependents: [] };
    group.indexes.push(problem.index);
    group.dependents.push(...(problem.dependents ?? []));
    groups.set(key, group);
  }
  return [...groups.values()];
}

function groupLine(group: ProblemGroup): string {
  const outside = [...new Set(group.dependents)].filter((index) => !group.indexes.includes(index)).sort((left, right) => left - right);
  const refs = outside.map((index) => `#${index}`).join(", ");
  const one = outside.length === 1;
  const later = outside.length ? ` Later ${one ? "operation" : "operations"} ${refs} ${one ? "uses" : "use"} what this creates, so changing or removing it affects ${one ? "it" : "them"}.` : "";
  return `${group.type} [${group.code}] at ${group.indexes.map((index) => `#${index}`).join(", ")}: ${group.message}${later}`;
}

/**
 * What the reader is told, and what the model is asked to do about it, grouped by what is wrong rather than
 * one line per operation. A group drops the dependency notice for its own members, since those operations are
 * being rewritten anyway.
 */
export function planProblemMessage(planId: string, problems: readonly PlanProblem[]): string {
  const count = problems.length === 1 ? "One operation cannot run as written" : `${problems.length} operations cannot run as written`;
  const lines = groupProblems(problems).map(groupLine).join("\n");
  return `${count}. Nothing was applied.\n${lines}\nFix them with ae_amend_plan on plan ${planId}: replace an operation, remove one, or insert one, by its index. The rest of the plan is kept, so do not write it again from scratch.`;
}
