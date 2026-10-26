// Collects the effect catalogue in the headless render engine, never in the After Effects the user works in: it starts the engine, asks its census, runs the collector's pages there and replaces the engine when it crashes, stalls or leaves its project dirty.
import { randomUUID } from "node:crypto";
import { array, decode, fallback, jsonValue, map, object, string, type JsonValue } from "@extynt/decode";
import { connectPlugin } from "@extynt/host-native";
import { jsonFieldsOf } from "@extynt/mcp-server";
import type { PluginClient, PluginEndpoint } from "@extynt/host-native";
import type { CatalogueCollector, CatalogueProgress } from "./catalogue-collector.js";
import type { LogFields } from "./catalogue-collector-types.js";
import { engineDiscoveryPid, engineEndpoint, engineHostForVersion, launchEngine, userAfterEffectsOpen } from "./catalogue-engine-process.js";
import type { EngineHost, EngineProcess } from "./catalogue-engine-process.js";
import { askEffectsCensus } from "./host/run-census.js";
import { runEnginePage } from "./host/run-catalogue.js";

type EngineRunState = "idle" | "running" | "done" | "failed";

type EnginePhase = "waiting" | "starting" | "reading-effects" | "learning" | "restarting" | "finished";

type EngineHostResult = { installed: number; collected: number; failed: number; needsSource: number; deferred: number; crashed: string[] };

type EngineHostReport = {
  year: string; state: "pending" | "running" | "done" | "failed"; phase: EnginePhase; engines: number; crashes: number; reason: string | null;
  startedAt: number | null; finishedAt: number | null; result: EngineHostResult | null;
};

interface EngineStatus { state: EngineRunState; hosts: EngineHostReport[]; startedAt: number | null; finishedAt: number | null; catalogue: CatalogueProgress }

interface EngineLimits { startMs: number; idleMs: number; maxEngines: number; totalMs: number; pollMs: number; watchMs: number }

/** What the engine needs from its surroundings: the collector, a way to accept a census, the hosts and files, and replaceable process and connection seams. `finished` is called once a run ends, so the collector goes back to the user's own After Effects; `userOpen` says the user has that After Effects open, so its catalogue is collected another time. */
export interface CatalogueEngineDeps {
  catalogue: Pick<CatalogueCollector, "nextItem" | "complete" | "abandon" | "progress">;
  acceptCensus(census: EffectsCensus): Promise<{ outcome: string; errorCode?: string }>;
  log(event: string, fields: LogFields): void;
  now(): number;
  discoveryPath: string;
  logPath: string;
  hosts(): EngineHost[];
  finished?(): void;
  launch?(host: EngineHost, logPath: string): EngineProcess;
  userOpen?(host: EngineHost): boolean;
  connect?: typeof connectPlugin;
  endpoint?(discoveryPath: string, pid: number | undefined): PluginEndpoint | undefined;
  limits?: Partial<EngineLimits>;
}

type EffectsCensus = Extract<Awaited<ReturnType<typeof askEffectsCensus>>, { ok: true }>["census"];
type EngineEnd = "complete" | "crashed" | "hung" | "stalled" | "start-failed" | "census-failed" | "modal-blocked" | "time-limit" | "after-effects-open" | `paused:${string}`;
type Job = { host: EngineHost; report: EngineHostReport };

const DEFAULT_LIMITS: EngineLimits = { startMs: 90_000, idleMs: 30_000, maxEngines: 12, totalMs: 15 * 60_000, pollMs: 200, watchMs: 30_000 };
const PAGE_TIMEOUT_MS = 25_000;
const MAX_ERROR_MESSAGE = 200;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms).unref(); });

const timedOutPage = object({ error: object({ code: string() }) });
const censusWithEffects = object({
  result: object({ completeness: fallback(string(), null), installedEffects: map(array(jsonValue), (effects) => effects.length) }),
});

