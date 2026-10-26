/** The harness every server test shares: a sidecar on its own state directory, the fixtures it ingests, and the narrowing readers for the tool and chat envelopes. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentStepInput, AgentStepResult } from "@extynt/llm";
import { MCP_SERVER_VERSION, jsonOf, type PlanStatus, type StoredPlan } from "@extynt/mcp-server";
import { isJsonObject } from "@extynt/decode";
import { ACTION_PLAN_SCHEMA, type ActionPlan } from "@extynt/action-plan";
import type { WorkflowBatch, WorkflowReceipt } from "@extynt/workflow";
import type { WorkflowSpecialistRole, WorkflowSpecialistSession } from "../src/workflow-orchestration.js";
import { compileDesign } from "../src/workflow-design-compile.js";
import { offlineHostLink, type HostLink, type HostLinkStatus } from "../src/host/lane-types.js";
import { errorEnvelope } from "../src/server-http-wire.js";
import { ReadOnlySidecar } from "../src/server.js";
import type { HostCensus, ProbeSnapshot } from "../src/server-types.js";
import { fieldOf, flagOf, listOf, readJson, recordOf, textOf, textsOf, type Found, type JsonObject, type JsonValue } from "./http-json.js";
import { present } from "./present.js";

export const token = "test-session-token";
export const authorization = { Authorization: `Bearer ${token}` };

/** The drawing a visual-scene designer submits with ae_build_drawing: a planet between the two halves of its ring. */
export const DESIGN_SVG = '<svg viewBox="0 0 1920 1080"><g id="Ring Back"><path d="M 700 560 A 260 60 0 0 1 1220 560" fill="none" stroke="#e8c170" stroke-width="12"/></g><g id="Planet"><circle cx="960" cy="560" r="150" fill="#3355cc"/></g><g id="Ring Front"><path d="M 700 560 A 260 60 0 0 0 1220 560" fill="none" stroke="#e8c170" stroke-width="12"/></g></svg>';
/** One step of a scripted visual-scene designer: it builds `svg` with ae_build_drawing, then reports in plain words. */
export function designerTurn(input: AgentStepInput, svg = DESIGN_SVG, report = "Built Ring Back, Planet and Ring Front in the open composition. No departures from the brief."): AgentStepResult {
  const built = input.messages.some((message) => message.role === "tool" && message.name === "ae_build_drawing");
  return built ? { text: report, toolCalls: [] } : { text: "", toolCalls: [{ id: "build", name: "ae_build_drawing", arguments: { svg } }] };
}

/** A scripted designer that reports without building anything: enough for the gates that only need a scene design to exist. */
export const DESIGNER_REPORT = "Drew the scene; nothing was built in this test.";

/** A job whose designer compiled a drawing but built nothing (its build was refused, say): the owner's ae_queue_design builds it. */
export function seedDesign(sidecar: ReadOnlySidecar, jobSeed: string, svg = DESIGN_SVG): void {
  const snapshot = sidecar.normalizedLatest();
  const compiled = snapshot ? compileDesign(svg, snapshot, () => new Date()) : undefined;
  if (!compiled?.ok) throw new Error("seedDesign: the drawing did not compile");
  const jobId = sidecar.workflowCoordinator.jobIdForSeed(jobSeed);
  const sessions = sidecar.workflowSpecialistSessions.get(jobId) ?? new Map<WorkflowSpecialistRole, WorkflowSpecialistSession>();
  sessions.set("visual-scene", { role: "visual-scene", turns: 1, messages: [], design: compiled.design });
  sidecar.workflowSpecialistSessions.set(jobId, sessions);
}

const stateDirectories: string[] = [];
process.on("exit", () => { for (const directory of stateDirectories) { try { rmSync(directory, { recursive: true, force: true }); } catch { continue; } } });

type SidecarOptions = ConstructorParameters<typeof ReadOnlySidecar>[0];

/** A sidecar over a throwaway state directory, talking to a real plugin (a fake-plugin) through the `native.json` at `discoveryPath`. */
export function sidecarForPlugin(options: SidecarOptions): ReadOnlySidecar {
  const stateDirectory = mkdtempSync(join(tmpdir(), "ae-sidecar-"));
  stateDirectories.push(stateDirectory);
  return new ReadOnlySidecar({ stateDirectory, discoveryPath: join(stateDirectory, "native.json"), ...options });
}

