// Composition-level operation kinds: creating, duplicating and rendering a composition, and the check that a composition exists
// in the snapshot or is created earlier in the plan.
import { openCompositionNotRead, type ProjectSnapshot } from "@extynt/project-graph";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { hasPlannedComposition, type OperationContext } from "./layer-targets.js";
import { renderSettingsRefusal } from "./output-cleanup-ops.js";
import { compositionTarget, isCurrentIdentity } from "./plan-shape.js";
import { ACCEPTED, invalid, isAbsoluteBoundedPath, isBoundedName, isFiniteInRange, isIntegerInRange, isNonEmptyString, isOptionalBoundedName, isPlaceholderField, isPositiveFiniteUpTo, isRefusal, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";

const CREATE_COMPOSITION_FIELDS = ["type", "newCompositionId", "snapshotFingerprint", "selectionFingerprint", "name", "width", "height", "durationSeconds", "frameRate"];
const DUPLICATE_COMPOSITION_FIELDS = ["type", "target", "newCompositionId", "name"];
const RENDER_COMPOSITION_FIELDS = ["type", "compositionId", "snapshotFingerprint", "selectionFingerprint", "renderSettingsTemplate", "outputModuleTemplate", "outputPath", "destinationPolicy", "executeAuthorization", "outputSettings", "renderSettings", "mediaEncoder"];

/** True when the snapshot holds the composition or an earlier operation of the plan creates it. */
export function compositionKnown(snapshot: ProjectSnapshot, earlier: readonly JsonValue[], compositionId: string): boolean {
  return snapshot.compositions.some((composition) => composition.id === compositionId) || hasPlannedComposition(earlier, compositionId);
}

/** The TARGET_NOT_FOUND refusal for a composition that neither the snapshot holds nor the plan creates earlier; none without a snapshot. */
export function unknownCompositionError(snapshot: ProjectSnapshot | undefined, earlier: readonly JsonValue[], compositionId: string): Refusal | undefined {
  if (!snapshot || compositionKnown(snapshot, earlier, compositionId)) return undefined;
  return invalid("TARGET_NOT_FOUND", openCompositionNotRead(snapshot, compositionId) ?? "Composition target is not present in the current snapshot or created earlier in this plan.");
}

function compositionShapeError(operation: JsonObject): Refusal | undefined {
  if (!isIntegerInRange(operation.width, 4, 8192)) return invalid("INVALID_VALUE", "width must be an integer from 4 to 8192.");
  if (!isIntegerInRange(operation.height, 4, 8192)) return invalid("INVALID_VALUE", "height must be an integer from 4 to 8192.");
  if (!isPositiveFiniteUpTo(operation.durationSeconds, 10_800)) return invalid("INVALID_VALUE", "durationSeconds must be a positive number up to 10800 (3 hours).");
  return isFiniteInRange(operation.frameRate, 1, 120) ? undefined : invalid("INVALID_VALUE", "frameRate must be a number from 1 to 120.");
}

/** create_composition: current snapshot identity, a `__new__:` placeholder id, a bounded name and bounded size, duration and frame rate. */
export function validateCreateComposition(context: OperationContext): OperationResult {
  const { operation, plan } = context;
  const unknownField = rejectUnknown(operation, CREATE_COMPOSITION_FIELDS);
  if (unknownField) return unknownField;
  if (!isCurrentIdentity(operation, plan)) return invalid("STALE_TARGET", "Every v0.2 operation must carry the exact current snapshot and selection identity.");
  if (!isPlaceholderField(operation.newCompositionId)) return invalid("INVALID_OPERATION", "create_composition requires a __new__: placeholder id.");
  if (!isBoundedName(operation.name, 256)) return invalid("INVALID_OPERATION", "create_composition requires a bounded 1-256 character name.");
  return compositionShapeError(operation) ?? ACCEPTED;
}

/** duplicate_composition copies an observed or earlier-planned composition; the copy answers to its newCompositionId placeholder in later operations. */
export function validateDuplicateComposition(context: OperationContext): OperationResult {
  const { operation, plan, snapshot, earlier } = context;
  const unknownField = rejectUnknown(operation, DUPLICATE_COMPOSITION_FIELDS);
  if (unknownField) return unknownField;
  const target = compositionTarget(operation, plan);
  if (isRefusal(target)) return target;
  const newCompositionId = operation.newCompositionId;
  if (!isPlaceholderField(newCompositionId)) return invalid("INVALID_OPERATION", "duplicate_composition requires a __new__: newCompositionId placeholder.");
  if (hasPlannedComposition(earlier, newCompositionId)) return invalid("INVALID_OPERATION", "duplicate_composition newCompositionId is already used earlier in this plan.");
  if (!isOptionalBoundedName(operation.name, 256)) return invalid("INVALID_OPERATION", "duplicate_composition name must be a bounded 1-256 character string.");
  return unknownCompositionError(snapshot, earlier, target.compositionId) ?? ACCEPTED;
}

function renderPathError(operation: JsonObject, plan: JsonObject): Refusal | undefined {
  if (!isCurrentIdentity(operation, plan) || !isNonEmptyString(operation.compositionId) || !isAbsoluteBoundedPath(operation.outputPath, 1024) || operation.destinationPolicy !== "explicit-local-path") return invalid("INVALID_VALUE", "render_composition requires an exact composition and bounded explicit local output path policy.");
  return undefined;
}

function renderTemplateError(operation: JsonObject): Refusal | undefined {
  const authorization = operation.executeAuthorization;
  if (!isOptionalBoundedName(operation.renderSettingsTemplate, 128) || !isOptionalBoundedName(operation.outputModuleTemplate, 128) || (authorization !== undefined && authorization !== "RENDER_NOW")) return invalid("INVALID_VALUE", "Render templates and authorization are outside the typed bound.");
  return undefined;
}

function missingRenderComposition(snapshot: ProjectSnapshot | undefined, compositionId: JsonValue | undefined): Refusal | undefined {
  if (!snapshot || typeof compositionId !== "string") return undefined;
  if (snapshot.compositions.some((composition) => composition.id === compositionId)) return undefined;
  return invalid("TARGET_NOT_FOUND", openCompositionNotRead(snapshot, compositionId) ?? "Render composition is not present in the current snapshot.");
}

/** render_composition: an exact composition, a bounded explicit local output path, bounded templates and settings, and a composition the snapshot holds. */
export function validateRenderComposition(context: OperationContext): OperationResult {
  const { operation, plan, snapshot } = context;
  const unknownField = rejectUnknown(operation, RENDER_COMPOSITION_FIELDS);
  if (unknownField) return unknownField;
  const problem = renderPathError(operation, plan) ?? renderTemplateError(operation) ?? renderSettingsRefusal(operation);
  return problem ?? missingRenderComposition(snapshot, operation.compositionId) ?? ACCEPTED;
}
