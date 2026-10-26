// Builds the short, deterministic project summary the live-state message carries between turns: the open composition, what verified batches created or changed, and the last plan's outcome.
import { decode, fallback, object, string } from "@extynt/decode";
import type { WorkflowBatch } from "@extynt/workflow";

/** Hard cap on the carried summary. The model reads it every step, so it stays a few lines, never a project dump. */
export const MAX_CARRIED_CONTEXT_CHARS = 2400;
const MAX_LAYER_DETAIL_CHARS = 900;
const MAX_DETAIL_LAYERS = 8;
const MAX_DETAIL_KINDS = 5;
const MAX_DETAIL_LABELS = 3;
const MAX_LABEL_CHARS = 24;
const MAX_OPEN_LAYERS = 10;
const MAX_ENTRIES_PER_KIND = 6;
const MAX_NAME_CHARS = 28;
const MAX_SUMMARY_CHARS = 56;
const MAX_BATCH_LINE_CHARS = 330;
const MAX_CARRIED_JOBS = 2;
const MAX_RECENT_BUILD_CHARS = 600;
const CARRIED_HEADING = "Carried project context (built by the sidecar from the host read and verified receipts; trusted). There is no need to re-inspect what is listed here:";

interface Named {
  readonly id: string;
  readonly name: string;
}

interface Touched {
  readonly created: Named[];
  readonly changed: Named[];
  readonly comps: Named[];
}

interface Live {
  readonly compIds: ReadonlySet<string>;
  readonly layerIds: ReadonlySet<string>;
  readonly unreadComps: ReadonlySet<string>;
}

interface CarryContext {
  readonly bound: ReadonlyMap<string, string>;
  readonly names: ReadonlyMap<string, string>;
  readonly live: Live;
}

interface Entry {
  readonly batch: CarriedBatch;
  readonly touched: Touched;
}

interface ChangedLayer {
  readonly id: string;
  readonly compositionId: string;
}

interface CarriedOutcome {
  readonly operationId: string;
  readonly type: string;
  readonly readback?: { readonly targetLayerId?: string };
}

interface CarriedBinding {
  readonly placeholder: string;
  readonly createdId: string;
  readonly operationId: string;
}

interface CarriedBatch {
  readonly lifecycle: WorkflowBatch["lifecycle"];
  readonly summary: string;
  readonly recovery: { readonly state: WorkflowBatch["recovery"]["state"] };
  readonly verification: { readonly state: WorkflowBatch["verification"]["state"] };
  readonly execution: { readonly state: WorkflowBatch["execution"]["state"]; readonly receipt: { readonly outcomes: readonly CarriedOutcome[]; readonly createdBindings?: readonly CarriedBinding[] } | null };
}

interface CarriedJob {
  readonly jobId: string;
  readonly createdAt: string;
  readonly batchIds: readonly string[];
}

interface CarriedLedger {
  readonly jobs: Readonly<Record<string, CarriedJob>>;
  readonly batches: Readonly<Record<string, CarriedBatch>>;
}

interface CarriedComposition {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly frameRate: number;
  readonly layers: readonly Named[];
}

interface CarriedSnapshot {
  readonly activeCompositionId: string | null;
  readonly compositions: readonly CarriedComposition[];
}

interface CarryInput<Payload> {
  readonly state: CarriedLedger & { readonly operations: Readonly<Record<string, { readonly payload: Payload }>> };
  readonly snapshot: CarriedSnapshot | undefined;
  readonly hiddenJobs?: ReadonlySet<string>;
}

type FactsTable = ReadonlyMap<string, PayloadFacts>;

interface PayloadFacts {
  readonly type: string;
  readonly name: string;
  readonly propertyPath: string;
  readonly effectMatchName: string;
  readonly capabilityId: string;
  readonly target: { readonly compositionId: string; readonly propertyPath: string };
}

type LayerBuild = Map<string, Map<string, Set<string>>>;

const textOrEmpty = fallback(string(), "");
const targetFacts = object({ compositionId: textOrEmpty, propertyPath: textOrEmpty });
const NO_TARGET = { compositionId: "", propertyPath: "" };
const lenientTarget = fallback(targetFacts, NO_TARGET);
const payloadFacts = object({ type: textOrEmpty, name: textOrEmpty, propertyPath: textOrEmpty, effectMatchName: textOrEmpty, capabilityId: textOrEmpty, target: lenientTarget });
const NO_FACTS: PayloadFacts = { type: "", name: "", propertyPath: "", effectMatchName: "", capabilityId: "", target: NO_TARGET };

