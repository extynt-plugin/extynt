// The graph tools shared by the external MCP surface and the in-panel agent: bounded native page demands, cache queries, relational queries and effect notes.
export { runPanelParameterTool } from "./relational-routing.js";
import { decode, decodeOrThrow, map, presentFields, decodeOrCode, fallback, jsonValue, number, object, string, type Decoder, type JsonValue, type Infer, type JsonObject } from "@extynt/decode";
import type { callTool } from "@extynt/mcp-server";
import { collectionLaneBusy } from "./collection-lane-busy.js";
import { recovery } from "./collection-recovery.js";
import { EFFECT_NOTES_TOOLS, runEffectNotesTool } from "./effect-notes-tools.js";
import { enqueueHostWork } from "./host/work-queue.js";
import { hostNotConnected } from "./offline-note.js";
import { RELATIONAL_QUERY_TOOLS, runRelationalTool, type RelationalToolDeps } from "./relational-tools.js";
import { MAX_AGENT_MAILBOX_ITEMS } from "./server-limits.js";
import type { SidecarState } from "./server-state.js";
import { wireObject } from "./wire-object.js";

type ToolResult = ReturnType<typeof callTool>;

const DEFAULT_WAIT_SECONDS = 20;
const MAX_WAIT_SECONDS = 20;
const MAX_DEMAND_ID = 128;
const NO_ARGUMENTS: JsonObject = {};
const toolArguments = object({
  waitSeconds: fallback(number(), undefined), demandId: fallback(string(), undefined), jobId: fallback(string(), undefined),
  target: fallback(jsonValue, undefined), startCursor: fallback(jsonValue, undefined), limit: fallback(jsonValue, undefined),
});
const demandFacts = object({
  state: fallback(string(), undefined), freshness: fallback(string(), undefined),
  error: fallback(object({ code: fallback(string(), undefined) }), undefined),
});

/** The sidecar state the graph tools read and the transport that wakes their waiters. */
export interface CollectionToolDeps {
  state: Pick<SidecarState, "collection" | "activePanelInstanceId" | "agentMailbox" | "panel" | "inFlight" | "hostLink" | "options">;
  transport: { notifyChange(): void; waitUntil(test: () => boolean, seconds: number): Promise<boolean> };
}

/** Whether a tool name belongs to this module's tools. */
export function isCollectionTool(name: string): boolean {
  return ["ae_read_graph_page", "ae_get_graph_page", "ae_query_graph_cache"].includes(name) || RELATIONAL_QUERY_TOOLS.has(name) || EFFECT_NOTES_TOOLS.has(name);
}

function toolArgumentsOf(args: JsonValue): Infer<typeof toolArguments> {
  return decodeOrCode(toolArguments, args, "INVALID_TOOL_ARGUMENTS");
}

function demandData(result: JsonObject, unresolved: boolean): JsonObject {
  const facts = decodeOrCode(demandFacts, result, "COLLECTION_FAILED");
  const code = facts.state === "pending" ? "DEMAND_PENDING" : facts.freshness === "stale" ? "STALE_EVIDENCE" : facts.error?.code;
  return code ? { ...result, recovery: { ...recovery(code, unresolved) }, writeAuthorizing: false } : result;
}

function requireActiveDemand(signal?: AbortSignal): void {
  if (signal?.aborted) throw Error("DEMAND_CANCELLED");
}

function beginCollectionDemand(state: CollectionToolDeps["state"], args: JsonValue): JsonObject {
  const wanted = toolArgumentsOf(args);
  if (hostNotConnected(state)) throw Error("HOST_OFFLINE");
  if (!state.activePanelInstanceId) throw Error("PANEL_NOT_PAIRED");
  if (state.agentMailbox.length >= MAX_AGENT_MAILBOX_ITEMS) throw Error("MAILBOX_FULL");
  const request = presentFields({ begin: wanted.jobId === undefined, jobId: wanted.jobId, target: wanted.target, startCursor: wanted.startCursor, maxRows: wanted.limit });
  return state.collection.demand(request, collectionLaneBusy(state));
}

function existingDemand(args: JsonValue): string {
  const { demandId } = toolArgumentsOf(args);
  if (demandId === undefined || demandId.length > MAX_DEMAND_ID) throw Error("INVALID_DEMAND_ID");
  return demandId;
}

function selectCollectionDemand(state: CollectionToolDeps["state"], name: string, args: JsonValue): { id: string; dispatch?: JsonObject } {
  if (name !== "ae_read_graph_page") return { id: existingDemand(args) };
  const dispatch = beginCollectionDemand(state, args);
  const ticket = decode(object({ ticket: string() }), dispatch);
  if (!ticket.ok) throw Error("COLLECTION_FAILED");
  return { id: ticket.value.ticket, dispatch };
}

