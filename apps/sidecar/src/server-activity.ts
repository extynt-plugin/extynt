/**
 * What the sidecar is doing, for the panel. Chat work is job-centred: a workflow job is shown while it runs, whichever request
 * started it (the request itself, a self-continued cycle, a resume after Apply). MCP work is the tool calls an external agent
 * made. Both travel on the UI event stream (`activity`, `mcp`); nothing here polls.
 */
import { type JsonValue, type JsonObject } from "@extynt/decode";
import type { ServerResponse } from "node:http";

import type { Translate } from "@extynt/ui-text";
import type { WorkflowId } from "@extynt/workflow";
import type { RequestContext } from "./server-types.js";
import type { SidecarState } from "./server-state.js";
import { shownGoal } from "./server-workflow-carry.js";
import { translatorOf } from "./ui-language.js";
import type { UiActivity, UiChecklist, UiJob, UiMcpCall, UiSpecialist, UiWait } from "./ui-contract.js";
import { checklistOf, itemStates, stampVerified, type Checklist } from "./server-workflow-checklist.js";
import { WORKFLOW_SPECIALIST_REGISTRY, type WorkflowSpecialistActivity } from "./workflow-orchestration.js";

const MAX_MCP_CALLS = 100;
const MAX_ARGS_CHARS = 120, MAX_JOB_PLANS = 30, MAX_WAITS = 50, MAX_ITEM_TITLE = 80, MAX_DESIGNER_PLANS = 400;
const SECRET_KEY = /key|token|secret|password|authorization|credential/i;

function toggleWait(list: UiWait[], waiting: boolean, at: string): void {
  const last = list[list.length - 1];
  const open = last?.to === null ? last : undefined;
  if (waiting && !open) list.push({ from: at, to: null });
  else if (!waiting && open) open.to = at;
}

class ActivityLog {
  readonly via = new Map<WorkflowId, UiJob["via"]>();
  readonly calls: UiMcpCall[] = [];
  readonly waits = new Map<WorkflowId, UiWait[]>();
  readonly designerPlans = new Set<string>();
  private rev = 0;
  private ids = 0;

  beginCall(call: { at: string; tool: string; client: string; args: string }): UiMcpCall {
    const entry: UiMcpCall = { id: ++this.ids, rev: ++this.rev, ...call, state: "running", code: null, ms: null, planIds: [] };
    this.calls.push(entry);
    if (this.calls.length > MAX_MCP_CALLS) this.calls.splice(0, this.calls.length - MAX_MCP_CALLS);
    return entry;
  }

  finishCall(entry: UiMcpCall, outcome: { ok: boolean; code: string | null; ms: number; planId?: string }): void {
    entry.state = outcome.ok ? "ok" : "error";
    entry.code = outcome.code;
    entry.ms = outcome.ms;
    if (outcome.planId && !entry.planIds.includes(outcome.planId)) entry.planIds.push(outcome.planId);
    entry.rev = ++this.rev;
  }

  noteDesignerPlans(planIds: Iterable<string>): void {
    for (const id of planIds) this.designerPlans.add(id);
    for (const id of this.designerPlans) { if (this.designerPlans.size <= MAX_DESIGNER_PLANS) break; this.designerPlans.delete(id); }
  }

  noteWaiting(jobId: WorkflowId, waiting: boolean, at: string): UiWait[] {
    for (const other of [...this.waits.keys()]) if (other !== jobId) this.waits.delete(other);
    const list = this.waits.get(jobId) ?? [];
    toggleWait(list, waiting, at);
    if (list.length > MAX_WAITS) list.splice(0, list.length - MAX_WAITS);
    if (list.length) this.waits.set(jobId, list);
    return list.map((wait) => ({ ...wait }));
  }

  callsAfter(rev: number): UiMcpCall[] { return this.calls.filter((call) => call.rev > rev); }
  get latestRev(): number { return this.rev; }
}

const logs = new WeakMap<WeakKey, ActivityLog>();

/** The activity log of the sidecar that owns `state`: the phase each job runs in, the MCP calls, the waits for Apply and the plans the designer built. */
export function activityFor(state: WeakKey): ActivityLog {
  let log = logs.get(state);
  if (!log) { log = new ActivityLog(); logs.set(state, log); }
  return log;
}

function summarize(value: JsonValue): string {
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  if (Array.isArray(value)) return `[${value.length}]`;
  return value !== null && typeof value === "object" ? "{…}" : String(value);
}

function summarizeArgs(args: JsonObject | undefined): string {
  const parts = Object.entries(args ?? {}).map(([key, value]) => `${key}: ${SECRET_KEY.test(key) ? "…" : summarize(value)}`);
  const line = parts.join(", ");
  return line.length > MAX_ARGS_CHARS ? `${line.slice(0, MAX_ARGS_CHARS)}…` : line;
}

