// The `refresh_snapshot` runner: one scoped or full read of After Effects, folded onto the stored snapshot. The flow is
// a hashed native read, the layers whose hash moved, the jsx details for those layers only, the probe envelope, and a merge
// that keeps every unchanged layer's row.
import { decode, fallback, object, optional, string } from "@extynt/decode";
import type { PingDirectResult } from "@extynt/host-native";
import { readApplyBreadcrumb } from "../native-snapshot/index.js";
import type { NativeReadScope, NativeReadSet } from "../native-snapshot/index.js";
import { queuedSpec, rememberIssuedRead } from "../read-queue.js";
import { postSnapshot } from "./apply-support.js";
import { foldRead, rememberLanded } from "./fold-read.js";
import type { Folded } from "./fold-read.js";
import type { HashMemory } from "./hash-memory.js";
import type { HostLaneContext, HostRunner, HostWorkData } from "./lane-types.js";
import { nativeScopeOf } from "./read-batch.js";
import { pingOf, readNative, type HostFailure, type ReadParts } from "./read-ops.js";
import { releaseFlight, reportFailure } from "./runner-support.js";

interface ReadRunnerDeps {
  hashes: HashMemory;
  scan(): void;
  queueCensus(): void;
}

const readIdField = object({ readId: optional(fallback(string({ nonEmpty: true, maxLength: 100 }), undefined)) });

function readIdOf(item: HostWorkData, context: HostLaneContext): string {
  const decoded = decode(readIdField, item);
  if (decoded.ok && decoded.value.readId !== undefined) return decoded.value.readId;
  context.state.readSequence += 1;
  return `read-${context.now().toString(36)}-${context.state.readSequence.toString(36)}`;
}

type Gathered = { ok: true; read: NativeReadSet } | { ok: false; failure: HostFailure };

async function gather(context: HostLaneContext, scope: NativeReadScope, requestId: string): Promise<Gathered> {
  const ping = await pingOf(context.client);
  if (!ping.ok) return ping;
  const parts = await readNative(context.client, scope);
  if (!parts.ok) return parts;
  return { ok: true, read: assemble(parts.value, ping.value, scope, requestId) };
}

function assemble(parts: ReadParts, ping: PingDirectResult, scope: NativeReadScope, requestId: string): NativeReadSet {
  return { stamp: parts.stamp, comps: parts.comps, ping, requestId, scope, ...(parts.project ? { project: parts.project } : {}) };
}

async function land(context: HostLaneContext, deps: ReadRunnerDeps, built: Folded): Promise<boolean> {
  const { envelope } = built;
  const outcome = await postSnapshot(context, envelope);
  if (outcome.outcome === "succeeded") { rememberLanded(deps.hashes, context, built); return true; }
  context.log("host.read-refused", { code: outcome.errorCode ?? null, requestId: envelope.requestId });
  return outcome.errorCode === "READ_NEEDS_FULL" || outcome.errorCode === "SUPERSEDED_SNAPSHOT";
}

async function perform(item: HostWorkData, context: HostLaneContext, deps: ReadRunnerDeps): Promise<void> {
  const { state } = context, spec = queuedSpec(item), requestId = readIdOf(item, context), scope = nativeScopeOf(spec.read);
  const awaiting = state.awaitingFreshSnapshotAfterPair, startedAt = context.now();
  rememberIssuedRead(state, { ...item, readId: requestId });
  const gathered = await gather(context, scope, requestId);
  if (!gathered.ok) { await reportFailure(context, "read", gathered.failure); return; }
  const breadcrumb = gathered.read.scope.kind === "full" ? readApplyBreadcrumb() : null;
  const built = await foldRead({ ctx: context, hashes: deps.hashes, read: gathered.read, touched: [], breadcrumb });
  if (built.failure) context.log("host.details-failed", { code: built.failure.code });
  const landed = await land(context, deps, built);
  context.log("host.read", { reason: spec.reason, scope: spec.read.scope, landed, ms: context.now() - startedAt, detailsFromStore: built.details.fromStore, detailsAsked: built.details.asked });
  if (landed && (awaiting || spec.includeEffects === true)) deps.queueCensus();
}

/** `refresh_snapshot`: whatever happens, the lane is released and the scheduler looks again, so an edit made during the read is not lost. */
export function createReadRunner(deps: ReadRunnerDeps): HostRunner {
  return async (item, context) => {
    try { await perform(item, context, deps); }
    finally { releaseFlight(context.state, "refresh_snapshot"); deps.scan(); }
  };
}
