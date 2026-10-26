// Hands out the collector's work: which probe page or instance read goes next, the journal entry written before it leaves, and what a lost page leaves behind.
import { join } from "node:path";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { CRASH_FAILURE, CRASH_IDENTIFIED } from "./catalogue-collector-types.js";
import type { CatalogueInstanceItem, CatalogueMailboxItem, CatalogueProbeRequest } from "./catalogue-collector-types.js";
import { BREADCRUMB_FILE, takeBreadcrumb } from "./catalogue-journal.js";
import type { HostJournal, ProbeBreadcrumb } from "./catalogue-journal.js";
import { INSTANCE_HOST_FUNCTION, instanceHostRequest } from "./catalogue-instances.js";
import type { CatalogueRun } from "./catalogue-run.js";

interface PageChoice { matchNames: string[]; cleanup: boolean }
interface Delivery { panel: string | null; engine: boolean }
interface LostEffect { crumb: ProbeBreadcrumb; tries: number }

const UNLEARNABLE_CODES: ReadonlySet<string> = new Set([CRASH_FAILURE, CRASH_IDENTIFIED, "remove-failed", "invalid-probe-data"]);

function lostEffect(run: CatalogueRun, host: HostJournal): LostEffect | undefined {
  if (Object.keys(host.attempts).length === 0) return undefined;
  const crumb = takeBreadcrumb(run.options.directory);
  const tries = crumb && crumb.phase !== "done" ? host.attempts[crumb.matchName] : undefined;
  return crumb && tries !== undefined ? { crumb, tries } : undefined;
}

function settleBreadcrumb(run: CatalogueRun, host: HostJournal, code: string): void {
  const lost = lostEffect(run, host);
  if (!lost) return;
  const { crumb, tries } = lost;
  for (const [name, count] of Object.entries(host.attempts)) if (count === 1 && name !== crumb.matchName) delete host.attempts[name];
  if (tries >= 2) run.recordFailure(crumb.matchName, code);
  run.options.log(tries >= 2 ? "catalogue.crash-identified" : "catalogue.crash-retry", { hostKey: run.hostKey(), matchName: crumb.matchName, phase: crumb.phase, ticket: crumb.ticket });
  run.saveQuietly();
}

/** The page never completed: its attempts stay recorded so the effects are retried one at a time. A page that is merely late did not crash AE, so the effect the host's breadcrumb names is only marked as hanging, which the user's Collect press forgives. */
export function abandonOutstanding(run: CatalogueRun, ticket: string, reason: string): void {
  const page = run.outstanding;
  if (!page || page.ticket !== ticket) return;
  run.outstanding = undefined;
  run.coolDown();
  const host = run.hostJournal();
  if (reason === "timeout" && host) settleBreadcrumb(run, host, CRASH_FAILURE);
  run.options.log("catalogue.page-abandoned", { ticket, reason, effects: page.matchNames.length, cleanup: page.cleanup });
}

/** Abandons the outstanding page when it has been out longer than the page timeout. */
export function expireOutstanding(run: CatalogueRun): void {
  const page = run.outstanding;
  if (page && run.options.now() - page.handedAt > run.pageTimeoutMs) abandonOutstanding(run, page.ticket, "timeout");
}

function retireCrashers(run: CatalogueRun, host: HostJournal): number {
  const crashers = run.pendingNames().filter((name) => (host.attempts[name] ?? 0) >= 2);
  for (const name of crashers) run.recordFailure(name, CRASH_FAILURE);
  return crashers.length;
}

function selectPage(run: CatalogueRun, host: HostJournal): PageChoice | undefined {
  settleBreadcrumb(run, host, CRASH_IDENTIFIED);
  if (retireCrashers(run, host) > 0) run.saveQuietly();
  const pending = run.pendingNames();
  if (pending.length === 0) return run.journal.cleanup ? { matchNames: [], cleanup: true } : undefined;
  const retry = pending.find((name) => (host.attempts[name] ?? 0) >= 1);
  if (retry !== undefined) return { matchNames: [retry], cleanup: false };
  const adobe = pending.filter((name) => run.isAdobeNative(name));
  return { matchNames: (adobe.length > 0 ? adobe : pending).slice(0, run.pageSize), cleanup: false };
}

function ready(run: CatalogueRun, idle: boolean): boolean {
  return !!run.options.enabled && idle && !run.outstanding && !run.storageDown && run.options.now() >= run.cooldownUntil;
}

function mayIssue(run: CatalogueRun, idle: boolean): boolean {
  return ready(run, idle) && run.host !== undefined && !run.paused;
}

function journaled(run: CatalogueRun): boolean {
  try {
    run.journal.save();
    return true;
  } catch {
    run.pause("journal-unwritable");
    return false;
  }
}

