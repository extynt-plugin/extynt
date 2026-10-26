/**
 * A workflow job remembers the placeholder names its own applied batches created. A later plan or read in the same job that uses
 * such a name gets the real id before it runs; a name that was never built is refused, naming its state, so nothing that does
 * not exist is ever read. Nothing is stored: the map is derived from the job's plans and batches, so it ends with the job.
 */
import { declaredNames, type StoredPlan } from "@extynt/mcp-server";
import type { WorkflowId } from "@extynt/workflow";
import type { ToolArguments } from "./agent-types.js";
import type { JsonObject } from "@extynt/decode";
import type { ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { operationsOf } from "./server-workflow-design-receipts.js";
import { boundId, type SettledBatch } from "./server-workflow-design-release.js";
import { argumentJson, objectOf, objectsOf, PLACEHOLDER_PREFIX, refusal, stringsIn, withIds, type ToolResult } from "./server-workflow-operation-json.js";
import { recordSeedAction, type SidecarActionHost } from "./server-workflow-sidecar-actions.js";

type Coordinator = ChatAgentDeps["state"]["workflowCoordinator"];

/** What placeholder resolution reads of the chat agent: the job's plans and batches, and the ledger it records its notes in. */
export interface PlaceholderDeps {
  readonly state: SidecarActionHost & { readonly plans: ReadonlyMap<string, StoredPlan>; readonly workflowCoordinator: Pick<Coordinator, "jobIdForSeed" | "jobIdForPlan" | "batchForPlan"> };
}

type Unbuilt = "queued" | "failed";

interface JobPlaceholders {
  readonly built: Map<string, string>;
  readonly ambiguous: Set<string>;
  readonly unbuilt: Map<string, Unbuilt>;
}

const QUEUE_TOOLS: ReadonlySet<string> = new Set(["ae_queue_add", "ae_queue_fix"]);
const READ_TOOLS: ReadonlySet<string> = new Set(["ae_inspect_layer", "ae_inspect_composition", "ae_measure_layer", "ae_list_effects_and_expressions", "ae_trace_dependencies", "ae_capture_composition_frame", "ae_observe_frame", "ae_solve_arc_path", "ae_solve_stagger", "ae_solve_keyframe_assistant"]);

const STATE_TEXT: Readonly<Record<Unbuilt | "unknown", string>> = {
  queued: "it is declared in a batch that has not been applied yet (seal it with ae_queue_finish and let it apply first)",
  failed: "the batch that declared it did not apply (refused, failed or undone)",
  unknown: "no batch in this job declares it",
};

function placeholdersIn(args: ToolArguments): Set<string> {
  const names = new Set<string>();
  for (const key of Object.keys(args)) {
    const value = argumentJson(args, key);
    for (const text of value === undefined ? [] : stringsIn(value)) if (text.startsWith(PLACEHOLDER_PREFIX)) names.add(text);
  }
  return names;
}

function declaredIn(operations: readonly JsonObject[]): Set<string> {
  const names = new Set<string>();
  for (const operation of operations) {
    for (const name of declaredNames(operation)) names.add(name);
    const inner = objectOf(operation.operation);
    if (inner) for (const name of declaredNames(inner)) names.add(name);
  }
  return names;
}

function settledId(batch: SettledBatch, record: StoredPlan, canonical: string): string | undefined {
  return batch.recovery.state === "undone" ? undefined : boundId(batch, record, canonical);
}

function noteName(out: JobPlaceholders, name: string, plan: { batch: ReturnType<Coordinator["batchForPlan"]>; record: StoredPlan; canonical: string }): void {
  const { batch, record, canonical } = plan;
  if (batch?.lifecycle !== "settled") {
    out.unbuilt.set(name, "queued");
    return;
  }
  const id = settledId(batch, record, canonical);
  if (!id) {
    if (!out.built.has(name)) out.unbuilt.set(name, "failed");
    return;
  }
  if (out.built.has(name) && out.built.get(name) !== id) out.ambiguous.add(name);
  out.built.set(name, id);
  out.unbuilt.delete(name);
}

function jobPlaceholders(deps: PlaceholderDeps, jobId: WorkflowId): JobPlaceholders {
  const coordinator = deps.state.workflowCoordinator;
  const out: JobPlaceholders = { built: new Map(), ambiguous: new Set(), unbuilt: new Map() };
  for (const record of deps.state.plans.values()) {
    if (coordinator.jobIdForPlan(record.plan.planId) !== jobId) continue;
    const bindings = record.placeholderBindings ?? {};
    const names = new Set<string>([...Object.keys(bindings), ...declaredIn(operationsOf(record))]);
    const batch = coordinator.batchForPlan(record.plan.planId);
    for (const name of names) noteName(out, name, { batch, record, canonical: bindings[name] ?? name });
  }
  return out;
}

function notBuilt(name: string, state: Unbuilt | "unknown"): ToolResult {
  return refusal("PLACEHOLDER_NOT_BUILT", `${name} is a placeholder that does not exist in After Effects yet: ${STATE_TEXT[state]}. Placeholders live only inside a plan; reads take ids from a read or a receipt. Nothing was read.`);
}

function replaceIn(args: ToolArguments, ids: ReadonlyMap<string, string>): void {
  for (const key of Object.keys(args)) {
    const value = argumentJson(args, key);
    if (value !== undefined) args[key] = withIds(value, ids);
  }
}

function resolveNames(used: ReadonlySet<string>, own: ReadonlySet<string>, map: JobPlaceholders, isQueue: boolean): { ids: Map<string, string> } | { refusal: ToolResult } {
  const ids = new Map<string, string>();
  for (const name of used) {
    if (own.has(name) || (isQueue && map.unbuilt.get(name) === "queued")) continue;
    const id = map.built.get(name);
    if (id) ids.set(name, id);
    else if (!isQueue) return { refusal: notBuilt(name, map.unbuilt.get(name) ?? "unknown") };
  }
  return { ids };
}

function ownDeclared(name: string, args: ToolArguments): Set<string> {
  if (!QUEUE_TOOLS.has(name)) return new Set();
  return declaredIn(objectsOf(argumentJson(args, name === "ae_queue_add" ? "operations" : "edits")));
}

function noteAmbiguous(deps: PlaceholderDeps, seed: string, used: { ids: ReadonlyMap<string, string>; ambiguous: ReadonlySet<string> }): void {
  for (const [placeholder, id] of used.ids) if (used.ambiguous.has(placeholder)) recordSeedAction(deps.state, seed, `${placeholder} was created more than once in this job; used the latest applied one (${id})`);
}

interface PlaceholderCall {
  readonly name: string;
  readonly args: ToolArguments;
  readonly input: Pick<ChatAgentInput, "workflowJobId">;
}

/**
 * Swaps the placeholders this job already built for their real ids, in the args of a queue call or a read. A read of a name that
 * is not built is refused. A queue call keeps the names it declares itself or that wait in the open batch (those belong to a plan).
 */
export function resolveJobPlaceholders(deps: PlaceholderDeps, call: PlaceholderCall): ToolResult | undefined {
  const { name, args, input } = call;
  const isQueue = QUEUE_TOOLS.has(name);
  const seed = input.workflowJobId;
  if (!seed || (!isQueue && !READ_TOOLS.has(name))) return undefined;
  const used = placeholdersIn(args);
  if (!used.size) return undefined;
  const map = jobPlaceholders(deps, deps.state.workflowCoordinator.jobIdForSeed(seed));
  const resolved = resolveNames(used, ownDeclared(name, args), map, isQueue);
  if ("refusal" in resolved) return resolved.refusal;
  noteAmbiguous(deps, seed, { ids: resolved.ids, ambiguous: map.ambiguous });
  if (resolved.ids.size) replaceIn(args, resolved.ids);
  return undefined;
}
