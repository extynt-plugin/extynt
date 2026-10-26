/**
 * What the host reads around an apply or an undo, decided here from the plan and the sidecar's own record. At claim time the
 * apply item gets `reads: { precheck, verify, expectedStamp?, preApply? }`; the host runs them and decides nothing.
 *
 * The precheck is the read just before the plan runs. It is skipped (`null`) only when the sidecar can prove, from the stamp
 * the host's last claim carried, that After Effects still shows exactly what the sidecar last read, for every composition
 * the plan names and for the item list when the plan needs it. A skipped precheck is replaced by `expectedStamp`: the host
 * compares AE's revision with it before writing anything, and refuses (STALE_STAMP, nothing applied) when it moved.
 */
import { decode, jsonObject, object, type Decoder, type JsonArray, type JsonObject } from "@extynt/decode";
import { jsonOf } from "@extynt/mcp-server";
import { visitStrings } from "./bounded-strings.js";
import { MAX_READ_COMPOSITIONS, issuePanelRead, type PanelRead, type ReadScope } from "./read-queue.js";
import { compositionCurrent, freshStamp, itemsCurrent, stampMatchesLatest, type CurrencyState } from "./read-currency.js";
import { snapshotView, type Opaque } from "./snapshot-view.js";
import type { SidecarState } from "./server-state.js";
import type { AgentMailboxItem, ProbeSnapshot } from "./server-types.js";

const SKIP_STAMP_MAX_AGE_MS = 2000;
const FULL_OPERATIONS = new Set(["create_composition", "duplicate_composition", "import_file", "precompose_layers"]);
const ITEM_OPERATIONS = new Set([...FULL_OPERATIONS, "create_folder", "create_vector_artwork", "set_item_name", "move_item_to_folder", "delete_project_item", "cleanup_project", "resize_solid", "replace_footage", "set_footage_proxy", "clear_footage_proxy", "set_footage_interpretation"]);
const SOLID_LAYER_TYPES = new Set(["null", "solid", "adjustment"]);
const SOLID_DERIVE_KINDS = new Set(["path-null", "audio-keyframes"]);
const NEW_ITEM_ID = /^__new__:(comp|folder|item)/;
const NON_VISUAL = new Set(["set_layer_name", "add_marker", "update_marker", "remove_marker", "create_folder", "import_file", "render_composition", "cleanup_project", "export_mogrt", "export_frame", "set_composition_guides"]);
const REFRAMES = new Set(["set_composition_settings", "create_composition"]);
const PLAN_SCAN = { strings: 20_000, depth: 8, length: 160 };

type Data = AgentMailboxItem["approvedData"];
type Command = JsonObject;

const text: Decoder<string | undefined> = { run: (input) => (typeof input === "string" ? input : undefined) };
const operationList: Decoder<JsonArray | undefined> = { run: (input) => (Array.isArray(input) ? input : undefined) };
const present: Decoder<boolean> = { run: (input) => input !== undefined };
const operationShape = object({ operation: text, type: text, layerType: text, kind: text });
const commandShape = object({ operation: text, readSet: present, operations: operationList });

interface PlanReach { compositionIds: string[]; items: boolean; creates: boolean; picture: boolean }
interface Operation { kind: string; layerType: string | undefined; deriveKind: string | undefined; value: Opaque }
interface Known { compositions: ReadonlySet<string>; others: ReadonlySet<string> }
interface Flags { items: boolean; creates: boolean }

function knownIds(snapshot: ProbeSnapshot): Known {
  const view = snapshotView(snapshot), compositions = new Set(view.compositions.map((composition) => composition.id));
  return { compositions, others: new Set((view.items ?? []).filter((item) => !compositions.has(item.id)).map((item) => item.id)) };
}

function operationOf(value: Opaque): Operation {
  const decoded = decode(operationShape, value), fact = decoded.ok ? decoded.value : undefined;
  return { kind: fact?.operation ?? fact?.type ?? "", layerType: fact?.layerType, deriveKind: fact?.kind, value };
}

function makesSolidItem({ kind, layerType, deriveKind }: Operation): boolean {
  if (kind === "create_layer") return layerType !== undefined && SOLID_LAYER_TYPES.has(layerType);
  return kind === "derive_layer" && deriveKind !== undefined && SOLID_DERIVE_KINDS.has(deriveKind);
}

function mayTakePicture(operations: readonly Operation[]): boolean {
  return operations.length > 0 && !operations.some(({ kind }) => REFRAMES.has(kind)) && operations.some(({ kind }) => !NON_VISUAL.has(kind));
}

function noteText(found: string, known: Known, seen: Set<string>, flags: Flags): void {
  if (known.compositions.has(found)) seen.add(found);
  else if (known.others.has(found) || NEW_ITEM_ID.test(found)) flags.items = true;
  if (found.startsWith("__new__:comp")) flags.creates = true;
}