/** A sidecar that reads After Effects as connected with no plugin behind it, so its writes are admitted; the test plays the host and drains the mailbox with `claimOver`. */
export function sidecarFor(options: SidecarOptions): ReadOnlySidecar {
  const sidecar = sidecarForPlugin(options);
  sidecar.hostLink = onlineHostLink();
  return sidecar;
}

/** The plugin link as the sidecar sees it with After Effects open and no plugin behind it: a test that plays the host claims and settles items itself. */
export function onlineHostLink(): HostLink {
  const status: HostLinkStatus = { ...offlineHostLink(0).status(), state: "online", instanceId: "test-host", pluginVersion: "0.0.0", aeVersion: "26.2.1" };
  return { status: () => ({ ...status }) };
}

/** One claim as the host lane makes it, answered as `{ status, body }`: the item, null when nothing waits, or the refusal. */
export function claimOver(sidecar: ReadOnlySidecar): { status: number; body: JsonObject } {
  const outcome = sidecar.claimHostItem();
  if (outcome.kind === "item") return { status: 200, body: { ok: true, item: outcome.data } };
  if (outcome.kind === "empty") return { status: 200, body: { ok: true, item: null } };
  return { status: outcome.kind === "blocked" ? 409 : 422, body: errorEnvelope(outcome.code, outcome.message) };
}

/** `claimOver` as the Response the old claim route sent, for callers that read it with `readJson`. */
export function claimResponse(sidecar: ReadOnlySidecar): Response {
  const { status, body } = claimOver(sidecar);
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Settles a receipt the way the host lane does, in process, answered as the Response the old receipt route sent. */
export async function receiptResponse<T>(sidecar: ReadOnlySidecar, receipt: T, hostInstanceId?: string): Promise<Response> {
  const { status, body } = await sidecar.receivers.acceptReceipt(jsonOf(receipt), hostInstanceId);
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Approves the way a user clicking Apply does; the dedicated refusal test opts out. */
export const withVerificationAck = (name: string, args: JsonObject) =>
  name === "ae_approve_plan" && args.acknowledgeUnverified === undefined ? { ...args, acknowledgeUnverified: true } : args;

export const validSnapshot: ProbeSnapshot = {
  schemaVersion: "0.1",
  ok: true,
  requestId: "probe-1",
  result: {
    runtime: {
      application: "After Effects",
      appVersion: "26.2.1",
      buildNumber: "2",
      buildName: "After Effects 26.2.1 (Build 2)",
      platform: "macOS",
      architecture: "arm64",
      compatible: true,
    },
    project: { name: "Fixture", filePath: null },
    activeCompositionId: "comp-1",
    selectedLayerIds: ["layer-1"],
    compositions: [],
  },
  warnings: [],
};

export const hostCensus = (count = 400): HostCensus => ({
  schemaVersion: "0.1",
  ok: true,
  requestId: "census-1",
  result: {
    runtime: validSnapshot.result.runtime,
    installedEffects: Array.from({ length: count }, (_, index) => ({ matchName: `ADBE Census ${index}`, displayName: `Census ${index}`, available: true })),
    totalReported: count,
    returnedCount: count,
    completeness: "complete",
  },
  warnings: [],
});

/** The fonts half of a split census, as the host answers `parts: ["fonts"]`: the list, or none when `known` is the key it already holds. */
export const fontCensus = (names: readonly string[] = ["Arial-Black", "Georgia-Bold"], known?: string) => {
  const key = `ff1|${names.length}|${names.length}|${names.join(",").length.toString(16)}`, unchanged = known === key;
  return {
    schemaVersion: "0.1", ok: true, requestId: "census-fonts",
    result: {
      runtime: validSnapshot.result.runtime, part: "fonts",
      installedFonts: unchanged ? [] : names.map((name) => ({ family: name.split("-")[0], style: name.split("-")[1] ?? "Regular", postScriptName: name })),
      fontTotalReported: names.length, fontFamiliesReported: names.length, fontCompleteness: "complete", fontFingerprint: key, fontsUnchanged: unchanged,
    },
    warnings: [],
  };
};

/** What `aeHostCensus` answers for `args`: the effects half for `parts: ["effects"]`, the fonts half for `["fonts"]`, and the whole census for a request that names no part. */
export function censusAnswer(args: JsonObject, count = 3, names?: readonly string[]): JsonValue {
  const parts = Array.isArray(args.parts) ? args.parts : [];
  if (parts.length === 1 && parts[0] === "fonts") return jsonOf(fontCensus(names, typeof args.fontFingerprint === "string" ? args.fontFingerprint : undefined));
  return jsonOf(parts.length === 1 ? { ...hostCensus(count), result: { ...hostCensus(count).result, part: "effects" } } : hostCensus(count));
}

export const mutableSnapshot = (requestId: string, selectedLayerIds = ["layer-1"], name = "Original") => ({
  ...validSnapshot,
  requestId,
  result: {
    ...validSnapshot.result,
    revision: "project-revision-1",
    selectedLayerIds,
    compositions: [{
      id: "comp-1", name: "Main", width: 1920, height: 1080, duration: 10, frameRate: 24, layers: [{
        id: "layer-1", index: 1, name, selected: selectedLayerIds.includes("layer-1"), parentId: null, type: "text", propertyPaths: [{
          path: "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001", matchName: "ADBE Gaussian Blur 2-0001", displayName: "Blurriness", kind: "property", valueType: "number", value: 4, canSetValue: true,
        }, { path: "ADBE Transform Group/ADBE Position", matchName: "ADBE Position", displayName: "Position", kind: "property", valueType: "vector", value: [960, 540], canSetValue: true }],
      }],
    }],
  },
});

/** What the panel's pulse reports when After Effects shows exactly what `mutableSnapshot` describes; post it where a test advances the clock and an agent then plans or approves, or the sidecar rightly re-reads first. */
export const matchingFocus = (over: JsonObject = {}) => ({ schemaVersion: "0.1", projectPath: null, projectName: "Fixture", epoch: null, revision: 7, activeCompositionId: "comp-1", activeCompositionName: "Main", selected: ["layer-1"], selectedLayers: [{ id: "layer-1", index: 1, name: "Original" }], ...over });

export const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type ScriptStep = { text: string; toolCalls: Array<{ id: string; name: string; arguments: JsonObject }> };
type ScriptInput = { messages: Array<{ role: string; name?: string }>; tools?: Array<{ name: string }>; system?: string };

export const queueRename = (id: string, name: string) => ({ text: "", toolCalls: [{ id: `${id}-add`, name: "ae_queue_add", arguments: { summary: `Rename to ${name}`, operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name }] } }] });
export const queueFinishStep = (id: string) => ({ text: "", toolCalls: [{ id: `${id}-finish`, name: "ae_queue_finish", arguments: {} }] });
export const workflowStageStep = (id: string, summary = "Rename the selected layer", operationTypes = ["set_layer_name"]) => ({ text: "", toolCalls: [{ id: `${id}-stage`, name: "ae_select_workflow_stage", arguments: { summary, operationTypes } }] });

