/** The owner's specialist tool: launching, waiting on, reading and correcting the design specialists, and the wake events and landing time that go with them. */
import { specialistWithheld } from "./decision-specialists.js";
import { decode, literal, string, type JsonValue } from "@extynt/decode";
import { canRunAgent, WORKFLOW_SPECIALIST_TOOL, type AgentRunInput } from "./agent.js";
import type { ToolArguments } from "./agent-types.js";
import { jsonOf } from "@extynt/mcp-server";
import type { ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { CHAT_TURN_ADVISORY_MS, CHAT_TURN_LANDING_MS } from "./server-limits.js";
import { refusal, type ToolResult } from "./server-workflow-operation-json.js";
import { consultExpression } from "./server-workflow-sidecar-specialists.js";
import { specialistRemedy, specialistWorkflowId } from "./server-workflow-specialist-id.js";
import type { PlanSnapshot } from "./server-workflow-design-receipts.js";
import { designerHandoff, specialistBundle, specialistSession, startSpecialistTurn, type DispatchRun, type TurnStart } from "./server-workflow-specialist-turn.js";
import { MODEL_SPECIALIST_ROLES, workflowSpecialistRole, WORKFLOW_OWNER, type WorkflowSpecialistActivity, type WorkflowSpecialistBrief, type WorkflowSpecialistRole, type WorkflowSpecialistSession } from "./workflow-orchestration.js";

type Result = ToolResult;
type Refusal = Extract<Result, { ok: false }>;
type Target = { id: string; name: string };
type CallRequest = { role: WorkflowSpecialistRole; action: SpecialistAction; instruction: string };
type PreparedCall = TurnStart & CallRequest & { target?: Target };
type SpecialistAction = "launch" | "wait" | "status" | "message";
type SpecialistStatus = "running" | "failed" | "sleeping" | "not-started";
type SpecialistData = {
  role: WorkflowSpecialistRole;
  status: SpecialistStatus;
  turns: number;
  stream?: WorkflowSpecialistActivity;
  handoff?: WorkflowSpecialistBrief | ReturnType<typeof designerHandoff> | string;
  mayContinue?: boolean;
  error?: string;
  reason?: string;
  remedy?: string;
  next?: string;
};
type RequestNotes = { calls: number; wakes: number; poll?: { session: WorkflowSpecialistSession; generation: number | undefined; calls: number } };

const TEXT = string();
const ACTION = literal("launch", "wait", "status", "message");
const INSTRUCTION_CHARS = 4_000;
const SPECIALIST_WAKE_LIMIT = 3;
const SPECIALIST_HEARTBEAT_MS = 10_000;
const HANDOFF_ALREADY_RETURNED = "Unchanged since an earlier call in this conversation returned it in full; read it there.";
const MAX_LANDING_EXTENSION_MS = CHAT_TURN_ADVISORY_MS - CHAT_TURN_LANDING_MS - 120_000;
const requestNotes = new WeakMap<ChatAgentInput, RequestNotes>();

const DESIGNER_STILL_DRAWING = "The designer is still drawing and building its scene itself; do not queue its layers. Work on the other items: its report wakes you when it is done. Polling again with nothing else in between waits for it.";

const SPECIALIST_WAIT_MAX_SECONDS = 300;

type WaitDeps = Pick<ChatAgentDeps, "state"> & { readonly transport?: { notifyChange(): void } };

function notesOf(input: ChatAgentInput): RequestNotes {
  const existing = requestNotes.get(input);
  if (existing) return existing;
  const created: RequestNotes = { calls: 0, wakes: 0 };
  requestNotes.set(input, created);
  return created;
}

function success(snapshot: PlanSnapshot, data: SpecialistData): Result {
  return { ok: true, tool: WORKFLOW_SPECIALIST_TOOL, snapshotFingerprint: snapshot.fingerprint, data: jsonOf(data) };
}

function textArg(value: JsonValue | undefined): string | undefined {
  const decoded = decode(TEXT, value);
  return decoded.ok ? decoded.value : undefined;
}

/** The lifecycle the sidecar tells the owner it holds for the job's specialists, or undefined when none has run. */
export function specialistRuntimeState(deps: ChatAgentDeps, input: ChatAgentInput): string | undefined {
  const workflowId = specialistWorkflowId(deps, input);
  const bundle = workflowId ? deps.state.workflowOrchestrations.get(workflowId) : undefined;
  if (!bundle?.activity?.length) return undefined;
  return `Specialist lifecycle (sidecar-owned; trusted):\n${JSON.stringify(bundle.activity.map((entry) => ({ role: entry.role, status: entry.status, turn: entry.turn, updatedAt: entry.updatedAt })))}\nA completed specialist has pinged you. Read it with ae_consult_specialist action=status or wait; wake the same thread with action=message when its handoff (the designer: its report) needs correction.`;
}

function specialistStatus(session: WorkflowSpecialistSession): SpecialistStatus {
  if (session.pending) return "running";
  if (session.error) return "failed";
  return session.brief ? "sleeping" : "not-started";
}

function toolData(role: WorkflowSpecialistRole, session: WorkflowSpecialistSession): SpecialistData {
  const drawing = role === "visual-scene";
  return {
    role, status: specialistStatus(session), turns: session.turns,
    ...(session.activity && !drawing ? { stream: session.activity } : {}),
    ...(session.brief ? { handoff: drawing ? designerHandoff(session.brief) : session.brief, mayContinue: true } : {}),
    ...(session.error && !session.pending ? { error: session.error, reason: session.error, remedy: specialistRemedy(role) } : {}),
  };
}

async function boundedWait(work: Promise<void>, milliseconds: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, milliseconds); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function specialistHeartbeat(deps: WaitDeps, input: ChatAgentInput): void {
  const previous = deps.state.chatProgress.get(input.requestId);
  if (previous) deps.state.chatProgress.set(input.requestId, { ...previous, at: deps.state.now().toISOString() });
  deps.transport?.notifyChange();
}

async function waitRound(deps: WaitDeps, input: ChatAgentInput, wait: { session: WorkflowSpecialistSession; startedAt: number; capMs: number }): Promise<boolean> {
  const pending = wait.session.pending;
  if (!pending || input.signal?.aborted) return false;
  const left = wait.capMs - (deps.state.now().getTime() - wait.startedAt);
  if (left <= 0) return false;
  await boundedWait(pending, Math.min(SPECIALIST_HEARTBEAT_MS, left));
  if (wait.session.pending) specialistHeartbeat(deps, input);
  return true;
}

/** Blocks until the running turn of this specialist finishes, the cap passes or the request is stopped, telling the panel every few seconds that the block is alive; the time spent is design time, so the owner's clock gets it back. */
export async function awaitRunningSpecialist(deps: WaitDeps, input: ChatAgentInput, session: WorkflowSpecialistSession, capSeconds = SPECIALIST_WAIT_MAX_SECONDS): Promise<void> {
  if (!session.pending) return;
  const wait = { session, startedAt: deps.state.now().getTime(), capMs: capSeconds * 1_000 };
  let waiting = true;
  while (waiting) waiting = await waitRound(deps, input, wait);
  input.extendLanding?.(Math.max(0, deps.state.now().getTime() - wait.startedAt));
}

function unannounced(session: WorkflowSpecialistSession): boolean {
  return session.turns > Math.max(session.ownerSeenTurn ?? 0, session.ownerWokenTurn ?? 0);
}

function wakeEvents(ready: readonly WorkflowSpecialistSession[]): string {
  const events = ready.map((session) => `${session.role} turn ${session.turns} ${session.error ? "failed and can be corrected" : "completed"}`).join(", ");
  return `[Sidecar wake event: ${events}. Read each result with ${WORKFLOW_SPECIALIST_TOOL} action=status, then critique with action=message if needed. Do not finalize without consuming the handoffs you launched.]`;
}

function outstandingSessions(deps: ChatAgentDeps, input: ChatAgentInput): WorkflowSpecialistSession[] {
  const workflowId = specialistWorkflowId(deps, input);
  const sessions = workflowId ? deps.state.workflowSpecialistSessions.get(workflowId) : undefined;
  return [...(sessions?.values() ?? [])].filter((session) => !!session.pending || unannounced(session));
}

async function sessionsReadyAfterWait(outstanding: readonly WorkflowSpecialistSession[], input: ChatAgentInput): Promise<WorkflowSpecialistSession[]> {
  await Promise.allSettled(outstanding.flatMap((session) => session.pending ? [session.pending] : []));
  return input.signal?.aborted ? [] : outstanding.filter((session) => !session.pending && unannounced(session));
}

/**
 * The event that wakes an owner whose specialists finished while it was answering in prose, or undefined. There is one wake per completed specialist turn,
 * and at most SPECIALIST_WAKE_LIMIT per request, so an owner that keeps answering without reading is not woken until its step limit. Each pending turn is
 * bounded by its own specialist turn timeout.
 */
export async function specialistWake(deps: ChatAgentDeps, input: ChatAgentInput): Promise<string | undefined> {
  const outstanding = outstandingSessions(deps, input);
  const notes = notesOf(input);
  if (!outstanding.length || notes.wakes >= SPECIALIST_WAKE_LIMIT) return undefined;
  notes.wakes += 1;
  const ready = await sessionsReadyAfterWait(outstanding, input);
  for (const session of ready) session.ownerWokenTurn = session.turns;
  return ready.length ? wakeEvents(ready) : undefined;
}

function isModelRole(role: WorkflowSpecialistRole): boolean {
  return MODEL_SPECIALIST_ROLES.some((entry) => entry === role);
}

function ownerRefusal(input: ChatAgentInput): Refusal | undefined {
  return input.workflowJobId && input.workflowRole === WORKFLOW_OWNER ? undefined : refusal("WORKFLOW_OWNER_REQUIRED", "Only the active workflow owner may consult a specialist.");
}

function shapedRequest(raw: { role: WorkflowSpecialistRole | undefined; action: SpecialistAction | undefined; instruction: string }): CallRequest | Refusal {
  const { role, action, instruction } = raw;
  if (role && !isModelRole(role)) return refusal("INVALID_SPECIALIST_REQUEST", `The ${role} specialist is run by the sidecar itself; you cannot launch it.`);
  if (!role || !action) return refusal("INVALID_SPECIALIST_REQUEST", "Choose a registered specialist role and one of launch, wait, status, or message.");
  if ((action === "launch" || action === "message") && !instruction) return refusal("INVALID_SPECIALIST_REQUEST", `${action} requires a concrete specialist instruction.`);
  return { role, action, instruction };
}

function checkedRequest(input: ChatAgentInput, args: ToolArguments): CallRequest | Refusal {
  const decoded = decode(ACTION, args.action);
  const shaped = shapedRequest({ role: workflowSpecialistRole(args.role), action: decoded.ok ? decoded.value : undefined, instruction: (textArg(args.instruction) ?? "").trim().slice(0, INSTRUCTION_CHARS) });
  return "ok" in shaped ? shaped : ownerRefusal(input) ?? shaped;
}

function namedComposition(request: CallRequest, args: ToolArguments): string {
  const named = request.role === "visual-scene" && request.action === "launch" ? textArg(args.compositionId) : undefined;
  return (named ?? "").trim();
}

function launchTarget(snapshot: PlanSnapshot | undefined, request: CallRequest, args: ToolArguments): Target | Refusal | undefined {
  const targetId = namedComposition(request, args);
  const target = targetId ? snapshot?.compositions.find((item) => item.id === targetId) : undefined;
  if (targetId && snapshot && !target) return refusal("INVALID_SPECIALIST_REQUEST", `compositionId "${targetId}" is not a composition in the project. Use the id of an existing composition (ae_inspect_composition lists them).`);
  return target ? { id: target.id, name: target.name } : undefined;
}

function activeSession(deps: ChatAgentDeps, input: ChatAgentInput, role: WorkflowSpecialistRole): { bundle: TurnStart["bundle"]; session: WorkflowSpecialistSession } | undefined {
  const workflowId = specialistWorkflowId(deps, input);
  const bundle = specialistBundle(deps, input);
  return bundle && workflowId ? { bundle, session: specialistSession(deps, workflowId, role) } : undefined;
}

function providerFor(deps: ChatAgentDeps, input: ChatAgentInput, role: WorkflowSpecialistRole): ChatAgentInput["workflowOwnerProvider"] {
  return deps.state.options.workflowSpecialistProviders?.[role] ?? input.workflowOwnerProvider;
}

function neededRequest(input: ChatAgentInput, args: ToolArguments): ReturnType<typeof checkedRequest> | Refusal {
  const request = checkedRequest(input, args);
  if ("ok" in request) return request;
  return request.action === "launch" && specialistWithheld(input.workflowGoalSummary, request.role) ? refusal("SPECIALIST_NOT_NEEDED", `The request does not call for the ${request.role} specialist; build that part yourself.`) : request;
}

function prepareCall(deps: ChatAgentDeps, input: ChatAgentInput, args: ToolArguments, run: DispatchRun): PreparedCall | Refusal {
  const request = neededRequest(input, args);
  if ("ok" in request) return request;
  const snapshot = deps.planState.normalizedLatest();
  const target = launchTarget(snapshot, request, args);
  if (target && "ok" in target) return target;
  const provider = providerFor(deps, input, request.role);
  if (!snapshot || !canRunAgent(provider)) return refusal("SPECIALIST_UNAVAILABLE", `No tool-capable provider is available for the ${request.role} specialist.`);
  const active = activeSession(deps, input, request.role);
  if (!active) return refusal("SPECIALIST_UNAVAILABLE", "This workflow has no active specialist session.");
  return { deps, input, run, ...request, snapshot, provider, ...active, ...(target ? { target } : {}) };
}

function launchInstruction(call: PreparedCall): string {
  return call.target ? `${call.instruction}\n\nTarget composition: "${call.target.name}" (${call.target.id}). Draw for its size and build in it, whichever composition is open.` : call.instruction;
}

function launchCall(call: PreparedCall): Result {
  const { session, role, action } = call;
  if (session.pending) return refusal("SPECIALIST_BUSY", `The ${role} specialist is already running. Wait for it before sending a correction.`);
  if (action === "message" && session.turns === 0) return refusal("SPECIALIST_NOT_STARTED", `Launch the ${role} specialist before sending a follow-up.`);
  if (role === "visual-scene" && action === "launch") {
    if (call.target) session.target = call.target.id; else delete session.target;
  }
  startSpecialistTurn({ ...call, instruction: launchInstruction(call) });
  const next = role === "visual-scene" ? DESIGNER_STILL_DRAWING : "Keep working; wait or status blocks until it finishes, so call it once when you need the result.";
  return success(call.snapshot, { ...toolData(role, session), next });
}

function ownerRun(input: ChatAgentInput): string {
  return `${input.requestId}:${input.workflowCycle ?? 0}`;
}

function isRepeatPoll(notes: RequestNotes, call: PreparedCall): boolean {
  const last = notes.poll;
  return call.role === "visual-scene" && !!call.session.pending && last?.session === call.session && last.generation === call.session.generation && last.calls === notes.calls;
}

function pollData(call: PreparedCall, input: ChatAgentInput): SpecialistData {
  const { session, role } = call;
  const data = toolData(role, session);
  const pending = role === "visual-scene" && session.pending ? { ...data, next: DESIGNER_STILL_DRAWING } : data;
  if (session.pending || session.turns === 0) return pending;
  const returned = session.ownerSeenTurn === session.turns && session.ownerSeenRun === ownerRun(input);
  session.ownerSeenTurn = session.turns;
  session.ownerSeenRun = ownerRun(input);
  return returned && pending.handoff ? { ...pending, handoff: HANDOFF_ALREADY_RETURNED } : pending;
}

async function passiveCall(call: PreparedCall): Promise<Result> {
  const { deps, input, session } = call;
  const drawing = call.role === "visual-scene";
  const notes = notesOf(input);
  const repeat = isRepeatPoll(notes, call);
  if (drawing) notes.poll = { session, generation: session.generation, calls: notes.calls };
  if (!drawing || repeat) await awaitRunningSpecialist(deps, input, session);
  return success(call.snapshot, pollData(call, input));
}

/** Any owner tool call other than a designer poll: it makes the next poll a first poll again. */
export function noteOwnerToolCall(input: ChatAgentInput): void {
  notesOf(input).calls += 1;
}

/**
 * The owner's specialist tool. Launch and message start a turn and answer at once; status and wait read it, blocking until the turn ends except for the
 * designer's first poll. A finished handoff the owner already read in this conversation (one loop keeps its history; a later cycle starts a fresh one) is not
 * sent again. The expression specialist is answered by the sidecar itself.
 */
export async function consultSpecialistTool(deps: ChatAgentDeps, input: ChatAgentInput, args: ToolArguments, run: DispatchRun): Promise<Result> {
  if (args.role === "expression") return consultExpression(deps, input, args);
  const call = prepareCall(deps, input, args, run);
  if ("ok" in call) return call;
  if (call.role !== "visual-scene" || call.action === "launch" || call.action === "message") noteOwnerToolCall(input);
  return call.action === "launch" || call.action === "message" ? launchCall(call) : passiveCall(call);
}

/** Lets the landing time move toward the panel's own ceiling by the time spent waiting on design, never past it less the time a seal and its apply still need; undefined when the turn has no landing time. */
export function landingExtender(request: AgentRunInput): ((milliseconds: number) => void) | undefined {
  const original = request.landingAt;
  if (original === undefined) return undefined;
  const ceiling = original + Math.max(0, MAX_LANDING_EXTENSION_MS);
  return (milliseconds) => {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0 || request.landingAt === undefined) return;
    request.landingAt = Math.min(ceiling, request.landingAt + milliseconds);
  };
}