/** The catalogue's progress with how many engine hosts this machine has, so a reader can tell "learning" from "nothing here can learn". */
export function catalogueProgressWithEngine<T extends CatalogueProgress>(progress: T, engine: Pick<CatalogueEngine, "hostCount"> | undefined): T & { engineHosts?: number } {
  return engine ? { ...progress, engineHosts: engine.hostCount() } : progress;
}

function givesUp(end: EngineEnd, previous: EngineEnd | null, startFailures: number): boolean {
  return startFailures >= 2 || end === "time-limit" || (end.startsWith("paused:") && end === previous);
}

function hostTimedOut(page: JsonValue): boolean {
  const decoded = decode(timedOutPage, page);
  return decoded.ok && decoded.value.error.code === "HOST_TIMEOUT";
}

function censusHasEffects(census: EffectsCensus): boolean {
  const decoded = decode(censusWithEffects, census);
  return decoded.ok && decoded.value.result.completeness !== "failed" && decoded.value.result.installedEffects > 0;
}

function pendingReport(host: EngineHost): EngineHostReport {
  return { year: host.year, state: "pending", phase: "waiting", engines: 0, crashes: 0, reason: null, startedAt: null, finishedAt: null, result: null };
}

/** Drives the headless render engine for each installed After Effects version until its catalogue is complete or given up on. */
export class CatalogueEngine {
  private readonly limits: EngineLimits;
  private status_: Omit<EngineStatus, "catalogue"> = { state: "idle", hosts: [], startedAt: null, finishedAt: null };
  private running: EngineProcess | undefined;
  private stopped = false;
  private readonly attempted = new Set<string>();
  private readonly deferred = new Set<string>();
  private watcher: NodeJS.Timeout | undefined;
  private censusCode = "";

