// The native bridge's reserve and settle routes: the paired host asks for the lease before it touches After Effects natively and settles it afterwards.
import { decode, type Infer, jsonValue, type JsonValue, optional, strictObject, string } from "@extynt/decode";
import { jsonFieldsOf } from "@extynt/mcp-server";

import { accepted, refusedUncoded } from "./receiver-outcome.js";
import type { ReceiverOutcome } from "./receiver-types.js";
import { bindRelationalNativeApply } from "./relational-native-binding.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { suppliedPanel } from "./server-paired-panel.js";
import { jsonBody } from "./server-route-body.js";
import { outcomeReply } from "./server-route-outcome.js";
import { bodyRoute, type MountedRoute } from "./server-route-table.js";
import { errorEnvelope } from "./server-http-wire.js";

const BRIDGE_BODY_LIMIT_BYTES = 4_096;
const CODE_PATTERN = /^[A-Z_]{1,64}$/;
const NOT_CONFIRMED = "Native bridge admission or settlement was not confirmed. Native access remains blocked until exact settlement.";
const ADMISSION_REFUSED_CODES: ReadonlySet<string> = new Set(["STALE_PANEL_INSTANCE", "HOST_NATIVE_UNRESOLVED", "COLLECTION_BUSY", "STALE_COLLECTION_TICKET", "NATIVE_BRIDGE_INVALID_REQUEST", "NATIVE_BRIDGE_BUSY", "NATIVE_BRIDGE_ALREADY_SETTLED"]);

const reserveRequest = strictObject({ requestId: optional(string()), kind: optional(string()), collectionTicket: optional(string()) });

type ReserveRequest = Infer<typeof reserveRequest>;
type BridgeAction = "reserve" | "settle";
type BridgeResult = ReturnType<HttpRoutesDeps["state"]["nativeBridge"]["reserve"]> | ReturnType<HttpRoutesDeps["state"]["nativeBridge"]["settle"]>;

function bridgeOwner(deps: HttpRoutesDeps, call: { readonly action: BridgeAction; readonly owner: string | undefined }): string {
  const { state } = deps;
  if (!call.owner || (call.action === "reserve" && call.owner !== state.activePanelInstanceId)) throw Error("STALE_PANEL_INSTANCE");
  if (call.action === "reserve" && (state.inFlight?.nativeSettlement === "unknown" || state.collection.nativeAccessQuarantine())) throw Error("HOST_NATIVE_UNRESOLVED");
  return call.owner;
}

function admittedCollectionTicket(state: HttpRoutesDeps["state"], request: ReserveRequest): string | undefined {
  const admitted = state.collection.admittedNativeTicket();
  if (admitted && request.collectionTicket !== admitted) throw Error("COLLECTION_BUSY");
  if (request.collectionTicket !== undefined && (!admitted || request.kind !== "read")) throw Error("STALE_COLLECTION_TICKET");
  return admitted ?? undefined;
}

function logicalOwnerOf(state: HttpRoutesDeps["state"], admitted: string | undefined): { kind: string; id: string } | undefined {
  if (admitted) return { kind: "collection_page", id: admitted };
  const flight = state.inFlight;
  return flight ? { kind: flight.kind, id: flight.id } : undefined;
}

function reserveBridge(deps: HttpRoutesDeps, owner: string, request: ReserveRequest): BridgeResult {
  const { state } = deps;
  const admitted = admittedCollectionTicket(state, request);
  if (request.requestId !== undefined && state.nativeBridge.settledRequestMatches(owner, request.requestId)) throw Error("NATIVE_BRIDGE_ALREADY_SETTLED");
  if (request.kind === "mutation" && request.requestId !== undefined && !state.nativeBridge.activeRequestMatches(request.requestId)) {
    bindRelationalNativeApply({ state, owner, requestId: request.requestId, kind: request.kind, now: state.now().getTime() });
  }
  return state.nativeBridge.reserve(owner, jsonFieldsOf({ requestId: request.requestId, kind: request.kind }), logicalOwnerOf(state, admitted));
}

function settleLogicalOwner(deps: HttpRoutesDeps, result: BridgeResult, received: boolean): void {
  if (!("logicalOwner" in result) || !result.logicalOwner) return;
  deps.state.releaseNativeFlight(result.logicalOwner.id);
  if (result.logicalOwner.kind === "collection_page" && received) deps.state.collection.settleNativeAfterBridge(result.logicalOwner.id);
}

function publishBridgeResult(deps: HttpRoutesDeps, result: BridgeResult): void {
  if ("lease" in result && result.lease.kind === "mutation") deps.state.collection.invalidate();
  if (!("settled" in result)) return;
  try { deps.dispatch.wakeDeferredWorkflowContinuations(); }
  catch (error) { deps.dispatch.logPlanEvent("plan.workflow-continuation-schedule-failed", { nativeBridgeSettled: true, message: error instanceof Error ? error.message : String(error) }); }
}

