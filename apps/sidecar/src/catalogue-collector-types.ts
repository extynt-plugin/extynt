// The vocabulary of the catalogue collector: its store and options, the progress it reports, the mailbox items it hands out and the failure codes it journals.
import type { JsonObject } from "@extynt/decode";
import type { CatalogueProbeWrite } from "./catalogue-definitions.js";
import type { CatalogueInstanceWrite } from "./catalogue-instance-definitions.js";
import type { InstanceHostRequest, INSTANCE_HOST_FUNCTION } from "./catalogue-instances.js";

/** The failure of a page that never completed on its retry alone: inferred, and forgiven by the user's Collect press. */
export const CRASH_FAILURE = "crashes-or-hangs-on-apply";

/** The host's breadcrumb proved AE went down inside this effect's add or removal. Unlike CRASH_FAILURE (inferred, and forgiven by the user's Collect press) this is never applied again on this host and version. */
export const CRASH_IDENTIFIED = "crashed-after-effects";

/** The host could add the effect (canAddProperty said so) and AE answered without crashing, but gave nothing back: the effect needs a layer of its own kind. */
export const NEEDS_SOURCE = "needs-layer-source";

/** An add that held AE this long was waiting on a window (file picker, licence prompt), not computing. */
export const INTERACTIVE_APPLY_MS = 1500;

/** /health and ae_status stay small however many effects a plugin pack breaks. */
export const MAX_REPORTED_FAILURES = 10;

/** The words shown for effects that need a layer source of their own. */
export const NEEDS_SOURCE_NOTE = "needs a layer of its own kind (e.g. a C4D file layer); learned when it appears in one of your projects";

/** The fields one collector log event carries. */
export type LogFields = JsonObject;

interface CatalogueStore {
  probedKeys(hostKey: string): Set<string> | undefined;
  writeProbe(inputs: readonly CatalogueProbeWrite[]): { written: string[]; failed: Array<{ matchName: string; code: string }> } | undefined;
  writeInstance?(input: CatalogueInstanceWrite): { written: boolean; code: string | null } | undefined;
}

/** How the collector is built. Collection is off unless `enabled`, so a sidecar built by a test harness never starts probing by itself. `adobeNative` says which effects are Adobe's own and defaults to the `ADBE ` match-name prefix (synthetic test hosts override it). */
export interface CatalogueCollectorOptions {
  directory: string; now(): number; store: CatalogueStore; log(event: string, fields: LogFields): void;
  enabled?: boolean; newId?(): string;
  adobeNative?(matchName: string): boolean; pageSize?: number; budgetMs?: number; pageTimeoutMs?: number; cooldownMs?: number; onProbed?(hostKey: string, matchNames: readonly string[]): void;
}

/** Where collection stands: not enabled, waiting for a census, running, paused, finished or without storage. */
export type CatalogueState = "disabled" | "idle" | "collecting" | "paused" | "complete" | "unavailable";

/** One effect that could not be collected: `detail` is After Effects' own words for the refusal when it gave any. */
export interface CatalogueFailedEffect { matchName: string; name: string | null; reason: string; detail: string | null; at: string }

/** What /health and ae_status report about collection. `needsSource` counts effects the test layer cannot take because they need a layer of their own kind (a C4D file layer, say): not broken, and learned from a project instance. `deferred` counts effects waiting for the user's own "Collect" press (effects that open a window, plugins after a crash or lost page) and those known to open a dialog under any script, which no probe takes. `probedThisRun` counts the effects the host answered since this census, which with `totalProbeMs` gives the measured per-effect probe time. `failedEffects` and `needsSourceEffects` are bounded lists present only when something failed or needs a source; `needsSourceNote` is the words shown for the latter. */
export interface CatalogueProgress {
  state: CatalogueState; hostKey: string | null; installed: number; collected: number; pending: number; failed: number;
  needsSource: number; deferred: number;
  lastPageMs: number | null; totalProbeMs: number; probedThisRun: number;
  pauseReason: string | null; outstanding: boolean;
  failedEffects?: CatalogueFailedEffect[];
  needsSourceEffects?: CatalogueFailedEffect[]; needsSourceNote?: string;
}

/** The request of one probe page. */
export interface CatalogueProbeRequest { schemaVersion: "0.1"; requestId: string; matchNames: string[]; budgetMs: number; cleanup?: true; breadcrumb?: string; engine?: true }

interface CataloguePageItem { kind: "catalogue_page"; ticket: string; hostFunction: "aeCatalogueProbePage"; hostRequest: CatalogueProbeRequest }

/** A read-only look at one effect already in the user's project; it changes nothing. */
export interface CatalogueInstanceItem { kind: "catalogue_page"; ticket: string; hostFunction: typeof INSTANCE_HOST_FUNCTION; hostRequest: InstanceHostRequest }

/** Either kind of item the panel can be handed. */
export type CatalogueMailboxItem = CataloguePageItem | CatalogueInstanceItem;

/** The collector's answer to a completed page. */
export interface CatalogueCompletion { ok: true; accepted: boolean; written: number; failed: number; remaining: number; state: CatalogueState }
