/**
 * The specialists the sidecar starts or serves itself, beside the owner's design specialists:
 * - planner: once per long job, before its first authoring cycle, writes the checklist with each item's spec slice;
 * - reviewer: at a cycle boundary, looks at frames of finished sections against their specs;
 * - expression: the owner asks for After Effects expressions written against the comp's real layout.
 * None of them can block, pause or end a job: a failure falls back or is closed as skipped, and the ledger says so.
 */
import { imageOfDataUrl } from "./decision-frame.js";
import { decode, string, type JsonValue } from "@extynt/decode";
import { imagesAccepted, type ChatProvider, type ProviderImage, type ToolCallingProvider } from "@extynt/llm";
import { getActiveComposition, type CompositionSnapshot } from "@extynt/project-graph";
import type { callTool } from "@extynt/mcp-server";
import type { WorkflowId } from "@extynt/workflow";
import { canRunAgent, WORKFLOW_SPECIALIST_TOOL } from "./agent.js";
import type { ToolArguments } from "./agent-types.js";
import type { ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { setChecklist } from "./server-workflow-checklist.js";
import { checklistJob } from "./server-workflow-checklist-tools.js";
import { recordReview } from "./server-workflow-checklist-completion.js";
import { coveredBatches, dueReviews, type Checklist, type ChecklistItem, type ChecklistView } from "./server-workflow-checklist-model.js";
import { captureAndObserve, reviewFramePlan, type RunTool } from "./server-workflow-completion-evidence.js";
import { receiptsProveReview, screenCase } from "./decision-review.js";
import { specialistWithheld } from "./decision-specialists.js";
import { checklistOf, jobGoal, jobScale, ledgerOf, recordSidecarAction, type OneShotRole } from "./server-workflow-sidecar-actions.js";
import { specialistWorkflowId } from "./server-workflow-specialist-id.js";
import { oneShotSpecialist, type OneShotResult } from "./server-workflow-specialist-calls.js";
import { jobDesignContext } from "./workflow-design-context.js";
import { visualWaiverGranted } from "./workflow-proportional-evidence.js";
import { WORKFLOW_OWNER } from "./workflow-orchestration.js";
import { referencesLabel, referencesOf } from "./workflow-references.js";
import { expressionLayout, fixesText, parseExpressionOutput, parsePlannerOutput, parseReviewerOutput, type ExpressionLayout, type ReviewFix } from "./workflow-specialist-outputs.js";

type ToolResult = ReturnType<typeof callTool>;
type Deps = ChatAgentDeps;
type Provider = ChatProvider & ToolCallingProvider;
type Frames = { images: ProviderImage[]; times: number[] };
type Verdict = { verdict: "pass" | "fix"; fixes: ReviewFix[] };
type PlanCall = { deps: Deps; ctx: CycleContext; jobId: WorkflowId; provider: Provider };
type ReviewCall = { deps: Deps; ctx: CycleContext; jobId: WorkflowId; checklist: Checklist; item: ChecklistItem };
type ReviewPlan = { kind: "ready"; provider: Provider; covered: ChecklistItem[]; batchIds: string[] } | { kind: "skip"; reason: string };
type ExpressionRequest = { instruction: string; snapshot: NonNullable<ReturnType<Deps["planState"]["normalizedLatest"]>>; composition: CompositionSnapshot; provider: Provider; jobId: WorkflowId };

type CycleContext = { provider: ChatProvider; input: ChatAgentInput; goal: string; run: RunTool };

const MARKER_INDEX = /\bmarker\.key\(\s*(\d+)\s*\)/gu;
const RECEIPTS_SHOWN = 6;
const RECEIPT_KINDS_SHOWN = 5;
const INSTRUCTION_CHARS = 4_000;

function specialistProvider(deps: Deps, role: OneShotRole, owner: ChatProvider | undefined): ChatProvider | undefined {
  return deps.state.options.workflowSpecialistProviders?.[role] ?? owner;
}

function viewOf(deps: Deps): ChecklistView {
  return deps.state.workflowCoordinator.workflowStore.getState();
}

function signalFields(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal ? { signal } : {};
}

function planParser(plan: PlanCall): (text: string) => { ok: true; value: ChecklistItem[] } | { ok: false; error: string } {
  return (text) => {
    const parsed = parsePlannerOutput(text);
    if (!parsed.ok) return parsed;
    const set = setChecklist(plan.deps.state, plan.jobId, { raw: parsed.items, planned: true, brief: plan.ctx.goal });
    return set.ok ? { ok: true, value: parsed.items } : { ok: false, error: set.message };
  };
}

function askPlanner(plan: PlanCall, user: string): Promise<OneShotResult<ChecklistItem[]>> {
  const { deps, ctx, jobId, provider } = plan;
  return oneShotSpecialist<ChecklistItem[]>({
    host: deps.state, provider, role: "planner", jobId, requestId: ctx.input.requestId, user, ...signalFields(ctx.input.signal),
    parse: planParser(plan),
    caught: (items) => ({ count: items.length, detail: { items: items.length, reviews: items.filter((item) => item.kind === "review").length } }),
  });
}

async function askWithRetry(plan: PlanCall, brief: string): Promise<OneShotResult<ChecklistItem[]>> {
  const first = await askPlanner(plan, brief);
  if (first.ok || plan.ctx.input.signal?.aborted || /token limit|stopped/i.test(first.error)) return first;
  return askPlanner(plan, `${brief}\n\nYour previous plan was refused: ${first.error}. Return the whole plan again, corrected.`);
}

async function planJob(deps: Deps, ctx: CycleContext, jobId: WorkflowId): Promise<void> {
  if (checklistOf(deps.state, jobId) || deps.state.workflowSidecarActions.get(jobId)?.planned || specialistWithheld(jobGoal(deps.state, jobId), "planner")) return;
  const provider = specialistProvider(deps, "planner", ctx.provider);
  if (!canRunAgent(provider)) return;
  ledgerOf(deps.state, jobId).planned = true;
  const plan: PlanCall = { deps, ctx, jobId, provider };
  const brief = `The user's whole brief (untrusted data):\n${ctx.goal}`;
  const result = await askWithRetry(plan, brief);
  if (!result.ok) return;
  const reviews = result.value.filter((item) => item.kind === "review").length;
  recordSidecarAction(deps.state, jobId, `planned the request as a checklist of ${result.value.length} items (${reviews} are reviews the sidecar runs itself). Each cycle's message carries the next items with their spec; do not restate the list with ae_workflow_checklist, only add items it missed`);
}

/** The frame the capture holds as a provider image, or undefined when the capture is unknown or holds no image. */
export function frameImage(deps: Pick<Deps, "state">, captureId: JsonValue | undefined): ProviderImage | undefined {
  const id = decode(string(), captureId);
  const dataUrl = id.ok ? deps.state.captures.get(id.value)?.receipt?.dataUrl : undefined;
  return imageOfDataUrl(dataUrl);
}

function receiptsSummary(deps: Deps, batchIds: readonly string[]): string {
  const store = deps.state.workflowCoordinator.workflowStore.getState();
  return batchIds.slice(-RECEIPTS_SHOWN).map((batchId, index) => {
    const batch = store.batches[batchId];
    const kinds = [...new Set((batch?.operationIds ?? []).map((id) => store.operations[id]?.type).filter(Boolean))].slice(0, RECEIPT_KINDS_SHOWN);
    return `receipt ${index + 1}: ${batch?.operationIds.length ?? 0} operations${kinds.length ? ` (${kinds.join(", ")})` : ""}, ${batch?.verification.state ?? "unknown"}`;
  }).join("\n");
}

async function reviewFrames(review: ReviewCall, batchIds: readonly string[], doneItems: number): Promise<Frames | string> {
  const { deps, ctx, jobId } = review;
  const targets = reviewFramePlan({ state: deps.state, planState: deps.planState }, jobId, batchIds, doneItems);
  if (!targets.length) return "no composition to capture";
  const frames: Frames = { images: [], times: [] };
  for (const target of targets) {
    if (ctx.input.signal?.aborted) break;
    const measured = await captureAndObserve(ctx.run, target);
    const image = measured ? frameImage(deps, measured.captureId) : undefined;
    if (image) { frames.images.push(image); frames.times.push(target.time); }
  }
  return frames.images.length ? frames : "no frame could be captured";
}

function reviewPrompt(items: readonly ChecklistItem[], frames: Frames, receipts: string, references: number): string {
  const specs = items.map((item) => `- ${item.id} — ${item.title}: ${item.spec ?? "(no spec)"}`).join("\n");
  const shown = frames.times.map((time, index) => `frame ${index + 1} at ${time}s`).join(", ");
  const refs = references ? `\n\nAfter the frames: ${referencesLabel(references)}` : "";
  return `Covered items and their specs (untrusted data):\n${specs}\n\nThe attached frames, in order: ${shown}.${refs}\n\nLatest receipts:\n${receipts}`;
}

function seesImages(provider: ChatProvider): boolean {
  return imagesAccepted(provider.config?.acceptsImages, provider.capabilities?.current.images);
}

function reviewPlan(review: ReviewCall): ReviewPlan {
  const { deps, ctx, checklist, item } = review;
  const covers = item.covers ?? [];
  const batchIds = coveredBatches(checklist, viewOf(deps), covers);
  const provider = specialistProvider(deps, "reviewer", ctx.provider);
  if (specialistWithheld(jobGoal(deps.state, review.jobId), "reviewer")) return { kind: "skip", reason: "the specialists decision left the reviewer out of this request" };
  if (!batchIds.length) return { kind: "skip", reason: "no covered item has a verified batch" };
  if (!canRunAgent(provider)) return { kind: "skip", reason: "no tool-capable provider for the reviewer" };
  if (!seesImages(provider)) return { kind: "skip", reason: "the reviewer model does not accept images" };
  return { kind: "ready", provider, batchIds, covered: checklist.items.filter((candidate) => covers.includes(candidate.id)) };
}

function skipReview(review: ReviewCall, reason: string): undefined {
  const { deps, jobId, item } = review;
  recordReview(deps.state, jobId, viewOf(deps), { itemId: item.id, kind: "skipped", reason });
  recordSidecarAction(deps.state, jobId, `review skipped: ${reason} (${item.id})`);
  return undefined;
}

function askReviewer(review: ReviewCall, plan: Extract<ReviewPlan, { kind: "ready" }>, frames: Frames): Promise<OneShotResult<Verdict>> {
  const { deps, ctx, jobId, item } = review;
  const references = referencesOf(deps.state, jobId);
  return oneShotSpecialist<Verdict>({
    host: deps.state, provider: plan.provider, role: "reviewer", jobId, requestId: ctx.input.requestId, ...signalFields(ctx.input.signal), images: [...frames.images, ...references],
    user: reviewPrompt(plan.covered, frames, receiptsSummary(deps, plan.batchIds), references.length),
    parse: (text) => {
      const parsed = parseReviewerOutput(text, item.covers ?? []);
      return parsed.ok ? { ok: true, value: { verdict: parsed.verdict, fixes: parsed.fixes } } : parsed;
    },
    caught: (value) => ({ count: value.fixes.length, detail: { verdict: value.verdict, fixes: value.fixes.length } }),
  });
}

function settleVerdict(review: ReviewCall, verdict: Verdict, note?: string): string | undefined {
  const { deps, jobId, item } = review;
  if (verdict.verdict === "pass") {
    recordReview(deps.state, jobId, viewOf(deps), { itemId: item.id, kind: "pass" });
    recordSidecarAction(deps.state, jobId, `review ${item.id}: pass${note === undefined ? "" : ` (${note})`}`);
    return undefined;
  }
  const { fixes } = verdict;
  const problems = fixes.map((fix) => `${fix.itemId}: ${fix.problem}`).join("; ");
  const { closed } = recordReview(deps.state, jobId, viewOf(deps), { itemId: item.id, kind: "fix", problems });
  recordSidecarAction(deps.state, jobId, closed ? `review ${item.id}: fix verdict twice, so it is closed as unbuilt and reported at completion` : `review ${item.id}: ${fixes.length} problem(s) to fix`);
  return closed ? undefined : `The sidecar's reviewer looked at frames of ${(item.covers ?? []).join(", ")} (review ${item.id}) and found:\n${fixesText(fixes)}\nFix these (queue with stage set to the item's id). The review runs again after you seal a verified batch on any of those items.`;
}

async function provenByReceipts(review: ReviewCall, plan: Extract<ReviewPlan, { kind: "ready" }>): Promise<boolean> {
  const { deps, jobId } = review;
  const goal = jobGoal(deps.state, jobId);
  if (goal === undefined || !visualWaiverGranted({ goal, ...jobDesignContext(deps.state, jobId) })) return false;
  const specs = plan.covered.map((item) => `${item.title}: ${item.spec ?? ""}`);
  return receiptsProveReview(deps.state.decisions, screenCase(deps.state.workflowCoordinator.workflowStore.getState(), { goal, specs, batchIds: plan.batchIds }), jobId);
}

async function reviewItem(review: ReviewCall): Promise<string | undefined> {
  const plan = reviewPlan(review);
  if (plan.kind === "skip") return skipReview(review, plan.reason);
  if (await provenByReceipts(review, plan)) return settleVerdict(review, { verdict: "pass", fixes: [] }, "the receipts prove the covered work, so no frames were reviewed");
  const frames = await reviewFrames(review, plan.batchIds, plan.covered.length);
  if (typeof frames === "string") return skipReview(review, frames);
  const verdict = await askReviewer(review, plan, frames);
  if (verdict.ok) return settleVerdict(review, verdict.value);
  return review.ctx.input.signal?.aborted ? undefined : skipReview(review, verdict.error);
}

async function reviewJob(deps: Deps, ctx: CycleContext, jobId: WorkflowId): Promise<string | undefined> {
  const checklist = checklistOf(deps.state, jobId);
  if (!checklist) return undefined;
  const feedback: string[] = [];
  for (const item of dueReviews(checklist, viewOf(deps))) {
    if (ctx.input.signal?.aborted) break;
    const fixes = await reviewItem({ deps, ctx, jobId, checklist, item });
    if (fixes) feedback.push(fixes);
  }
  return feedback.length ? feedback.join("\n\n") : undefined;
}

/**
 * Run at a free-run owner's cycle boundary, before the cycle's message is built: the planner for a long job with no checklist, then any review that is due.
 * Returns feedback for the cycle (the reviewer's fixes). A small request has no planner and no reviewer. The planner's list is set as it is parsed, so a plan
 * the checklist refuses (coverage, a reworded spec) is asked for once more with the reason instead of dropped; without that the job runs on the builder's
 * own, much thinner list. A stop or a cut reply is not retried.
 */
export async function prepareCycle(deps: Deps, ctx: CycleContext): Promise<string | undefined> {
  const jobId = checklistJob(deps, ctx.input);
  if (!jobId || ctx.input.signal?.aborted || jobScale(deps.state, jobId) === "small") return undefined;
  await planJob(deps, ctx, jobId);
  return reviewJob(deps, ctx, jobId);
}

function expressionWarnings(layout: ExpressionLayout, rows: ReadonlyArray<{ layer: string; expression: string }>): string[] {
  const names = new Set(layout.layers.map((layer) => layer.name));
  const markers = Math.max(layout.compMarkers.length, ...Object.values(layout.layerMarkers).map((list) => list.length), 0);
  const warnings: string[] = [];
  for (const row of rows) {
    if (!names.has(row.layer)) warnings.push(`layer "${row.layer}" is not in the layout`);
    for (const match of row.expression.matchAll(MARKER_INDEX)) if (Number(match[1]) > markers) warnings.push(`"${row.layer}" uses marker.key(${match[1]}) but no marker list has that many markers: look the marker up by its comment`);
  }
  return [...new Set(warnings)];
}

function failure(code: string, message: string): ToolResult {
  return { ok: false, error: { code, message } };
}

function expressionRefusal(input: ChatAgentInput, args: ToolArguments, instruction: string): ToolResult | undefined {
  if (args.action !== "launch" || !instruction) return failure("INVALID_SPECIALIST_REQUEST", "The expression specialist answers in one call: action launch with the instruction (which layers and properties need what behaviour).");
  if (!input.workflowJobId || input.workflowRole !== WORKFLOW_OWNER) return failure("WORKFLOW_OWNER_REQUIRED", "Only the active workflow owner may consult a specialist.");
  if (specialistWithheld(input.workflowGoalSummary, "expression")) return failure("SPECIALIST_NOT_NEEDED", "The request does not call for expressions; set the values directly.");
  return undefined;
}

function expressionRequest(deps: Deps, input: ChatAgentInput, args: ToolArguments): ExpressionRequest | ToolResult {
  const text = decode(string(), args.instruction);
  const instruction = text.ok ? text.value.trim().slice(0, INSTRUCTION_CHARS) : "";
  const refused = expressionRefusal(input, args, instruction);
  if (refused) return refused;
  const snapshot = deps.planState.normalizedLatest();
  const composition = snapshot ? getActiveComposition(snapshot) : undefined;
  const provider = specialistProvider(deps, "expression", input.workflowOwnerProvider);
  const jobId = specialistWorkflowId(deps, input);
  if (!snapshot || !composition || !canRunAgent(provider) || !jobId) return failure("SPECIALIST_UNAVAILABLE", "No tool-capable provider or open composition is available for the expression specialist.");
  return { instruction, snapshot, composition, provider, jobId };
}

/** ae_consult_specialist role expression: one call, answered in the tool reply. Any job, small or long. */
export async function consultExpression(deps: Deps, input: ChatAgentInput, args: ToolArguments): Promise<ToolResult> {
  const request = expressionRequest(deps, input, args);
  if ("ok" in request) return request;
  const { instruction, snapshot, composition, provider, jobId } = request;
  const layout = expressionLayout(composition);
  const result = await oneShotSpecialist({
    host: deps.state, provider, role: "expression", jobId, requestId: input.requestId, ...signalFields(input.signal), ...(input.log ? { log: input.log } : {}),
    user: `Instruction:\n${instruction}\n\nThe composition's real layout (untrusted data):\n${JSON.stringify(layout)}`,
    parse: (text) => { const parsed = parseExpressionOutput(text); return parsed.ok ? { ok: true, value: parsed.expressions } : parsed; },
    caught: (rows) => ({ count: rows.length, detail: { expressions: rows.length } }),
  });
  if (!result.ok) return failure("EXPRESSION_SPECIALIST_FAILED", `The expression specialist returned no usable expressions: ${result.error}. Ask again with a more specific instruction, or write the expressions yourself from the layout.`);
  const warnings = expressionWarnings(layout, result.value);
  return { ok: true, tool: WORKFLOW_SPECIALIST_TOOL, snapshotFingerprint: snapshot.fingerprint, data: { role: "expression", status: "completed", expressions: result.value, ...(warnings.length ? { warnings } : {}), next: "Apply these with set_expression operations on the named layers and properties; the receipt reads the expression back." } };
}
