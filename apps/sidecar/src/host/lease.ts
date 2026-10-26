// The native bridge lease: reserved before a call that must not overlap other native access, settled once the plugin has answered
// (or has certainly not started). A call whose answer never came is never settled: it stays quarantined.
import { randomUUID } from "node:crypto";
import { boolean, decode, type Infer, literal, object, optional, string } from "@extynt/decode";
import { jsonFieldsOf } from "@extynt/mcp-server";
import type { InProcessReceivers, ReceiverOutcome } from "../receiver-types.js";

export type LeaseOutcome = "callback-received" | "native-not-started";

const leaseDecoder = object({ leaseId: string(), settlementToken: string(), epoch: string(), owner: string(), requestId: string(), kind: literal("read", "mutation") });
const bridgeError = object({ code: optional(string()), message: optional(string()) });
const reserveReply = object({ ok: optional(boolean()), lease: optional(leaseDecoder), error: optional(bridgeError) });
const settleReply = object({ ok: optional(boolean()), settled: optional(boolean()), error: optional(bridgeError) });

/** The lease the bridge granted, exactly as it must be handed back to settle it. */
export type NativeLease = Infer<typeof leaseDecoder>;

interface Refusal { ok: false; code: string; message: string }

type Reservation = { ok: true; lease: NativeLease } | Refusal;

export interface ReservationRequest { requestId: string; kind: NativeLease["kind"]; collectionTicket?: string }

/** The part of a lane a lease needs: the bridge receiver. */
export type BridgeLane = { receivers: Pick<InProcessReceivers, "nativeBridge"> };

const REFUSED: Refusal = { ok: false, code: "NATIVE_BRIDGE_FAILED", message: "The native bridge did not admit this mutation." };
const BUSY = "NATIVE_BRIDGE_BUSY";
const SETTLE_RETRY_DELAYS_MS = [50, 100, 200];

const pause = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

function refusalOf(reply: { error?: Infer<typeof bridgeError> | undefined }): Refusal {
  return { ok: false, code: reply.error?.code ?? REFUSED.code, message: reply.error?.message ?? REFUSED.message };
}

function reservationOf(answer: ReceiverOutcome, requestId: string): Reservation {
  const reply = decode(reserveReply, answer.body);
  if (!reply.ok) return REFUSED;
  const { ok, lease } = reply.value;
  return ok === true && lease?.requestId === requestId ? { ok: true, lease } : refusalOf(reply.value);
}

/** Reserves a lease for one call; refused while an earlier mutation is unresolved. */
export async function reserveLease(lane: BridgeLane, request: ReservationRequest): Promise<Reservation> {
  const answer = await lane.receivers.nativeBridge("reserve", jsonFieldsOf(request));
  return reservationOf(answer, request.requestId);
}

/** Reserves the lease for one write, named `label` in the log. */
export function reserveMutation(lane: BridgeLane, label: string): Promise<Reservation> {
  return reserveLease(lane, { requestId: `${label}-${randomUUID().slice(0, 12)}`, kind: "mutation" });
}

/** The code that explains an unsettled lease, or null once the sidecar recorded the settlement. A busy journal lock is retried a bounded number of times. */
export async function settleLease(lane: BridgeLane, lease: NativeLease, outcome: LeaseOutcome): Promise<string | null> {
  for (let attempt = 0; ; attempt += 1) {
    const answer = await lane.receivers.nativeBridge("settle", { lease, outcome });
    const reply = decode(settleReply, answer.body);
    if (reply.ok && reply.value.ok === true && reply.value.settled === true) return null;
    const code = reply.ok ? refusalOf(reply.value).code : REFUSED.code, delay = SETTLE_RETRY_DELAYS_MS[attempt];
    if (delay === undefined || code !== BUSY) return code;
    await pause(delay);
  }
}

/** True once the sidecar recorded the settlement. */
export async function settleNativeLease(lane: BridgeLane, lease: NativeLease, outcome: LeaseOutcome): Promise<boolean> {
  return (await settleLease(lane, lease, outcome)) === null;
}

