// The agent-visible pipeline: the state of the panel, the queue, the connected host and the host's last censuses.
import { decodeOrThrow, wireJson, type JsonObject, type JsonValue } from "@extynt/decode";
import type { StoredPlan } from "@extynt/mcp-server";

import type { SidecarState } from "./server-state.js";
import type { HostLinkStatus } from "./host/lane-types.js";
import { statusView, type HostCheck } from "./host/facts.js";

type PipelineViewState = Pick<SidecarState, "agentMailbox" | "hostFacts" | "hostLink" | "inFlight" | "now" | "panel" | "plans" | "readyPlanQueueLimit" | "readyPlans">;

const RECENT_ERROR_MS = 300_000;
const MILLISECONDS = 1000;

function checkView(check: HostCheck | null): JsonObject | null {
  if (!check) return null;
  const at = new Date(check.at).toISOString();
  return check.ok ? { ok: true, at } : { ok: false, code: check.code, message: check.message, at };
}

/** The effects census, the fonts census (which finishes later, so `census.ok` is not "fonts are loaded") and the script library as the host last answered; null before either has been tried, so a failure that only reached the log is never silent. */
export function hostLibraryView(state: Pick<SidecarState, "hostFacts">): JsonObject | null {
  const { census, library } = state.hostFacts.checks;
  const fonts = state.hostFacts.fonts;
  if (!census && !library) return null;
  return { ok: census?.ok !== false && library?.ok !== false, census: checkView(census), library: checkView(library), fonts: { state: fonts.phase, ...(fonts.code ? { code: fonts.code } : {}) } };
}

function panelViewOf(link: HostLinkStatus, working: boolean): string {
  if (link.state === "stalled") return link.stall?.verdict === "plugin-unresponsive" ? "unresponsive" : "stalled";
  if (link.state !== "online") return "offline";
  return working || link.busyKind ? "busy" : "idle";
}

/** What the agent is told about the connected After Effects: its version family and the typed capabilities that differ between 25 and 26, never a bare version string it would have to interpret. */
export function hostIdentityView(host: HostLinkStatus["host"]): JsonObject | null {
  if (!host) return null;
  const { source, version, family, supported, measured, experimental, capabilities } = host;
  const experimentalNote = "This After Effects release is newer than any extynt has been tested on. It runs, but treat every read-back as the only evidence and tell the user it is experimental.";
  const unmeasuredNote = "Behaviour on this After Effects release has not been measured; a read-back that disagrees is evidence, not a bug in the plan.";
  return { source, version, family, supported, measured, experimental, capabilities: decodeOrThrow(wireJson, capabilities), ...(experimental ? { experimentalNote } : {}), ...(measured ? {} : { unmeasuredNote }) };
}

/** The version and SVG route of the plugin that is connected right now; null with no plugin. */
export function liveHostOf(host: HostLinkStatus["host"]): { version: string; svgImport: "native" | "converter" | "unknown" } | null {
  return host ? { version: host.version, svgImport: host.capabilities.svgImport } : null;
}

function stallView(stall: NonNullable<HostLinkStatus["stall"]>): JsonObject {
  return { verdict: stall.verdict, waitedSeconds: Math.round(stall.waitedMs / MILLISECONDS), idleAgeMs: stall.idleAgeMs, ...(stall.dialog ? { waitingOnDialog: stall.dialog.title } : {}) };
}

function nativeHostFacts(link: HostLinkStatus): JsonObject {
  return { state: link.state, reason: link.reason ?? null, pluginVersion: link.pluginVersion, aeVersion: link.aeVersion, host: hostIdentityView(link.host), ...(link.stall ? { stall: stallView(link.stall) } : {}) };
}

/** True for a plan settled (applied, undone, in flight) before the current plugin instance paired: After Effects has restarted since, so what it did there is history, not state. */
export function fromEarlierSession(state: Pick<SidecarState, "hostFacts">, record: StoredPlan | undefined): boolean {
  const pairedAt = state.hostFacts.pairedAt;
  if (pairedAt === null || !record) return false;
  const settled = record.receipt || record.undoReceipt || record.status === "applying" || record.status === "undo_requested";
  return !!settled && Date.parse(record.updatedAt) < pairedAt;
}

function queueView(state: PipelineViewState): JsonObject {
  const earlier = state.readyPlans.filter((entry) => fromEarlierSession(state, state.plans.get(entry.planId))).length;
  const waiting = state.readyPlans.length - earlier;
  const fullNote = "The commit queue is full; commit or discard the waiting batches before sealing more.";
  const earlierNote = "Applied on an earlier After Effects session; whether they are still applied there is unknown, and they are not waiting.";
  return {
    ...(earlier ? { readyPlansFromEarlierSession: { count: earlier, note: earlierNote } } : {}),
    ...(waiting ? { readyPlans: { waiting, limit: state.readyPlanQueueLimit, ...(waiting >= state.readyPlanQueueLimit ? { full: true, action: fullNote } : {}) } } : {}),
  };
}

function activityView(state: PipelineViewState, link: HostLinkStatus): JsonObject {
  const now = state.now().getTime();
  const working = state.inFlight ? `${state.inFlight.kind} ${state.inFlight.id}` : link.busyKind;
  const error = state.panel.lastError;
  const busy: JsonObject = working ? { working, busySeconds: Math.round((now - (link.busySince ?? state.inFlight?.claimedAt ?? now)) / MILLISECONDS) } : {};
  return { ...busy, ...(error && now - error.at < RECENT_ERROR_MS ? { lastError: { code: error.code, message: error.message } } : {}) };
}

function hintView(link: HostLinkStatus, panel: string): { hint?: string } {
  const hint = statusView(link).message;
  if (!hint) return {};
  return { hint: panel === "offline" ? `${hint} The sidecar connects by itself when After Effects is running.` : hint };
}

/** The pipeline as the agent sees it when the host is the native plugin: the link's state stands in for the panel's last poll. */
export function nativePipeline(state: PipelineViewState): JsonObject {
  const link = state.hostLink.status();
  const panel = panelViewOf(link, state.inFlight !== undefined);
  const view: { [key: string]: JsonValue } = { panel, queued: state.agentMailbox.length, host: nativeHostFacts(link) };
  return { ...view, ...queueView(state), ...activityView(state, link), ...hintView(link, panel) };
}
