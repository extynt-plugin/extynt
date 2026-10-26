// The collector's shared state for one host run: what is installed, probed, failed or waiting, with the derived tables (keys, collection order) computed once per census.
import { randomUUID } from "node:crypto";
import { DIALOG_EFFECTS, EFFECT_HOST_CAVEATS } from "@extynt/capability-catalogue";
import { catalogueProbeKey } from "./catalogue-definitions.js";
import { catalogueInstanceKey } from "./catalogue-instance-definitions.js";
import { CatalogueJournal } from "./catalogue-journal.js";
import type { HostJournal } from "./catalogue-journal.js";
import { InstanceQueue } from "./catalogue-instances.js";
import type { InstanceTarget } from "./catalogue-instances.js";
import { CATALOGUE_MAX_EFFECTS } from "./catalogue-page.js";
import { MAX_REPORTED_FAILURES, NEEDS_SOURCE } from "./catalogue-collector-types.js";
import type { CatalogueCollectorOptions, CatalogueFailedEffect } from "./catalogue-collector-types.js";
import type { HostCensus } from "./server-types.js";

interface Host { key: string; version: string; build: string | null }

/** The page or instance read currently handed to a panel or engine. */
export interface Outstanding { ticket: string; matchNames: string[]; cleanup: boolean; handedAt: number; panel: string | null; instance?: InstanceTarget; engine?: true }

type CatalogueCounts = { installed: number; collected: number; pending: number; failed: number; needsSource: number; deferred: number };

type InstalledEffect = HostCensus["result"]["installedEffects"][number];

interface KnownEffect { version: string | null; probeKey: string; instanceKey: string; failureKey: string }

const ADOBE_PREFIX = "ADBE ";
const DEFAULT_BUDGET_MS = 200;
const MAX_BUDGET_MS = 400;
const DEFAULT_PAGE_TIMEOUT_MS = 90_000;
const DEFAULT_COOLDOWN_MS = 5_000;
const MAX_DISPLAY_NAME = 128;

function adobePrefix(matchName: string): boolean {
  return matchName.startsWith(ADOBE_PREFIX);
}

/** Orders strings by UTF-16 code unit, the order the journal and the reports use. */
export function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Collected state of one catalogue run; the collector's other modules read and change it. */
export class CatalogueRun {
  readonly journal: CatalogueJournal;
  readonly instances = new InstanceQueue();
  readonly pageSize: number;
  readonly budgetMs: number;
  readonly pageTimeoutMs: number;
  readonly cooldownMs: number;
  host: Host | undefined;
  probed = new Set<string>();
  paused: string | null = null;
  storageDown = false;
  runId = "";
  outstanding: Outstanding | undefined;
  cooldownUntil = 0;
  consecutiveFailures = 0;
  lastPageMs: number | null = null;
  totalProbeMs = 0;
  probedThisRun = 0;
  manual = false;
  private known = new Map<string, KnownEffect>();
  private displayNames = new Map<string, string>();
  private collectionOrder: string[] = [];

