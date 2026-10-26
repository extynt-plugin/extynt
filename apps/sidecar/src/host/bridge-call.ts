// A host call under a native bridge lease, for calls that must not overlap another native access or be retried when their outcome
// is unknown. When the answer never came back the lease stays open: a mutation that may still be running quarantines native access.
import type { CallOutcome, HostCallResult } from "@extynt/host-native";
import type { InFlightItem } from "../server-types.js";
import { quarantineUnknownMutation } from "./outcome.js";
import { reserveLease, settleLease, type BridgeLane, type LeaseOutcome, type NativeLease, type ReservationRequest } from "./lease.js";
import type { HostLaneContext } from "./lane-types.js";

/** What a leased call needs of its lane: the bridge receiver, the clock, the log and the in-flight slot a lost mutation quarantines. */
export interface LeaseContext extends BridgeLane {
  state: { inFlight: InFlightItem | undefined };
  now: HostLaneContext["now"];
  log: HostLaneContext["log"];
}

type CallResult = CallOutcome<HostCallResult>;
type LeasedKind = ReservationRequest["kind"];

type Leased =
  | { status: "refused"; code: string }
  | { status: "not-started" | "done" | "unknown"; outcome: CallResult };

const SCRIPT_MAY_HAVE_RUN = "SCRIPT_FAILED";

let sequence = 0;

function nextRequestId(now: number): string {
  sequence += 1;
  return `lane-${now.toString(36)}-${sequence.toString(36)}`;
}

function classify(outcome: CallResult, kind: LeasedKind): "done" | "not-started" | "unknown" {
  if (outcome.kind === "ok") return "done";
  if (outcome.kind === "refused") return kind === "mutation" && outcome.error.code === SCRIPT_MAY_HAVE_RUN ? "unknown" : "done";
  return outcome.sent ? "unknown" : "not-started";
}

async function settle(context: LeaseContext, lease: NativeLease, outcome: LeaseOutcome): Promise<void> {
  const code = await settleLease(context, lease, outcome);
  if (code !== null) context.log("host.bridge-settle-failed", { requestId: lease.requestId, code });
}

async function begin(context: LeaseContext, lease: NativeLease, call: () => Promise<CallResult>): Promise<CallResult> {
  let pending: Promise<CallResult>;
  try { pending = call(); } catch (error) {
    await settle(context, lease, "native-not-started");
    throw error;
  }
  return pending.catch((): CallResult => ({ kind: "lost", reason: "closed", sent: true, waitedMs: 0 }));
}

/**
 * Runs `call` under a lease of `request.kind`. A throw before the call returned a promise sent nothing: the lease settles as not
 * started and the throw goes on. A rejection came after the call began, so what it did is unknown and counts as an answer that never came.
 */
export async function leasedHostCall(context: LeaseContext, request: { kind: LeasedKind; collectionTicket?: string }, call: () => Promise<CallResult>): Promise<Leased> {
  const reservation = await reserveLease(context, { requestId: nextRequestId(context.now()), ...request });
  if (!reservation.ok) return { status: "refused", code: reservation.code };
  const outcome = await begin(context, reservation.lease, call), status = classify(outcome, request.kind);
  if (status === "unknown") {
    if (request.kind === "mutation") quarantineUnknownMutation(context, outcome.kind === "lost" && outcome.reason === "timeout" ? "HOST_TIMEOUT" : "HOST_DISPATCH_UNKNOWN");
    return { status, outcome };
  }
  await settle(context, reservation.lease, status === "not-started" ? "native-not-started" : "callback-received");
  return { status, outcome };
}
