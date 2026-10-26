// The `collection_page` runner: one bounded page of the collection graph (index, detail, value, blur control or effect
// creation). The order is the panel's (`panel-apply.ts`, runMailboxCollection): admit the ticket, reserve the bridge lease with
// the ticket, run the host function, settle, and complete the ticket with the page or with the proof that nothing started.
import { decode, decodeJson, type Infer, type JsonObject, literal, object, refine, string } from "@extynt/decode";
import type { CallOutcome, HostCallResult } from "@extynt/host-native";
import { opaque } from "../snapshot-view.js";
import { rowDecoder } from "../verify/json-fields.js";
import { leasedHostCall } from "./bridge-call.js";
import type { HostLaneContext, HostRunner, HostWorkData } from "./lane-types.js";
import { releaseFlight } from "./runner-support.js";

const NOT_SENT: CallOutcome<HostCallResult> = { kind: "lost", reason: "closed", sent: false, waitedMs: 0 };

const dispatchShape = object({
  ticket: string(),
  hostRequest: rowDecoder,
  hostFunction: literal("aeCollectIndexPage", "aeCollectDetailPage", "aeCollectValuePage", "aeCollectBlurControl", "aeCollectEffectCreation"),
  generation: opaque,
});
type Dispatch = Infer<typeof dispatchShape>;
const matchesTicket = (dispatch: Dispatch): dispatch is Dispatch => dispatch.hostRequest.requestId === dispatch.ticket;
const collectionItem = object({ dispatch: refine(dispatchShape, matchesTicket, "a request that carries the ticket as its requestId") });
const ticketOnly = object({ dispatch: object({ ticket: string() }) });

function ticketOf(item: HostWorkData): string | undefined {
  const decoded = decode(ticketOnly, item);
  return decoded.ok ? decoded.value.dispatch.ticket : undefined;
}

function notStarted(dispatch: Dispatch): JsonObject {
  const { generation } = dispatch;
  return { ticket: dispatch.ticket, outcome: { schemaVersion: "collection-dispatch-outcome/1", kind: "native-not-started", requestId: dispatch.ticket, ...(generation === undefined ? {} : { generation }) } };
}

function pageOf(text: string): JsonObject {
  const decoded = decodeJson(text, rowDecoder);
  return decoded.ok ? decoded.value : { ok: false, error: { code: "INVALID_PAGE" } };
}

async function readPage(dispatch: Dispatch, context: HostLaneContext): Promise<CallOutcome<HostCallResult>> {
  if (!context.state.collection.dispatchCurrent(dispatch.ticket)) return NOT_SENT;
  return context.client.hostCall(dispatch.hostFunction, dispatch.hostRequest);
}

function failedPage(outcome: Exclude<CallOutcome<HostCallResult>, { kind: "ok" }>): JsonObject {
  const code = outcome.kind === "refused" ? outcome.error.code : outcome.reason === "timeout" ? "HOST_TIMEOUT" : "HOST_DISPATCH_UNKNOWN";
  return { ok: false, error: { code, ...(outcome.kind === "refused" ? { message: outcome.error.message.slice(0, 256) } : {}) } };
}

async function runPage(dispatch: Dispatch, context: HostLaneContext): Promise<JsonObject> {
  const leased = await leasedHostCall(context, { kind: "read", collectionTicket: dispatch.ticket }, () => readPage(dispatch, context));
  if (leased.status === "refused" || leased.status === "not-started") return notStarted(dispatch);
  const { outcome } = leased;
  return { ticket: dispatch.ticket, page: outcome.kind === "ok" ? pageOf(outcome.result.result) : failedPage(outcome) };
}

async function refuseInvalid(item: HostWorkData, context: HostLaneContext): Promise<void> {
  await context.receivers.acceptPanelEvent({ code: "INVALID_COLLECTION_DISPATCH", message: "Invalid bounded collection mailbox envelope." });
  const ticket = ticketOf(item);
  if (ticket) await context.receivers.collection("cancel", { ticket, undispatched: true });
}

async function admit(dispatch: Dispatch, context: HostLaneContext): Promise<boolean> {
  const admitted = await context.receivers.collection("dispatch", { ticket: dispatch.ticket });
  if (admitted.outcome === "succeeded") return true;
  if (context.state.collection.hasUnsettled(dispatch.ticket)) await context.receivers.collection("cancel", { ticket: dispatch.ticket, undispatched: true });
  await context.receivers.acceptPanelEvent({ code: "COLLECTION_DISPATCH_UNKNOWN", message: "Ticket admission was not confirmed; no native retry was sent." });
  return false;
}

async function perform(item: HostWorkData, context: HostLaneContext): Promise<void> {
  const decoded = decode(collectionItem, item);
  if (!decoded.ok) { await refuseInvalid(item, context); return; }
  const { dispatch } = decoded.value;
  if (context.link.status().state !== "online") { await context.receivers.collection("cancel", { ticket: dispatch.ticket, undispatched: true }); return; }
  if (!(await admit(dispatch, context))) return;
  const done = await context.receivers.collection("complete", await runPage(dispatch, context));
  context.log("host.collection", { entry: dispatch.hostFunction, completed: done.outcome === "succeeded", code: done.errorCode ?? null });
}

/** The runner for `collection_page` items. */
export const runCollection: HostRunner = async (item, context) => {
  try { await perform(item, context); }
  finally { releaseFlight(context.state, "collection_page", ticketOf(item)); }
};
