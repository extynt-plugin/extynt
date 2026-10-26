// The census the hidden catalogue engine asks of its own After Effects. It feeds the effect catalogue and nothing else: the
// user's inventory, host profile, fonts and preset list describe the After Effects they work in (possibly another version),
// and an engine census must never overwrite them.
import { decode, type JsonValue } from "@extynt/decode";
import type { SidecarState } from "./server-state.js";
import { hostCensus } from "./server-census-wire.js";

type EngineCensusState = Pick<SidecarState, "catalogue" | "collection" | "eventLog">;

/** Takes the census as the native host sent it and decodes it here; a census that does not decode is rejected. */
export function acceptEngineCensus(state: EngineCensusState, reading: JsonValue | undefined): { outcome: "succeeded" | "rejected"; errorCode?: string } {
  const decoded = decode(hostCensus, reading);
  if (!decoded.ok) return { outcome: "rejected", errorCode: "INVALID_HOST_CENSUS" };
  const census = decoded.value;
  const stored = state.collection.recordCensus(census);
  state.catalogue.onCensus(census, stored?.censusDefinitions !== "failed");
  state.eventLog("catalogue.engine-census", { version: census.result.runtime.appVersion, effects: census.result.installedEffects.length, definitions: typeof stored?.censusDefinitions === "string" ? stored.censusDefinitions : "unavailable" });
  return { outcome: "succeeded" };
}