/** Which compositions and items a plan's operations reach, from the ids they carry: `items` when the item list is needed, `creates` when the project afterwards holds things the snapshot cannot name, `picture` when a frame could show the change; every string is visited within fixed bounds, so a hostile plan costs a constant scan. */
export function reachOf(operations: Opaque, snapshot: ProbeSnapshot): PlanReach {
  const list = Array.isArray(operations) ? operations.map(operationOf) : [], known = knownIds(snapshot), seen = new Set<string>(), flags: Flags = { items: false, creates: false };
  for (const operation of list) {
    if (FULL_OPERATIONS.has(operation.kind)) flags.creates = true;
    if (ITEM_OPERATIONS.has(operation.kind) || makesSolidItem(operation)) flags.items = true;
    visitStrings(operation.value, PLAN_SCAN, (found) => noteText(found, known, seen, flags));
  }
  const compositionIds = [...seen];
  return { compositionIds, ...flags, picture: compositionIds.length > 0 && mayTakePicture(list) };
}

function scopeOf(reach: PlanReach, whole: boolean): ReadScope {
  if (whole || reach.compositionIds.length === 0 || reach.compositionIds.length > MAX_READ_COMPOSITIONS) return { scope: "full" };
  return { scope: "compositions", compositionIds: reach.compositionIds, includeItems: reach.items };
}

function slimSnapshot(snapshot: ProbeSnapshot, ids: readonly string[]): ProbeSnapshot {
  const wanted = new Set(ids), compositions = snapshotView(snapshot).compositions.filter((composition) => wanted.has(composition.id)).map((composition) => composition.row);
  return { ...snapshot, result: Object.assign({}, snapshot.result, { compositions, items: [], sources: [] }) };
}

type ApplyReadState = Pick<SidecarState, "issuedReads" | "latest" | "liveStamp" | "now" | "readSequence"> & Partial<Pick<SidecarState, "options" | "hostLink">>;

interface ApplyReads { precheck: PanelRead | null; verify: PanelRead; expectedStamp?: { epoch: number; revision: number }; preApply?: ProbeSnapshot }

function precheckSkippable(state: CurrencyState, reach: PlanReach): boolean {
  if (reach.compositionIds.length === 0 || !stampMatchesLatest(state, SKIP_STAMP_MAX_AGE_MS)) return false;
  return reach.compositionIds.every((id) => compositionCurrent(state, id, SKIP_STAMP_MAX_AGE_MS)) && (!reach.items || itemsCurrent(state, SKIP_STAMP_MAX_AGE_MS));
}

function revisionGuardOff(state: Partial<Pick<SidecarState, "hostLink">>): boolean {
  return state.hostLink?.status().host?.capabilities.revisionGuard === "off";
}

function skippedPrecheck(state: ApplyReadState, reach: PlanReach, snapshot: ProbeSnapshot, verify: PanelRead): ApplyReads | undefined {
  const stamp = precheckSkippable(state, reach) ? freshStamp(state, SKIP_STAMP_MAX_AGE_MS) : null;
  return stamp ? { precheck: null, verify, expectedStamp: { epoch: stamp.epoch, revision: stamp.revision }, preApply: slimSnapshot(snapshot, reach.compositionIds) } : undefined;
}

/** The reads for one apply, or undefined when the command is not a plain apply (a metadata read-set plan keeps its own path). Without a revision there is no stamp for a scoped read to be merged under, so the precheck is then a whole read. */
export function applyReadsFor(state: ApplyReadState, command: Command): ApplyReads | undefined {
  const stored = state.latest, decoded = decode(commandShape, command);
  if (!stored || !decoded.ok || decoded.value.operation !== "apply_plan" || decoded.value.readSet || !decoded.value.operations) return undefined;
  const reach = reachOf(decoded.value.operations, stored.snapshot), verify = issuePanelRead(state, { reason: "apply", read: scopeOf(reach, reach.creates) });
  return skippedPrecheck(state, reach, stored.snapshot, verify) ?? { precheck: issuePanelRead(state, { reason: "apply", read: scopeOf(reach, revisionGuardOff(state)) }), verify };
}

/** The apply item with its reads attached, and the stamp the host must still find when it skips the precheck. */
export function withApplyReads(state: ApplyReadState, data: Data): Data {
  const decoded = decode(jsonObject, data.command), reads = decoded.ok ? applyReadsFor(state, decoded.value) : undefined;
  if (!decoded.ok || !reads) return data;
  return { ...data, command: reads.expectedStamp ? { ...decoded.value, expectedStamp: reads.expectedStamp } : decoded.value, reads: jsonOf(reads) };
}

/**
 * The reads around an undo. The guard stays a whole-project read: Edit > Undo is global, and a merged fingerprint could miss an
 * edit of the user's in a composition that was not read again. The read after only has to show what the undo put back.
 */
export function undoReadsFor(state: Pick<SidecarState, "issuedReads" | "latest" | "now" | "readSequence">, operations: Opaque): { guard: PanelRead; after: PanelRead } {
  const guard = issuePanelRead(state, { reason: "undo", read: { scope: "full" } });
  const reach = state.latest ? reachOf(operations, state.latest.snapshot) : undefined;
  return { guard, after: issuePanelRead(state, { reason: "undo", read: reach ? scopeOf(reach, reach.creates) : { scope: "full" } }) };
}