function probeRequest(run: CatalogueRun, ticket: string, choice: PageChoice, engine: boolean): CatalogueProbeRequest {
  return {
    schemaVersion: "0.1", requestId: ticket, matchNames: choice.matchNames, budgetMs: run.budgetMs,
    ...(choice.cleanup ? { cleanup: true as const } : { breadcrumb: join(run.options.directory, BREADCRUMB_FILE) }), ...(engine ? { engine: true as const } : {}),
  };
}

function issue(run: CatalogueRun, choice: PageChoice, host: HostJournal, delivery: Delivery): CatalogueMailboxItem | undefined {
  for (const name of choice.matchNames) host.attempts[name] = (host.attempts[name] ?? 0) + 1;
  if (!choice.cleanup) run.journal.cleanup = true;
  if (!journaled(run)) return undefined;
  const ticket = `cat-${run.newId()}`;
  run.outstanding = { ticket, matchNames: choice.matchNames, cleanup: choice.cleanup, handedAt: run.options.now(), panel: delivery.panel, ...(delivery.engine ? { engine: true as const } : {}) };
  run.options.log("catalogue.page-issued", { ticket, hostKey: run.hostKey(), effects: choice.matchNames.length, cleanup: choice.cleanup, single: choice.matchNames.length === 1 && !choice.cleanup });
  return { kind: "catalogue_page", ticket, hostFunction: "aeCatalogueProbePage", hostRequest: probeRequest(run, ticket, choice, delivery.engine) };
}

function mayLearn(run: CatalogueRun, host: HostJournal, matchName: string): boolean {
  const key = run.failureKeyOf(matchName), entry = host.failed[key];
  if (run.isProbed(matchName) || host.instanceReads[key] !== undefined) return false;
  return entry !== undefined ? !UNLEARNABLE_CODES.has(entry.code) : run.isDeferred(matchName);
}

function learnable(run: CatalogueRun): Set<string> {
  const host = run.hostJournal();
  if (!host || !run.options.enabled || !run.options.store.writeInstance || run.storageDown) return new Set();
  return new Set(run.installedNames().filter((name) => mayLearn(run, host, name)));
}

function nextInstance(run: CatalogueRun, idle: boolean, host: HostJournal, panel: string | null): CatalogueInstanceItem | undefined {
  if (!ready(run, idle)) return undefined;
  const target = run.instances.next((name) => mayLearn(run, host, name));
  if (!target) return undefined;
  host.instanceReads[run.failureKeyOf(target.matchName)] = run.options.now();
  if (!journaled(run)) return undefined;
  const ticket = `cat-${run.newId()}`;
  run.outstanding = { ticket, matchNames: [], cleanup: false, handedAt: run.options.now(), panel, instance: target };
  run.options.log("catalogue.instance-issued", { ticket, hostKey: run.hostKey(), matchName: target.matchName });
  return { kind: "catalogue_page", ticket, hostFunction: INSTANCE_HOST_FUNCTION, hostRequest: instanceHostRequest(ticket, target) };
}

function blockedByOutstanding(run: CatalogueRun, panel: string | null, engine: boolean): boolean {
  expireOutstanding(run);
  const page = run.outstanding;
  if (!page) return false;
  if (engine !== (page.engine === true)) return true;
  if (page.panel !== panel) abandonOutstanding(run, page.ticket, "panel-replaced");
  return false;
}

/** The next page for an idle, paired panel, or nothing. Attempts are journaled before the page leaves, so a crash can never lose the record. `engine` marks a page for the headless render engine, which shares the one ticket with the user's After Effects: each waits for the other's page instead of abandoning it. A read of an effect in the user's project goes first, since a real project is open exactly when scratch pages are refused. */
export function nextCatalogueItem(run: CatalogueRun, idle: boolean, panel: string | null, engine: boolean): CatalogueMailboxItem | undefined {
  if (blockedByOutstanding(run, panel, engine)) return undefined;
  const host = run.hostJournal();
  if (!host) return undefined;
  const instance = nextInstance(run, idle, host, panel);
  if (instance || !mayIssue(run, idle)) return instance;
  const choice = selectPage(run, host);
  return choice ? issue(run, choice, host, { panel, engine }) : undefined;
}

/** Only a read of an effect already in the user's project, never a probe page: what the user's own After Effects is offered. */
export function nextInstanceItem(run: CatalogueRun, idle: boolean, panel: string | null): CatalogueInstanceItem | undefined {
  if (blockedByOutstanding(run, panel, false)) return undefined;
  const host = run.hostJournal();
  return host ? nextInstance(run, idle, host, panel) : undefined;
}

/** The panel published a project read: remember where the effects the catalogue lacks appear in it. */
export function observeProjectSnapshot(run: CatalogueRun, snapshot: ProjectSnapshot): void {
  if (run.host) run.instances.observe(snapshot, learnable(run));
}
