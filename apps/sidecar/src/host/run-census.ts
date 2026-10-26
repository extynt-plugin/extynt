// The `host_census` runner: the installed effects and fonts, asked once after a pair and on demand, and handed to the census receiver. The effects are
// asked for first, alone; the fonts are a second call the lane makes when it is idle (`read-claims.ts`), because listing them takes the host seconds.
import { boolean, decode, decodeJson, decodeOrThrow, fallback, literal, map, object, optional, refine, string } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import { optionsDialogFlags } from "@extynt/host-native";
import type { HostCallResult, PluginClient } from "@extynt/host-native";
import type { SidecarState } from "../server-state.js";
import { listOf, objectOf, rowDecoder } from "../verify/json-fields.js";
import type { HostLaneContext, HostRunner, HostWorkData } from "./lane-types.js";
import { noteFontsFailed } from "../server-census-fonts.js";
import { noteCensusOk, noteHostFailure, noteLayerStyles } from "./facts.js";
import type { EventTimers } from "./events.js";
import { failureOf, type HostFailure } from "./read-ops.js";
import { releaseFlight, reportFailure } from "./runner-support.js";
import { enqueueHostWork } from "./work-queue.js";

const CENSUS_LIMITS = { maxEffects: 10_000, maxFonts: 8192 } as const;
const CENSUS_DIALOG_REASK_MS = 5000;
const CENSUS_SCAN_REASK_MS = 30_000;
const DIALOG_WORDS = "After Effects has a dialog open. Close it and extynt continues.";
const UNREADABLE: HostFailure = { code: "CENSUS_UNREADABLE", message: "The census answer was not a successful census.", unknown: false };

/** The first census after After Effects launches can be refused by the script engine while it is still starting; one retry after this long. */
export const CENSUS_REASK_MS = 3000;

/** A Layer Styles command probe is re-asked no sooner than this while the commands are not known live: the Layer menu can be built at any time. */
export const FEATURES_REASK_MS = 20_000;

type Asked = { ok: true; census: JsonObject; bytes: number; scriptMs: number; scanPending: boolean } | { ok: false; failure: HostFailure; unreadable: boolean };
type Refused = Extract<Asked, { ok: false }>;

const censusItem = object({
  part: fallback(literal("effects", "fonts", "features"), "effects"),
  requestId: optional(fallback(string({ maxLength: 100 }), undefined)),
  fontFingerprint: optional(fallback(string(), undefined)),
  retry: fallback(boolean(), false),
});
type CensusItem = Infer<typeof censusItem>;

const successfulCensus = refine(rowDecoder, (census): census is JsonObject => census.ok === true, "a successful census");
const fontsCensus = object({ result: object({ part: literal("fonts") }) });
const layerStyleProbe = fallback(map(object({ result: object({ layerStyleCommandsLive: boolean() }) }), (census) => census.result.layerStyleCommandsLive), null);

/** Queues one census unless one is already waiting or running. */
export function queueCensus(state: Pick<SidecarState, "agentMailbox" | "inFlight" | "now" | "hostWake" | "hostFacts">, retry = false): boolean {
  if ((state.inFlight?.kind === "host_census" && !state.hostFacts.layerStyles.probing) || state.agentMailbox.some((item) => item.approvedData.kind === "host_census" && item.approvedData.part !== "features")) return false;
  enqueueHostWork(state, { approvedData: { kind: "host_census", requestId: `census-${state.now().getTime().toString(36)}`, ...(retry ? { retry: true } : {}) } });
  return true;
}

/** Queues the cheap host-feature probe (is the Layer Styles menu live) unless one is waiting or running, or the commands are known live or were asked about lately. */
export function queueFeaturesProbe(state: Pick<SidecarState, "agentMailbox" | "inFlight" | "now" | "hostFacts"> & Partial<Pick<SidecarState, "hostWake">>): boolean {
  const asked = state.hostFacts.layerStyles, nowMs = state.now().getTime();
  if (asked.state === "available" || (asked.at !== null && nowMs - asked.at < FEATURES_REASK_MS)) return false;
  if (asked.probing) return false;
  state.hostFacts.layerStyles = { ...asked, at: nowMs, probing: true };
  enqueueHostWork(state, { approvedData: { kind: "host_census", requestId: `features-${nowMs.toString(36)}`, part: "features" } });
  return true;
}

function retryLater(context: HostLaneContext, timers: EventTimers, failure: HostFailure): void {
  noteHostFailure(context.state.hostFacts, "census", failure, context.now());
  context.log("host.census-retry", { code: failure.code, message: failure.message, afterMs: CENSUS_REASK_MS });
  timers.set(() => { queueCensus(context.state, true); }, CENSUS_REASK_MS);
}

function waitForDialog(context: HostLaneContext, timers: EventTimers, failure: HostFailure, retry: boolean): void {
  noteHostFailure(context.state.hostFacts, "census", { code: failure.code, message: DIALOG_WORDS }, context.now());
  context.log("host.census-dialog", { afterMs: CENSUS_DIALOG_REASK_MS });
  timers.set(() => { queueCensus(context.state, retry); }, CENSUS_DIALOG_REASK_MS);
}

