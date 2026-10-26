// The verdicts for layer operations whose write the host reads back itself and whose result the fresh read does not carry: each re-checks the host's evidence against the request.
import { array, decode, fallback, number, object, optional, string } from "@extynt/decode";
import type { Decoder, Infer, JsonObject, JsonValue } from "@extynt/decode";
import { KEY_TIME_TOLERANCE } from "./compare-values.js";
import { measuredRectOf, stepEvidence } from "./step-reply.js";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { Details, VerifiedStep } from "./verdicts.js";
import { layerWhere } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";

const ANCHOR_TOLERANCE = 0.01;
const TEXT_PATH_TOLERANCE = 0.001;
const PIXEL_ASPECT_TOLERANCE = 0.0001;

interface FieldSpec {
  readonly fields: readonly string[];
  readonly toleranceOf: (field: string) => number;
  readonly notRead: string;
  readonly mismatch: string;
  readonly exact: string;
  readonly nothingToCheck: string;
}

type FieldComparison =
  | { readonly outcome: "unread" }
  | { readonly outcome: "mismatch"; readonly field: string; readonly wanted: number; readonly seen: number }
  | { readonly outcome: "checked"; readonly count: number };

interface KeyCounts {
  readonly before: number;
  readonly after: number;
  readonly selected: number;
}

interface PresetWrite {
  readonly file: string;
  readonly bytes: number;
  readonly effects: number | undefined;
}

const stringList = array(string());
const timeList = array(number(), { minLength: 1 });
const requestFields = object({
  index: optional(fallback(number(), undefined)),
  effectPath: optional(fallback(string(), undefined)),
  effectPaths: optional(fallback(stringList, undefined)),
  outputPath: optional(fallback(string(), undefined)),
  sourceItemId: optional(fallback(string(), undefined)),
  keyframeMode: optional(fallback(string(), undefined)),
  action: optional(fallback(string(), undefined)),
});


function evidence<T>(decoder: Decoder<T>, state: LayerState, none: T): T {
  const decoded = decode(decoder, state.step.row);
  return decoded.ok ? decoded.value : none;
}

function askedOf(state: LayerState): Infer<typeof requestFields> {
  const decoded = decode(requestFields, state.request.row);
  return decoded.ok ? decoded.value : {};
}

function orNull<T>(value: T | undefined): T | null {
  return value ?? null;
}

function lengthOf(list: { readonly length: number } | undefined): number | null {
  return list ? list.length : null;
}

function count(list: readonly string[], name: string): number {
  return list.filter((entry) => entry === name).length;
}

function compareFields(state: LayerState, seen: JsonObject, spec: FieldSpec): FieldComparison {
  let checked = 0;
  for (const field of spec.fields) {
    const wanted = state.request.row[field];
    if (wanted === undefined) continue;
    const found = seen[field];
    if (typeof wanted !== "number" || typeof found !== "number") return { outcome: "unread" };
    if (Math.abs(found - wanted) > spec.toleranceOf(field)) return { outcome: "mismatch", field, wanted, seen: found };
    checked += 1;
  }
  return { outcome: "checked", count: checked };
}

function fieldVerdict(state: LayerState, seen: JsonObject | undefined, spec: FieldSpec): VerifiedStep {
  const kind = state.request.operation;
  const details = { ...layerWhere(state), observedValues: orNull(seen) };
  if (!seen) return unverifiedStep(kind, spec.notRead, details);
  const result = compareFields(state, seen, spec);
  if (result.outcome === "unread") return unverifiedStep(kind, spec.notRead, details);
  if (result.outcome === "mismatch") return failedStep(kind, spec.mismatch, { ...details, field: result.field, expectedValue: result.wanted, observedValue: result.seen });
  return result.count ? exactStep(kind, spec.exact, details) : unverifiedStep(kind, spec.nothingToCheck, details);
}

function isCentred(anchor: readonly number[], rect: { left: number; top: number; width: number; height: number }): boolean {
  const offByX = Math.abs((anchor[0] ?? NaN) - (rect.left + rect.width / 2));
  const offByY = Math.abs((anchor[1] ?? NaN) - (rect.top + rect.height / 2));
  return offByX <= ANCHOR_TOLERANCE && offByY <= ANCHOR_TOLERANCE;
}

/** center_anchor: the anchor the host read back after the write is the middle of the content rectangle it measured. */
export function verifyCenterAnchor(state: LayerState): VerifiedStep {
  const kind = state.request.operation;
  const { contentRect, anchorAfter } = evidence(stepEvidence.centerAnchor, state, {});
  const rect = measuredRectOf(contentRect);
  const details = { ...layerWhere(state), anchorAfter: orNull(anchorAfter), contentRect: orNull(contentRect) };
  if (!rect || !anchorAfter || anchorAfter.length < 2) return unverifiedStep(kind, "anchor-readback-not-read", details);
  return isCentred(anchorAfter, rect) ? exactStep(kind, "anchor-centred-host-readback", details) : failedStep(kind, "anchor-not-centred", details);
}

