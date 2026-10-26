// The font half of the census. The effects half lands first and the fonts follow when the lane is idle (the host spends seconds listing them), so for
// a while the profile holds the font list of an earlier run, or none. That list is marked `loading` while a font census is outstanding, which is how
// `ae_search_fonts` knows to say "still loading" instead of "no such font". The list is cached in the stored profile with the host's own cheap key:
// an unchanged key means the host need not read a single style again.
import { emptyFontInventory, fontInventoryFromCensus, makeHostProfile, withFontsLoading } from "@extynt/capability-catalogue";
import type { FontInventory, HostCapabilityProfile } from "@extynt/capability-catalogue";
import { profileDirectory, saveHostProfile, scanPresetInventory } from "./profile-store.js";
import { accepted, refused } from "./receiver-outcome.js";
import type { ReceiverOutcome } from "./receiver-types.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import type { FontCensus, HostCensus } from "./server-types.js";

type FontsState = Pick<HttpRoutesDeps["state"], "hostFacts" | "hostProfile" | "now">;

/** The held list when it can stand in for the host's (it has records and was read to the end or cut short, never a failed read): the key worth sending with the next census. */
export function cachedFontKey(profile: HostCapabilityProfile | undefined): string | undefined {
  const fonts = profile?.fontInventory;
  return fonts && fonts.items.length > 0 && fonts.completeness !== "failed" ? fonts.hostFingerprint : undefined;
}

/** What the profile's font list is when a census arrives: the census's own when it carries one, else the held list marked as awaiting one. */
export function fontsOfCensus(state: FontsState, result: HostCensus["result"]): { fonts: FontInventory; pending: boolean } {
  if (Array.isArray(result.installedFonts)) return { fonts: fontInventoryFromCensus(result), pending: false };
  return { fonts: withFontsLoading(state.hostProfile?.fontInventory ?? emptyFontInventory(), true), pending: true };
}

/** Records where the fonts stand after an effects or whole census: queued for the lane's idle time, or done. */
export function noteFontsAfterCensus(state: FontsState, pending: boolean): void {
  state.hostFacts.fonts = pending ? { phase: "pending", at: state.now().getTime() } : { phase: "ready", at: state.now().getTime() };
}

/** The font call failed: whatever list is held stands, no longer marked as awaiting a census, and the phase says why. */
export function noteFontsFailed(state: FontsState, code: string): void {
  state.hostFacts.fonts = { phase: "failed", at: state.now().getTime(), code };
  const profile = state.hostProfile;
  if (profile?.fontInventory.loading) state.hostProfile = { ...profile, fontInventory: withFontsLoading(profile.fontInventory, false) };
}

function unchangedFonts(usable: FontInventory | undefined, key: string | undefined): FontInventory | undefined {
  return usable && key !== undefined && usable.hostFingerprint === key ? withFontsLoading(usable, false) : undefined;
}

function fontsOfFontCensus(held: FontInventory | undefined, census: FontCensus): FontInventory | undefined {
  const usable = held && held.items.length > 0 ? held : undefined;
  if (census.result.fontsUnchanged === true) return unchangedFonts(usable, census.result.fontFingerprint);
  const read = fontInventoryFromCensus(census.result);
  return read.completeness === "failed" && usable ? withFontsLoading(usable, false) : read;
}

function carriedCounts(held: HostCapabilityProfile | undefined): Partial<HostCapabilityProfile> {
  return { ...(held?.inventoryTotalReported === undefined ? {} : { inventoryTotalReported: held.inventoryTotalReported }), ...(held?.inventoryReturnedCount === undefined ? {} : { inventoryReturnedCount: held.inventoryReturnedCount }) };
}

function fontTimings(timings: FontCensus["result"]["durationMs"]): Record<"fontsMs" | "enumerateMs" | "readMs" | "sortMs", number | null> {
  return { fontsMs: timings?.fonts ?? null, ...fontPhaseTimings(timings) };
}

function fontPhaseTimings(timings: FontCensus["result"]["durationMs"]): Record<"enumerateMs" | "readMs" | "sortMs", number | null> {
  return { enumerateMs: timings?.fontsEnumerate ?? null, readMs: timings?.fontsRead ?? null, sortMs: timings?.fontsSort ?? null };
}

function logFonts(deps: HttpRoutesDeps, census: FontCensus, fonts: FontInventory): void {
  const timings = census.result.durationMs;
  deps.dispatch.logPlanEvent("host.fonts", { fonts: fonts.items.length, unchanged: census.result.fontsUnchanged === true, completeness: fonts.completeness, ...fontTimings(timings) });
}

/** Records the fonts half: the profile is rebuilt around the new list (a different list is a different profile), and the cache key is kept with it. */
export function acceptFontCensus(deps: HttpRoutesDeps, census: FontCensus, bytes: number): ReceiverOutcome {
  const { state } = deps, held = state.hostProfile;
  const fonts = fontsOfFontCensus(held?.fontInventory, census);
  if (!state.inventory) return refused(409, "CENSUS_ORDER", "The font census needs the effects census first.");
  if (!fonts) return refused(409, "FONT_CACHE_MISSING", "The host kept a font list this sidecar no longer holds; the next census reads it in full.");
  const base = makeHostProfile(state.inventory, held, scanPresetInventory(state.options.presetRoots), fonts);
  const profile = { ...(deps.dispatch.withEffectEvidence(base) ?? base), ...carriedCounts(held) };
  state.hostProfile = profile;
  saveHostProfile(profile, state.options.stateDirectory ?? profileDirectory());
  state.hostFacts.fonts = census.result.fontCompleteness === "failed" ? { phase: "failed", at: state.now().getTime(), code: "FONTS_UNAVAILABLE" } : { phase: "ready", at: state.now().getTime() };
  logFonts(deps, census, fonts);
  return accepted(201, { ok: true, accepted: true, requestId: census.requestId, profileId: profile.profileId, bytes });
}
