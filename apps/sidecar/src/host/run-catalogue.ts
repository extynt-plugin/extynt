// The `catalogue_page` runner: background collection of the host's effect catalogue, one whitelisted host function per ticket.
// It runs only when nothing else waits (read-claims.ts offers it last) and fails soft: a page that did not come back is
// completed as such, so the collector pauses or retries on its own schedule.
import { decode, decodeJson, literal, object, refine, string } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import type { CallOptions, CallOutcome, HostCallResult, PluginClient } from "@extynt/host-native";
import { rowDecoder } from "../verify/json-fields.js";
import { leasedHostCall } from "./bridge-call.js";
import type { HostLaneContext, HostRunner, HostWorkData } from "./lane-types.js";
import { cleanupRequest, heldOf, mergeMenus, readMenus, withPage, type HeldEffects } from "./catalogue-menus.js";
import { releaseFlight } from "./runner-support.js";

const TICKET = /^[A-Za-z0-9_-]{1,128}$/;

type Log = HostLaneContext["log"];
interface HeldPage { page: JsonObject; held: HeldEffects }

const envelopeShape = object({
  ticket: string({ pattern: TICKET }),
  hostFunction: literal("aeCatalogueProbePage", "aeCatalogueReadInstance"),
  hostRequest: rowDecoder,
});
type Envelope = Infer<typeof envelopeShape>;
const matchesTicket = (envelope: Envelope): envelope is Envelope => envelope.hostRequest.requestId === envelope.ticket;
const catalogueEnvelope = refine(envelopeShape, matchesTicket, "a request that carries the ticket as its requestId");
const anyTicket = object({ ticket: string() });
const validTicket = object({ ticket: string({ pattern: TICKET }) });

const cancelled = (code: string): JsonObject => ({ ok: false, mayHaveMutated: false, error: { code } });

function pageOf(text: string): JsonObject {
  const decoded = decodeJson(text, rowDecoder);
  return decoded.ok ? decoded.value : { ok: false, error: { code: "INVALID_PAGE", reason: text.replace(/[^\x20-\x7e]/g, "?").slice(0, 60) } };
}

const holds = (envelope: Envelope): boolean => envelope.hostFunction === "aeCatalogueProbePage" && envelope.hostRequest.cleanup !== true;

async function labelledPage(envelope: Envelope, client: PluginClient, log: Log, probe: HeldPage): Promise<JsonObject> {
  const { page, held } = probe;
  try {
    const menus = await readMenus(client, held), merged = menus ? mergeMenus(page, menus) : { page, labelled: 0 };
    log("host.catalogue-menus", { read: menus !== null, labelled: merged.labelled });
    return merged.page;
  } finally {
    const cleaned = await client.hostCall(envelope.hostFunction, { ...cleanupRequest(envelope.ticket), ...(envelope.hostRequest.engine === true ? { engine: true } : {}) });
    if (cleaned.kind !== "ok") log("host.catalogue-cleanup-failed", { kind: cleaned.kind });
  }
}

function withoutHeld(page: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(page).filter(([key]) => key !== "held"));
}

async function pageWithMenus(envelope: Envelope, client: PluginClient, log: Log, options: CallOptions): Promise<CallOutcome<HostCallResult>> {
  const first = await client.hostCall(envelope.hostFunction, { ...envelope.hostRequest, hold: true }, options);
  if (first.kind !== "ok") return first;
  const page = pageOf(first.result.result), held = heldOf(page);
  return held ? withPage(first, withoutHeld(await labelledPage(envelope, client, log, { page, held }))) : first;
}

function callPage(envelope: Envelope, client: PluginClient, log: Log, options: CallOptions = {}): Promise<CallOutcome<HostCallResult>> {
  return holds(envelope) ? pageWithMenus(envelope, client, log, options) : client.hostCall(envelope.hostFunction, envelope.hostRequest, options);
}

function answerOf(outcome: CallOutcome<HostCallResult>): JsonObject {
  if (outcome.kind === "ok") return pageOf(outcome.result.result);
  return { ok: false, error: { code: outcome.kind === "refused" ? outcome.error.code : outcome.reason === "timeout" ? "HOST_TIMEOUT" : "HOST_DISPATCH_UNKNOWN" } };
}

async function runPage(envelope: Envelope, context: HostLaneContext): Promise<JsonObject> {
  if (context.link.status().state !== "online") return cancelled("HOST_BRIDGE_CANCELLED");
  const leased = await leasedHostCall(context, { kind: "read" }, () => callPage(envelope, context.client, context.log));
  if (leased.status === "refused" || leased.status === "not-started") return cancelled("HOST_BRIDGE_CANCELLED");
  return answerOf(leased.outcome);
}

/**
 * One probe page in the headless render engine: no bridge lease (the engine is its own process, not the user's After Effects)
 * and no lane. Answers the page the collector completes, or a failure envelope it charges the right way.
 */
export async function runEnginePage(item: HostWorkData, client: PluginClient, log: Log, timeoutMs?: number): Promise<JsonObject> {
  const decoded = decode(catalogueEnvelope, item);
  if (!decoded.ok || decoded.value.hostFunction !== "aeCatalogueProbePage") return cancelled("INVALID_CATALOGUE_DISPATCH");
  return answerOf(await callPage(decoded.value, client, log, timeoutMs === undefined ? {} : { timeoutMs }));
}

async function refuseInvalid(item: HostWorkData, context: HostLaneContext): Promise<void> {
  await context.receivers.acceptPanelEvent({ code: "INVALID_CATALOGUE_DISPATCH", message: "Invalid catalogue mailbox envelope." });
  const named = decode(validTicket, item);
  if (named.ok) await context.receivers.catalogue("complete", { ticket: named.value.ticket, page: cancelled("INVALID_CATALOGUE_DISPATCH") });
}

async function perform(item: HostWorkData, context: HostLaneContext): Promise<void> {
  const decoded = decode(catalogueEnvelope, item);
  if (!decoded.ok) { await refuseInvalid(item, context); return; }
  const envelope = decoded.value, completed = await context.receivers.catalogue("complete", { ticket: envelope.ticket, page: await runPage(envelope, context) });
  context.log("host.catalogue", { entry: envelope.hostFunction, completed: completed.outcome === "succeeded", code: completed.errorCode ?? null });
}

/** The runner for `catalogue_page` items. */
export const runCatalogue: HostRunner = async (item, context) => {
  const ticket = decode(anyTicket, item);
  try { await perform(item, context); }
  finally { releaseFlight(context.state, "catalogue_page", ticket.ok ? ticket.value.ticket : undefined); }
};
