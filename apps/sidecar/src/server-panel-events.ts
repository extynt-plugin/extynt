// Panel and pipeline events from the host: failures it reports for the status surface, and the apply-begin claim handed to apply admission.
import { decode, fallback, object, optional, refine, string } from "@extynt/decode";

import { recordUnknownNativeAccess } from "./native-mutation-lease.js";
import { accepted, refused } from "./receiver-outcome.js";
import type { ReceiverOutcome } from "./receiver-types.js";
import { beginPipelineApply, type PipelineApplyDeps } from "./server-pipeline-apply.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { HttpCoreCapability } from "./server-http-core.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import type { SidecarState } from "./server-state.js";
import { boundedHostError } from "./server-host-error.js";

/** The panel and pipeline event receivers. */
export interface PanelEventsCapability {
  acceptPanelEvent<Body>(body: Body): ReceiverOutcome;
  acceptPipelineEvent<Event>(event: Event): ReceiverOutcome;
  beginApply(detail: string): ReceiverOutcome;
}

type PanelEventsDeps = PipelineApplyDeps & {
  readonly state: Pick<SidecarState, "latest" | "normalizedCache" | "awaitingFreshSnapshotAfterPair" | "panel">;
  readonly planState: Pick<PlanStateCapability, "markPanelSeen">;
  readonly planLog: Pick<PlanLogCapability, "logPlanEvent">;
  readonly transport: Pick<HttpCoreCapability, "notifyChange">;
};

const hostFailure = object({
  code: refine(string(), (given): given is string => /^[A-Z0-9_]{1,64}$/.test(given), "an upper-case code"),
  message: string(),
  nativeLease: fallback(object({ requestId: optional(string()) }), undefined),
});

const pipelineEvent = object({
  event: fallback(string(), undefined),
  detail: fallback(string(), undefined),
});

function invalidateObservations(deps: PanelEventsDeps): void {
  const { state } = deps;
  state.collection.invalidate();
  state.latest = undefined;
  state.normalizedCache = undefined;
  state.awaitingFreshSnapshotAfterPair = true;
}

function retireObservations(deps: PanelEventsDeps, code: string): void {
  if (code !== "PREVIEW_RESTORE_UNCONFIRMED") return;
  recordUnknownNativeAccess(deps.state, { kind: "mutation", code: "HOST_DISPATCH_UNKNOWN" }, deps.state.now().getTime());
  invalidateObservations(deps);
}

function acceptPipelineEvent<Event>(deps: PanelEventsDeps, reported: Event): ReceiverOutcome {
  const decoded = decode(pipelineEvent, reported);
  const fields = decoded.ok ? decoded.value : { event: undefined, detail: undefined };
  if (fields.event === undefined || !/^[a-z0-9-]{1,64}$/.test(fields.event)) return refused(422, "INVALID_PIPELINE_EVENT", "Pipeline events require a lowercase event name.");
  deps.planLog.logPlanEvent(`panel.${fields.event}`, fields.detail === undefined ? {} : { detail: fields.detail.slice(0, 256) });
  if (fields.event === "apply-begin" && fields.detail !== undefined) return beginPipelineApply(deps, fields.detail);
  return accepted(200, { ok: true });
}

function acceptPanelEvent<Body>(deps: PanelEventsDeps, body: Body): ReceiverOutcome {
  const decoded = decode(hostFailure, body);
  if (!decoded.ok) return refused(422, "INVALID_PANEL_EVENT", "Panel events require a code and message.");
  const { code, message, nativeLease } = decoded.value;
  const { state } = deps;
  if (code === "HOST_NATIVE_UNRESOLVED") {
    if (!state.nativeBridge.activeRequestMatches(nativeLease?.requestId)) return accepted(201, { ok: true, ignored: true });
    invalidateObservations(deps);
  }
  retireObservations(deps, code);
  deps.planState.markPanelSeen();
  state.panel.lastError = { ...(boundedHostError({ code, message }) ?? { code, message }), at: state.now().getTime() };
  if (state.inFlight?.kind === "refresh_snapshot") state.inFlight = undefined;
  deps.transport.notifyChange();
  return accepted(201, { ok: true });
}

/** The panel and pipeline event receivers over the plans, the shared dispatch lane and the current snapshot. */
export function createPanelEvents(deps: PanelEventsDeps): PanelEventsCapability {
  return {
    acceptPanelEvent: (body) => acceptPanelEvent(deps, body),
    acceptPipelineEvent: (event) => acceptPipelineEvent(deps, event),
    beginApply: (detail) => beginPipelineApply(deps, detail),
  };
}