/** add -> finish -> answer: one queue is one plan, and only the seal carries a card; a continuation cycle renames again to a new name, because the same name would change nothing and the plan would not be sealed. */
export const queueScript = (id: string, name: string) => (input: ScriptInput) => {
  const target = /"cycle"\s*:\s*[1-9]/.test(input.system ?? "") ? `${name} 2` : name;
  const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
  if (input.tools?.some((tool) => tool.name === "ae_select_workflow_stage") && !called.includes("ae_select_workflow_stage")) return workflowStageStep(id);
  if (!called.includes("ae_queue_add")) return queueRename(id, target);
  if (!called.includes("ae_queue_finish")) return queueFinishStep(id);
  return { text: `Renamed Original to ${target}.`, toolCalls: [] };
};

/** Several plans in one turn: each add/finish round is one plan, the answer lands last. */
export const queuePlans = (plans: Array<{ id: string; step: ScriptStep }>, answer: string) => (input: ScriptInput) => {
  const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
  const written = called.filter((name) => name === "ae_queue_finish").length;
  if (called.filter((name) => name === "ae_queue_add").length === written) return plans[written]?.step ?? { text: answer, toolCalls: [] };
  return queueFinishStep(present(plans[written]).id);
};

export interface ChatPlanCard { planId: string; title: string; operations: string[]; expressions?: Array<{ propertyPath: string; source: string }>; autoApply?: boolean }
export interface ChatTurnResult {
  ok: boolean; mode: string; outcome: string; answer: string; notes: string[];
  plans: ChatPlanCard[]; tools: Array<{ name: string; ok: boolean; code?: string }>;
  fallback?: { from: string; reason: string }; model: string; usage?: { cachedInputTokens: number }; approval?: { kind: string };
}

function chatPlan(value: Found): ChatPlanCard {
  const card: ChatPlanCard = { planId: textOf(value, "planId"), title: textOf(value, "title"), operations: textsOf(value, "operations") };
  const autoApply = fieldOf(value, "autoApply");
  if (typeof autoApply === "boolean") card.autoApply = autoApply;
  const expressions = fieldOf(value, "expressions");
  if (Array.isArray(expressions)) card.expressions = expressions.map((entry) => ({ propertyPath: textOf(entry, "propertyPath"), source: textOf(entry, "source") }));
  return card;
}