function collectionWaitSeconds(wait: number): number | null {
  return Number.isFinite(wait) && wait > 0 ? Math.min(MAX_WAIT_SECONDS, wait) : null;
}

const failureCode: Decoder<string> = fallback(map(object({ message: string() }), (facts) => facts.message), "COLLECTION_FAILED");

function failedCollectionDemand(code: string, state: CollectionToolDeps["state"], id?: string): ToolResult {
  const next = recovery(code, id !== undefined && state.collection.hasUnsettled(id));
  return { ok: false, error: { code, message: `Bounded graph demand unavailable; coverage remains unknown. No write was authorized. ${next.message}` } };
}

function unavailableRelationalSubmit(): Promise<Awaited<ReturnType<RelationalToolDeps["submitChange"]>>> {
  throw Error("PARAMETER_AUTHORING_UNAVAILABLE");
}

function answerWithoutNative(deps: CollectionToolDeps, name: string, args: JsonValue): Promise<ToolResult> | ToolResult | undefined {
  const { state } = deps;
  if (EFFECT_NOTES_TOOLS.has(name)) return runEffectNotesTool(state.collection.effectNotes, name, args);
  const arguments_ = decode(wireObject, args);
  const row = arguments_.ok ? arguments_.value : NO_ARGUMENTS;
  if (RELATIONAL_QUERY_TOOLS.has(name)) {
    const relational = { collection: state.collection, snapshot: undefined, panelInstanceId: state.activePanelInstanceId, now: Date.now(), submitChange: unavailableRelationalSubmit };
    return runRelationalTool(relational, name, row);
  }
  if (name === "ae_query_graph_cache") return { ok: true, tool: name, snapshotFingerprint: null, data: state.collection.queryCache(args) };
  return undefined;
}

function waitForDemand(deps: CollectionToolDeps, id: string, seconds: number, signal?: AbortSignal): Promise<boolean> {
  return deps.transport.waitUntil(() => !!signal?.aborted || deps.state.collection.demandResult(id).state !== "pending", seconds);
}

function announceDemand(deps: CollectionToolDeps, dispatch: JsonObject | undefined): void {
  if (!dispatch) return;
  enqueueHostWork(deps.state, { approvedData: { kind: "collection_page", dispatch } });
  deps.transport.notifyChange();
}

/** How long a graph tool waits for its demand, in seconds, and the signal that abandons it. */
export interface CollectionToolLimits { wait?: number | undefined; signal?: AbortSignal | undefined }

/** Runs one graph tool. A demand for a native page is announced to the panel, waited on up to `wait` seconds and answered with whatever the demand holds by then; every failure answers with its recovery step. */
export async function runCollectionTool(deps: CollectionToolDeps, name: string, args: JsonValue, limits: CollectionToolLimits = {}): Promise<ToolResult> {
  const { state, transport } = deps, { signal, wait = DEFAULT_WAIT_SECONDS } = limits;
  let demandId: string | undefined;
  const abort = (): void => {
    if (demandId && name === "ae_read_graph_page") state.collection.cancelDemand(demandId);
    transport.notifyChange();
  };
  try {
    requireActiveDemand(signal);
    const answered = answerWithoutNative(deps, name, args);
    if (answered) return answered;
    const selected = selectCollectionDemand(state, name, args);
    demandId = selected.id;
    announceDemand(deps, selected.dispatch);
    signal?.addEventListener("abort", abort, { once: true });
    const seconds = collectionWaitSeconds(wait);
    if (seconds !== null) await waitForDemand(deps, demandId, seconds, signal);
    requireActiveDemand(signal);
    return { ok: true, tool: name, snapshotFingerprint: null, data: { demandId, ...demandData(state.collection.demandResult(demandId), state.collection.hasUnsettled(demandId)) } };
  } catch (error) {
    return failedCollectionDemand(decodeOrThrow(failureCode, error), state, demandId);
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

/** Runs a graph tool for the in-panel agent and records the project it answered about against the chat request that received it. */
export async function runChatCollectionTool(deps: CollectionToolDeps & { state: Pick<SidecarState, "chatProjectLinks"> }, name: string, args: JsonValue, input: { requestId: string; signal?: AbortSignal }): Promise<ToolResult> {
  const result = await runCollectionTool(deps, name, args, { wait: toolArgumentsOf(args).waitSeconds ?? DEFAULT_WAIT_SECONDS, signal: input.signal });
  deps.state.chatProjectLinks.record(input.requestId, result);
  return result;
}
