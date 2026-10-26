// The "host.census" event: how long each census phase took on the host and what the graph did with the inventory.
import type { GraphRecord } from "./graph-record.js";
import type { HostCensus } from "./server-types.js";
import type { HttpRoutesDeps } from "./server-http-state.js";

const MAX_PLAUSIBLE_PHASE_MS = 3_600_000;

function plausibleMs(measured: number | undefined): number | null {
  return measured !== undefined && Number.isFinite(measured) && measured >= 0 && measured < MAX_PLAUSIBLE_PHASE_MS ? Math.round(measured) : null;
}

function censusTimings(census: HostCensus): Record<"effectsMs" | "fontsMs" | "totalMs", number | null> {
  const timings = census.result.durationMs;
  return { effectsMs: plausibleMs(timings?.effects), fontsMs: plausibleMs(timings?.fonts), totalMs: plausibleMs(timings?.total) };
}

function censusStored(stored: GraphRecord | undefined): { definitions: string; fingerprint: string | null } {
  return {
    definitions: typeof stored?.censusDefinitions === "string" ? stored.censusDefinitions : "unavailable",
    fingerprint: typeof stored?.censusFingerprint === "string" ? stored.censusFingerprint.slice(0, 16) : null,
  };
}

/** Logs the phase timings the host measured and what the graph did with the inventory; a half of the census that was not asked for reports null. */
export function logHostCensus(deps: HttpRoutesDeps, census: HostCensus, stored: GraphRecord | undefined): void {
  const { result } = census;
  deps.dispatch.logPlanEvent("host.census", {
    part: result.part ?? "all",
    effects: result.installedEffects.length,
    fonts: result.installedFonts?.length ?? null,
    completeness: result.completeness,
    ...censusTimings(census),
    ...censusStored(stored),
  });
}
