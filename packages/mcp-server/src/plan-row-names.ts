// Plain display names for the properties and effects a plan row names: the snapshot, then this host's own profile, then the curated catalogue.
import { BASE_CATALOGUE, type HostCapabilityProfile } from "@extynt/capability-catalogue";
import { findProperty, type LayerSnapshot } from "@extynt/project-graph";
import { humanizeName } from "./plan-row-format.js";
import type { RowState } from "./plan-row-context.js";

type LabelState = Pick<RowState, "hostNames" | "translate">;

let catalogueNamesCache: ReadonlyMap<string, string> | undefined;
const byProfile = new WeakMap<HostCapabilityProfile, ReadonlyMap<string, string>>();

type NamedControl = { readonly matchName?: string; readonly displayName: string };

function nameFirst(names: Map<string, string>, named: NamedControl): void {
  if (named.matchName && !names.has(named.matchName)) names.set(named.matchName, named.displayName);
}

function addEffectNames(names: Map<string, string>, entry: HostCapabilityProfile["entries"][number]): void {
  if (entry.kind !== "effect" || !entry.matchName) return;
  names.set(entry.matchName, entry.displayName);
  for (const control of entry.controls ?? []) nameFirst(names, control);
}

/** Every effect and control name this host reported, by match name; a third-party effect's controls are only named here. */
export function profileNames(profile: HostCapabilityProfile | undefined): ReadonlyMap<string, string> {
  if (!profile) return new Map();
  const cached = byProfile.get(profile);
  if (cached) return cached;
  const names = new Map<string, string>();
  for (const entry of profile.entries) addEffectNames(names, entry);
  byProfile.set(profile, names);
  return names;
}

function catalogueNames(): ReadonlyMap<string, string> {
  if (catalogueNamesCache) return catalogueNamesCache;
  const names = new Map<string, string>();
  for (const capability of BASE_CATALOGUE.capabilities) {
    nameFirst(names, capability);
    for (const control of capability.controls ?? []) nameFirst(names, control);
  }
  catalogueNamesCache = names;
  return names;
}

function lastSegment(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function matchNameLabel(matchName: string, hostNames?: ReadonlyMap<string, string>): string {
  return hostNames?.get(matchName) ?? catalogueNames().get(matchName) ?? humanizeName(matchName);
}

function segmentLabel(segment: string, hostNames?: ReadonlyMap<string, string>): string {
  const [, matchName, ordinal] = /^(.+)#(\d+)$/.exec(segment) ?? [];
  return matchName && ordinal ? `${matchNameLabel(matchName, hostNames)} ${ordinal}` : matchNameLabel(segment, hostNames);
}

function readDisplayName(layer: LayerSnapshot | undefined, path: string | undefined): string | undefined {
  return layer && path ? findProperty(layer, { path })?.displayName || undefined : undefined;
}

/** A property's display name from the layer when it was read, else from its path. */
export function propertyLabel(layer: LayerSnapshot | undefined, path: string | undefined, role: string | undefined, state: LabelState): string {
  const read = readDisplayName(layer, path);
  if (read) return read;
  if (path) return segmentLabel(lastSegment(path), state.hostNames);
  return role ? humanizeName(role) : state.translate("plan.row.property");
}

function unnamedEffectLabel(effectPath: string | undefined, state: LabelState): string {
  return effectPath ? segmentLabel(lastSegment(effectPath), state.hostNames) : state.translate("plan.row.effect");
}

/** An effect's display name from the layer when it carries it, else from its match name. */
export function effectLabel(layer: LayerSnapshot | undefined, effectPath: string | undefined, matchName: string | undefined, state: LabelState): string {
  const read = readDisplayName(layer, effectPath);
  if (read) return read;
  if (!matchName) return unnamedEffectLabel(effectPath, state);
  const ordinal = effectPath ? /#(\d+)$/.exec(effectPath)?.[1] : undefined;
  return ordinal ? `${matchNameLabel(matchName, state.hostNames)} ${ordinal}` : matchNameLabel(matchName, state.hostNames);
}

const PLAIN_STYLE = /^(?:regular|roman|book|normal)$/i;

function fontDisplayName(record: { readonly family: string; readonly style: string }): string {
  return PLAIN_STYLE.test(record.style) || record.style === "" ? record.family : `${record.family} ${record.style}`;
}

/** The family and style this host reports for each PostScript name it lists, so a row can show "Times New Roman" where a plan holds "TimesNewRomanPSMT". */
export function profileFontNames(profile: HostCapabilityProfile | undefined): ReadonlyMap<string, string> {
  return new Map((profile?.fontInventory.items ?? []).map((record) => [record.postScriptName, fontDisplayName(record)]));
}
