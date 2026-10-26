// Decoders and types for the results of batch, host_call and effect_menus requests.
import { boolean, literal, number, object, optional, string } from "@extynt/decode";
import type { Decoder, Infer } from "@extynt/decode";
import { jsonValue } from "./json-value.js";
import { HOST_ENTRIES } from "./protocol.js";
import { list, softly, wireError } from "./wire-common.js";

const batchItem = object({
  op: string(), id: softly(string()), ok: boolean(), result: optional(jsonValue), error: softly(wireError),
  mainThreadMs: number(), getterCalls: number(),
});

/** One reply inside a batch: its op, the caller's id when it had one, and either a result or an error; an `id` or `error` of the wrong type reads as absent. */
export type BatchItem = Infer<typeof batchItem>;

/** Decodes the result of a `batch` request; a malformed item rejects the whole result. */
export const batchResult: Decoder<BatchResult> = object({
  source: literal("native"), results: list(batchItem), ran: number(), failed: number(), requested: number(), totalMainThreadMs: number(),
});

/** The decoded result of a `batch` request; callers that merge chunked batches add to its counters and results. */
export interface BatchResult { source: "native"; results: BatchItem[]; ran: number; failed: number; requested: number; totalMainThreadMs: number }

const optionsDialogScanEntry = object({ matchName: string(), hasOptionsDialog: boolean() });

/** One scanned effect's PiPL answer: its match name and whether its global out flags carry PF_OutFlag_I_DO_DIALOG. */
export type OptionsDialogScanEntry = Infer<typeof optionsDialogScanEntry>;

/**
 * Decodes the result of a `host_call` request. `optionsDialogScan` is the census's PiPL scan: absent or malformed means "unknown", never "no dialogs",
 * so the caller must not invent false; `optionsDialogScanPending` is present only as true.
 */
export const hostCallResult = object({
  source: literal("native"), entry: literal(...HOST_ENTRIES), result: string(), scriptUs: number(), scriptError: softly(string()),
  optionsDialogScan: softly(list(optionsDialogScanEntry)), optionsDialogScanPending: softly(literal(true)),
  libraryLoaded: boolean(), libraryLoadUs: number(), libraryVersion: string(), projectEpoch: number(),
});
export type HostCallResult = Infer<typeof hostCallResult>;

const popupMenu = object({ matchName: string(), choices: number(), consistent: boolean(), items: list(string()) });

/** One popup parameter: its stream matchName, the host's stated choice count and the item labels (a separator slot is "-"); `consistent` is false when the labels do not number `choices`. */
export type EffectPopupMenu = Infer<typeof popupMenu>;

/** Decodes the result of an `effect_menus` request. */
export const effectMenusResult = object({
  source: literal("native"), effects: list(object({ matchName: string(), popups: list(popupMenu) })),
});
export type EffectMenusResult = Infer<typeof effectMenusResult>;
export type EffectPopupEffect = EffectMenusResult["effects"][number];
