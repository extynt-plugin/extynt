// Settles the panel's answer to an issued page or instance read: what is stored, what is journaled as failed, what is retried and when collection pauses.
import type { JsonValue } from "@extynt/decode";
import { INTERACTIVE_APPLY_MS, NEEDS_SOURCE } from "./catalogue-collector-types.js";
import type { CatalogueCompletion } from "./catalogue-collector-types.js";
import type { CatalogueProbeWrite } from "./catalogue-definitions.js";
import { MOVED_CODES, NOT_RUN_CODES } from "./catalogue-instances.js";
import type { InstanceTarget } from "./catalogue-instances.js";
import { parseCatalogueInstance, parseCataloguePage, refusedBeforeStart } from "./catalogue-page.js";
import type { CatalogueApplyCost, CatalogueInstanceRead, CataloguePage, CataloguePageOutcome } from "./catalogue-page.js";
import type { CatalogueRun, Outstanding } from "./catalogue-run.js";

type Settled = Omit<CatalogueCompletion, "state">;

interface Persisted { written: string[]; invalid: number; storageFailures: number }

const UNANSWERED_CODES: ReadonlySet<string> = new Set(["HOST_TIMEOUT", "HOST_DISPATCH_UNKNOWN"]);
const HOST_FAILURE_CODES: ReadonlyMap<string, string> = new Map([["CANNOT_ADD", "cannot-add"], ["ADD_FAILED", NEEDS_SOURCE], ["READ_FAILED", "read-failed"], ["REMOVE_FAILED", "remove-failed"]]);
const PAUSING_REFUSALS: ReadonlySet<string> = new Set(["NOT_SCRATCH_PROJECT", "NO_PROJECT", "SETUP_FAILED", "INVALID_REQUEST"]);
const INVALID_DATA_CODES: ReadonlySet<string> = new Set(["GRAPH_DEFINITION_INVALID", "GRAPH_DEFINITION_IDENTITY_INVALID", "GRAPH_DEFINITION_PROVENANCE_INVALID", "GRAPH_DEFINITION_DEFAULT_UNVERIFIED"]);
const MAX_CONSECUTIVE_FAILURES = 5;
const NOTHING: Settled = { ok: true, accepted: false, written: 0, failed: 0, remaining: 0 };

function hostMatches(run: CatalogueRun, page: Pick<CataloguePage, "host">): boolean {
  const host = run.host;
  return host !== undefined && page.host.version === host.version && (page.host.build === null || host.build === null || page.host.build === host.build);
}

function noteFailure(run: CatalogueRun): void {
  run.consecutiveFailures += 1;
  if (run.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) run.pause("repeated-page-failures");
}

function pauseReasonOf(code: string): string {
  return code === "NOT_SCRATCH_PROJECT" ? "not-scratch-project" : code.toLowerCase().replace(/_/g, "-");
}

function refusePage(run: CatalogueRun, outcome: Exclude<CataloguePageOutcome, { kind: "page" }>, raw: JsonValue, page: Outstanding): Settled {
  const { code } = outcome;
  run.options.log("catalogue.page-refused", { ticket: page.ticket, code, reason: outcome.kind === "refused" ? outcome.reason : null, cleanup: page.cleanup, notStarted: refusedBeforeStart(raw) });
  run.coolDown();
  if (page.cleanup) {
    if (code === "NOT_SCRATCH_PROJECT" || code === "NO_PROJECT") run.journal.cleanup = false;
    return NOTHING;
  }
  if (!UNANSWERED_CODES.has(code)) run.clearAttempts(page.matchNames);
  if (PAUSING_REFUSALS.has(code)) run.pause(pauseReasonOf(code));
  else noteFailure(run);
  return { ...NOTHING, remaining: page.matchNames.length };
}

function noteApplyCosts(run: CatalogueRun, entries: ReadonlyArray<CatalogueApplyCost & { matchName: string }>): number {
  const host = run.hostJournal();
  let interactive = 0;
  for (const entry of entries) {
    if (!host || entry.applyMs === null) continue;
    if (entry.applyMs < INTERACTIVE_APPLY_MS) {
      delete host.interactive[entry.matchName];
      continue;
    }
    host.interactive[entry.matchName] = run.options.now();
    interactive += 1;
    run.options.log("catalogue.effect-interactive", { hostKey: run.hostKey(), matchName: entry.matchName, applyMs: entry.applyMs });
  }
  return interactive;
}

function settleAnswered(run: CatalogueRun, page: CataloguePage, storageFailures: number): void {
  const answered = [...page.results.map((result) => result.matchName), ...page.failures.map((failure) => failure.matchName)];
  for (const failure of page.failures) run.recordFailure(failure.matchName, HOST_FAILURE_CODES.get(failure.code) ?? "probe-failed", failure.detail ?? undefined);
  run.clearAttempts([...answered, ...page.remaining]);
  run.consecutiveFailures = storageFailures > 0 ? run.consecutiveFailures + 1 : 0;
  if (run.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) run.pause("graph-write-failed");
  run.lastPageMs = page.elapsedMs;
  run.totalProbeMs += page.elapsedMs;
  run.probedThisRun += answered.length;
}

function probeWrites(run: CatalogueRun, page: CataloguePage, hostKey: string, build: string | null): CatalogueProbeWrite[] {
  return page.results.filter((effect) => run.isInstalled(effect.matchName)).map((effect) => ({ hostKey, runId: run.runId, observedAt: run.options.now(), hostBuild: build, version: run.versionOf(effect.matchName), effect }));
}

