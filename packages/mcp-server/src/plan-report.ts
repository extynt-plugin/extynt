// What a plan tool reports about the plan being authored: the verdicts, the notes, the card and the plan as echoed.
import type { ActionPlan } from "@extynt/action-plan";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { OperationVerdict } from "./batch.js";
import type { PlanPresentation, StoredPlan, ToolContext } from "./contracts.js";
import { jobFields } from "./job-status.js";
import { jsonOf, objectOf } from "./json.js";
import type { JsonObject } from "@extynt/decode";
import { compactOperationEcho } from "./operation-echo.js";
import { composedOperations } from "./operations.js";
import { presentPlanRows } from "./plan-rows.js";

interface ReportFacts {
  readonly record: StoredPlan;
  readonly plan: ActionPlan;
  readonly verdicts: readonly OperationVerdict[];
  readonly notes: readonly string[];
  readonly context: ToolContext;
  readonly snapshot: ProjectSnapshot;
}

function authoredCard(facts: ReportFacts): PlanPresentation {
  const { record, plan, snapshot, context } = facts;
  const operations = composedOperations(plan);
  return {
    title: record.plan.summary,
    target: { compositionId: "", layerId: "", layerName: "Authored plan" },
    effect: { action: "Authored", name: `${operations.length} operation(s)`, amount: null, controlPath: "" },
    motion: { property: "Multiple", from: null, to: null, durationSeconds: 0 },
    values: presentPlanRows(snapshot, operations, context.hostProfile).map((row) => ({ ...row, before: jsonOf(row.before), after: jsonOf(row.after) })),
    notices: [],
    warnings: [],
    approvalRequired: true,
    actions: { approve: "ae_approve_plan", cancel: "ae_cancel_plan" },
  };
}

/** The data an add reports: how many operations were taken, which were changed or refused, and what to do next. */
export function batchReport(facts: ReportFacts): JsonObject {
  const { record, plan, verdicts, notes, context } = facts;
  const operations = composedOperations(plan);
  const accepted = verdicts.filter((verdict) => verdict.status !== "rejected").length;
  const modified = verdicts.filter((verdict) => verdict.status === "accepted_modified").length;
  const staged = (record.staged ?? []).length;
  const refused = verdicts.some((verdict) => verdict.status === "rejected");
  const held = `The plan holds ${operations.length} operation${operations.length === 1 ? "" : "s"}. Keep adding with ae_plan_add, or seal it with ae_plan_complete.`;
  return {
    ...objectOf({
      planId: record.plan.planId,
      status: record.status,
      authored: operations.length,
      batch: verdicts.length ? staged + (refused ? 1 : 0) : staged,
      submitted: verdicts.length,
      accepted,
      modified,
      rejected: verdicts.length - accepted,
      verdicts: jsonOf(verdicts),
      notes: [...notes],
      next: notes.at(-1) ?? held,
      summary: record.plan.summary,
      presentation: jsonOf(authoredCard(facts)),
      plan: jsonOf({ ...plan, operations: compactOperationEcho(operations) }),
    }),
    ...jobFields(record, context),
  };
}