  constructor(private readonly deps: CatalogueEngineDeps) {
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits };
  }

  hostCount(): number {
    return this.deps.hosts().length;
  }

  status(): EngineStatus {
    return { ...this.status_, hosts: this.status_.hosts.map((host) => ({ ...host })), catalogue: this.deps.catalogue.progress() };
  }

  collect(years?: readonly string[]): Promise<EngineStatus> {
    if (this.status_.state === "running") return Promise.resolve(this.status());
    const jobs = this.deps.hosts().filter((host) => !years || years.includes(host.year)).map((host): Job => ({ host, report: pendingReport(host) }));
    for (const job of jobs) this.attempted.add(job.host.year);
    this.status_ = { state: "running", hosts: jobs.map((job) => job.report), startedAt: this.deps.now(), finishedAt: null };
    return this.run(jobs);
  }

  onCensus(appVersion: string): void {
    if (this.status_.state === "running" || this.deps.catalogue.progress().pending === 0) return;
    const host = engineHostForVersion(this.deps.hosts(), appVersion);
    if (!host || this.attempted.has(host.year) || this.deferred.has(host.year)) return;
    this.deps.log("catalogue.engine-wanted", { year: host.year, pending: this.deps.catalogue.progress().pending });
    if (!this.userOpen(host)) {
      void this.collect([host.year]);
      return;
    }
    this.deferred.add(host.year);
    this.watcher ??= setInterval(() => this.collectDeferred(), this.limits.watchMs);
    this.watcher.unref();
  }

  stop(): void {
    this.stopped = true;
    this.endWatch();
    this.running?.stop();
  }

  private userOpen(host: EngineHost): boolean {
    return this.deps.userOpen ? this.deps.userOpen(host) : userAfterEffectsOpen(host, undefined, engineDiscoveryPid(this.deps.discoveryPath));
  }

  private collectDeferred(): void {
    if (this.status_.state === "running") return;
    for (const year of [...this.deferred]) {
      const host = this.deps.hosts().find((candidate) => candidate.year === year);
      if (host && this.userOpen(host)) continue;
      this.deferred.delete(year);
      if (host && this.deps.catalogue.progress().pending > 0) {
        void this.collect([year]);
        break;
      }
    }
    if (this.deferred.size === 0) this.endWatch();
  }

  private endWatch(): void {
    clearInterval(this.watcher);
    this.watcher = undefined;
  }

  private async run(jobs: readonly Job[]): Promise<EngineStatus> {
    const deadline = this.deps.now() + this.limits.totalMs;
    for (const job of jobs) await this.collectHost(job, deadline);
    const failed = jobs.length === 0 || this.status_.hosts.some((host) => host.state === "failed");
    this.status_ = { ...this.status_, state: failed ? "failed" : "done", finishedAt: this.deps.now() };
    const { state: catalogue, collected, pending, failed: failedEffects, deferred } = this.deps.catalogue.progress();
    this.deps.log("catalogue.engine-finished", { state: this.status_.state, hosts: this.status_.hosts, ms: this.deps.now() - (this.status_.startedAt ?? 0), catalogue, collected, pending, failed: failedEffects, deferred });
    this.deps.finished?.();
    return this.status();
  }

  private async collectHost(job: Job, deadline: number): Promise<void> {
    const { host, report } = job;
    Object.assign(report, { state: "running", startedAt: this.deps.now() });
    if (this.userOpen(host)) {
      Object.assign(report, { state: "failed", phase: "finished", reason: "after-effects-open", finishedAt: this.deps.now() });
      this.deps.log("catalogue.engine-ended", { year: host.year, engine: 0, end: "after-effects-open" });
      return;
    }
    const censusSeen = await this.engines(job, deadline);
    Object.assign(report, { state: report.reason === "complete" ? "done" : "failed", phase: "finished", finishedAt: this.deps.now(), result: censusSeen ? this.resultNow() : null });
  }

  private async engines(job: Job, deadline: number): Promise<boolean> {
    let startFailures = 0, previous: EngineEnd | null = null, censusSeen = false;
    while (this.mayStartEngine(job, deadline)) {
      const end = await this.oneEngine(job, deadline);
      const startFailed = end === "start-failed" || end === "census-failed" || end === "modal-blocked";
      censusSeen ||= !startFailed;
      this.noteEnd(job, end);
      if (end === "complete") break;
      startFailures = startFailed ? startFailures + 1 : 0;
      if (givesUp(end, previous, startFailures)) break;
      previous = end;
      job.report.phase = "restarting";
    }
    return censusSeen;
  }

  private mayStartEngine(job: Job, deadline: number): boolean {
    return !this.stopped && job.report.engines < this.limits.maxEngines && this.deps.now() < deadline;
  }

  private noteEnd(job: Job, end: EngineEnd): void {
    job.report.reason = end;
    if (end === "crashed" || end === "hung") job.report.crashes += 1;
    this.deps.log("catalogue.engine-ended", { year: job.host.year, engine: job.report.engines, end });
  }

  private resultNow(): EngineHostResult {
    const progress = this.deps.catalogue.progress();
    const crashed = (progress.failedEffects ?? []).filter((effect) => effect.reason === "crashed-after-effects").map((effect) => effect.name ?? effect.matchName);
    return { installed: progress.installed, collected: progress.collected, failed: progress.failed, needsSource: progress.needsSource, deferred: progress.deferred, crashed };
  }

  private async oneEngine(job: Job, deadline: number): Promise<EngineEnd> {
    const { host, report } = job;
    report.engines += 1;
    if (report.phase !== "restarting") report.phase = "starting";
    const engine = (this.deps.launch ?? launchEngine)(host, this.deps.logPath);
    this.running = engine;
    try {
      return await this.inEngine(engine, report, deadline);
    } catch (error) {
      this.deps.log("catalogue.engine-error", { year: host.year, message: error instanceof Error ? error.message.slice(0, MAX_ERROR_MESSAGE) : String(error) });
      return engine.alive() ? "start-failed" : "crashed";
    } finally {
      engine.stop();
      this.running = undefined;
    }
  }

  private async inEngine(engine: EngineProcess, report: EngineHostReport, deadline: number): Promise<EngineEnd> {
    const endpoint = await this.waitForEndpoint(engine);
    if (!endpoint) return "start-failed";
    report.phase = "reading-effects";
    let closed = false;
    const client = await (this.deps.connect ?? connectPlugin)({ endpoint, onEvent: () => undefined, onClose: () => { closed = true; } });
    try {
      if (!await this.census(client)) return this.censusCode === "HOST_MODAL_DIALOG" ? "modal-blocked" : "census-failed";
      report.phase = "learning";
      return await this.pages(client, engine, () => closed, deadline);
    } finally {
      client.close();
    }
  }

  private async waitForEndpoint(engine: EngineProcess): Promise<PluginEndpoint | undefined> {
    const until = this.deps.now() + this.limits.startMs, read = this.deps.endpoint ?? engineEndpoint;
    while (this.deps.now() < until && engine.alive() && !this.stopped) {
      const endpoint = read(this.deps.discoveryPath, engine.pid);
      if (endpoint) return endpoint;
      await sleep(this.limits.pollMs);
    }
    return undefined;
  }

  private async census(client: PluginClient): Promise<boolean> {
    const asked = await askEffectsCensus(client, `engine-census-${randomUUID().slice(0, 8)}`);
    this.censusCode = asked.ok ? "" : asked.failure.code;
    if (!asked.ok) {
      this.deps.log("catalogue.engine-census-failed", { code: asked.failure.code });
      return false;
    }
    if (!censusHasEffects(asked.census)) {
      this.deps.log("catalogue.engine-census-failed", { code: "CENSUS_EMPTY" });
      return false;
    }
    const accepted = await this.deps.acceptCensus(asked.census);
    return accepted.outcome === "succeeded";
  }

  private settle(ticket: string, page: JsonValue): boolean {
    try {
      this.deps.catalogue.complete(ticket, page);
      return true;
    } catch {
      return false;
    }
  }

  private async pages(client: PluginClient, engine: EngineProcess, closed: () => boolean, deadline: number): Promise<EngineEnd> {
    const panel = `engine:${engine.pid ?? "?"}`;
    let idleSince = this.deps.now();
    while (!this.stopped) {
      if (this.deps.now() >= deadline) return "time-limit";
      const item = this.deps.catalogue.nextItem(true, panel, true);
      if (!item) {
        const waiting = this.whyNoPage(idleSince);
        if (waiting) return waiting;
        await sleep(this.limits.pollMs);
        continue;
      }
      const page = await this.whileAlive(engine, client, () => runEnginePage(jsonFieldsOf(item), client, this.deps.log, PAGE_TIMEOUT_MS));
      const lost = this.lostEngine(engine, closed(), item.ticket, page);
      if (lost) return lost;
      this.settle(item.ticket, page);
      idleSince = this.deps.now();
    }
    return "stalled";
  }

  private lostEngine(engine: EngineProcess, closed: boolean, ticket: string, page: JsonValue): EngineEnd | undefined {
    if (!engine.alive() || closed) {
      this.deps.catalogue.abandon(ticket, "engine-exit");
      return "crashed";
    }
    if (!hostTimedOut(page)) return undefined;
    engine.stop();
    this.deps.catalogue.abandon(ticket, "engine-hung");
    return "hung";
  }

  private async whileAlive<T>(engine: EngineProcess, client: PluginClient, call: () => Promise<T>): Promise<T> {
    const watch = setInterval(() => { if (!engine.alive()) client.close(); }, this.limits.pollMs);
    try {
      return await call();
    } finally {
      clearInterval(watch);
    }
  }

  private whyNoPage(idleSince: number): EngineEnd | undefined {
    const progress = this.deps.catalogue.progress();
    if (progress.state === "complete") return "complete";
    if (progress.state === "paused") return `paused:${progress.pauseReason ?? "unknown"}`;
    if (progress.state !== "collecting") return `paused:${progress.state}`;
    return this.deps.now() - idleSince >= this.limits.idleMs ? "stalled" : undefined;
  }
}