function persistResults(run: CatalogueRun, page: CataloguePage): Persisted {
  const host = run.host;
  if (!host || page.results.length === 0) return { written: [], invalid: 0, storageFailures: 0 };
  const result = run.options.store.writeProbe(probeWrites(run, page, host.key, host.build));
  if (!result) {
    run.storageDown = true;
    run.pause("graph-storage-unavailable");
    return { written: [], invalid: 0, storageFailures: 1 };
  }
  for (const name of result.written) run.markProbed(name, "probe");
  const invalid = result.failed.filter((entry) => INVALID_DATA_CODES.has(entry.code));
  for (const entry of invalid) run.recordFailure(entry.matchName, "invalid-probe-data");
  return { written: result.written, invalid: invalid.length, storageFailures: result.failed.length - invalid.length };
}

function acceptCleanup(run: CatalogueRun, page: CataloguePage): Settled {
  run.journal.cleanup = !page.cleanedUp;
  return { ...NOTHING, accepted: page.cleanedUp };
}

function rejectChangedHost(run: CatalogueRun, issued: Outstanding): Settled {
  run.clearAttempts(issued.matchNames);
  run.pause("host-changed");
  return { ...NOTHING, remaining: issued.matchNames.length };
}

function logPage(run: CatalogueRun, page: CataloguePage, issued: Outstanding, saved: Persisted): void {
  const costs = [...page.results, ...page.failures];
  const interactive = noteApplyCosts(run, costs), createdItems = costs.reduce((sum, entry) => sum + entry.createdItems, 0);
  run.options.log("catalogue.page", {
    ticket: issued.ticket, effects: issued.matchNames.length, written: saved.written.length, hostFailed: page.failures.length, invalid: saved.invalid,
    remaining: page.remaining.length, hostMs: page.elapsedMs, roundTripMs: Math.max(0, run.options.now() - issued.handedAt), interactive, createdItems, ...run.counts(),
  });
}

function acceptPage(run: CatalogueRun, page: CataloguePage, issued: Outstanding): Settled {
  if (issued.cleanup) return acceptCleanup(run, page);
  if (!hostMatches(run, page)) return rejectChangedHost(run, issued);
  const saved = persistResults(run, page);
  settleAnswered(run, page, saved.storageFailures);
  logPage(run, page, issued, saved);
  if (saved.written.length) run.options.onProbed?.(run.hostKey() ?? "", saved.written);
  if (run.pendingNames().length === 0) run.options.log("catalogue.complete", { hostKey: run.hostKey(), ...run.counts(), totalProbeMs: run.totalProbeMs });
  return { ok: true, accepted: true, written: saved.written.length, failed: page.failures.length + saved.invalid, remaining: page.remaining.length };
}

function storeInstance(run: CatalogueRun, read: CatalogueInstanceRead, target: InstanceTarget): Settled {
  const host = run.host;
  const refused: Settled = { ...NOTHING, failed: 1 };
  if (!host || !hostMatches(run, read)) return refused;
  const saved = run.options.store.writeInstance?.({ hostKey: host.key, runId: run.runId, observedAt: run.options.now(), hostBuild: host.build, version: run.versionOf(target.matchName), read });
  if (!saved) {
    run.storageDown = true;
    run.pause("graph-storage-unavailable");
    return refused;
  }
  if (!saved.written) {
    run.options.log("catalogue.instance-not-stored", { hostKey: host.key, matchName: target.matchName, code: saved.code });
    return refused;
  }
  run.markProbed(target.matchName, "instance");
  run.options.onProbed?.(host.key, [target.matchName]);
  run.options.log("catalogue.instance-learned", { hostKey: host.key, matchName: target.matchName, controls: read.controls.length, truncated: read.truncated });
  return { ...NOTHING, accepted: true, written: 1 };
}

function completeInstance(run: CatalogueRun, raw: JsonValue, ticket: string, target: InstanceTarget): Settled {
  const outcome = parseCatalogueInstance(raw, ticket, target.matchName);
  run.coolDown();
  if (outcome.kind === "instance") return storeInstance(run, outcome.read, target);
  run.options.log("catalogue.instance-refused", { hostKey: run.hostKey(), matchName: target.matchName, code: outcome.code });
  const retryable = MOVED_CODES.has(outcome.code) || NOT_RUN_CODES.has(outcome.code);
  if (retryable && run.instances.noteMoved(target.matchName)) delete run.hostJournal()?.instanceReads[run.failureKeyOf(target.matchName)];
  return NOTHING;
}

/** Settles the panel's answer to the outstanding ticket: only an exact, whole page is stored, and only an unanswered page keeps its attempts. A ticket other than the outstanding one is stale and throws. */
export function completeOutstanding(run: CatalogueRun, ticket: string, raw: JsonValue): Settled {
  const issued = run.outstanding;
  if (!issued || issued.ticket !== ticket || !run.host) throw Error("STALE_CATALOGUE_TICKET");
  run.outstanding = undefined;
  if (issued.instance) {
    const settled = completeInstance(run, raw, ticket, issued.instance);
    run.saveQuietly();
    return settled;
  }
  const outcome = parseCataloguePage(raw, ticket, issued.matchNames);
  const settled = outcome.kind === "page" ? acceptPage(run, outcome.page, issued) : refusePage(run, outcome, raw, issued);
  run.saveQuietly();
  return settled;
}

