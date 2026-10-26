// The collection receiver: the paired host's collection calls (prepare, complete, dispatch, cancel) and what is stored when one of them returns a scoped snapshot.
import { decode, object, string, presentFields, type JsonValue } from "@extynt/decode";

import { approximateBytes } from "./approximate-bytes.js";
import { collectionLaneBusy } from "./collection-lane-busy.js";
import { accepted, refusedUncoded } from "./receiver-outcome.js";
import type { InProcessReceivers, ReceiverOutcome } from "./receiver-types.js";
import { storeSnapshot, type HttpRoutesDeps } from "./server-http-state.js";
import { errorEnvelope } from "./server-http-wire.js";
import { probeSnapshot } from "./server-probe-wire.js";

type CollectionAction = Parameters<InProcessReceivers["collection"]>[0];

type CollectionCall<Body extends JsonValue> = { action: CollectionAction; body: Body; panel: string };

const ticketShape = object({ ticket: string() });
const COLLECTION_CODE = /^[A-Z_]{1,64}$/;

function collectionResult<Body extends JsonValue>(deps: HttpRoutesDeps, body: Body, action: CollectionAction) {
  if (action === "prepare") return deps.state.collection.prepare(body, !!deps.state.nativeBridge.accessQuarantine() || collectionLaneBusy(deps.state));
  if (action === "complete") return deps.state.collection.complete(body);
  if (action === "dispatch") return deps.state.collection.authorizeDispatch(body);
  deps.state.collection.cancel(body);
  return { ok: true };
}

function releaseSettledTicket(deps: HttpRoutesDeps, ticket: string | undefined): void {
  const inFlight = deps.state.inFlight;
  if (ticket && inFlight?.kind === "collection_page" && inFlight.id === ticket && !deps.state.collection.hasUnsettled(ticket)) deps.state.inFlight = undefined;
}

function storeScopedSnapshot(deps: HttpRoutesDeps, result: ReturnType<typeof collectionResult>): void {
  if (!("snapshot" in result)) return;
  const decoded = decode(probeSnapshot, result.snapshot);
  if (decoded.ok) storeSnapshot(deps, decoded.value, approximateBytes(result.snapshot), deps.state.now().toISOString());
}

function collectionFailure(deps: HttpRoutesDeps, call: { action: CollectionAction; ticket?: string }, code: string): ReceiverOutcome {
  if (call.ticket && call.action === "complete") deps.state.collection.failDemand(call.ticket, code);
  releaseSettledTicket(deps, call.ticket);
  deps.dispatch.notifyChange();
  return refusedUncoded(409, errorEnvelope(COLLECTION_CODE.test(code) ? code : "COLLECTION_FAILED", "Collection unavailable; details remain unknown."));
}

/** The collection receiver for the paired host `call.panel`, which must still be the active one when the work runs. */
export function acceptCollection<Body extends JsonValue>(deps: HttpRoutesDeps, call: CollectionCall<Body>): ReceiverOutcome {
  const decoded = decode(ticketShape, call.body);
  const ticket = decoded.ok ? decoded.value.ticket : undefined;
  try {
    if (call.panel !== deps.state.activePanelInstanceId) throw new Error("STALE_PANEL_INSTANCE");
    const result = collectionResult(deps, call.body, call.action);
    releaseSettledTicket(deps, ticket);
    storeScopedSnapshot(deps, result);
    deps.dispatch.notifyChange();
    return accepted(200, { ...result });
  } catch (error) {
    return collectionFailure(deps, presentFields({ action: call.action, ticket }), error instanceof Error ? error.message : "COLLECTION_FAILED");
  }
}

/** The refusal for a collection call from a host that is not the paired one. */
export function staleCollectionPanel(): ReceiverOutcome {
  return refusedUncoded(409, errorEnvelope("STALE_PANEL_INSTANCE", "Collection requires the paired panel instance."));
}

/** A collection call from whichever host is active now; refused when none is paired. */
export function collectionAsActiveHost<Body extends JsonValue>(deps: HttpRoutesDeps, action: CollectionAction, body: Body): ReceiverOutcome {
  const panel = deps.state.activePanelInstanceId;
  if (!panel) return staleCollectionPanel();
  deps.state.collection.pair(panel);
  return acceptCollection(deps, { action, body, panel });
}
