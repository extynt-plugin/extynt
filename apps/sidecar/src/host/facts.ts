// Facts the native host lane keeps beside the plan store, and the one hook it publishes UI-visible changes through.
import { stampOf } from "../snapshot-merge.js";
import type { StoredSnapshot } from "../server-types.js";
import type { HostLink, HostLinkStatus } from "./lane-types.js";

/** AE's project stamp: the plugin's epoch and `app.project.revision`. */
export interface HostStamp { epoch: number; revision: number }

/** Who asked for a change: the extynt panel (its chat and Apply button), or an external agent over MCP. */
export type PlanSource = "panel" | "agent";

/** The last answer of a host check (epoch ms in `at`): a census that ran, or the script library failing to load. */
export type HostCheck = { ok: true; at: number } | { ok: false; code: string; message: string; at: number };

interface HostChecks { census: HostCheck | null; library: HostCheck | null }

interface FontsFact { phase: "unknown" | "pending" | "loading" | "ready" | "failed"; at: number | null; code?: string }

interface LayerStylesFact { state: "unknown" | "available" | "unavailable"; at: number | null; probing: boolean }

export interface HostFacts {
  checks: HostChecks;
  fonts: FontsFact;
  layerStyles: LayerStylesFact;
  pairedAt: number | null;
  afterStamps: Map<string, HostStamp>;
  planSources: Map<string, PlanSource>;
  capturePlan?: (planId: string, side: "before" | "after", urgency?: "idle" | "ahead") => boolean;
  changesSeenAt: number;
  isoLanguage: string | null;
}

/** The stamp the stored read of the project was taken at; null when nothing is stored or the read carried none. */
export function readStampOf(latest: StoredSnapshot | undefined): HostStamp | null {
  return latest ? stampOf(latest.snapshot) : null;
}

/** Facts of a lane that has seen nothing yet. */
export function newHostFacts(): HostFacts {
  return { checks: { census: null, library: null }, fonts: { phase: "unknown", at: null }, layerStyles: { state: "unknown", at: null, probing: false }, pairedAt: null, afterStamps: new Map(), planSources: new Map(), changesSeenAt: 0, isoLanguage: null };
}

/**
 * A new pairing is a new After Effects session: no stamp taken in the last one can match the live project again, and a plan the sidecar no
 * longer holds has no use for its source. Both maps would otherwise grow with every plan for the life of the process.
 */
export function pruneHostFacts(facts: HostFacts, heldPlanIds: Iterable<string>): void {
  const held = new Set(heldPlanIds);
  facts.afterStamps.clear();
  facts.layerStyles = { state: "unknown", at: null, probing: false };
  for (const planId of [...facts.planSources.keys()]) if (!held.has(planId)) facts.planSources.delete(planId);
}

const LIBRARY_CODES = new Set(["LIBRARY_NOT_FOUND", "LIBRARY_VERSION_INVALID", "LIBRARY_LOAD_FAILED"]);

/** A host call failed: the library check fails when its code says the library did not load; a census check fails whatever the code. */
export function noteHostFailure(facts: HostFacts, what: "census" | "read", failure: { code: string; message: string }, at: number): void {
  const check: HostCheck = { ok: false, code: failure.code, message: failure.message, at };
  if (LIBRARY_CODES.has(failure.code)) facts.checks.library = check;
  if (what === "census") facts.checks.census = check;
}

/** A census that ran proves the library loads. */
export function noteCensusOk(facts: HostFacts, at: number): void {
  facts.checks.census = { ok: true, at };
  facts.checks.library = { ok: true, at };
}

interface HostStatusView {
  state: HostLinkStatus["state"];
  since: number;
  online: boolean;
  message: string | null;
  stall: HostLinkStatus["stall"];
  pluginVersion: string | null;
  aeVersion: string | null;
  experimental: boolean;
  busyKind: HostLinkStatus["busyKind"];
  busySince: number | null;
}

const STALL_WORDS: Record<NonNullable<HostLinkStatus["stall"]>["verdict"], string> = {
  "ae-busy": "After Effects is busy (a dialog or popup is open).",
  "plugin-unresponsive": "The extynt plugin is not answering. After Effects may be frozen or quitting.",
  slow: "After Effects is slow to answer; this step is still running.",
};

function dialogWaitLine(title: string): string {
  return `After Effects is waiting for you in the \u201C${title}\u201D window`;
}

function stallMessage(stall: NonNullable<HostLinkStatus["stall"]>): string {
  return stall.dialog && stall.dialog.title !== "" ? dialogWaitLine(stall.dialog.title) : STALL_WORDS[stall.verdict];
}

function messageFor(status: HostLinkStatus): string | null {
  if (status.state === "online") return null;
  if (status.state === "stalled") return status.stall ? stallMessage(status.stall) : STALL_WORDS.slow;
  if (status.state === "connecting") return "Connecting to After Effects…";
  if (status.state === "closing") return "After Effects is closing.";
  return "Open After Effects (the extynt plugin starts with it).";
}

/** The status the UI shows for a link status. */
export function statusView(status: HostLinkStatus): HostStatusView {
  return {
    state: status.state, since: status.since, online: status.state === "online" || status.state === "stalled", message: messageFor(status), stall: status.stall,
    pluginVersion: status.pluginVersion, aeVersion: status.aeVersion, experimental: status.host?.experimental === true, busyKind: status.busyKind, busySince: status.busySince,
  };
}

/** The host connection as the UI shows it. */
export function hostStatusView(state: { hostLink: HostLink }): HostStatusView {
  return statusView(state.hostLink.status());
}

/** The Activity view was opened: everything applied so far counts as seen. */
export function markChangesSeen(state: { hostFacts: HostFacts }, nowMs: number): void {
  state.hostFacts.changesSeenAt = nowMs;
}

/** Records what a probe or a refused apply proved about the Layer Style commands; a probe that could not tell (`null`) leaves what is held. */
export function noteLayerStyles(facts: HostFacts, live: boolean | null, at: number): void {
  if (live === null) return;
  facts.layerStyles = { state: live ? "available" : "unavailable", at, probing: false };
}

/** The apply refusal that proves the Layer Style commands are inert in this session (the host's AE_LAYER_STYLES_INERT text), not a per-layer refusal. */
export function isLayerStylesInert(error: { code?: string | undefined; message?: string | undefined } | null | undefined): boolean {
  return !!error && error.code === "LAYER_STYLES_UNSUPPORTED" && !!error.message?.includes("menu commands are not available");
}
