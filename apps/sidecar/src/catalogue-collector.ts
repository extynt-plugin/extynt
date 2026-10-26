// Decides what the catalogue collects and when; the run state, the paging and the completion rules live in the modules it composes.
import type { JsonValue } from "@extynt/decode";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { completeOutstanding } from "./catalogue-completion.js";
import { CRASH_FAILURE, NEEDS_SOURCE, NEEDS_SOURCE_NOTE } from "./catalogue-collector-types.js";
import type { CatalogueCollectorOptions, CatalogueCompletion, CatalogueInstanceItem, CatalogueMailboxItem, CatalogueProgress, CatalogueState } from "./catalogue-collector-types.js";
import { abandonOutstanding, expireOutstanding, nextCatalogueItem, nextInstanceItem, observeProjectSnapshot } from "./catalogue-pages.js";
import { CatalogueRun, codeUnitOrder } from "./catalogue-run.js";
import type { HostCensus } from "./server-types.js";

export { CRASH_FAILURE, CRASH_IDENTIFIED, INTERACTIVE_APPLY_MS } from "./catalogue-collector-types.js";
export type { CatalogueProgress } from "./catalogue-collector-types.js";

const PROJECT_RESUME_INTERVAL_MS = 30_000;

/** Decides what to collect and when. The panel only runs the page it is handed; every state change that matters is journaled first. */
export class CatalogueCollector {
  private readonly run: CatalogueRun;
  private projectEpoch: number | undefined;
  private lastProjectResumeAt = Number.NEGATIVE_INFINITY;

  constructor(options: CatalogueCollectorOptions) {
    this.run = new CatalogueRun(options);
  }

  onCensus(census: HostCensus, definitionsWritten = true): void {
    const run = this.run;
    run.describeCensus(census);
    run.resume();
    run.runId = run.newId();
    run.manual = false;
    run.lastPageMs = null;
    run.totalProbeMs = 0;
    run.probedThisRun = 0;
    run.instances.reset();
    run.rebuildProbed();
    run.settleHostSetupEffects();
    if (!definitionsWritten) run.pause("census-definitions-not-stored");
    run.options.log("catalogue.census", { hostKey: run.hostKey(), ...run.counts() });
  }

  start(): CatalogueProgress | { ok: false; code: "NO_CENSUS" } {
    const run = this.run;
    if (!run.host) return { ok: false, code: "NO_CENSUS" };
    run.resume();
    run.rebuildProbed();
    run.manual = true;
    run.forgiveCrashers(CRASH_FAILURE);
    run.options.log("catalogue.start", { hostKey: run.host.key, ...run.counts() });
    return this.progress();
  }

  observeProjectEpoch(epoch: number): void {
    const run = this.run;
    if (run.paused !== "not-scratch-project" || this.projectEpoch === undefined) {
      this.projectEpoch = epoch;
      return;
    }
    const now = run.options.now();
    if (this.projectEpoch === epoch || now - this.lastProjectResumeAt < PROJECT_RESUME_INTERVAL_MS) return;
    this.projectEpoch = epoch;
    this.lastProjectResumeAt = now;
    run.resume();
    run.options.log("catalogue.resumed", { reason: "project-changed", hostKey: run.hostKey() });
  }

  userAssistedNames(): string[] {
    return Object.keys(this.run.hostJournal()?.interactive ?? {}).sort(codeUnitOrder);
  }

  private currentState(pending: number): CatalogueState {
    const run = this.run;
    if (!run.options.enabled) return "disabled";
    if (!run.host) return "idle";
    if (run.storageDown) return "unavailable";
    if (run.paused) return "paused";
    return pending > 0 || run.journal.cleanup ? "collecting" : "complete";
  }

  progress(): CatalogueProgress {
    const run = this.run;
    expireOutstanding(run);
    const counts = run.counts();
    const failedEffects = counts.failed > 0 ? run.reportedEffects((code) => code !== NEEDS_SOURCE) : [];
    const needsSourceEffects = counts.needsSource > 0 ? run.reportedEffects((code) => code === NEEDS_SOURCE) : [];
    return {
      state: this.currentState(counts.pending), hostKey: run.hostKey(), ...counts,
      ...(failedEffects.length ? { failedEffects } : {}), ...(needsSourceEffects.length ? { needsSourceEffects } : {}), ...(counts.needsSource > 0 ? { needsSourceNote: NEEDS_SOURCE_NOTE } : {}),
      lastPageMs: run.lastPageMs, totalProbeMs: run.totalProbeMs, probedThisRun: run.probedThisRun,
      pauseReason: run.paused ?? (run.storageDown ? "graph-storage-unavailable" : null), outstanding: run.outstanding !== undefined,
    };
  }

  abandon(ticket: string, reason: string): void {
    abandonOutstanding(this.run, ticket, reason);
  }

  outstandingTicket(): string | undefined {
    return this.run.outstanding?.ticket;
  }

  nextItem(idle: boolean, panel: string | null, engine = false): CatalogueMailboxItem | undefined {
    return nextCatalogueItem(this.run, idle, panel, engine);
  }

  nextInstanceRead(idle: boolean, panel: string | null): CatalogueInstanceItem | undefined {
    return nextInstanceItem(this.run, idle, panel);
  }

  observeSnapshot(snapshot: ProjectSnapshot): void {
    observeProjectSnapshot(this.run, snapshot);
  }

  complete(ticket: string, rawPage: JsonValue): CatalogueCompletion {
    const settled = completeOutstanding(this.run, ticket, rawPage);
    return { ...settled, state: this.progress().state };
  }
}