type McpCall = { tool: string; args: JsonObject | undefined; client: string; response: ServerResponse; context: RequestContext };

function callPlanId(call: McpCall): string | undefined {
  return call.context.answered?.planId ?? (typeof call.args?.planId === "string" ? call.args.planId : undefined);
}

function callOutcome(call: McpCall): { ok: boolean; code: string | null; ms: number; planId?: string } {
  const answered = call.context.answered, planId = callPlanId(call);
  const ok = (answered?.statusCode ?? call.response.statusCode) < 400;
  return { ok, code: ok ? null : answered?.errorCode ?? "FAILED", ms: Math.max(0, Date.now() - call.context.startedAt), ...(planId ? { planId } : {}) };
}

/** Notes one call an external agent makes: running now, then its outcome when the response finishes. */
export function recordMcpCall(state: SidecarState, call: McpCall, changed: () => void): void {
  const entry = activityFor(state).beginCall({ at: state.now().toISOString(), tool: call.tool, client: call.client, args: summarizeArgs(call.args) });
  changed();
  call.response.once("close", () => {
    activityFor(state).finishCall(entry, callOutcome(call));
    changed();
  });
}

type ActivityState = Pick<SidecarState, "activeChatTurn" | "chatProgress" | "plans" | "workflowCoordinator" | "workflowRuns" | "workflowSidecarActions" | "workflowOrchestrations" | "options" | "persistWorkflowHandoffs" | "now" | "hostFacts">;

function jobActivity(input: { applying: boolean; held: boolean; working: boolean; specialist: string | undefined; label: string | undefined; waitingReceipt: boolean }, translate: Translate): Pick<UiJob, "status" | "activity"> {
  if (input.applying) return { status: "applying", activity: translate("plan.activity.applying") };
  if (input.held && !input.working) return { status: "waiting-apply", activity: translate("plan.activity.waitingApply") };
  if (input.specialist) return { status: "working", activity: translate("plan.activity.specialist", { specialist: input.specialist }) };
  if (input.working) return { status: "working", activity: input.label ?? translate("plan.activity.thinking") };
  return { status: "waiting", activity: translate(input.waitingReceipt ? "plan.activity.waitingBatch" : "plan.activity.waiting") };
}

function phaseOf(id: string, review: boolean): string {
  if (review) return "review";
  return id.replace(/[-_.]?\d+$/, "") || id;
}

function checklistView(state: ActivityState, checklist: Checklist): UiChecklist {
  const batches = state.workflowCoordinator.workflowStore.getState();
  const stamps = checklist.verifiedAt ?? {};
  const phases = new Map<string, { name: string; verified: number; total: number }>();
  const items = itemStates(checklist, batches).map((entry): UiChecklist["items"][number] => {
    const phase = phaseOf(entry.id, entry.review === true), row = phases.get(phase) ?? { name: phase, verified: 0, total: 0 };
    row.total += 1;
    if (entry.status === "done") row.verified += 1;
    phases.set(phase, row);
    const status = entry.status === "done" ? "verified" : entry.status;
    const verifiedAt = status === "verified" ? stamps[entry.id] : undefined;
    return { id: entry.id, title: entry.title.slice(0, MAX_ITEM_TITLE), phase, status, ...(verifiedAt ? { verifiedAt } : {}) };
  });
  return { items, phases: [...phases.values()], current: items.find((item) => item.status === "open")?.id ?? null };
}

const SPECIALIST_STATES = { running: "running", completed: "done", failed: "failed" } as const;

function specialistsOf(state: ActivityState, jobId: string): UiSpecialist[] {
  const activity = state.workflowOrchestrations.get(jobId)?.activity ?? [];
  return activity.map((entry: WorkflowSpecialistActivity): UiSpecialist => {
    const startedAt = entry.startedAt ?? entry.updatedAt, label = WORKFLOW_SPECIALIST_REGISTRY.find((row) => row.role === entry.role)?.label ?? entry.role;
    const running = entry.status === "running", span = Date.parse(entry.updatedAt) - Date.parse(startedAt);
    return { role: entry.role, state: SPECIALIST_STATES[entry.status], startedAt, elapsedMs: running || !Number.isFinite(span) ? null : Math.max(0, span), label };
  });
}

type WorkflowStoreState = ReturnType<ActivityState["workflowCoordinator"]["workflowStore"]["getState"]>;
type JobRun = NonNullable<ReturnType<ActivityState["workflowRuns"]["get"]>>;
type JobProgress = ReturnType<ActivityState["chatProgress"]["get"]>;
type JobPlan = NonNullable<ReturnType<ActivityState["plans"]["get"]>>;