function requestFor(item: CensusItem, context: HostLaneContext): JsonObject {
  const requestId = item.requestId ?? `census-${context.now().toString(36)}`;
  const known: JsonObject = item.part === "fonts" && item.fontFingerprint !== undefined ? { fontFingerprint: item.fontFingerprint } : {};
  return { schemaVersion: "0.1", requestId, limits: { ...CENSUS_LIMITS }, parts: [item.part], ...known };
}

function fontsFailed(context: HostLaneContext, failure: HostFailure): void {
  noteFontsFailed(context.state, failure.code);
  context.log("host.fonts-failed", { code: failure.code, message: failure.message });
}

function markOptionsDialogs(census: JsonObject, scan: HostCallResult["optionsDialogScan"]): JsonObject {
  const result = objectOf(census.result), effects = listOf(result?.installedEffects);
  if (!scan || !result || !effects) return census;
  const flags = optionsDialogFlags({ optionsDialogScan: scan });
  const installedEffects = effects.flatMap((effect) => {
    const row = objectOf(effect);
    if (!row) return [];
    const matchName = String(row.matchName), flag = flags.get(matchName);
    return [flag === undefined ? { ...row, matchName } : { ...row, matchName, hasOptionsDialog: flag }];
  });
  return { ...census, result: { ...result, installedEffects } };
}

async function askWith(client: PluginClient, request: JsonObject): Promise<Asked> {
  const outcome = await client.hostCall("aeHostCensus", request);
  if (outcome.kind !== "ok") return { ok: false, failure: failureOf(outcome), unreadable: false };
  const parsed = decodeJson(outcome.result.result, successfulCensus);
  if (!parsed.ok) return { ok: false, failure: UNREADABLE, unreadable: true };
  return { ok: true, census: markOptionsDialogs(parsed.value, outcome.result.optionsDialogScan), bytes: Buffer.byteLength(outcome.result.result), scriptMs: Math.round(outcome.result.scriptUs / 1000), scanPending: outcome.result.optionsDialogScanPending === true };
}

/** The installed-effects census from any plugin client: the headless render engine (catalogue-engine.ts) asks it this way. */
export function askEffectsCensus(client: PluginClient, requestId: string): Promise<Asked> {
  return askWith(client, { schemaVersion: "0.1", requestId, limits: { ...CENSUS_LIMITS }, parts: ["effects"] });
}

async function performFonts(item: CensusItem, context: HostLaneContext): Promise<void> {
  const asked = await askWith(context.client, requestFor(item, context));
  if (!asked.ok) { fontsFailed(context, asked.failure); return; }
  if (!decode(fontsCensus, asked.census).ok) { fontsFailed(context, { code: "FONTS_PART_UNSUPPORTED", message: "The host library did not answer with a fonts census.", unknown: false }); return; }
  const accepted = await context.receivers.acceptHostCensus(asked.census, asked.bytes);
  if (accepted.outcome !== "succeeded") fontsFailed(context, { code: accepted.errorCode ?? "FONTS_REFUSED", message: "The font census was not accepted.", unknown: false });
  context.log("host.census", { part: "fonts", accepted: accepted.outcome === "succeeded", scriptMs: asked.scriptMs });
}

async function failEffects(asked: Refused, item: CensusItem, context: HostLaneContext, timers: EventTimers): Promise<void> {
  if (asked.unreadable) {
    noteHostFailure(context.state.hostFacts, "census", asked.failure, context.now());
    context.log("host.census-failed", { ...asked.failure });
  } else if (asked.failure.code === "HOST_MODAL_DIALOG") waitForDialog(context, timers, asked.failure, item.retry);
  else if (asked.failure.code === "SCRIPT_FAILED" && !item.retry) retryLater(context, timers, asked.failure);
  else await reportFailure(context, "census", asked.failure);
}

async function performEffects(item: CensusItem, context: HostLaneContext, timers: EventTimers): Promise<void> {
  const asked = await askWith(context.client, requestFor(item, context));
  if (!asked.ok) { await failEffects(asked, item, context, timers); return; }
  noteCensusOk(context.state.hostFacts, context.now());
  if (asked.scanPending && !item.retry) timers.set(() => { queueCensus(context.state, true); }, CENSUS_SCAN_REASK_MS);
  const accepted = await context.receivers.acceptHostCensus(asked.census, asked.bytes);
  context.log("host.census", { part: "effects", accepted: accepted.outcome === "succeeded", scriptMs: asked.scriptMs });
}

async function performFeatures(item: CensusItem, context: HostLaneContext): Promise<void> {
  const asked = await askWith(context.client, requestFor(item, context));
  context.state.hostFacts.layerStyles.probing = false;
  if (!asked.ok) { context.log("host.features-failed", { code: asked.failure.code }); return; }
  const live = decodeOrThrow(layerStyleProbe, asked.census);
  noteLayerStyles(context.state.hostFacts, live, context.now());
  context.log("host.features", { layerStyleCommandsLive: live });
}

function perform(raw: HostWorkData, context: HostLaneContext, timers: EventTimers): Promise<void> {
  const item = decodeOrThrow(censusItem, raw);
  if (item.part === "features") return performFeatures(item, context);
  return item.part === "fonts" ? performFonts(item, context) : performEffects(item, context, timers);
}

/** The runner for `host_census` items; a census that fails leaves the inventory as it was. */
export function createCensusRunner(timers: EventTimers): HostRunner {
  return async (item, context) => {
    try { await perform(item, context, timers); }
    finally { releaseFlight(context.state, "host_census"); }
  };
}