/** reorder_effect: the host found the effect (match name and name) at the requested place in the stack after moveTo. */
export function verifyReorderEffect(state: LayerState): VerifiedStep {
  const kind = state.request.operation;
  const { observedIndex, stackBefore, stackAfter } = evidence(stepEvidence.reorderEffect, state, {});
  const { index, effectPath } = askedOf(state);
  const details = { ...layerWhere(state), effectPath: orNull(effectPath), requestedIndex: orNull(index), observedIndex: orNull(observedIndex) };
  if (index === undefined || observedIndex === undefined || !stackAfter || !stackBefore) return unverifiedStep(kind, "effect-order-not-read", details);
  if (observedIndex !== index) return failedStep(kind, "effect-index-mismatch", details);
  if (stackAfter.length === stackBefore.length) return exactStep(kind, "effect-order-host-readback", details);
  return failedStep(kind, "effect-stack-size-changed", { ...details, stackBefore, stackAfter });
}

/** remove_effect: the stack the host read after the removal is one effect shorter, and holds one fewer of the removed name. */
export function verifyRemoveEffect(state: LayerState): VerifiedStep {
  const kind = state.request.operation;
  const { removedName, stackBefore, stackAfter } = evidence(stepEvidence.removeEffect, state, {});
  const details = {
    ...layerWhere(state),
    effectPath: orNull(askedOf(state).effectPath),
    removedName: orNull(removedName),
    effectsBefore: lengthOf(stackBefore),
    effectsAfter: lengthOf(stackAfter),
  };
  if (!stackBefore || !stackAfter || removedName === undefined) return unverifiedStep(kind, "effect-stack-not-read", details);
  const removedOne = stackAfter.length === stackBefore.length - 1 && count(stackAfter, removedName) === count(stackBefore, removedName) - 1;
  return removedOne ? exactStep(kind, "effect-removed-host-readback", details) : failedStep(kind, "effect-stack-count-mismatch", details);
}

const SOLID_SIZE: FieldSpec = {
  fields: ["width", "height", "pixelAspect"],
  toleranceOf: (field) => (field === "pixelAspect" ? PIXEL_ASPECT_TOLERANCE : 0),
  notRead: "solid-size-not-read",
  mismatch: "solid-size-mismatch",
  exact: "solid-size-host-readback",
  nothingToCheck: "no-solid-size-to-check",
};

const TEXT_PATH: FieldSpec = {
  fields: ["maskIndex", "firstMargin", "lastMargin"],
  toleranceOf: () => TEXT_PATH_TOLERANCE,
  notRead: "text-path-not-read",
  mismatch: "text-path-mismatch",
  exact: "text-path-host-readback",
  nothingToCheck: "no-text-path-fields-to-check",
};

/** resize_solid: the solid's width, height and pixel aspect as the host read them back are the requested ones. */
export function verifyResizeSolid(state: LayerState): VerifiedStep {
  return fieldVerdict(state, evidence(stepEvidence.resizeSolid, state, {}).after, SOLID_SIZE);
}

/** set_text_path: each Path Options value written is the value the host read back from it. */
export function verifyTextPath(state: LayerState): VerifiedStep {
  return fieldVerdict(state, evidence(stepEvidence.textPath, state, {}).written, TEXT_PATH);
}

function expectedSourceId(state: LayerState): string {
  const requested = askedOf(state).sourceItemId ?? "";
  return state.ctx.ids.items.get(requested) || state.ctx.ids.comps.get(requested) || requested;
}

/** replace_layer_source: the layer's source id after replaceSource is the item the plan named (a placeholder resolved through the plan's own creations). */
export function verifyReplaceLayerSource(state: LayerState): VerifiedStep {
  const kind = state.request.operation;
  const { sourceId } = evidence(stepEvidence.replaceSource, state, {});
  const expected = expectedSourceId(state);
  const details = { ...layerWhere(state), expectedSourceId: expected, observedSourceId: orNull(sourceId) };
  if (!sourceId || expected.startsWith("__new__:")) return unverifiedStep(kind, "layer-source-not-read", details);
  return sourceId === expected ? exactStep(kind, "layer-source-host-readback", details) : failedStep(kind, "layer-source-mismatch", details);
}

function presetWriteFailure(state: LayerState, written: PresetWrite, details: Details): VerifiedStep | null {
  const kind = state.request.operation;
  const { outputPath, effectPaths } = askedOf(state);
  if (written.file !== outputPath) return failedStep(kind, "preset-file-path-mismatch", { ...details, expectedFile: orNull(outputPath) });
  if (written.bytes <= 0) return failedStep(kind, "written-file-empty", details);
  if (effectPaths && written.effects !== undefined && written.effects !== effectPaths.length) return failedStep(kind, "preset-effect-count-mismatch", { ...details, expectedEffects: effectPaths.length });
  return null;
}