function jobEnded(status: string, run: JobRun | undefined): boolean {
  if (status === "completed" || status === "cancelled") return true;
  return status === "blocked" && (!run || run.state === "terminal");
}

function liveJob(state: ActivityState, store: WorkflowStoreState): { jobId: string; job: WorkflowStoreState["jobs"][string]; run: JobRun | undefined } | undefined {
  const jobId = store.activeJobId ?? [...state.workflowRuns.values()].find((run) => run.state !== "terminal")?.jobId;
  const job = jobId ? store.jobs[jobId] : undefined;
  if (!jobId || !job) return undefined;
  const run = state.workflowRuns.get(jobId);
  return jobEnded(job.status, run) ? undefined : { jobId, job, run };
}

function jobPlansOf(state: ActivityState, jobId: string): JobPlan[] {
  const coordinator = state.workflowCoordinator;
  return [...state.plans.values()].filter((record) => coordinator.jobIdForPlan(record.plan.planId) === jobId);
}

function settledBatchCount(store: WorkflowStoreState, batchIds: readonly string[]): number {
  return batchIds.filter((id) => { const batch = store.batches[id]; return batch?.lifecycle === "settled" && batch.execution.state === "executed"; }).length;
}

const NOT_APPLIED_PLAN_STATUSES = new Set(["failed", "cancelled"]);

function plansNotAppliedOf(plans: JobPlan[]): number {
  return plans.filter((record) => NOT_APPLIED_PLAN_STATUSES.has(record.status)).length;
}

function runWorking(run: JobRun | undefined): boolean {
  return run?.state === "running" || run?.state === "scheduled";
}

function jobStatusOf(plans: JobPlan[], run: JobRun | undefined, seen: { requestOpen: boolean; progress: JobProgress }, translate: Translate): Pick<UiJob, "status" | "activity"> {
  const { requestOpen, progress } = seen;
  const specialist = progress?.orchestration?.activity?.find((entry) => entry.status === "running")?.role;
  const working = requestOpen || runWorking(run);
  const applying = plans.some((record) => record.status === "approved" || record.status === "applying");
  const held = plans.some((record) => (record.status === "prepared" || record.status === "presented") && !record.variantSetId);
  return jobActivity({ applying, held, working, specialist, label: progress?.label, waitingReceipt: run?.state === "waiting_receipt" }, translate);
}

function jobVia(state: ActivityState, jobId: string, requestOpen: boolean): UiJob["via"] {
  const origin = activityFor(state).via.get(jobId);
  return requestOpen && origin === "apply-resume" ? "request" : origin ?? "request";
}

function requestIdOf(state: ActivityState, run: JobRun | undefined): string {
  return run?.requestId ?? state.activeChatTurn?.requestId ?? "";
}

function requestIsOpen(state: ActivityState, jobId: string): boolean {
  return !!state.activeChatTurn && state.workflowCoordinator.jobIdForSeed(state.activeChatTurn.requestId) === jobId;
}

function checklistFor(state: ActivityState, jobId: string): UiChecklist | null {
  const checklist = checklistOf(state, jobId);
  return checklist ? checklistView(state, checklist) : null;
}

function activeJob(state: ActivityState): UiJob | undefined {
  const store = state.workflowCoordinator.workflowStore.getState();
  const live = liveJob(state, store);
  if (!live) return undefined;
  const { jobId, job, run } = live;
  const requestId = requestIdOf(state, run), requestOpen = requestIsOpen(state, jobId);
  const plans = jobPlansOf(state, jobId);
  const progress = state.chatProgress.get(requestId);
  const now = jobStatusOf(plans, run, { requestOpen, progress }, translatorOf(state));
  const at = state.now().toISOString();
  stampVerified(state, jobId, store, at);
  const waits = activityFor(state).noteWaiting(jobId, now.status === "waiting-apply", at);
  return { jobId, requestId, goal: shownGoal(job.goalSummary, translatorOf(state)).slice(0, 120), via: jobVia(state, jobId, requestOpen), ...now, cycle: job.providerCycle, step: progress?.step ?? 0, plansApplied: settledBatchCount(store, job.batchIds), plansNotApplied: plansNotAppliedOf(plans), requestOpen, plans: plans.slice(-MAX_JOB_PLANS).map((record) => record.plan.planId), startedAt: job.createdAt, waits, checklist: checklistFor(state, jobId), specialists: specialistsOf(state, jobId) };
}

/** The jobs the panel shows as running: the one the engine holds or a resume still owns, if any (the engine runs one job at a time). */
export function activityViewOf(state: ActivityState): UiActivity {
  const job = activeJob(state);
  return { jobs: job ? [job] : [] };
}
