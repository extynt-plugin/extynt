/**
 * The in-process cores behind the sidecar's HTTP receivers. The HTTP handlers are thin wrappers over them, and the native
 * host lane calls them directly instead of posting to itself. Each core returns what its route answers: a status, a body
 * and the diagnostic outcome.
 */
import type { Opaque } from "./snapshot-view.js";

/** What a core answers: the HTTP status, the JSON body, the diagnostic outcome and, for a refusal, its error code. */
export interface ReceiverOutcome {
  status: number;
  body: Record<string, Opaque>;
  outcome: "succeeded" | "rejected" | "failed";
  errorCode?: string;
}

/**
 * The receivers, one core per route: POST /v1/snapshots, /v1/host-census, /v1/receipts, /v1/captures, /v1/panel/focus and
 * /v1/panel/events; /v1/pipeline (`beginApply` for apply-begin, `acceptPipelineEvent` for the other events); and the action
 * routes /v1/collection/{dispatch,prepare,complete,cancel}, /v1/catalogue/{start,complete} and /v1/native-bridge/{reserve,settle}.
 */
export interface InProcessReceivers {
  acceptSnapshot(read: Opaque, meta: { bytes: number; purpose?: "precheck"; planId?: string }): Promise<ReceiverOutcome>;
  acceptHostCensus(census: Opaque, bytes: number): Promise<ReceiverOutcome>;
  acceptReceipt(input: Opaque, hostInstanceId?: string): Promise<ReceiverOutcome>;
  beginApply(detail: string): Promise<ReceiverOutcome>;
  acceptPipelineEvent(event: Record<string, Opaque>): Promise<ReceiverOutcome>;
  acceptCapture(receipt: Opaque): Promise<ReceiverOutcome>;
  acceptFocus(body: Opaque): Promise<ReceiverOutcome>;
  acceptPanelEvent(body: Opaque): Promise<ReceiverOutcome>;
  collection(action: "dispatch" | "prepare" | "complete" | "cancel", body: Opaque): Promise<ReceiverOutcome>;
  catalogue(action: "start" | "complete", body: Opaque): Promise<ReceiverOutcome>;
  nativeBridge(action: "reserve" | "settle", body: Opaque): Promise<ReceiverOutcome>;
}
