/** Native read results to the probe envelope the existing `/v1/snapshots` core takes: normaliser, merge, fingerprint and focus run unchanged on it. */
import { hostIdentityOf } from "@extynt/host-native";
import type { PingDirectResult, WatchState } from "@extynt/host-native";
import { SNAPSHOT_SCHEMA_VERSION } from "../server-contracts.js";
import type { ProbeSnapshot } from "../server-types.js";
import type { Row } from "../snapshot-view.js";
import { detailsLookup, probeComposition } from "./rows.js";
import { anyResult, readCompositions } from "./read-set.js";
import { rowsOf, type CompositionFacts } from "./row-facts.js";
import type { InterruptedApply, NativeReadSet } from "./types.js";

type Runtime = ProbeSnapshot["result"]["runtime"];
type ExtraResult = {
  hostStamp?: { epoch: number; revision: number };
  itemCount?: number;
  readScope: { compositions: "all" | "listed"; items: "read" | "skipped" };
  revision?: string;
  currentTime: number | null;
  items?: Row[];
  sources?: Row[];
  compositionPages: { unread: string[]; partial: string[]; capped: boolean };
  truncation: { truncated: boolean; limits: Record<string, never> };
  interruptedApply?: InterruptedApply;
};

/** The plugin loads on macOS and Windows only and the sidecar runs on the machine After Effects is on, so the sidecar's own OS is the host's (evidence and host keys stay per platform). Any other OS is a development machine and reads as macOS. */
export function hostPlatformOf(nodePlatform: string = process.platform): "macOS" | "Windows" {
  return nodePlatform === "win32" ? "Windows" : "macOS";
}

function architectureOf(arch: string): Runtime["architecture"] {
  return arch === "arm64" || arch === "x86_64" ? arch : "unknown";
}

function runtimeOf(ping: PingDirectResult, nodePlatform?: string): Runtime {
  const match = /^(.*?)(?: \(build ([^)]*)\))?$/.exec(ping.aeVersion.trim());
  return { application: "After Effects", appVersion: match?.[1] || ping.aeVersion, buildNumber: match?.[2] ?? null, buildName: null, platform: hostPlatformOf(nodePlatform), architecture: architectureOf(ping.arch), compatible: hostIdentityOf(ping.host, ping.aeVersion)?.supported ?? true };
}

function projectOf(read: NativeReadSet): { name: string; filePath: string | null } {
  const result = anyResult(read);
  if (result) return { name: result.project.name, filePath: result.project.filePath };
  return { name: read.stamp.projectName, filePath: read.stamp.projectPath };
}

function warningsOf(read: NativeReadSet): string[] {
  return [...new Set([...(read.project?.warnings ?? []), ...read.comps.flatMap((comp) => comp.warnings)])];
}

function focusOf(read: NativeReadSet): { activeCompositionId: string | null; currentTime: number | null; selectedLayerIds: string[] } {
  const result = anyResult(read), stamp: WatchState = read.stamp;
  return {
    activeCompositionId: result?.activeCompositionId ?? stamp.activeCompId,
    currentTime: result?.currentTime ?? stamp.time,
    selectedLayerIds: result?.selectedLayerIds ?? stamp.selection,
  };
}

function readScopeOf(read: NativeReadSet): ExtraResult["readScope"] {
  const scope = read.scope;
  if (scope.kind === "full") return { compositions: "all", items: "read" };
  return { compositions: "listed", items: scope.includeItems ? "read" : "skipped" };
}

function itemCountOf(read: NativeReadSet, withItems: boolean): number | undefined {
  return withItems ? read.project?.itemCount : read.stamp.items ?? undefined;
}

function itemsOf(read: NativeReadSet): Pick<ExtraResult, "items" | "sources" | "itemCount" | "readScope"> {
  const readScope = readScopeOf(read), withItems = readScope.items === "read", itemCount = itemCountOf(read, withItems);
  const lists = withItems && read.project ? { items: rowsOf(read.project.items), sources: rowsOf(read.project.sources) } : {};
  return { ...lists, readScope, ...(itemCount === undefined ? {} : { itemCount }) };
}

function extraOf(read: NativeReadSet, breadcrumb: InterruptedApply | null, warnings: string[], compositions: readonly CompositionFacts[]): ExtraResult {
  const { revision } = read.stamp, focus = focusOf(read);
  return {
    ...itemsOf(read),
    ...(revision === null ? {} : { hostStamp: { epoch: read.stamp.epoch, revision }, revision: String(revision) }),
    currentTime: focus.currentTime,
    compositionPages: { unread: [], partial: [], capped: false },
    truncation: { truncated: warnings.length > 0 || compositions.some((composition) => composition.truncated), limits: {} },
    ...(breadcrumb ? { interruptedApply: breadcrumb } : {}),
  };
}

/**
 * Builds the probe envelope for one native read set. Hash members are dropped (see `layerHashIndex`), `{unsupported}` values become
 * the details value or `null`, and `keyDigest` comes from the details call. The documented differences from a probe read are
 * `DOCUMENTED_DIFFERENCES` (differences.ts), and a golden test holds the envelope to them.
 */
export function toProbeEnvelope(read: NativeReadSet, breadcrumb: InterruptedApply | null, nodePlatform?: string): ProbeSnapshot {
  const lookup = detailsLookup(read.details?.ok ? read.details.layers : undefined);
  const markerLists = new Map((read.details?.ok ? read.details.compositions ?? [] : []).map((entry) => [entry.compId, entry.markers]));
  const facts = readCompositions(read), compositions = facts.map((composition) => probeComposition(composition, lookup, markerLists.get(composition.id)));
  const warnings = warningsOf(read), focus = focusOf(read);
  const result: ProbeSnapshot["result"] & ExtraResult = {
    runtime: runtimeOf(read.ping, nodePlatform),
    project: projectOf(read),
    activeCompositionId: focus.activeCompositionId,
    selectedLayerIds: focus.selectedLayerIds,
    compositions,
    ...extraOf(read, breadcrumb, warnings, facts),
  };
  return { schemaVersion: SNAPSHOT_SCHEMA_VERSION, ok: true, requestId: read.requestId, result, warnings };
}
