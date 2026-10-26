// Agent-facing MCP shaping: the sidecar and panel keep full response bodies, agents get a compact view (verbose restores the body).
import { captureView } from "./capture-view.js";
import type { CaptureView } from "./capture-view.js";
import { capabilityRow, catalogueView, effectsRow, inventoryView } from "./catalogue-view.js";
import { objectAt, objectOf, objectsIn, stringAt } from "./json.js";
import { isJsonArray, isJsonObject } from "@extynt/decode";
import type { JsonFields } from "./json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { amendView, approveView, planView, presentView, statusView } from "./plan-view.js";
import type { AgentViewMemory } from "./plan-view.js";
import { receiptView } from "./receipt-agent-view.js";
import { redactTokens, withoutBudget } from "./view-text.js";

export type { AgentViewMemory } from "./plan-view.js";

type McpContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: "image/png" };

/** A tool result as an MCP client receives it. */
export interface McpToolResult {
  readonly isError?: true;
  readonly content: ReadonlyArray<McpContent>;
}

interface McpResultOptions {
  readonly verbose?: boolean;
  readonly memory?: AgentViewMemory;
}

type ViewBuilder = (data: JsonValue | undefined, memory: AgentViewMemory | undefined) => JsonValue | undefined;

/** An empty memory of what each agent view last showed. */
export function createAgentViewMemory(): AgentViewMemory {
  return { lastView: new Map() };
}

function text(value: JsonValue): McpContent {
  return { type: "text", text: JSON.stringify(value) };
}

function ofObject(build: (data: JsonObject) => JsonValue | undefined): ViewBuilder {
  return (data) => (isJsonObject(data) ? build(data) : withoutBudget(data));
}

function ofRows(row: (item: JsonObject) => JsonValue): ViewBuilder {
  return (data) => (isJsonArray(data) ? objectsIn(data).map(row) : withoutBudget(data));
}

function planRow(row: JsonObject): JsonObject {
  return objectOf({ planId: row.planId, status: row.status, summary: row.summary });
}

function undoView(data: JsonObject): JsonObject {
  const receipt = objectAt(data, "receipt");
  const base = withoutBudget(data);
  return { ...(isJsonObject(base) ? base : {}), ...(receipt ? { receipt: receiptView(receipt) } : {}) };
}

function receiptEnvelopeView(data: JsonObject): JsonObject {
  const receipt = objectAt(data, "receipt");
  return objectOf({ planId: data.planId, receipt: receipt ? receiptView(receipt) : data.receipt });
}

const AGENT_VIEWS = new Map<string, ViewBuilder>([
  ["ae_propose_plan", planView],
  ["ae_prepare_change", planView],
  ["ae_amend_plan", ofObject(amendView)],
  ["ae_present_plan", ofObject(presentView)],
  ["ae_approve_plan", ofObject(approveView)],
  ["ae_get_plan_status", (data, memory) => (isJsonObject(data) ? statusView(data, memory) : withoutBudget(data))],
  ["ae_undo_plan", ofObject(undoView)],
  ["ae_get_receipt", ofObject(receiptEnvelopeView)],
  ["ae_list_plans", ofRows(planRow)],
  ["ae_search_capabilities", ofRows(capabilityRow)],
  ["ae_list_capabilities", ofObject(catalogueView)],
  ["ae_list_effects_and_expressions", ofRows(effectsRow)],
  ["ae_get_inventory_diff", ofObject(inventoryView)],
]);

function envelope(result: JsonObject, data: JsonValue | undefined): JsonObject {
  const fields: JsonFields = {
    snapshotFingerprint: stringAt(result, "snapshotFingerprint"),
    data,
    truncated: result.truncated === true ? true : undefined,
    warning: stringAt(result, "warning"),
  };
  return objectOf(fields);
}

function captureContent(result: JsonObject, capture: CaptureView): McpToolResult {
  const image: McpContent[] = capture.base64 ? [{ type: "image", data: capture.base64, mimeType: "image/png" }] : [];
  return { content: [text(envelope(result, capture.metadata)), ...image] };
}

/** An MCP tool result for a sidecar result: an error block, the capture as an image, the whole body (verbose), or the agent's compact view. */
export function toMcpToolResult(result: JsonObject, options: McpResultOptions = {}): McpToolResult {
  const error = objectAt(result, "error");
  if (result.ok !== true) return { isError: true, content: [text(error ? { error } : result)] };
  const capture = captureView(result);
  if (capture) return captureContent(result, capture);
  if (options.verbose) return { content: [text(redactTokens(result))] };
  const build = AGENT_VIEWS.get(stringAt(result, "tool") ?? "");
  const data = build ? build(result.data, options.memory) : withoutBudget(result.data);
  return { content: [text(envelope(result, data))] };
}
