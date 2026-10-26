// Starting a plan the sidecar owns: it exists from this moment and gains operations until it is sealed.
import type { Infer } from "@extynt/decode";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { BATCH_INTEROP_NOTE } from "./batch.js";
import type { StoredPlan, ToolContext } from "./contracts.js";
import { jobStatus } from "./job-status.js";
import { jsonOf, objectOf } from "./json.js";
import { authoredShell } from "./plan-authoring.js";
import { mintJobId, newPlanId, now } from "./plan-store.js";
import type { AE_PLAN_CREATE } from "./tool-specs-plan.js";
import { toolError, toolSuccess } from "./tool-result.js";
import type { ToolBase, ToolFailure, ToolResult } from "./tool-result.js";

type CreateArgs = Infer<typeof AE_PLAN_CREATE.input.decoder>;

const MAX_SUMMARY_CHARS = 512;
const MAX_JOB_ID_CHARS = 128;

function planSummary(args: CreateArgs): string | ToolFailure {
  const summary = args.summary.trim();
  return summary && summary.length <= MAX_SUMMARY_CHARS ? summary : toolError("INVALID_ARGUMENT", `summary is required and must be at most ${MAX_SUMMARY_CHARS} characters.`);
}

function jobIdProblem(given: string | undefined, requested: string): ToolFailure | undefined {
  return given !== undefined && (!requested || requested.length > MAX_JOB_ID_CHARS) ? toolError("INVALID_ARGUMENT", `jobId must be 1-${MAX_JOB_ID_CHARS} characters. Omit it to start a new job.`) : undefined;
}

function jobNamed({ jobId: given }: CreateArgs, context: ToolContext): string | ToolFailure {
  const requested = given?.trim() ?? "";
  const invalid = jobIdProblem(given, requested);
  if (invalid) return invalid;
  const held = [...(context.plans?.values() ?? [])].some((record) => record.jobId === requested);
  if (requested && !held) return toolError("JOB_NOT_FOUND", `No batch of job ${requested} is held in this panel session — this sidecar's plan store is in memory, so a job does not survive a restart. Omit jobId to start a new job, or pass a jobId an earlier create in this session returned.`);
  return requested;
}

/** Start a plan the sidecar owns: it exists from this moment, is readable at any status, and gains operations through `ae_plan_add` until `ae_plan_complete` seals it. */
export function createPlan(base: ToolBase, snapshot: ProjectSnapshot, args: CreateArgs, context: ToolContext): ToolResult {
  const summary = planSummary(args);
  if (typeof summary !== "string") return summary;
  const named = jobNamed(args, context);
  if (typeof named !== "string") return named;
  const jobId = named || mintJobId();
  const planId = newPlanId();
  const at = now(context).toISOString();
  const record: StoredPlan = { plan: authoredShell({ planId, summary, createdAt: at }, snapshot, [], { totalKeyframes: 0, maxExpressionLength: 0 }), status: "draft", staged: [], jobId, createdAt: at, updatedAt: at };
  context.plans?.set(planId, record);
  const job = jobStatus(context, jobId);
  const next = `Authoring ${planId} as batch ${job.batches} of job ${jobId}. Add the operations you are sure of with ae_plan_add — one coherent group at a time, as many calls as the work needs; read it back at any time with ae_recall_plan; seal it with ae_plan_complete when it is whole. Pass jobId ${jobId} to ae_plan_create for the next batch of this same job, or omit it to start a different job. The sidecar validates each operation as it arrives and judges the whole plan only at complete, so an operation may reference something a later one creates. ${BATCH_INTEROP_NOTE}`;
  return toolSuccess(base, objectOf({ planId, jobId, status: record.status, authored: 0, batches: 0, job: jsonOf(job), next }));
}
