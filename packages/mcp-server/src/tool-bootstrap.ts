// The bootstrap read: whether the profile and project the caller already holds are still current, with the counts that say what to read next.
import type { HostCapabilityProfile } from "@extynt/capability-catalogue";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { ToolContext } from "./contracts.js";
import type { Infer, JsonObject } from "@extynt/decode";
import { objectOf } from "./json.js";
import type { HostRequest } from "./tool-handle.js";
import { AE_GET_BOOTSTRAP_CONTEXT } from "./tool-specs-read.js";
import { hostSuccess } from "./tool-result.js";
import type { ToolResult } from "./tool-result.js";

const TOOL = "ae_get_bootstrap_context";

type KnownIdentity = { readonly profileId: string | undefined; readonly revision: string | undefined };
type CurrentIdentity = { readonly profileId: string | null; readonly revision: string | null; readonly snapshotFingerprint: string | null };

function currentIdentity({ hostProfile, snapshot }: ToolContext): CurrentIdentity {
  return {
    profileId: hostProfile?.profileId ?? null,
    revision: snapshot ? `${snapshot.revision}:${snapshot.fingerprint}` : null,
    snapshotFingerprint: snapshot?.fingerprint ?? null,
  };
}

function changedSince(known: KnownIdentity, current: CurrentIdentity): JsonObject {
  return {
    profile: known.profileId !== undefined && known.profileId !== current.profileId,
    project: known.revision !== undefined && known.revision !== current.revision,
  };
}

function isCurrent(known: KnownIdentity, current: CurrentIdentity): boolean {
  const compared = known.profileId !== undefined || known.revision !== undefined;
  return compared && !Object.values(changedSince(known, current)).includes(true);
}

function profileCounts(profile: HostCapabilityProfile | undefined): JsonObject {
  return { effects: profile?.inventoryReturnedCount ?? 0, profileEntries: profile?.entries.length ?? 0 };
}

function snapshotCounts(snapshot: ProjectSnapshot | undefined): JsonObject {
  return { compositions: snapshot?.compositions.length ?? 0, selectedLayers: snapshot?.selection.layerIds.length ?? 0 };
}

function freshData(known: KnownIdentity, current: CurrentIdentity, { hostProfile, snapshot }: ToolContext): JsonObject {
  return objectOf({
    ...current,
    selectionFingerprint: snapshot?.selectionFingerprint ?? null,
    counts: { ...profileCounts(hostProfile), ...snapshotCounts(snapshot) },
    changedSince: changedSince(known, current),
    nextRecommendedRead: snapshot ? "ae_get_current_context" : "ae_refresh_snapshot",
    responseBudgetBytes: 2048,
  });
}

/** Answers the bootstrap read from the held profile and snapshot, or says nothing changed since the caller's known identity. */
export function bootstrapContextTool({ args, context }: HostRequest<Infer<typeof AE_GET_BOOTSTRAP_CONTEXT.input.decoder>>): ToolResult {
  const known: KnownIdentity = { profileId: args.knownProfileId, revision: args.knownRevision };
  const current = currentIdentity(context);
  const data = isCurrent(known, current) ? objectOf({ status: "NOT_MODIFIED", ...current, responseBudgetBytes: 512 }) : freshData(known, current, context);
  return { ...hostSuccess(TOOL, data), snapshotFingerprint: current.snapshotFingerprint };
}