function callbackReceived(body: JsonValue): boolean {
  return typeof body === "object" && body !== null && !Array.isArray(body) && "outcome" in body && body.outcome === "callback-received";
}

function bridgeRefusal(deps: HttpRoutesDeps, action: BridgeAction, message: string): ReceiverOutcome {
  const code = CODE_PATTERN.test(message) ? message : "NATIVE_BRIDGE_FAILED";
  const relationalRefused = code === "RELATIONAL_APPLY_BINDING_REFUSED" && deps.state.nativeBridge.accessQuarantine() === null;
  const refused = action === "reserve" && (relationalRefused || ADMISSION_REFUSED_CODES.has(code));
  return refusedUncoded(409, { ...errorEnvelope(code, NOT_CONFIRMED), ...(refused ? { nativeAdmission: "refused" } : {}) });
}

function answered(deps: HttpRoutesDeps, call: { readonly action: BridgeAction; readonly owner: string | undefined }, work: (owner: string) => BridgeResult): ReceiverOutcome {
  try {
    const result = work(bridgeOwner(deps, call));
    return finished(deps, result);
  } catch (error) { return bridgeRefusal(deps, call.action, error instanceof Error ? error.message : ""); }
}

function finished(deps: HttpRoutesDeps, result: BridgeResult): ReceiverOutcome {
  publishBridgeResult(deps, result);
  deps.dispatch.notifyChange();
  return accepted(200, { ...result });
}

function reserveNativeBridge(deps: HttpRoutesDeps, call: { readonly owner: string | undefined; readonly request: ReserveRequest }): ReceiverOutcome {
  return answered(deps, { action: "reserve", owner: call.owner }, (owner) => reserveBridge(deps, owner, call.request));
}

function settleNativeBridge(deps: HttpRoutesDeps, call: { readonly owner: string | undefined; readonly body: JsonValue }): ReceiverOutcome {
  return answered(deps, { action: "settle", owner: call.owner }, (owner) => {
    const result = deps.state.nativeBridge.settle(owner, call.body);
    settleLogicalOwner(deps, result, callbackReceived(call.body));
    return result;
  });
}

/** The native bridge receiver the host lane calls in process: it reserves or settles the lease for `owner`, and a reservation in any other shape is refused. */
export function acceptNativeBridge(deps: HttpRoutesDeps, call: { readonly action: BridgeAction; readonly body: JsonValue; readonly owner: string | undefined }): ReceiverOutcome {
  if (call.action === "settle") {
    const body = decode(jsonValue, call.body);
    return body.ok ? settleNativeBridge(deps, { owner: call.owner, body: body.value }) : bridgeRefusal(deps, "settle", "NATIVE_BRIDGE_FAILED");
  }
  const request = decode(reserveRequest, call.body);
  return request.ok ? reserveNativeBridge(deps, { owner: call.owner, request: request.value }) : bridgeRefusal(deps, "reserve", "NATIVE_BRIDGE_INVALID_REQUEST");
}

const NOT_JSON_OR_TOO_LARGE = { status: 409, code: "NATIVE_BRIDGE_FAILED", message: NOT_CONFIRMED } as const;
const INVALID_RESERVATION = { status: 409, code: "NATIVE_BRIDGE_INVALID_REQUEST", message: NOT_CONFIRMED, alongside: { nativeAdmission: "refused" } } as const;

/** The native bridge routes: `reserve` before a native call, `settle` after it. Both speak for the paired panel instance named in the request. */
export const nativeBridgeRoutes: readonly MountedRoute[] = [
  bodyRoute({
    method: "POST",
    path: "/v1/native-bridge/reserve",
    body: jsonBody(reserveRequest, BRIDGE_BODY_LIMIT_BYTES, INVALID_RESERVATION, { tooLarge: NOT_JSON_OR_TOO_LARGE, notJson: NOT_JSON_OR_TOO_LARGE }),
    handle: ({ deps, request, body }) => outcomeReply(reserveNativeBridge(deps, { owner: suppliedPanel(request) ?? undefined, request: body })),
  }),
  bodyRoute({
    method: "POST",
    path: "/v1/native-bridge/settle",
    body: jsonBody(jsonValue, BRIDGE_BODY_LIMIT_BYTES, NOT_JSON_OR_TOO_LARGE, { tooLarge: NOT_JSON_OR_TOO_LARGE, notJson: NOT_JSON_OR_TOO_LARGE }),
    handle: ({ deps, request, body }) => outcomeReply(settleNativeBridge(deps, { owner: suppliedPanel(request) ?? undefined, body })),
  }),
];
