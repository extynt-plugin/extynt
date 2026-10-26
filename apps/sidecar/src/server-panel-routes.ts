// The routes only the paired panel calls: collection pages, panel and pipeline events, the host-closing signal and the plans ready for it.
import { isJsonObject, jsonValue, type JsonValue, literal, object } from "@extynt/decode";

import type { HttpRoutesDeps } from "./server-http-state.js";
import { isPairedPanel, requirePairedPanel, suppliedPanel } from "./server-paired-panel.js";
import { acceptCollection, staleCollectionPanel } from "./server-collection-receiver.js";
import { jsonBody, uniformBody, type Refusal } from "./server-route-body.js";
import { outcomeReply } from "./server-route-outcome.js";
import { answer, bodyRoute, ok, route, type Exchange, type MountedRoute } from "./server-route-table.js";
import { errorEnvelope } from "./server-http-wire.js";

const COLLECTION_ACTIONS = ["dispatch", "prepare", "complete", "cancel"] as const;
const COLLECTION_BODY_LIMIT_BYTES = 262_144;
const EVENT_BODY_LIMIT_BYTES = 8_000;
const SHUTDOWN_BODY_LIMIT_BYTES = 1_024;
const UNCERTAINTY_CODES: ReadonlySet<string> = new Set(["HOST_NATIVE_UNRESOLVED", "PREVIEW_RESTORE_UNCONFIRMED"]);

const COLLECTION_FAILED: Refusal = { status: 409, code: "COLLECTION_FAILED", message: "Collection unavailable; details remain unknown." };
const shutdownSignal = object({ schemaVersion: literal("0.1"), reason: literal("cep-host-closing") });
const INVALID_SHUTDOWN: Refusal = { status: 422, code: "INVALID_SHUTDOWN_SIGNAL", message: "Expected schemaVersion 0.1 and reason cep-host-closing." };

function eventBody(label: string) {
  return jsonBody(jsonValue, EVENT_BODY_LIMIT_BYTES, { status: 400, code: "INVALID_JSON", message: `${label} must be valid JSON.` }, { tooLarge: { status: 413, code: "BODY_LIMIT", message: `${label} exceeded the limit.` } });
}

function reportsNativeUncertainty(event: JsonValue): boolean {
  if (!isJsonObject(event)) return false;
  const code = event.code;
  return typeof code === "string" && UNCERTAINTY_CODES.has(code);
}

function pipelineEventOf(body: JsonValue): { readonly [key: string]: JsonValue } {
  return isJsonObject(body) ? body : {};
}

function shutdownRefusal(active: string | undefined, supplied: string | null): Refusal | null {
  if (!active) return { status: 409, code: "PANEL_NOT_PAIRED", message: "Pair this CEP panel instance before sending the host-closing signal." };
  if (!supplied) return { status: 409, code: "PANEL_INSTANCE_REQUIRED", message: "The host-closing signal requires the paired X-AE-Panel-Instance header." };
  return supplied === active ? null : { status: 409, code: "STALE_PANEL_INSTANCE", message: "Only the currently paired CEP panel instance may stop this sidecar." };
}

function pairedForShutdown(deps: HttpRoutesDeps, exchange: Exchange): Refusal | null {
  return shutdownRefusal(deps.state.activePanelInstanceId, suppliedPanel(exchange.request));
}

function scheduleShutdown(deps: HttpRoutesDeps, exchange: Exchange): void {
  const { state } = deps;
  const panelInstanceId = state.activePanelInstanceId;
  if (state.shutdownRequested !== null || panelInstanceId === undefined) return;
  state.shutdownRequested = { panelInstanceId, requestedAt: state.now().toISOString(), reason: "cep-host-closing" };
  state.eventLog("panel.shutdown-received", { reason: "cep-host-closing" });
  const closed = () => state.options.onHostClosed?.();
  exchange.response.once("finish", () => setImmediate(() => { void deps.dispatch.stop().then(closed, closed); }));
}

function collectionRoute(action: (typeof COLLECTION_ACTIONS)[number]): MountedRoute {
  return bodyRoute({
    method: "POST",
    path: `/v1/collection/${action}`,
    guard: requirePairedPanel("Collection requires the paired panel instance."),
    body: uniformBody(jsonValue, COLLECTION_BODY_LIMIT_BYTES, COLLECTION_FAILED),
    handle: ({ deps, request, body }) => {
      const panel = suppliedPanel(request);
      if (panel === null) return outcomeReply(staleCollectionPanel());
      deps.state.collection.pair(panel);
      return outcomeReply(acceptCollection(deps, { action, body, panel }));
    },
  });
}

/** Collection dispatch, prepare, complete and cancel; panel and pipeline events; the host-closing signal; and the plans the panel may claim. */
export const panelRoutes: readonly MountedRoute[] = [
  ...COLLECTION_ACTIONS.map(collectionRoute),
  route({ method: "GET", path: "/v1/chat/plans/ready", handle: ({ deps }) => ok(deps.dispatch.claimReadyPlans()) }),
  bodyRoute({
    method: "POST",
    path: "/v1/panel/events",
    body: eventBody("Panel event"),
    handle: ({ deps, request, body }) => {
      const unpaired = reportsNativeUncertainty(body) && !isPairedPanel(deps.state, request);
      if (unpaired) return answer(409, errorEnvelope("STALE_PANEL_INSTANCE", "Only the currently paired authenticated panel may report native dispatch uncertainty."), "rejected");
      return outcomeReply(deps.dispatch.acceptPanelEvent(body));
    },
  }),
  bodyRoute({
    method: "POST",
    path: "/v1/pipeline",
    body: eventBody("Pipeline event"),
    handle: ({ deps, body }) => outcomeReply(deps.dispatch.acceptPipelineEvent(pipelineEventOf(body))),
  }),
  bodyRoute({
    method: "POST",
    path: "/v1/panel/shutdown",
    guard: pairedForShutdown,
    body: jsonBody(shutdownSignal, SHUTDOWN_BODY_LIMIT_BYTES, INVALID_SHUTDOWN, { tooLarge: { status: 413, code: "BODY_LIMIT", message: "The host-closing signal exceeded the limit." }, notJson: { status: 400, code: "INVALID_JSON", message: "The host-closing signal must be valid JSON." } }),
    handle: (call) => {
      scheduleShutdown(call.deps, call);
      return answer(202, { ok: true, shuttingDown: true });
    },
  }),
];
