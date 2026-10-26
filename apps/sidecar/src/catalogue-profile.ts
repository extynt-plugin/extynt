// Folds freshly probed catalogue controls into the live host profile and keeps its on-disk copy as a cache.
import { applyEffectControlEvidence } from "@extynt/capability-catalogue";
import { catalogueEvidence } from "./server-http-core.js";
import { profileDirectory, saveHostProfile } from "./profile-store.js";
import type { SidecarState } from "./server-state.js";

const SAVE_INTERVAL_MS = 60_000;
const lastSaved = new WeakMap<SidecarState, number>();

function saveQuietly(state: SidecarState, profile: Parameters<typeof saveHostProfile>[0]): boolean {
  try {
    saveHostProfile(profile, state.options.stateDirectory ?? profileDirectory());
    return true;
  } catch {
    return false;
  }
}

/** Folds freshly probed controls into the live host profile; the graph stays the source, so the on-disk copy is only a cache saved at most once a minute and when collection finishes. */
export function refreshProfileFromCatalogue(state: SidecarState, hostKey: string, matchNames: readonly string[]): void {
  const profile = state.hostProfile;
  if (!profile || `${profile.host.application}:${profile.host.version}:${profile.host.platform}` !== hostKey) return;
  const next = applyEffectControlEvidence(profile, catalogueEvidence(state, profile, matchNames));
  if (next === profile) return;
  state.hostProfile = next;
  const now = state.now().getTime(), finished = state.catalogue.progress().pending === 0;
  if (!finished && now - (lastSaved.get(state) ?? 0) < SAVE_INTERVAL_MS) return;
  lastSaved.set(state, now);
  saveQuietly(state, next);
}
