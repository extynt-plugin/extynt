/** Starting and running one specialist turn: the session and bundle it lives in, the activity it publishes, its cost and its log line. */
import { decodeOrThrow } from "@extynt/decode";
import type { ToolCallingProvider } from "@extynt/llm";
import type { callTool } from "@extynt/mcp-server";
import { profileDirectory } from "./profile-store.js";
import type { ToolArguments } from "./agent-types.js";
import type { AgentCallState, ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { appendSpecialistTranscript } from "./server-specialist-logs.js";
import type { PlanSnapshot } from "./server-workflow-design-receipts.js";
import { runDesigner } from "./server-workflow-designer.js";
import { specialistWorkflowId } from "./server-workflow-specialist-id.js";
import { consultWorkflowSpecialist, delegationMode, handoffContract, orchestrationSummary, WORKFLOW_OWNER, type WorkflowOrchestrationBundle, type WorkflowSpecialistActivity, type WorkflowSpecialistBrief, type WorkflowSpecialistRole, type WorkflowSpecialistSession } from "./workflow-orchestration.js";
import { thrownMessage } from "./server-workflow-error.js";

/** Runs a tool of the owner's dispatcher under the given call state: the designer builds through it. */
export type DispatchRun = (name: string, args: ToolArguments, state: AgentCallState) => Promise<ReturnType<typeof callTool>>;

/** Everything one turn needs: where it runs, who runs it, what it was told and the tool dispatcher a designer builds through. */
export type TurnStart = {
  readonly deps: ChatAgentDeps;
  readonly input: ChatAgentInput;
  readonly bundle: WorkflowOrchestrationBundle;
  readonly session: WorkflowSpecialistSession;
  readonly run: DispatchRun;
  readonly provider: ToolCallingProvider;
  readonly snapshot: PlanSnapshot;
  readonly instruction: string;
};

type Outcome = "completed" | "failed";
type ChatProgress = NonNullable<ReturnType<ChatAgentDeps["state"]["chatProgress"]["get"]>>;
type Reporter = NonNullable<Parameters<typeof consultWorkflowSpecialist>[0]["onUsage"]>;
type Tally = { inputTokens: number; outputTokens: number; steps: number };

/** The job's orchestration bundle, created (and persisted) on first use; undefined when the request belongs to no job. */
export function specialistBundle(deps: ChatAgentDeps, input: ChatAgentInput): WorkflowOrchestrationBundle | undefined {
  const workflowId = specialistWorkflowId(deps, input);
  if (!workflowId) return undefined;
  const existing = deps.state.workflowOrchestrations.get(workflowId);
  if (existing) return existing;
  const created: WorkflowOrchestrationBundle = { owner: WORKFLOW_OWNER, mode: "single-agent-fallback", specialists: [], unavailable: [], activity: [], handoff: handoffContract([], input.workflowGoalSummary ?? input.message) };
  deps.state.workflowOrchestrations.set(workflowId, created);
  deps.state.persistWorkflowHandoffs();
  return created;
}

/** The role's session in the job, created (and persisted) on first use. */
export function specialistSession(deps: ChatAgentDeps, workflowId: string, role: WorkflowSpecialistRole): WorkflowSpecialistSession {
  const sessions = deps.state.workflowSpecialistSessions.get(workflowId) ?? new Map<WorkflowSpecialistRole, WorkflowSpecialistSession>();
  if (!deps.state.workflowSpecialistSessions.has(workflowId)) {
    deps.state.workflowSpecialistSessions.set(workflowId, sessions);
    deps.state.persistWorkflowHandoffs();
  }
  const existing = sessions.get(role);
  if (existing) return existing;
  const created: WorkflowSpecialistSession = { role, turns: 0, messages: [] };
  sessions.set(role, created);
  deps.state.persistWorkflowHandoffs();
  return created;
}

/** What the owner reads of the designer: its report, the layers the sidecar found built (name and id, bottom to top) and the compiled scene (names, positions, bounds, palette), never the drawing. */
export function designerHandoff(brief: WorkflowSpecialistBrief): { role: WorkflowSpecialistRole; report: string; built: readonly string[]; scene?: WorkflowSpecialistBrief["scene"] } {
  return { role: brief.role, report: brief.objective, built: brief.deliverables, ...(brief.scene ? { scene: brief.scene } : {}) };
}

function updatedActivities(existing: WorkflowSpecialistActivity[] | undefined, activity: WorkflowSpecialistActivity): WorkflowSpecialistActivity[] {
  const earlier = (existing ?? []).find((entry) => entry.role === activity.role);
  const startedAt = earlier?.turn === activity.turn && earlier.startedAt ? earlier.startedAt : activity.updatedAt;
  return [...(existing ?? []).filter((entry) => entry.role !== activity.role), { ...activity, startedAt }];
}

function activityLabel(activity: WorkflowSpecialistActivity): string {
  if (activity.status === "running") return `${activity.role} specialist is working`;
  if (activity.status === "completed") return `${activity.role} specialist ${activity.role === "visual-scene" ? "reported" : "returned a handoff"}`;
  return `${activity.role} specialist needs correction`;
}

function progressOf(context: TurnStart, activity: WorkflowSpecialistActivity, previous: ChatProgress): ChatProgress {
  const { deps, input, bundle } = context;
  return { requestId: input.requestId, step: previous.step, maxSteps: previous.maxSteps, phase: "delegating", label: activityLabel(activity), notes: previous.notes, at: deps.state.now().toISOString(), orchestration: orchestrationSummary(bundle), ...(previous.authoring ? { authoring: previous.authoring } : {}) };
}

function publishActivity(context: TurnStart, activity: WorkflowSpecialistActivity): void {
  const { deps, input, bundle } = context;
  bundle.activity = updatedActivities(bundle.activity, activity);
  deps.state.persistWorkflowHandoffs();
  const previous = deps.state.chatProgress.get(input.requestId);
  if (previous) deps.state.chatProgress.set(input.requestId, progressOf(context, activity, previous));
  deps.transport.notifyChange();
}

function updateBundleSuccess(context: TurnStart, brief: WorkflowSpecialistBrief): void {
  const { bundle, session, deps, input } = context;
  session.brief = brief;
  const index = bundle.specialists.findIndex((entry) => entry.role === session.role);
  if (index >= 0) bundle.specialists[index] = brief; else bundle.specialists.push(brief);
  bundle.unavailable = bundle.unavailable.filter((entry) => entry.role !== session.role);
  bundle.mode = delegationMode(bundle.specialists.length);
  bundle.handoff = handoffContract(bundle.specialists, input.workflowGoalSummary ?? input.message);
  if (session.activity) publishActivity(context, session.activity);
  deps.state.persistWorkflowHandoffs();
}

function updateBundleFailure(context: TurnStart, reason: string): void {
  const { bundle, session, deps } = context;
  session.error = reason;
  bundle.unavailable = [...bundle.unavailable.filter((entry) => entry.role !== session.role), { role: session.role, reason: reason.slice(0, 120) }];
  bundle.mode = delegationMode(bundle.specialists.length);
  if (session.activity) publishActivity(context, session.activity);
  deps.state.persistWorkflowHandoffs();
}

function designerSession(context: TurnStart): WorkflowSpecialistSession | undefined {
  if (context.session.role !== "motion") return undefined;
  const workflowId = specialistWorkflowId(context.deps, context.input);
  return workflowId ? context.deps.state.workflowSpecialistSessions.get(workflowId)?.get("visual-scene") : undefined;
}

function withSceneDesign(instruction: string, design: WorkflowSpecialistBrief | undefined): string {
  if (!design) return instruction;
  return `${instruction}\n\nThe scene as the visual-scene designer built it. Animate these layers by these names, from these positions and anchors; do not redesign them:\n${JSON.stringify(designerHandoff(design))}`;
}

function waitingActivity(context: TurnStart): WorkflowSpecialistActivity {
  const { deps, session } = context;
  return { role: session.role, status: "running", turn: session.turns + 1, text: "Waiting for the visual-scene designer, whose scene this motion is built on.", reasoning: "", updatedAt: deps.state.now().toISOString() };
}

async function awaitDesigner(context: TurnStart, designer: WorkflowSpecialistSession | undefined, current: () => boolean): Promise<boolean> {
  if (!designer?.pending) return true;
  const { input, session } = context;
  const waiting = waitingActivity(context);
  session.activity = waiting;
  publishActivity(context, waiting);
  await designer.pending;
  if (!current()) return false;
  if (session.controller?.signal.aborted || input.signal?.aborted) throw new Error("specialist turn was stopped before the scene was built");
  return true;
}

function activitySink(context: TurnStart, current: () => boolean): (activity: WorkflowSpecialistActivity) => void {
  return (activity) => {
    if (!current()) return;
    context.session.activity = activity;
    publishActivity(context, activity);
  };
}

function consultReporter(context: TurnStart, tally: Tally): Reporter {
  const { deps, input, session, provider } = context;
  return (usage) => {
    tally.steps += 1;
    tally.inputTokens += usage?.inputTokens ?? 0;
    tally.outputTokens += usage?.outputTokens ?? 0;
    deps.state.specialistUsage.add({ requestId: input.requestId, role: session.role, provider, usage });
  };
}

function consultInput(context: TurnStart, designer: WorkflowSpecialistSession | undefined, onActivity: ReturnType<typeof activitySink>, tally: Tally): Parameters<typeof consultWorkflowSpecialist>[0] {
  const { deps, input, session, provider, snapshot, instruction } = context;
  return { provider, snapshot: designer ? deps.planState.normalizedLatest() ?? snapshot : snapshot, requestId: input.requestId, goal: input.workflowGoalSummary ?? input.message, instruction: withSceneDesign(instruction, designer?.brief), role: session.role, session, now: deps.state.now, onActivity, onUsage: consultReporter(context, tally), ...(input.signal ? { signal: input.signal } : {}), ...(session.controller ? { controller: session.controller } : {}) };
}

function designerInput(context: TurnStart, onActivity: ReturnType<typeof activitySink>, tally: Tally): Parameters<typeof runDesigner>[0] {
  const { deps, input, session, provider, snapshot, instruction } = context;
  const onUsage: Parameters<typeof runDesigner>[0]["onUsage"] = (usage, steps) => {
    tally.steps = steps;
    tally.inputTokens += usage?.inputTokens ?? 0;
    tally.outputTokens += usage?.outputTokens ?? 0;
    deps.state.specialistUsage.add({ requestId: input.requestId, role: session.role, provider, usage, calls: steps });
  };
  return { deps, input, session, provider, snapshot: deps.planState.normalizedLatest() ?? snapshot, goal: input.workflowGoalSummary ?? input.message, instruction, run: context.run, onActivity, onUsage };
}

type TurnCost = { role: WorkflowSpecialistRole; jobId: string | null; requestId: string; outcome: Outcome; ms: number; inputTokens: number; outputTokens: number; steps: number };

function logTranscript(context: TurnStart, firstMessage: number, cost: TurnCost): void {
  const { deps, session, input } = context;
  if (session.messages.length <= firstMessage) return;
  try {
    appendSpecialistTranscript(deps.state.options.stateDirectory ?? profileDirectory(), {
      workflowId: specialistWorkflowId(deps, input) ?? input.workflowJobId ?? "unknown",
      requestId: input.requestId, role: session.role, turn: session.turns,
      outcome: cost.outcome, at: deps.state.now().toISOString(), messages: session.messages.slice(firstMessage),
      cost, ...(session.error ? { error: session.error } : {}),
    });
  } catch (error) {
    process.stderr.write(`[extynt] specialist transcript append failed: ${decodeOrThrow(thrownMessage, error)}\n`);
  }
}

function logLine(context: TurnStart, cost: TurnCost): void {
  const { input, session } = context;
  input.log?.({ event: "agent.specialist", requestId: input.requestId, role: session.role, turn: session.turns, outcome: cost.outcome, reason: cost.outcome === "failed" ? session.error?.slice(0, 400) ?? "superseded" : null, ms: cost.ms, inputTokens: cost.inputTokens, outputTokens: cost.outputTokens, steps: cost.steps });
}

function settle(context: TurnStart, firstMessage: number, cost: TurnCost): void {
  const { deps, session } = context;
  logTranscript(context, firstMessage, cost);
  logLine(context, cost);
  delete session.pending;
  delete session.controller;
  deps.transport.notifyChange();
}

async function produce(context: TurnStart, current: () => boolean, tally: Tally): Promise<WorkflowSpecialistBrief | undefined> {
  const designer = designerSession(context);
  if (!await awaitDesigner(context, designer, current)) return undefined;
  const onActivity = activitySink(context, current);
  return context.session.role === "visual-scene" ? runDesigner(designerInput(context, onActivity, tally)) : consultWorkflowSpecialist(consultInput(context, designer, onActivity, tally));
}

async function attempt(context: TurnStart, current: () => boolean, tally: Tally): Promise<Outcome> {
  try {
    const brief = await produce(context, current, tally);
    if (!brief || !current()) return "failed";
    updateBundleSuccess(context, brief);
    return "completed";
  } catch (error) {
    if (current()) updateBundleFailure(context, decodeOrThrow(thrownMessage, error));
    return "failed";
  }
}

async function runTurn(context: TurnStart, generation: number): Promise<void> {
  const { deps, input, session } = context;
  const current = () => session.generation === generation;
  const firstMessage = session.messages.length;
  const startedAt = Date.now();
  const tally: Tally = { inputTokens: 0, outputTokens: 0, steps: 0 };
  let outcome: Outcome = "failed";
  try {
    outcome = await attempt(context, current, tally);
  } finally {
    if (current()) settle(context, firstMessage, { role: session.role, jobId: specialistWorkflowId(deps, input) ?? null, requestId: input.requestId, outcome, ms: Date.now() - startedAt, ...tally });
  }
}

/**
 * Starts the role's next turn in the background and returns at once; the session's `pending` settles when the turn ends. The animator starts from the
 * designer's finished scene: a motion turn launched while the scene is still being designed waits for it, and its instruction carries the designer's report
 * and scene verbatim. Each turn has one log line with the reason a failed turn ended, because the transcript archive is local to the profile and the log is
 * what a run's evidence has. A turn that was superseded by a newer one publishes and logs nothing.
 */
export function startSpecialistTurn(context: TurnStart): void {
  const { session } = context;
  delete session.error;
  const generation = (session.generation ?? 0) + 1;
  session.generation = generation;
  session.controller = new AbortController();
  session.pending = runTurn(context, generation);
}