const NOTHING: Touched = { created: [], changed: [], comps: [] };
const LAYER_CREATORS: ReadonlySet<string> = new Set(["create_layer", "create_vector_artwork", "draw_vector_shapes", "duplicate_layer", "create_shape_group"]);

function clip(text: string, max: number): string {
  const flat = text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function layerNames(snapshot: CarriedSnapshot): Map<string, string> {
  const names = new Map<string, string>();
  for (const comp of snapshot.compositions) for (const layer of comp.layers) names.set(layer.id, layer.name);
  return names;
}

function liveOf(snapshot: CarriedSnapshot): Live {
  const compIds = new Set<string>(), layerIds = new Set<string>(), unreadComps = new Set<string>();
  for (const comp of snapshot.compositions) {
    compIds.add(comp.id);
    for (const layer of comp.layers) layerIds.add(layer.id);
    if (comp.layers.length === 0 && comp.id !== snapshot.activeCompositionId) unreadComps.add(comp.id);
  }
  return { compIds, layerIds, unreadComps };
}

function layerIsLive(live: Live, layerId: string, compositionId: string): boolean {
  return live.layerIds.has(layerId) || live.unreadComps.has(compositionId);
}

function factsTable<Payload>(operations: Readonly<Record<string, { readonly payload: Payload }>>): FactsTable {
  const table = new Map<string, PayloadFacts>();
  for (const [operationId, operation] of Object.entries(operations)) {
    const decoded = decode(payloadFacts, operation.payload);
    table.set(operationId, decoded.ok ? decoded.value : NO_FACTS);
  }
  return table;
}

function factsOf(facts: FactsTable, operationId: string): PayloadFacts {
  return facts.get(operationId) ?? NO_FACTS;
}

function targetComp(facts: FactsTable, operationId: string, bound: ReadonlyMap<string, string>): string {
  const raw = factsOf(facts, operationId).target.compositionId;
  return bound.get(raw) ?? raw;
}

function bindingsOf(batches: readonly CarriedBatch[]): Map<string, string> {
  const bound = new Map<string, string>();
  for (const batch of batches) for (const binding of batch.execution.receipt?.createdBindings ?? []) bound.set(binding.placeholder, binding.createdId);
  return bound;
}

function addUnique(list: Named[], entry: Named): void {
  if (entry.id && !list.some((known) => known.id === entry.id)) list.push(entry);
}

function changedLayers(facts: FactsTable, batch: CarriedBatch, context: CarryContext): ChangedLayer[] {
  const changed: ChangedLayer[] = [];
  for (const outcome of batch.execution.receipt?.outcomes ?? []) {
    const raw = outcome.readback?.targetLayerId;
    if (raw && !outcome.type.startsWith("create_")) changed.push({ id: context.bound.get(raw) ?? raw, compositionId: targetComp(facts, outcome.operationId, context.bound) });
  }
  return changed;
}

function addCreated(facts: FactsTable, touched: Touched, binding: { readonly operationId: string; readonly createdId: string }, context: CarryContext): void {
  const created = factsOf(facts, binding.operationId);
  const entry = { id: binding.createdId, name: created.name || context.names.get(binding.createdId) || "" };
  if (created.type === "create_composition" && context.live.compIds.has(entry.id)) addUnique(touched.comps, entry);
  else if (LAYER_CREATORS.has(created.type) && layerIsLive(context.live, entry.id, targetComp(facts, binding.operationId, context.bound))) addUnique(touched.created, entry);
}

function touchedBy(facts: FactsTable, batch: CarriedBatch, context: CarryContext): Touched {
  const touched: Touched = { created: [], changed: [], comps: [] };
  for (const binding of batch.execution.receipt?.createdBindings ?? []) addCreated(facts, touched, binding, context);
  for (const layer of changedLayers(facts, batch, context)) {
    if (layerIsLive(context.live, layer.id, layer.compositionId) && !touched.created.some((entry) => entry.id === layer.id)) addUnique(touched.changed, { id: layer.id, name: context.names.get(layer.id) ?? "" });
  }
  return touched;
}

function hasEntries(touched: Touched): boolean {
  return touched.comps.length + touched.created.length + touched.changed.length > 0;
}

function builtSomething(batch: CarriedBatch): boolean {
  return batch.recovery.state !== "undone" && batch.lifecycle !== "cancelled";
}

function listed(label: string, entries: readonly Named[]): string {
  if (!entries.length) return "";
  const shown = entries.slice(0, MAX_ENTRIES_PER_KIND).map((entry) => (entry.name ? `${entry.id} "${clip(entry.name, MAX_NAME_CHARS)}"` : entry.id));
  const more = entries.length > shown.length ? ` +${entries.length - shown.length} more` : "";
  return `${label} ${shown.join(", ")}${more}`;
}

function batchStatus(batch: CarriedBatch): string {
  if (batch.recovery.state === "undone") return "undone (these items no longer exist)";
  if (batch.lifecycle === "cancelled") return "cancelled before apply";
  if (batch.execution.state !== "executed") return batch.lifecycle === "settled" ? `not applied (${batch.execution.state})` : `in flight (${batch.lifecycle})`;
  if (batch.verification.state === "verified") return "applied and verified";
  if (batch.verification.state === "failed") return "applied, read-back mismatch";
  return "applied, not independently verified";
}

function batchLine(entry: Entry): string {
  const { batch, touched } = entry;
  const parts = [listed("created comp", touched.comps), listed("created layer", touched.created), listed("changed layer", touched.changed)].filter(Boolean);
  const head = `- "${clip(batch.summary, MAX_SUMMARY_CHARS)}": ${batchStatus(batch)}`;
  return clip(`${head}${parts.length ? `; ${parts.join("; ")}` : ""}`, MAX_BATCH_LINE_CHARS);
}

function carriedJobs(state: CarriedLedger, hidden: ReadonlySet<string> | undefined): CarriedJob[] {
  return Object.values(state.jobs)
    .filter((job) => !hidden?.has(job.jobId) && job.batchIds.some((batchId) => state.batches[batchId]))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.jobId.localeCompare(b.jobId))
    .slice(-MAX_CARRIED_JOBS);
}

