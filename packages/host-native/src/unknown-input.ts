// Entry points for callers that hold an untyped value: each decodes it with the matching decoder and answers null when it does not fit. New code uses the decoders directly.
import { decode, jsonObject } from "@extynt/decode";
import type { Decoder, JsonObject, JsonValue } from "@extynt/decode";
import { effectMenusResult, hostCallResult } from "./wire-calls.js";
import type { EffectMenusResult, HostCallResult } from "./wire-calls.js";
import { watchState } from "./wire-watch.js";
import type { WatchState } from "./wire-watch.js";

function decodedOrNull<T>(decoder: Decoder<T>, value: JsonValue | undefined): T | null {
  const decoded = decode(decoder, value);
  return decoded.ok ? decoded.value : null;
}

/** True for a JSON object: not null and not an array, holding only JSON values. */
export function isRecord(value: JsonValue | undefined): value is JsonObject {
  return decode(jsonObject, value).ok;
}

export function parseHostCallResult(value: JsonValue | undefined): HostCallResult | null {
  return decodedOrNull(hostCallResult, value);
}

export function parseWatchState(value: JsonValue | undefined): WatchState | null {
  return decodedOrNull(watchState, value);
}

export function parseEffectMenusResult(value: JsonValue | undefined): EffectMenusResult | null {
  return decodedOrNull(effectMenusResult, value);
}

/** The shape of `read_project` and `read_comp` results; the snapshot adapter in the sidecar decodes the rows. */
export interface NativeReadResult {
  source: "native";
  project: { name: string; filePath: string | null; dirty: boolean };
  itemCount: number;
  activeCompositionId?: string | null;
  currentTime?: number | null;
  selectedLayerIds: string[];
  items?: JsonObject[];
  sources?: JsonObject[];
  compositions: JsonObject[];
  itemsHash?: string;
  projectHash?: string;
  warnings: string[];
  warningsDropped?: number;
}
