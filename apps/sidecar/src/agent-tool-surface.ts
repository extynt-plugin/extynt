// The tool list the in-panel agent is offered: a fixed core, plus two meta tools that reach the long tail on demand so the provider can cache one stable block.
import { decode, decodeJson, fallback, object, string, type Decoder } from "@extynt/decode";
import type { AgentToolCall, AgentToolSpec } from "@extynt/llm";
import { schemaProblems } from "./tool-schema-check.js";
import type { ToolResult } from "./agent-types.js";

const TOOL_SCHEMA_TOOL = "ae_tool_schema";
const CALL_TOOL = "ae_call_tool";
const MAX_SCHEMA_PROBLEMS = 6;

/** Everything not named here is long-tail, so a new tool starts out behind the dispatcher. */
export const CORE_TOOLS: ReadonlySet<string> = new Set([
  "ae_get_current_context", "ae_inspect_composition", "ae_inspect_layer", "ae_measure_layer", "ae_find_project_objects",
  "ae_search_native_operations", "ae_describe_native_operation",
  "ae_queue_add", "ae_queue_fix", "ae_queue_finish", "ae_queue_design",
  "ae_capture_composition_frame", "ae_observe_frame",
  "ae_ask_user", "ae_consult_specialist", "ae_select_workflow_stage",
  "ae_undo_agent_work", "ae_workflow_complete", "ae_workflow_checklist", "ae_workflow_unbuilt",
]);

/** The block the provider caches: fixed core tools, then the two meta tools whose description carries the long-tail catalogue. */
export interface ToolSurface {
  readonly offered: AgentToolSpec[];
  readonly byName: ReadonlyMap<string, AgentToolSpec>;
}

interface ResolvedToolCall {
  readonly call: AgentToolCall;
  readonly result?: ToolResult;
}

type CallArguments = AgentToolCall["arguments"];

const lenientText = fallback(string(), "");

const argumentsObject: Decoder<CallArguments | undefined> = {
  run: (input) => (typeof input === "object" && input !== null && !Array.isArray(input) ? Object.fromEntries(Object.entries(input)) : undefined),
};

const innerArguments: Decoder<CallArguments | undefined> = {
  run: (input) => {
    if (typeof input !== "string") return argumentsObject.run(input);
    const parsed = decodeJson(input, argumentsObject);
    return parsed.ok ? parsed.value : undefined;
  },
};

const schemaRequest = object({ name: lenientText });
const dispatchRequest = object({ name: lenientText, arguments: innerArguments });

function metaSpecs(longTail: readonly AgentToolSpec[]): AgentToolSpec[] {
  return [
    {
      name: TOOL_SCHEMA_TOOL,
      description: `Return the full description and JSON schema of one tool that is not in your tool list, so you can call it with ${CALL_TOOL}. Tools you can reach this way (names only; ask for one to read what it does): ${longTail.map((spec) => spec.name).join(", ")}.`,
      parameters: { type: "object", properties: { name: { type: "string", minLength: 1, description: "Exact tool name from the list above." } }, required: ["name"], additionalProperties: false },
    },
    {
      name: CALL_TOOL,
      description: `Call a tool from the ${TOOL_SCHEMA_TOOL} list with its own arguments. Fetch its schema first unless you already know it; a wrong call returns the schema.`,
      parameters: { type: "object", properties: { name: { type: "string", minLength: 1, description: "Exact tool name." }, arguments: { type: "object", description: "The tool's arguments, as its schema describes." } }, required: ["name", "arguments"], additionalProperties: false },
    },
  ];
}

/** A restricted turn already names its few read-only tools, so it offers them directly instead of behind the dispatcher. */
export function toolSurface(specs: readonly AgentToolSpec[], options: { restricted?: boolean } = {}): ToolSurface {
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  if (options.restricted === true) return { offered: [...specs], byName };
  const core = specs.filter((spec) => CORE_TOOLS.has(spec.name));
  const longTail = specs.filter((spec) => !CORE_TOOLS.has(spec.name));
  return { offered: longTail.length ? [...core, ...metaSpecs(longTail)] : core, byName };
}

function isMetaTool(surface: ToolSurface, name: string): boolean {
  return (name === TOOL_SCHEMA_TOOL || name === CALL_TOOL) && surface.offered.some((spec) => spec.name === name);
}