function batchesOf(state: CarriedLedger, jobs: readonly CarriedJob[]): CarriedBatch[] {
  const batches: CarriedBatch[] = [];
  for (const job of jobs) for (const batchId of job.batchIds) { const batch = state.batches[batchId]; if (batch) batches.push(batch); }
  return batches;
}

function openCompLine(snapshot: CarriedSnapshot): { line: string; id: string | null } {
  const active = snapshot.compositions.find((comp) => comp.id === snapshot.activeCompositionId);
  if (!active) return { line: "Open in the viewer: no composition. Open or target one by id before inspecting.", id: null };
  const layers = active.layers.slice(0, MAX_OPEN_LAYERS).map((layer) => `${layer.id} "${clip(layer.name, MAX_NAME_CHARS)}"`).join(", ");
  const more = active.layers.length > MAX_OPEN_LAYERS ? ` +${active.layers.length - MAX_OPEN_LAYERS} more` : "";
  const size = `${active.width}x${active.height}, ${Math.round(active.duration * 100) / 100}s, ${Math.round(active.frameRate * 100) / 100}fps`;
  return { line: `Open in the viewer: comp ${active.id} "${clip(active.name, MAX_NAME_CHARS)}" (${size}), ${active.layers.length} layer(s)${layers ? `: ${layers}${more}` : ""}.`, id: active.id };
}

function viewerNote(comps: readonly Named[], openId: string | null): string | undefined {
  const built = comps.at(-1);
  if (!built || built.id === openId) return undefined;
  return `Built but not the open comp: ${built.id} "${clip(built.name, MAX_NAME_CHARS)}". Pass compositionId ${built.id} to inspect or queue into it.`;
}

function fitted(head: readonly string[], lines: readonly string[], tail: readonly string[]): string {
  const fixed = [CARRIED_HEADING, ...head, ...tail].join("\n").length;
  const kept: string[] = [];
  let used = fixed + "Earlier work (oldest first):".length + 2;
  for (const line of [...lines].reverse()) {
    if (used + line.length + 1 > MAX_CARRIED_CONTEXT_CHARS) break;
    kept.unshift(line);
    used += line.length + 1;
  }
  const dropped = lines.length - kept.length;
  const work = kept.length ? ["Earlier work (oldest first):", ...(dropped ? [`(${dropped} older batch(es) omitted)`] : []), ...kept] : [];
  return [CARRIED_HEADING, ...head, ...work, ...tail].join("\n").slice(0, MAX_CARRIED_CONTEXT_CHARS);
}

function operationLabel(facts: PayloadFacts): string {
  const path = facts.propertyPath || facts.target.propertyPath;
  const label = facts.effectMatchName || facts.capabilityId || path.split("/").at(-1)?.replace(/^ADBE /, "") || facts.name;
  return clip(label, MAX_LABEL_CHARS);
}

