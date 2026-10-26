// The in-process receivers: each core takes parsed input and returns what its HTTP route answers; the routes parse, authenticate and write the response around these, and the native host lane calls them directly.
import { makeHostProfile, makeInventory } from "@extynt/capability-catalogue";
import { decode, type JsonValue } from "@extynt/decode";
import { jsonOf } from "@extynt/mcp-server";

import { precheckAdmission, type PrecheckJobs } from "./apply-precheck.js";
import { learnFromSnapshot, reportLearningFailuresTo } from "./effect-notes-learn.js";
import { focusAnswer } from "./focus-overlay.js";
import { liveFocusReport } from "./live-focus-report.js";
import { profileDirectory, saveHostProfile, scanPresetInventory } from "./profile-store.js";
import { acceptFontCensus, fontsOfCensus, noteFontsAfterCensus } from "./server-census-fonts.js";
import { accepted, refused, settled } from "./receiver-outcome.js";
import type { InProcessReceivers, ReceiverOutcome } from "./receiver-types.js";
import { logHostCensus } from "./server-census-log.js";
import { collectionAsActiveHost } from "./server-collection-receiver.js";
import { noteInterruptedApply } from "./server-interrupted-apply.js";
import { receiptHead } from "./server-receipt-body.js";
import { acceptCatalogue } from "./server-catalogue-route.js";
import { mergeIntoLatest, refuseScopedRead, storeInventoryFallback, storeObservedSnapshot, supersededSnapshot, type HttpRoutesDeps } from "./server-http-state.js";
import { acceptNativeBridge } from "./server-native-bridge-route.js";
import { fontCensus, hostCensus, hostInstallation, inventoryItem, type HostCensus } from "./server-census-wire.js";
import { probeSnapshot } from "./server-probe-wire.js";
import { normalizeProbeSnapshot } from "./server-normalize.js";
import type { ProbeSnapshot } from "./server-types.js";

type SnapshotMeta = Parameters<InProcessReceivers["acceptSnapshot"]>[1];

function lineageChain(deps: HttpRoutesDeps, from: string, to: string): string[] | null {
  const chain: string[] = [];
  let cursor = to;
  for (let hops = 0; hops < 64 && cursor !== from; hops += 1) {
    const link = deps.state.lineage.get(cursor);
    if (!link) return null;
    chain.unshift(link.planId);
    cursor = link.beforeFingerprint;
  }
  return cursor === from ? chain : null;
}

function precheckJobs(deps: HttpRoutesDeps): PrecheckJobs {
  return { jobIdForPlan: (planId) => deps.state.workflowCoordinator.jobIdForPlan(planId) ?? undefined, lineageChain: (from, to) => lineageChain(deps, from, to) };
}

function answerExtras(deps: HttpRoutesDeps, meta: SnapshotMeta, stored: { normalized: ReturnType<typeof normalizeProbeSnapshot>; snapshot: ProbeSnapshot; receivedAt: string }): ReceiverOutcome["body"] {
  const focus = deps.state.liveFocus;
  const view = focus ? focusAnswer(stored.normalized, focus, deps.state.now().getTime())?.view ?? null : null;
  const planId = meta.purpose === "precheck" ? meta.planId : undefined;
  const admission = planId === undefined ? undefined : precheckAdmission(deps.state.plans.get(planId)?.plan, normalizeProbeSnapshot(stored.snapshot, stored.receivedAt), precheckJobs(deps));
  return { view: jsonOf(view), ...(admission ? { admission } : {}) };
}

function observeCatalogue(deps: HttpRoutesDeps, normalized: ReturnType<typeof normalizeProbeSnapshot>): void {
  try {
    deps.state.catalogue.observeSnapshot(normalized);
  } catch (error) {
    deps.state.eventLog("catalogue.observe-failed", { reason: (error instanceof Error ? error.message : String(error)).slice(0, 200) });
  }
}

/** Stores a probe snapshot the caller has already validated, and answers what the route answers: its fingerprints, the live view and a precheck verdict. */
export function storeProbeSnapshot(deps: HttpRoutesDeps, read: ProbeSnapshot, meta: SnapshotMeta): ReceiverOutcome {
  const receivedAt = deps.state.now().toISOString();
  const superseded = supersededSnapshot(deps, read);
  if (superseded) return superseded;
  const merged = mergeIntoLatest(deps, read);
  if (!merged.ok) return refuseScopedRead(deps, read, merged.reason);
  const parsed = merged.snapshot;
  storeObservedSnapshot(deps, parsed, { bytes: meta.bytes, receivedAt, observed: merged.observed });
  deps.state.issuedReads.delete(read.requestId);
  deps.dispatch.wakeDeferredWorkflowContinuations();
  noteInterruptedApply(deps, parsed);
  const normalized = deps.dispatch.normalizedLatest() ?? normalizeProbeSnapshot(parsed, receivedAt);
  learnFromSnapshot(deps.state.collection.effectNotes, normalized);
  observeCatalogue(deps, normalized);
  storeInventoryFallback(deps, read, normalized);
  const extras = answerExtras(deps, meta, { normalized, snapshot: parsed, receivedAt });
  return accepted(201, { ok: true, accepted: true, requestId: parsed.requestId, receivedAt, bytes: meta.bytes, fingerprint: normalized.fingerprint, selectionFingerprint: normalized.selectionFingerprint, ...extras });
}

