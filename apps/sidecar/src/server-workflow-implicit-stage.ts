/** The stage a queue call opens for itself when the model selected none: its label, its operation types, and the close of a settled one. */
import type { ToolArguments } from "./agent-types.js";
import type { JsonValue } from "@extynt/decode";
import type { AgentCallState } from "./server-chat-agent-types.js";
import { authoringOperations } from "./server-workflow-design.js";
import { textOf, type ToolResult } from "./server-workflow-operation-json.js";

type ImplicitStage = { summary: string; operationTypes: string[] };

const SUMMARY_CHARS = 240;

function label(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, SUMMARY_CHARS) : undefined;
}

function takeStageLabel(args: ToolArguments): string | undefined {
  const named = label(args.stage);
  delete args.stage;
  return named;
}

function openImplicitStage(name: string, args: ToolArguments, stageLabel: string | undefined): ImplicitStage {
  const types = [...new Set(authoringOperations(name, args).flatMap((operation) => textOf(operation.type) ?? []))];
  return { summary: stageLabel ?? label(args.summary) ?? (types.length ? `Queue ${types.join(", ")}`.slice(0, SUMMARY_CHARS) : "Queue a batch"), operationTypes: types };
}

/** Opens the call's stage when none is open; a finish with no stage has nothing to open. */
export function ensureStage(state: AgentCallState, name: string, args: ToolArguments): void {
  const stageLabel = takeStageLabel(args);
  if (!state.workflowStage && name !== "ae_queue_finish") state.workflowStage = openImplicitStage(name, args, stageLabel);
}

/** A seal that settled in the loop closes its stage, so the next queue call opens a fresh one; layers it created are built, so a later batch may animate them. */
export function closeSettledStage(state: AgentCallState, result: ToolResult): void {
  if (!("continuesLoop" in result)) return;
  delete state.workflowStage;
  delete state.createdLayers;
}
