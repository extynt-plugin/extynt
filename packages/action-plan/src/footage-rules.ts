// Footage rules: replacing and proxying a footage item, the image-sequence flags of import_file, and interpretation values. The
// sidecar checks these before the host is asked.
import type { ProjectSnapshot } from "@extynt/project-graph";
import { isJsonArray, type JsonObject, type JsonValue } from "@extynt/decode";
import type { OperationContext } from "./layer-targets.js";
import { currentItemTarget } from "./plan-shape.js";
import { FOOTAGE_ALPHA_MODES, FOOTAGE_FIELD_SEPARATIONS, FOOTAGE_PULLDOWN_METHODS, FOOTAGE_PULLDOWN_PHASES } from "./plan-constants.js";
import { ACCEPTED, invalid, isAbsoluteBoundedPath, isFiniteInRange, isIntegerInRange, isOneOf, isRefusal, objectAt, objectsIn, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";

type Field = JsonValue | undefined;
type InterpretationCheck = readonly [key: string, isValid: (value: Field) => boolean, message: string];

const INTERPRETATION_KEYS = ["conformFrameRate", "alphaMode", "premulColor", "loop", "pixelAspect", "fieldSeparationType", "invertAlpha", "guessAlpha", "highQualityFieldSeparation", "removePulldown", "guessPulldown", "resetFrameRate"];
const FOOTAGE_ITEM_MESSAGE = "Footage operations require an exact current item target.";

const isBoolean = (value: Field): boolean => typeof value === "boolean";
const isColor = (value: Field): boolean => isJsonArray(value) && value.length === 3 && value.every((channel) => isFiniteInRange(channel, 0, 1));

const INTERPRETATION_CHECKS: readonly InterpretationCheck[] = [
  ["conformFrameRate", (value) => isFiniteInRange(value, 0, 999), "conformFrameRate must be 0 (the footage's own rate) or a frame rate up to 999."],
  ["alphaMode", (value) => isOneOf(value, FOOTAGE_ALPHA_MODES), `alphaMode must be one of ${FOOTAGE_ALPHA_MODES.join(", ")}.`],
  ["loop", (value) => isIntegerInRange(value, 1, 9999), "loop must be a whole number of plays from 1 through 9999."],
  ["pixelAspect", (value) => isFiniteInRange(value, 0.01, 100), "pixelAspect must be from 0.01 through 100."],
  ["fieldSeparationType", (value) => isOneOf(value, FOOTAGE_FIELD_SEPARATIONS), `fieldSeparationType must be one of ${FOOTAGE_FIELD_SEPARATIONS.join(", ")}.`],
  ["premulColor", isColor, "premulColor must be [r, g, b] with each channel 0-1."],
  ["invertAlpha", isBoolean, "invertAlpha must be true or false."],
  ["guessAlpha", (value) => value === true, "guessAlpha must be true: After Effects guesses the alpha mode itself."],
  ["highQualityFieldSeparation", isBoolean, "highQualityFieldSeparation must be true or false."],
  ["removePulldown", (value) => isOneOf(value, FOOTAGE_PULLDOWN_PHASES), `removePulldown must be one of ${FOOTAGE_PULLDOWN_PHASES.join(", ")}.`],
  ["guessPulldown", (value) => isOneOf(value, FOOTAGE_PULLDOWN_METHODS), `guessPulldown must be one of ${FOOTAGE_PULLDOWN_METHODS.join(", ")}.`],
  ["resetFrameRate", (value) => value === true, "resetFrameRate must be true: the conformed frame rate goes back to the footage's native rate."],
];

/** The image-sequence flags of import_file: a sequence is footage, and alphabetical order only means something for one. */
export function importSequenceError(operation: JsonObject): Refusal | undefined {
  const sequence = operation.sequence;
  const forceAlphabetical = operation.forceAlphabetical;
  const importAs = operation.importAs;
  if ([sequence, forceAlphabetical].some((flag) => flag !== undefined && !isBoolean(flag))) return invalid("INVALID_VALUE", "sequence and forceAlphabetical must be true or false.");
  if (forceAlphabetical === true && sequence !== true) return invalid("INVALID_VALUE", "forceAlphabetical only applies with sequence:true.");
  if (sequence === true && importAs !== undefined && !isOneOf(importAs, ["auto", "footage"])) return invalid("INVALID_VALUE", "An image sequence imports as footage; leave importAs unset or use \"footage\".");
  return undefined;
}

function footageItemError(itemId: string, snapshot: ProjectSnapshot | undefined): Refusal | undefined {
  const item = snapshot?.items?.find((candidate) => candidate.id === itemId);
  if (snapshot && !item) return invalid("TARGET_NOT_FOUND", "Footage item is not present in the current snapshot.");
  return item && item.type !== "footage" ? invalid("INVALID_TARGET", "Footage operations only accept an exact footage item.") : undefined;
}

function footageItemProblem(context: OperationContext, allowed: readonly string[]): Refusal | undefined {
  const { operation, plan, snapshot } = context;
  const unknownField = rejectUnknown(operation, allowed);
  if (unknownField) return unknownField;
  const target = currentItemTarget(operation, plan, FOOTAGE_ITEM_MESSAGE);
  return isRefusal(target) ? target : footageItemError(target.itemId, snapshot);
}

/** replace_footage and set_footage_proxy: an exact footage item and a bounded absolute local path. */
export function validateFootageWithPath(context: OperationContext): OperationResult {
  const problem = footageItemProblem(context, ["type", "target", "path"]);
  if (problem) return problem;
  return isAbsoluteBoundedPath(context.operation.path, 1024) ? ACCEPTED : invalid("INVALID_VALUE", "Footage paths must be bounded absolute local paths.");
}

/** clear_footage_proxy: an exact footage item. */
export function validateClearFootageProxy(context: OperationContext): OperationResult {
  return footageItemProblem(context, ["type", "target"]) ?? ACCEPTED;
}

function interpretationClash(values: JsonObject): Refusal | undefined {
  if (values.guessAlpha !== undefined && (values.alphaMode !== undefined || values.premulColor !== undefined)) return invalid("INVALID_VALUE", "guessAlpha lets After Effects choose the alpha mode; do not also set alphaMode or premulColor.");
  if (values.guessPulldown !== undefined && values.removePulldown !== undefined) return invalid("INVALID_VALUE", "guessPulldown picks the pulldown phase itself; do not also set removePulldown.");
  if (values.resetFrameRate !== undefined && values.conformFrameRate !== undefined) return invalid("INVALID_VALUE", "resetFrameRate restores the native rate; do not also set conformFrameRate.");
  return undefined;
}

function interpretationValueError(values: JsonObject): Refusal | undefined {
  for (const [key, isValid, message] of INTERPRETATION_CHECKS) if (values[key] !== undefined && !isValid(values[key])) return invalid("INVALID_VALUE", message);
  if (values.premulColor !== undefined && values.alphaMode !== "premultiplied") return invalid("INVALID_VALUE", "premulColor is the matte colour of a premultiplied alpha; set alphaMode to \"premultiplied\" in the same operation.");
  return interpretationClash(values);
}

function hasEarlierImport(earlier: readonly JsonValue[], itemId: string): boolean {
  return objectsIn(earlier).some((operation) => operation.type === "import_file" && operation.newItemId === itemId);
}

function interpretationTargetError(context: OperationContext, itemId: string): Refusal | undefined {
  const item = context.snapshot?.items?.find((candidate) => candidate.id === itemId);
  if (context.snapshot && !item && !hasEarlierImport(context.earlier, itemId)) return invalid("TARGET_NOT_FOUND", "Footage item is not present in the current snapshot and is not imported earlier in this plan.");
  if (item && item.type !== "footage") return invalid("INVALID_TARGET", "Footage interpretation only applies to a footage item, not a folder or composition.");
  return undefined;
}

/** set_footage_interpretation: a footage item that exists or is imported earlier, and a non-empty set of bounded interpretation values. */
export function validateSetFootageInterpretation(context: OperationContext): OperationResult {
  const { operation, plan } = context;
  const unknownField = rejectUnknown(operation, ["type", "target", "interpretation"]);
  if (unknownField) return unknownField;
  const target = currentItemTarget(operation, plan, "set_footage_interpretation requires an exact current item target.");
  if (isRefusal(target)) return target;
  const wrongItem = interpretationTargetError(context, target.itemId);
  if (wrongItem) return wrongItem;
  const values = objectAt(operation, "interpretation");
  if (!values || Object.keys(values).length === 0) return invalid("INVALID_OPERATION", "set_footage_interpretation requires a non-empty interpretation object.");
  return rejectUnknown(values, INTERPRETATION_KEYS) ?? interpretationValueError(values) ?? ACCEPTED;
}
