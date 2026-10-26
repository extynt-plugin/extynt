// What an apply or undo whose answer is missing, or whose write never started, becomes: honest receipts, and the quarantine that keeps
// the lane from touching After Effects while an unresolved write may still be running.
import { recordUnknownNativeAccess } from "../native-mutation-lease.js";
import type { InFlightItem } from "../server-types.js";
import type { HostLaneContext } from "./lane-types.js";

export type LostReason = "timeout" | "closed" | "protocol" | "shutting-down";

type LostHostError = { code: "HOST_TIMEOUT" | "HOST_DISPATCH_UNKNOWN"; message: string };

type LostApplyReceipt = {
  planId: string | undefined;
  operation: "apply_plan";
  status: "rejected";
  postcondition: "partial_mutation_possible";
  appliedOperations: [];
  mayHaveMutated: true;
  mutationState: "unknown";
  hostError: LostHostError;
  approvalId?: string;
};

type LostUndoReceipt = {
  planId: string | undefined;
  operation: "undo_plan";
  status: "unknown";
  executed: false;
  mayHaveMutated: true;
  mutationState: "unknown";
  hostError: LostHostError;
};

const LOST_CODE = { timeout: "HOST_TIMEOUT", closed: "HOST_DISPATCH_UNKNOWN", protocol: "HOST_DISPATCH_UNKNOWN", "shutting-down": "HOST_DISPATCH_UNKNOWN" } as const satisfies Record<LostReason, LostHostError["code"]>;

const NEXT_STEP = {
  apply: "Treat the project as possibly changed. Do not retry or use Undo while the native call is unresolved.",
  undo: "Do not issue further Undo, Redo or retry while it is unresolved.",
} as const;

function lostError(reason: LostReason, what: keyof typeof NEXT_STEP): LostHostError {
  const cause = reason === "timeout" ? "did not answer in time" : "went away before it answered";
  const message = `After Effects ${cause}, so the sidecar cannot tell whether this ${what} ran. ${NEXT_STEP[what]} Inspect the project once After Effects is responsive again.`;
  return { code: LOST_CODE[reason], message };
}

/** The apply receipt for a write whose outcome is unknown; its vocabulary has no "unknown" status, so `mutationState` carries it, and the workflow reads it as an unknown execution, never as a failure. */
export function lostApplyReceipt(input: { planId: string | undefined; approvalToken: string | undefined; reason: LostReason }): LostApplyReceipt {
  return {
    planId: input.planId, operation: "apply_plan", status: "rejected", postcondition: "partial_mutation_possible", appliedOperations: [], mayHaveMutated: true, mutationState: "unknown",
    hostError: lostError(input.reason, "apply"), ...(input.approvalToken ? { approvalId: input.approvalToken } : {}),
  };
}

/** The undo receipt for a write whose outcome is unknown. */
export function lostUndoReceipt(planId: string | undefined, reason: LostReason): LostUndoReceipt {
  return { planId, operation: "undo_plan", status: "unknown", executed: false, mayHaveMutated: true, mutationState: "unknown", hostError: lostError(reason, "undo") };
}

/** Pins the lane: nothing runs against After Effects until the write settles (a new connection retires it). */
export function quarantineUnknownMutation(ctx: { state: { inFlight: InFlightItem | undefined }; now: HostLaneContext["now"] }, code: string): void {
  recordUnknownNativeAccess(ctx.state, { kind: "mutation", code: code === "HOST_TIMEOUT" ? "HOST_TIMEOUT" : "HOST_DISPATCH_UNKNOWN" }, ctx.now());
}

const NOT_STARTED_CODES: ReadonlySet<string> = new Set(["BAD_REQUEST", "BAD_JSON", "UNKNOWN_OP", "REQUEST_TOO_LARGE", "NO_PROJECT", "ENTRY_NOT_ALLOWED", "LIBRARY_NOT_FOUND", "LIBRARY_VERSION_INVALID", "LIBRARY_LOAD_FAILED", "SCRIPT_ENGINE_NOT_READY", "HOST_MODAL_DIALOG", "UNAUTHORIZED", "ENGINE_REFUSED"]);

/** True when the plugin refused the batch or the entry before running it, so the write certainly did not happen. */
export function writeNotStarted(code: string): boolean {
  return NOT_STARTED_CODES.has(code);
}