function recordBuild(build: LayerBuild, id: string, kind: string, label: string): void {
  const kinds = build.get(id) ?? new Map<string, Set<string>>();
  const labels = kinds.get(kind) ?? new Set<string>();
  if (label) labels.add(label);
  kinds.set(kind, labels);
  build.set(id, kinds);
}

function layerBuild(facts: FactsTable, entries: readonly Entry[], context: CarryContext): LayerBuild {
  const build: LayerBuild = new Map();
  const outcomes = entries.filter((entry) => builtSomething(entry.batch)).flatMap((entry) => entry.batch.execution.receipt?.outcomes ?? []);
  for (const outcome of outcomes) {
    const raw = outcome.readback?.targetLayerId;
    const id = raw ? context.bound.get(raw) ?? raw : "";
    if (id && !outcome.type.startsWith("create_") && context.live.layerIds.has(id)) recordBuild(build, id, outcome.type, operationLabel(factsOf(facts, outcome.operationId)));
  }
  return build;
}

function kindText(kind: string, labels: ReadonlySet<string>): string {
  const shown = [...labels].slice(0, MAX_DETAIL_LABELS).join(", ");
  return shown ? `${kind}(${shown})` : kind;
}

function layerBuildLines(build: LayerBuild, names: ReadonlyMap<string, string>): string[] {
  const lines: string[] = [];
  let used = 0;
  for (const [id, kinds] of [...build].slice(0, MAX_DETAIL_LAYERS)) {
    const line = `- ${id} "${clip(names.get(id) ?? "", MAX_NAME_CHARS)}": ${[...kinds].slice(0, MAX_DETAIL_KINDS).map(([kind, labels]) => kindText(kind, labels)).join("; ")}`;
    if (used + line.length + 1 > MAX_LAYER_DETAIL_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length ? ["Applied so far on existing layers (already confirmed; do not re-inspect to learn it):", ...lines] : [];
}

function lastOutcome(batch: CarriedBatch): string {
  return `Last plan: ${batchStatus(batch)}.${batch.verification.state === "applied_unverified" ? " Do not replay it; verify it by reading the result." : ""}`;
}

/**
 * A compact, deterministic project summary for the live-state message: the open comp, what each carried batch created or changed (ids and names)
 * and the last plan's outcome. Entries are kept only while their id exists in the current snapshot, so another project's batches never surface.
 * It is `undefined` until some carried batch has a live entry, because a first request is already covered by the briefing's project index.
 * A non-active composition that lists no layers was not read, so a layer in it is never called deleted; undone and cancelled batches
 * built nothing that exists; the newest batch lines that fit are kept, and the open comp and last outcome are never dropped.
 */
export function carriedContextSummary<Payload>(input: CarryInput<Payload>): string | undefined {
  const { state, snapshot } = input;
  const batches = batchesOf(state, carriedJobs(state, input.hiddenJobs));
  const last = batches.at(-1);
  if (!last || !snapshot) return undefined;
  const context: CarryContext = { bound: bindingsOf(batches), names: layerNames(snapshot), live: liveOf(snapshot) };
  const facts = factsTable(state.operations);
  const entries: Entry[] = batches.map((batch) => ({ batch, touched: builtSomething(batch) ? touchedBy(facts, batch, context) : NOTHING }));
  if (!entries.some((entry) => hasEntries(entry.touched))) return undefined;
  const shown = entries.filter((entry) => hasEntries(entry.touched) || !builtSomething(entry.batch));
  const open = openCompLine(snapshot);
  const note = viewerNote(entries.flatMap((entry) => entry.touched.comps), open.id);
  return fitted(note ? [open.line, note] : [open.line], shown.map(batchLine), [...layerBuildLines(layerBuild(facts, entries, context), context.names), lastOutcome(last)]);
}

/** The carried build summary bounded for a tool result: the panel's own text, cut at a line end when it is long. */
export function recentBuildSummary<Payload>(input: CarryInput<Payload>): string | undefined {
  const summary = carriedContextSummary(input);
  if (!summary || summary.length <= MAX_RECENT_BUILD_CHARS) return summary;
  const cut = summary.slice(0, MAX_RECENT_BUILD_CHARS - 1);
  const lineEnd = cut.lastIndexOf("\n");
  return (lineEnd > MAX_RECENT_BUILD_CHARS / 2 ? cut.slice(0, lineEnd) : cut) + "…";
}