function chatTool(value: Found): ChatTurnResult["tools"][number] {
  const code = fieldOf(value, "code");
  return { name: textOf(value, "name"), ok: flagOf(value, "ok"), ...(typeof code === "string" ? { code } : {}) };
}

export function chatTurnResult(value: Found): ChatTurnResult {
  const result: ChatTurnResult = {
    ok: flagOf(value, "ok"),
    mode: textOf(value, "mode"),
    outcome: textOf(value, "outcome"),
    answer: textOf(value, "answer"),
    notes: textsOf(value, "notes"),
    plans: listOf(value, "plans").map(chatPlan),
    tools: listOf(value, "tools").map(chatTool),
    model: textOf(value, "model"),
  };
  const fallback = fieldOf(value, "fallback");
  if (fallback !== null && fallback !== undefined) result.fallback = { from: textOf(fallback, "from"), reason: textOf(fallback, "reason") };
  const usage = fieldOf(value, "usage");
  const cachedInputTokens = usage === null || usage === undefined ? undefined : fieldOf(usage, "cachedInputTokens");
  if (typeof cachedInputTokens === "number") result.usage = { cachedInputTokens };
  const approval = fieldOf(value, "approval");
  if (approval !== null && approval !== undefined) result.approval = { kind: textOf(approval, "kind") };
  return result;
}

let chatSequence = 0;