function acceptSnapshotRead(deps: HttpRoutesDeps, read: JsonValue | undefined, meta: SnapshotMeta): ReceiverOutcome {
  deps.state.snapshotPostCount += 1;
  const decoded = decode(probeSnapshot, read);
  if (!decoded.ok) return refused(422, "INVALID_SNAPSHOT", "Expected a successful schema 0.1 CEP probe snapshot.");
  return storeProbeSnapshot(deps, decoded.value, meta);
}

/** Records the host's installed-effect census as the canonical inventory and profile; the fonts half of a split census goes to `acceptFontCensus`. */
export function acceptCensus(deps: HttpRoutesDeps, census: JsonValue | undefined, bytes: number): ReceiverOutcome {
  const fonts = decode(fontCensus, census);
  if (fonts.ok) return acceptFontCensus(deps, fonts.value, bytes);
  const effects = decode(hostCensus, census);
  if (!effects.ok) return refused(422, "INVALID_HOST_CENSUS", "Expected a bounded successful schema 0.1 host census.");
  return recordHostCensus(deps, effects.value, bytes);
}

function recordHostCensus(deps: HttpRoutesDeps, census: HostCensus, bytes: number): ReceiverOutcome {
  deps.state.previousInventory = deps.state.inventory;
  deps.state.inventory = makeInventory(hostInstallation(census.result.runtime), census.result.installedEffects.map(inventoryItem), census.result.completeness !== "complete", census.result.completeness);
  const { fonts, pending } = fontsOfCensus(deps.state, census.result);
  const baseProfile = makeHostProfile(deps.state.inventory, deps.state.hostProfile, scanPresetInventory(deps.state.options.presetRoots), fonts);
  const profile = { ...(deps.dispatch.withEffectEvidence(baseProfile) ?? baseProfile), inventoryTotalReported: census.result.totalReported, inventoryReturnedCount: census.result.returnedCount };
  deps.state.hostProfile = profile;
  noteFontsAfterCensus(deps.state, pending);
  saveHostProfile(profile, deps.state.options.stateDirectory ?? profileDirectory());
  const stored = deps.state.collection.recordCensus(census, profile.presetInventory);
  logHostCensus(deps, census, stored);
  const written = stored?.censusDefinitions !== "failed";
  deps.state.userCensus = { census, definitionsWritten: written };
  deps.state.catalogue.onCensus(census, written);
  deps.state.catalogueEngine?.onCensus(census.result.runtime.appVersion);
  deps.state.hostFacts.isoLanguage = census.result.runtime.isoLanguage ?? null;
  return accepted(201, { ok: true, accepted: true, requestId: census.requestId, profileId: profile.profileId, bytes });
}

function acceptFocusBody<Body>(deps: HttpRoutesDeps, body: Body): ReceiverOutcome {
  const report = decode(liveFocusReport, body);
  return report.ok ? deps.dispatch.acceptFocus(report.value) : refused(422, "INVALID_FOCUS", report.error.message);
}

function acceptReceiptBody<Body>(deps: HttpRoutesDeps, body: Body, hostInstanceId: string | undefined): ReceiverOutcome {
  const head = decode(receiptHead, body);
  if (!head.ok) return refused(422, "INVALID_RECEIPT", "Receipt requires bounded planId and status.");
  return deps.dispatch.acceptReceipt(head.value, hostInstanceId);
}

/** The receivers the native host lane calls in place of POSTing to this sidecar; each answers what its route answers. */
export function createInProcessReceivers(deps: HttpRoutesDeps): InProcessReceivers {
  const dispatch = deps.dispatch;
  reportLearningFailuresTo((event, fields) => deps.state.eventLog(event, fields));
  return {
    acceptSnapshot: (read, meta) => settled(() => acceptSnapshotRead(deps, read, meta)),
    acceptHostCensus: (census, bytes) => settled(() => acceptCensus(deps, census, bytes)),
    acceptReceipt: (input, hostInstanceId) => settled(() => acceptReceiptBody(deps, input, hostInstanceId)),
    beginApply: (detail) => settled(() => dispatch.beginApply(detail)),
    acceptPipelineEvent: (event) => settled(() => dispatch.acceptPipelineEvent(event)),
    acceptCapture: (receipt) => settled(() => dispatch.acceptCapture(receipt)),
    acceptFocus: (body) => settled(() => acceptFocusBody(deps, body)),
    acceptPanelEvent: (body) => settled(() => dispatch.acceptPanelEvent(body)),
    collection: (action, body) => settled(() => collectionAsActiveHost(deps, action, body ?? null)),
    catalogue: (action, body) => settled(() => acceptCatalogue(deps, action, body)),
    nativeBridge: (action, body) => settled(() => acceptNativeBridge(deps, { action, body: body ?? null, owner: deps.state.activePanelInstanceId })),
  };
}