function schemaText(spec: AgentToolSpec): string {
  return JSON.stringify({ name: spec.name, description: spec.description, parameters: spec.parameters });
}

function failure(code: string, message: string): ToolResult {
  return { ok: false, error: { code, message } };
}

const NAME_NOISE: ReadonlySet<string> = new Set(["ae", "tool", "call"]);
const MAX_SUGGESTIONS = 3;

function nameWords(name: string): string[] {
  return name.toLowerCase().split("_").filter((word) => word !== "" && !NAME_NOISE.has(word));
}

function closestTools(name: string, available: Iterable<string>): string[] {
  const wanted = new Set(nameWords(name));
  const scored = [...available].map((tool) => ({ tool, score: nameWords(tool).filter((word) => wanted.has(word)).length })).filter((entry) => entry.score > 0);
  return scored.sort((left, right) => right.score - left.score || (left.tool < right.tool ? -1 : 1)).slice(0, MAX_SUGGESTIONS).map((entry) => entry.tool);
}

/** What to say after a tool name that is not offered: a wrapper the model invented points at calling the real tool by its own name, anything else at the nearest offered names. */
export function unknownToolHint(name: string, available: Iterable<string>): string {
  const pool = [...available];
  if (name === CALL_TOOL || name === TOOL_SCHEMA_TOOL || /call_?tool|tool_?call/iu.test(name)) {
    return pool.includes(CALL_TOOL) ? ` ${CALL_TOOL} takes the real tool's exact name as its name argument and that tool's own arguments as arguments.` : ` There is no wrapper tool this turn: call the tool you want directly by its own name, such as ${pool.slice(0, MAX_SUGGESTIONS).join(", ")}.`;
  }
  const close = closestTools(name, pool);
  return close.length ? ` Did you mean ${close.join(", ")}?` : "";
}

function unknownTool(surface: ToolSurface, name: string): ToolResult {
  return failure("TOOL_NOT_AVAILABLE", `${name || "(no name)"} is not a tool available this turn.${unknownToolHint(name, surface.byName.keys())} Available: ${[...surface.byName.keys()].join(", ")}.`);
}

function schemaResult(surface: ToolSurface, args: CallArguments): ToolResult {
  const request = decode(schemaRequest, args);
  const name = request.ok ? request.value.name : "";
  const spec = surface.byName.get(name);
  if (!spec) return unknownTool(surface, name);
  return { ok: true, data: { name: spec.name, description: spec.description, parameters: spec.parameters } };
}

function checkedCall(call: AgentToolCall, spec: AgentToolSpec): ResolvedToolCall {
  if (CORE_TOOLS.has(spec.name)) return { call };
  const problems = schemaProblems(spec.parameters, call.arguments);
  if (!problems.length) return { call };
  return { call, result: failure("INVALID_TOOL_ARGUMENTS", `Nothing ran: ${problems.slice(0, MAX_SCHEMA_PROBLEMS).join("; ")}. Schema for ${spec.name}: ${schemaText(spec)}`) };
}

function unwrapped(surface: ToolSurface, call: AgentToolCall): ResolvedToolCall {
  const request = decode(dispatchRequest, call.arguments);
  const { name, arguments: args } = request.ok ? request.value : { name: "", arguments: undefined };
  const inner = { id: call.id, name, arguments: args ?? {} };
  const spec = surface.byName.get(name);
  if (!spec) return { call: inner, result: unknownTool(surface, name) };
  if (args === undefined) return { call: inner, result: failure("INVALID_TOOL_ARGUMENTS", `Nothing ran: arguments must be a JSON object. Schema for ${name}: ${schemaText(spec)}`) };
  return checkedCall(inner, spec);
}

/** Rewrites ae_call_tool to the inner tool so permissions, logs, plan cards and labels see the real name; a direct long-tail call is validated the same way, and ae_tool_schema is answered here. */
export function resolveToolCall(surface: ToolSurface, call: AgentToolCall): ResolvedToolCall {
  if (call.argumentsError) return { call };
  if (isMetaTool(surface, call.name)) return call.name === TOOL_SCHEMA_TOOL ? { call, result: schemaResult(surface, call.arguments) } : unwrapped(surface, call);
  const direct = surface.byName.get(call.name);
  return direct ? checkedCall(call, direct) : { call };
}