  constructor(readonly options: CatalogueCollectorOptions) {
    this.journal = new CatalogueJournal(options.directory);
    this.pageSize = Math.max(1, Math.min(CATALOGUE_MAX_EFFECTS, options.pageSize ?? CATALOGUE_MAX_EFFECTS));
    this.budgetMs = Math.max(1, Math.min(MAX_BUDGET_MS, options.budgetMs ?? DEFAULT_BUDGET_MS));
    this.pageTimeoutMs = options.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  newId(): string {
    return this.options.newId ? this.options.newId() : randomUUID();
  }

  hostJournal(): HostJournal | undefined {
    return this.host ? this.journal.host(this.host.key) : undefined;
  }

  installedNames(): string[] {
    return [...this.known.keys()];
  }

  isInstalled(matchName: string): boolean {
    return this.known.has(matchName);
  }

  versionOf(matchName: string): string | null {
    return this.known.get(matchName)?.version ?? null;
  }

  failureKeyOf(matchName: string): string {
    return this.known.get(matchName)?.failureKey ?? `${matchName}\0`;
  }

  markProbed(matchName: string, source: "probe" | "instance"): void {
    const entry = this.known.get(matchName);
    if (entry) this.probed.add(source === "probe" ? entry.probeKey : entry.instanceKey);
  }

  rebuildProbed(): void {
    const keys = this.host ? this.options.store.probedKeys(this.host.key) : undefined;
    this.storageDown = keys === undefined;
    this.probed = keys ?? new Set();
  }

  describeCensus(census: HostCensus): void {
    const runtime = census.result.runtime;
    this.host = { key: `${runtime.application}:${runtime.appVersion}:${runtime.platform}`, version: runtime.appVersion, build: runtime.buildNumber ?? null };
    this.known = new Map();
    this.displayNames = new Map();
    if (census.result.completeness !== "failed") for (const effect of census.result.installedEffects) if (effect.available !== false) this.remember(this.host.build, effect);
    this.collectionOrder = this.installedNames().sort((left, right) => this.adobeFirst(left, right));
  }

  private remember(build: string | null, effect: InstalledEffect): void {
    const version = effect.version || null;
    this.known.set(effect.matchName, {
      version, probeKey: catalogueProbeKey(effect.matchName, build, version), instanceKey: catalogueInstanceKey(effect.matchName, build, version), failureKey: `${effect.matchName}\0${version ?? ""}`,
    });
    if (effect.displayName) this.displayNames.set(effect.matchName, effect.displayName.slice(0, MAX_DISPLAY_NAME));
  }

  hostKey(): string | null {
    return this.host?.key ?? null;
  }

  pause(reason: string): void {
    this.paused = reason;
    this.options.log("catalogue.paused", { reason, hostKey: this.hostKey() });
  }

  resume(): void {
    this.paused = null;
    this.consecutiveFailures = 0;
    this.cooldownUntil = 0;
  }

  coolDown(): void {
    this.cooldownUntil = this.options.now() + this.cooldownMs;
  }

  saveQuietly(): void {
    try { this.journal.save(); } catch { this.pause("journal-unwritable"); }
  }

  failureEntry(matchName: string): HostJournal["failed"][string] | undefined {
    return this.hostJournal()?.failed[this.failureKeyOf(matchName)];
  }

  isProbed(matchName: string): boolean {
    const entry = this.known.get(matchName);
    return entry !== undefined && (this.probed.has(entry.probeKey) || this.probed.has(entry.instanceKey));
  }

  isFailed(matchName: string): boolean {
    return this.failureEntry(matchName) !== undefined;
  }

  private needsSource(matchName: string): boolean {
    return this.failureEntry(matchName)?.code === NEEDS_SOURCE;
  }

  isAdobeNative(matchName: string): boolean {
    return (this.options.adobeNative ?? adobePrefix)(matchName);
  }

  private adobeFirst(left: string, right: string): number {
    return Number(!this.isAdobeNative(left)) - Number(!this.isAdobeNative(right)) || codeUnitOrder(left, right);
  }

  isDeferred(matchName: string): boolean {
    if (DIALOG_EFFECTS[matchName] !== undefined) return true;
    const host = this.hostJournal();
    return !this.manual && host !== undefined && host.interactive[matchName] !== undefined;
  }

  pendingNames(): string[] {
    return this.collectionOrder.filter((name) => !this.isProbed(name) && !this.isFailed(name) && !this.isDeferred(name));
  }

  counts(): CatalogueCounts {
    const names = this.collectionOrder, open = names.filter((name) => !this.isProbed(name));
    const unsettled = open.filter((name) => this.isFailed(name)), needsSource = unsettled.filter((name) => this.needsSource(name)).length;
    const deferred = open.filter((name) => !this.isFailed(name) && this.isDeferred(name)).length;
    return { installed: names.length, collected: names.length - open.length, pending: open.length - unsettled.length - deferred, failed: unsettled.length - needsSource, needsSource, deferred };
  }

  reportedEffects(which: (code: string) => boolean): CatalogueFailedEffect[] {
    const failed = this.collectionOrder.flatMap((matchName) => {
      const entry = this.isProbed(matchName) ? undefined : this.failureEntry(matchName);
      return entry && which(entry.code) ? [{ matchName, entry }] : [];
    });
    return failed.sort((left, right) => codeUnitOrder(left.matchName, right.matchName)).slice(0, MAX_REPORTED_FAILURES).map(({ matchName, entry }) => ({
      matchName: matchName.slice(0, MAX_DISPLAY_NAME), name: this.displayNames.get(matchName) ?? null, reason: entry.code, detail: entry.detail ?? null, at: new Date(entry.at).toISOString(),
    }));
  }

  recordFailure(matchName: string, code: string, detail?: string): void {
    const host = this.hostJournal();
    if (!host || !this.host) return;
    host.failed[this.failureKeyOf(matchName)] = { code, at: this.options.now(), ...(detail ? { detail } : {}) };
    delete host.attempts[matchName];
    this.options.log("catalogue.effect-failed", { hostKey: this.host.key, matchName, code, ...(detail ? { detail } : {}) });
  }

  clearAttempts(matchNames: readonly string[]): void {
    const host = this.hostJournal();
    if (host) for (const name of matchNames) delete host.attempts[name];
  }

  forgiveCrashers(crashFailure: string): void {
    const host = this.hostJournal();
    if (!host) return;
    for (const [key, entry] of Object.entries(host.failed)) if (entry.code === crashFailure) delete host.failed[key];
    this.saveQuietly();
  }

  settleHostSetupEffects(): void {
    let settled = false;
    for (const name of this.known.keys()) {
      const caveat = EFFECT_HOST_CAVEATS[name];
      if (caveat?.code !== "EFFECT_NEEDS_HOST_SETUP" || this.isProbed(name) || this.isFailed(name)) continue;
      this.recordFailure(name, NEEDS_SOURCE, caveat.message);
      settled = true;
    }
    if (settled) this.saveQuietly();
  }
}