/** save_layer_preset: the host found the .ffx it wrote at the requested path with bytes in it (the contract: what the preset holds is not compared). */
export function verifySaveLayerPreset(state: LayerState): VerifiedStep {
  const kind = state.request.operation;
  const { file, bytes, effects } = evidence(stepEvidence.presetFile, state, {});
  const details = { ...layerWhere(state), file: orNull(file), bytes: orNull(bytes), effects: orNull(effects) };
  if (bytes === undefined || file === undefined) return unverifiedStep(kind, "preset-file-not-read", details);
  return presetWriteFailure(state, { file, bytes, effects }, details) ?? exactStep(kind, "preset-file-written", details);
}

function copyCountFailure(state: LayerState, copied: readonly string[], details: Details): VerifiedStep | null {
  const { effectPaths } = askedOf(state);
  if (effectPaths && copied.length !== effectPaths.length) return failedStep(state.request.operation, "copied-effect-count-mismatch", { ...details, expectedEffects: effectPaths.length });
  return null;
}

/** copy_effects: every effect asked for (or every effect on the source) was added on the target. Which property values came across is not compared. */
export function verifyCopyEffects(state: LayerState): VerifiedStep {
  const kind = state.request.operation;
  const { copiedEffects, failedEffects, skippedProperties } = evidence(stepEvidence.copyEffects, state, {});
  const details = { ...layerWhere(state), copiedEffects: orNull(copiedEffects), failedEffects: orNull(failedEffects), skippedProperties: orNull(skippedProperties) };
  if (!copiedEffects || !failedEffects) return unverifiedStep(kind, "copied-effects-not-read", details);
  if (failedEffects.length > 0) return unverifiedStep(kind, "some-effects-not-copied", details);
  const mismatch = copyCountFailure(state, copiedEffects, details);
  if (mismatch) return mismatch;
  return copiedEffects.length > 0 ? exactStep(kind, "effects-copied-host-report", details) : unverifiedStep(kind, "copied-effects-not-read", details);
}

function timesOf(list: readonly JsonValue[]): readonly number[] | undefined {
  const decoded = decode(timeList, list);
  return decoded.ok ? decoded.value : undefined;
}

function everyTimePresent(wanted: readonly number[], present: readonly number[]): boolean {
  return wanted.every((time) => present.some((seen) => Math.abs(seen - time) <= KEY_TIME_TOLERANCE));
}

function deletedKeysVerdict(state: LayerState, counts: KeyCounts, details: Details): VerifiedStep {
  return counts.after === counts.before - counts.selected ? exactStep(state.request.operation, "keys-deleted-host-readback", details) : failedStep(state.request.operation, "key-count-mismatch", details);
}

function copiedKeysVerdict(state: LayerState, counts: KeyCounts, details: Details): VerifiedStep {
  const kind = state.request.operation;
  if (askedOf(state).keyframeMode === "merge") return unverifiedStep(kind, "merged-key-count-not-comparable", details);
  return counts.after === counts.selected ? exactStep(kind, "keys-copied-host-readback", details) : failedStep(kind, "key-count-mismatch", details);
}

function movedKeysVerdict(state: LayerState, movedTo: readonly number[] | undefined, afterTimes: readonly JsonValue[], details: Details): VerifiedStep {
  const kind = state.request.operation;
  const after = timesOf(afterTimes);
  if (!movedTo || !after) return unverifiedStep(kind, "moved-key-times-not-read", details);
  return everyTimePresent(movedTo, after) ? exactStep(kind, "keys-moved-host-readback", details) : failedStep(kind, "moved-key-time-missing", { ...details, movedTo });
}

/** edit_keyframes: the key times the host read before and after the edit show what the action does to the count and to the moved keys. */
export function verifyEditKeyframes(state: LayerState): VerifiedStep {
  const kind = state.request.operation;
  const { beforeTimes, afterTimes, selectedKeys, movedTo } = evidence(stepEvidence.editKeyframes, state, {});
  const { action } = askedOf(state);
  const details = { ...layerWhere(state), propertyPath: state.request.propertyPath, action: orNull(action), keysBefore: lengthOf(beforeTimes), keysAfter: lengthOf(afterTimes) };
  if (!beforeTimes || !afterTimes || selectedKeys === undefined) return unverifiedStep(kind, "key-times-not-read", details);
  const counts = { before: beforeTimes.length, after: afterTimes.length, selected: selectedKeys };
  if (action === "delete") return deletedKeysVerdict(state, counts, details);
  if (action === "copy") return copiedKeysVerdict(state, counts, details);
  if (counts.after !== counts.before) return failedStep(kind, "key-count-mismatch", details);
  return movedKeysVerdict(state, movedTo, afterTimes, details);
}
