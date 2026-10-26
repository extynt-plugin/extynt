/**
 * The sidecar's request for a project read, as it travels through the host work queue. The host only runs it: which
 * compositions, whether the item list and whether the effects census are all decided here. At most one `refresh_snapshot`
 * item waits at a time; a caller that asks while it is queued widens it (full wins, ids unite) instead of adding another.
 * Every read the host takes is remembered by id in `issuedReads` (newest sixteen) until its answer is merged.
 */
import { array, boolean, decode, literal, map, object, optional, string, taggedUnion, type Decoder, type Infer } from "@extynt/decode";
import { enqueueHostWork } from "./host/work-queue.js";
import type { SidecarState } from "./server-state.js";
import type { AgentMailboxItem } from "./server-types.js";

const REASONS = ["pair", "project", "edit", "composition", "gate", "explicit", "apply", "undo", "overflow"] as const;

type ReadReason = (typeof REASONS)[number];
export type ReadScope = { scope: "full" } | { scope: "compositions"; compositionIds: string[]; includeItems: boolean };
/** What to read and why (the host logs the reason, nothing branches on it); `includeEffects` adds the effects census. */
export interface ReadSpec { reason: ReadReason; read: ReadScope; includeEffects?: boolean }
/** A read the host runs for an apply or an undo: the same spec, named so its answer can be placed on what the sidecar asked for. */
export type PanelRead = ReadSpec & { readId: string };

/** The most compositions one scoped read may name; a wider ask becomes a full read. */
export const MAX_READ_COMPOSITIONS = 256;
const MAX_ISSUED_READS = 16;
const FULL: ReadScope = { scope: "full" };
const EXPLICIT_FULL: ReadSpec = { reason: "explicit", read: FULL };

type ApprovedData = AgentMailboxItem["approvedData"];
type Queueing = Pick<SidecarState, "agentMailbox" | "now" | "readSequence"> & Partial<Pick<SidecarState, "hostWake">>;

const scopeShape: Decoder<ReadScope> = taggedUnion("scope", {
  full: object({ scope: literal("full") }),
  compositions: object({ scope: literal("compositions"), compositionIds: map(array(string()), (ids) => [...ids]), includeItems: boolean() }),
});
const refreshShape = object({ readId: optional(string()), reason: optional(literal(...REASONS)), read: optional(scopeShape), includeEffects: optional(boolean()) });
type RefreshData = Infer<typeof refreshShape>;

function refreshDataOf(data: ApprovedData): RefreshData {
  const decoded = decode(refreshShape, data);
  return decoded.ok ? decoded.value : {};
}

const withEffects = (spec: ReadSpec): { includeEffects?: true } => (spec.includeEffects ? { includeEffects: true } : {});

/** The union of two asks: full wins, ids are united, the item list is read if either wants it. */
export function mergeReadScopes(a: ReadScope, b: ReadScope): ReadScope {
  if (a.scope === "full" || b.scope === "full") return FULL;
  const ids = [...new Set([...a.compositionIds, ...b.compositionIds])];
  if (ids.length > MAX_READ_COMPOSITIONS) return FULL;
  return { scope: "compositions", compositionIds: ids, includeItems: a.includeItems || b.includeItems };
}

function mergeSpecs(queued: ReadSpec, asked: ReadSpec): ReadSpec {
  const read = mergeReadScopes(queued.read, asked.read);
  const reason = read.scope === "full" && queued.read.scope !== "full" ? asked.reason : queued.reason;
  return { reason, read, ...withEffects({ reason, read, includeEffects: queued.includeEffects === true || asked.includeEffects === true }) };
}

function refreshIndex(state: Pick<SidecarState, "agentMailbox">): number {
  return state.agentMailbox.findIndex((item) => item.approvedData.kind === "refresh_snapshot");
}

function nextReadId(state: Pick<SidecarState, "now" | "readSequence">): string {
  state.readSequence += 1;
  return `read-${state.now().getTime().toString(36)}-${state.readSequence.toString(36)}`;
}

function remember(state: Pick<SidecarState, "issuedReads">, readId: string, read: ReadScope): void {
  state.issuedReads.set(readId, read);
  for (const oldest of state.issuedReads.keys()) {
    if (state.issuedReads.size <= MAX_ISSUED_READS) return;
    state.issuedReads.delete(oldest);
  }
}

/** The spec a queued refresh item carries; an item without a readable `read` is a full read. */
export function queuedSpec(data: ApprovedData): ReadSpec {
  const { reason, read, includeEffects } = refreshDataOf(data);
  return { reason: reason ?? "explicit", read: read ?? FULL, ...(includeEffects === true ? { includeEffects: true } : {}) };
}

/** Asks for a read; callers that ask while one is queued widen it, so the host answers once however many asked. */
export function queueSnapshotRefresh(state: Queueing, spec: ReadSpec = EXPLICIT_FULL): void {
  const queued = state.agentMailbox[refreshIndex(state)];
  if (!queued) {
    enqueueHostWork(state, { approvedData: { kind: "refresh_snapshot", readId: nextReadId(state), reason: spec.reason, read: spec.read, ...withEffects(spec) } });
    return;
  }
  const merged = mergeSpecs(queuedSpec(queued.approvedData), spec);
  queued.approvedData = { ...queued.approvedData, kind: "refresh_snapshot", reason: merged.reason, read: merged.read, ...withEffects(merged) };
}

/** Takes back a refresh nobody needs any more (the read landed first), so the host does not read the project twice. */
export function withdrawSnapshotRefresh(state: Pick<SidecarState, "agentMailbox">): void {
  for (let index = state.agentMailbox.length - 1; index >= 0; index -= 1) if (state.agentMailbox[index]?.approvedData.kind === "refresh_snapshot") state.agentMailbox.splice(index, 1);
}

/** True while a refresh waits in the queue or the host is running one. */
export function refreshPending(state: Pick<SidecarState, "agentMailbox" | "inFlight">): boolean {
  return refreshIndex(state) >= 0 || state.inFlight?.kind === "refresh_snapshot";
}

/** Called when the host takes a refresh: what was asked is remembered under its read id until the answer is merged. */
export function rememberIssuedRead(state: Pick<SidecarState, "issuedReads">, data: ApprovedData): void {
  const { readId, read } = refreshDataOf(data);
  if (readId !== undefined) remember(state, readId, read ?? FULL);
}

/** Names a read that rides on an apply or an undo item instead of a refresh, and remembers it so its answer is merged like a refresh's. */
export function issuePanelRead(state: Pick<SidecarState, "issuedReads" | "now" | "readSequence">, spec: ReadSpec): PanelRead {
  const readId = nextReadId(state);
  remember(state, readId, spec.read);
  return { ...spec, readId };
}
