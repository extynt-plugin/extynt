/**
 * Keeps a native mutation pinned to the lane that dispatched it once its outcome is unknown. A timeout or an unknown
 * dispatch leaves After Effects possibly still running the call, so the in-flight item is marked unsettled: only the exact
 * admitted mutation is pinned, never a pre-dispatch refusal or a settled host partial failure, and a later receipt cannot
 * release a pinned lane. Only a mutation report counts: a read that outlived its timeout cannot change the project, and its
 * late callback is ignored. A scheduler notification proves native uncertainty, unlike an apply_pending precheck receipt, so
 * the actual mutation identity is kept for its later receipt.
 */
import { decode, fallback, type Infer, type JsonObject, literal, object, string } from "@extynt/decode";
import type { StoredReceipt } from "@extynt/mcp-server";
import type { InFlightItem } from "./server-types.js";
import { opaque, type Opaque } from "./snapshot-view.js";

type AdmittedMutationLease = InFlightItem & { kind: "apply_plan" | "undo_plan" };

const UNSETTLED_CODES = new Set(["HOST_DISPATCH_UNKNOWN", "HOST_TIMEOUT", "HOST_HOP_TIMED_OUT"]);
const receiptFacts = object({ planId: opaque, status: opaque, mayHaveMutated: opaque, mutationState: opaque, hostError: fallback(object({ code: fallback(string(), undefined) }), undefined) });
const mutationReportShape = object({ kind: literal("mutation"), code: literal("HOST_TIMEOUT", "HOST_DISPATCH_UNKNOWN") });
type ReceiptFacts = Infer<typeof receiptFacts>;

function admittedLease(lease: InFlightItem | undefined): lease is AdmittedMutationLease {
  return !!lease && ["apply_plan", "undo_plan"].includes(lease.kind);
}

function mutationUnknown(lease: AdmittedMutationLease, receipt: ReceiptFacts): boolean {
  return lease.kind === "apply_plan"
    ? receipt.mayHaveMutated === true && receipt.mutationState === "unknown"
    : receipt.status === "unknown" && receipt.mayHaveMutated !== false;
}

function unsettledReceipt(receipt: JsonObject | StoredReceipt, lease: AdmittedMutationLease): { code: string; facts: ReceiptFacts } | undefined {
  const facts = decode(receiptFacts, receipt), code = facts.ok ? facts.value.hostError?.code : undefined;
  return facts.ok && code && UNSETTLED_CODES.has(code) && lease.id === facts.value.planId ? { code, facts: facts.value } : undefined;
}

/** Pins the in-flight item as unsettled when the receipt shows its admitted mutation may still be running. */
export function retainNativeMutationLease(state: { inFlight: InFlightItem | undefined; nativeBridge?: { activeLogicalMatches(kind: string, id: string): boolean } }, receipt: JsonObject | StoredReceipt): void {
  const lease = state.inFlight;
  if (!admittedLease(lease)) return;
  const found = unsettledReceipt(receipt, lease);
  if (!found || (state.nativeBridge && !state.nativeBridge.activeLogicalMatches(lease.kind, lease.id))) return;
  if (!mutationUnknown(lease, found.facts)) return;
  state.inFlight = { ...lease, nativeSettlement: "unknown", nativeErrorCode: found.code, nativeAccessKind: "mutation" };
}

/**
 * The block on all native access while a mutation is unsettled, or null. Consumers must treat a non-null value as blocking
 * all native access, even when the retained lease is a read.
 */
export function nativeMutationQuarantine(lease: InFlightItem | undefined) {
  return lease?.nativeSettlement === "unknown" ? {
    state: "unresolved", planId: lease.id, operation: lease.kind,
    accessKind: lease.nativeAccessKind ?? "mutation",
    code: lease.nativeErrorCode ?? "HOST_NATIVE_UNRESOLVED",
    message: "A native call may still be running. Do not retry, collect, apply, Undo or Redo. Wait for exact callback settlement; otherwise quit After Effects and obtain explicit local journal recovery. Restart and reconnect do not establish settlement.",
    recovery: "exact-callback-or-explicit-local-journal-recovery",
  } : null;
}

/** Marks the in-flight item unsettled when a mutation report says the native call timed out or may not have been dispatched; true when the report counts. */
export function recordUnknownNativeAccess(state: { inFlight: InFlightItem | undefined }, input: Opaque, now: number): boolean {
  const report = decode(mutationReportShape, input);
  if (!report.ok) return false;
  const current = state.inFlight;
  if (current?.nativeSettlement === "unknown") return true;
  state.inFlight = admittedLease(current)
    ? { ...current, nativeSettlement: "unknown", nativeErrorCode: report.value.code, nativeAccessKind: "mutation" }
    : { kind: "host_native_unknown", id: current?.id ?? "host-native-" + now, claimedAt: now, nativeSettlement: "unknown", nativeErrorCode: report.value.code, nativeAccessKind: "mutation" };
  return true;
}