/** `autoApply` is the panel's toggle as the chat request carries it; omitted, the request carries none, which the sidecar reads as off. */
export async function chatTurn(address: { host: string; port: number }, message: string, history: JsonValue[] = [], options: { autoApply?: boolean; images?: JsonValue; sessionId?: string } = {}): Promise<ChatTurnResult> {
  const response = await fetch(`http://${address.host}:${address.port}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId: `chat-${Date.now()}-${chatSequence++}`, message, ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }), history, ...(options.autoApply === undefined ? {} : { autoApply: options.autoApply }), ...(options.images === undefined ? {} : { images: options.images }) }) });
  return chatTurnResult(await readJson(response));
}

export interface ToolCallEnvelope { ok: boolean; error?: { code?: string; message?: string }; warning?: string; snapshotFingerprint?: string; data: JsonObject }
export interface MailboxClaim { item: JsonObject | null; heartbeat?: boolean }

function toolError(value: Found): ToolCallEnvelope["error"] | undefined {
  const code = fieldOf(value, "error.code");
  const message = fieldOf(value, "error.message");
  if (typeof code !== "string" && typeof message !== "string") return undefined;
  return { ...(typeof code === "string" ? { code } : {}), ...(typeof message === "string" ? { message } : {}) };
}

export function toolResult(value: Found): ToolCallEnvelope {
  const ok = fieldOf(value, "ok");
  if (typeof ok !== "boolean") throw new Error("a tool result carries a boolean ok");
  const error = toolError(value);
  const warning = fieldOf(value, "warning");
  const fingerprint = fieldOf(value, "snapshotFingerprint");
  const data = fieldOf(value, "data");
  return {
    ok,
    ...(error === undefined ? {} : { error }),
    ...(typeof warning === "string" ? { warning } : {}),
    ...(typeof fingerprint === "string" ? { snapshotFingerprint: fingerprint } : {}),
    data: data === undefined || data === null ? {} : recordOf(value, "data"),
  };
}

export function mailboxClaim(value: Found): MailboxClaim {
  const item = fieldOf(value, "item");
  const heartbeat = fieldOf(value, "heartbeat");
  return { item: item === null || item === undefined ? null : recordOf(value, "item"), ...(typeof heartbeat === "boolean" ? { heartbeat } : {}) };
}

export interface QueueHarness {
  base: string;
  post: <T>(path: string, body: T) => Promise<Response>;
  agent: (name: string, args?: JsonObject, headers?: Record<string, string>) => Promise<{ status: number; body: ToolCallEnvelope }>;
  claim: (query?: string) => Promise<MailboxClaim>;
  clock: { ms: number };
  stateDirectory: string;
  sidecar: ReadOnlySidecar;
}

export function queueHarness(t: { after: (fn: () => void | Promise<void>) => void }, clock = { ms: Date.parse("2026-09-14T12:00:00.000Z") }): Promise<QueueHarness> {
  const stateDirectory = mkdtempSync(join(tmpdir(), "ae-queue-"));
  const sidecar = sidecarFor({ port: 0, token, panelSessionId: "panel-queue", stateDirectory, now: () => new Date(clock.ms) });
  return (async () => {
    const address = await sidecar.start();
    t.after(() => sidecar.stop());
    const base = `http://${address.host}:${address.port}`;
    const approvalIds = new Map<string, string>();
    const rememberApproval = (value: Found): void => {
      const planId = fieldOf(value, "planId");
      const approvalId = fieldOf(value, "approval.token");
      if (typeof planId === "string" && typeof approvalId === "string") approvalIds.set(planId, approvalId);
    };
    const receiptBody = (path: string, body: JsonValue): JsonValue => {
      if (path !== "/v1/receipts" || !isJsonObject(body)) return body;
      const planId = fieldOf(body, "planId"), supplied = fieldOf(body, "approvalId");
      const approvalId = typeof planId === "string" ? approvalIds.get(planId) : undefined;
      return supplied === undefined && approvalId ? { ...body, approvalId } : body;
    };
    const post = <T>(path: string, body: T): Promise<Response> => path === "/v1/receipts" ? receiptResponse(sidecar, receiptBody(path, jsonOf(body))) : fetch(`${base}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(receiptBody(path, jsonOf(body))) });
    const agent = async (name: string, args: JsonObject = {}, headers: Record<string, string> = { "X-AE-Client-Version": MCP_SERVER_VERSION }) => {
      const response = await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "agent", ...headers }, body: JSON.stringify({ name, arguments: { waitSeconds: 0, ...withVerificationAck(name, args) } }) });
      const body = toolResult(await readJson(response));
      rememberApproval(body.data);
      return { status: response.status, body };
    };
    const claim = async () => { const claimed = mailboxClaim(claimOver(sidecar).body); rememberApproval(claimed.item); return claimed; };
    return { base, post, agent, claim, clock, stateDirectory, sidecar };
  })();
}

/** The designer's first status or wait returns at once and a back-to-back repeat blocks until it finishes; this polls until it is no longer running. */
export async function settledDesigner(sidecar: ReadOnlySidecar, input: Parameters<ReadOnlySidecar["runAgentTool"]>[2], action: "wait" | "status" = "wait"): ReturnType<ReadOnlySidecar["runAgentTool"]> {
  for (let attempt = 0; ; attempt += 1) {
    const result = await sidecar.runAgentTool("ae_consult_specialist", { action, role: "visual-scene" }, input, {});
    if (!result.ok || fieldOf(result.data, "status") !== "running" || attempt > 2_000) return result;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
}

/** A workflow batch in the given lifecycle whose receipt applied and verified, binding the created ids named; the rest is the empty record of a batch that just ran. */
export function batchFixture(lifecycle: WorkflowBatch["lifecycle"], createdBindings: Array<{ placeholder: string; createdId: string }> = [], jobId = "job-1"): WorkflowBatch {
  const receipt: WorkflowReceipt = { receiptId: "r", receivedAt: "", execution: "executed", mutation: "applied", mayHaveMutated: true, verification: "verified", outcomes: [], createdBindings: createdBindings.map((binding, index) => ({ ...binding, operationId: `op-${index}`, readbackField: "id", observedFingerprint: "snap-1" })) };
  return {
    batchId: "b", jobId, stageId: "s", lifecycle, summary: "", dependencies: [], operationIds: [], admission: null, approval: null, cancelRequested: false, createdAt: "", updatedAt: "",
    execution: { state: "executed", mutation: "applied", mayHaveMutated: true, receiptId: "r", receivedAt: "", receipt, receiptHistory: [receipt] },
    verification: { state: "verified", basis: null, observedFingerprint: null },
    recovery: { state: "none", dispatch: "idle", mayHaveMutated: false, undoReceiptId: null, lineage: null, receipt: null, verification: null },
  };
}

/** A stored plan with the fields the sidecar requires and nothing else: tests that only care about its status, receipt or operations build it here. */
export function storedPlanFixture(planId: string, status: PlanStatus, extra: Partial<StoredPlan> = {}, operations: ActionPlan["operations"] = []): StoredPlan {
  const plan: ActionPlan = { schemaVersion: ACTION_PLAN_SCHEMA, planId, snapshotFingerprint: "snap-1", summary: "", operations, requiresApproval: true };
  return { plan, status, createdAt: "", updatedAt: "", ...extra };
}
