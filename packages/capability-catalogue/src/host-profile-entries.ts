// Profile entries for the curated catalogue and for installed effects the catalogue does not know.
import type { Capability, HostProfileEntry, InventoryItem } from "./catalogue-model.js";
import { EFFECT_HOST_CAVEATS } from "./effect-control-evidence.js";
import { DIALOG_EFFECTS, markUserAssisted, staticAssistReason } from "./user-assisted.js";

interface Caveat {
  readonly code: string;
  readonly message: string;
}

function curatedAvailability(item: InventoryItem | undefined, isNative: boolean, authoritative: boolean): HostProfileEntry["availability"] {
  if (isNative || item?.available) return "available";
  return item || authoritative ? "unavailable" : "unknown";
}

function curatedOperationStatus(item: InventoryItem | undefined, isNative: boolean, caveat: boolean, dialog: boolean): HostProfileEntry["operationStatus"] {
  if (caveat) return "unsupported";
  if (isNative || (dialog && item?.available)) return "supported";
  return item?.available ? "probeNeeded" : "unknown";
}

function curatedProbeState(item: InventoryItem | undefined, caveat: boolean, dialog: boolean, authoritative: boolean): HostProfileEntry["probeState"] {
  if (caveat || (dialog && item?.available)) return "manual-unavailable";
  if (item?.available) return "probeNeeded";
  return authoritative ? "manual-unavailable" : "probeNeeded";
}

function curatedProvenance(item: InventoryItem | undefined, authoritative: boolean): string {
  if (item) return "curated semantics joined to live inventory";
  return authoritative ? "curated catalogue; not installed on this host" : "curated catalogue; the host inventory does not say whether this is installed";
}

function curatedEvidence(item: InventoryItem | undefined, isNative: boolean): HostProfileEntry["evidence"] {
  if (isNative) return ["curated", "documented"];
  return item ? ["curated", "documented", "installed"] : ["curated", "documented"];
}

function curatedCaveat(capability: Capability): Caveat | undefined {
  return capability.matchName ? EFFECT_HOST_CAVEATS[capability.matchName] : undefined;
}

function curatedRequirements(capability: Capability, caveat: Caveat | undefined): string[] | undefined {
  if (!caveat) return capability.requirements;
  return [...new Set([...(capability.requirements ?? []), caveat.message])];
}

function assistedEntry(entry: HostProfileEntry, item: InventoryItem | undefined): HostProfileEntry {
  const reason = staticAssistReason(entry.matchName, item?.hasOptionsDialog);
  return reason ? markUserAssisted(entry, reason) : entry;
}

function curatedIdentity(capability: Capability, item: InventoryItem | undefined): Pick<HostProfileEntry, "id" | "matchName" | "displayName" | "description" | "version" | "category" | "provider" | "controls" | "applicability"> {
  return {
    id: capability.id,
    matchName: capability.matchName,
    displayName: item?.displayName ?? capability.displayName,
    description: capability.description || `Curated ${capability.kind} capability ${capability.displayName}.`,
    version: item?.version ?? null,
    category: item?.category ?? capability.category,
    provider: capability.provider,
    controls: capability.controls,
    applicability: capability.layerTypes,
  };
}

/** One curated capability as a profile entry: declared facts joined to the live inventory when the host reported the match name. */
export function curatedProfileEntry(capability: Capability, live: ReadonlyMap<string, InventoryItem>, authoritative: boolean): HostProfileEntry {
  const item = capability.matchName ? live.get(capability.matchName) : undefined;
  const isNative = !!capability.nativeFamily;
  const caveat = curatedCaveat(capability);
  const dialog = !!capability.matchName && DIALOG_EFFECTS[capability.matchName] !== undefined;
  const entry: HostProfileEntry = {
    ...curatedIdentity(capability, item),
    kind: isNative ? "native" : capability.kind,
    availability: curatedAvailability(item, isNative, authoritative),
    requirements: curatedRequirements(capability, caveat),
    operationStatus: curatedOperationStatus(item, isNative, !!caveat, dialog),
    evidence: curatedEvidence(item, isNative),
    provenance: curatedProvenance(item, authoritative),
    probeState: curatedProbeState(item, !!caveat, dialog, authoritative),
  };
  return assistedEntry(entry, item);
}

/** A shallow profile entry for an installed effect the curated catalogue does not describe. */
export function installedProfileEntry(item: InventoryItem): HostProfileEntry {
  const entry: HostProfileEntry = {
    id: `host:${item.matchName}`,
    kind: "effect",
    matchName: item.matchName,
    displayName: item.displayName,
    description: `Installed effect ${item.displayName}; controls have not been deeply probed.`,
    version: item.version,
    category: item.category,
    provider: "Unknown provider",
    availability: item.available ? "available" : "unavailable",
    operationStatus: item.available ? "probeNeeded" : "unknown",
    evidence: ["installed"],
    provenance: "live shallow effect inventory",
    probeState: item.available ? "probeNeeded" : "manual-unavailable",
  };
  return assistedEntry(entry, item);
}
