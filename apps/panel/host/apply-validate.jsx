/* Apply: preflight shape validation of every operation, and plan-order lookups. */
/* global AE_APPLY_VAL_COMPOSITION_SETTING_KEYS, AE_APPLY_VAL_FILL_SPECS, AE_APPLY_VAL_RULES_COMPOSITION, AE_APPLY_VAL_RULES_LAYER,
  AE_APPLY_VAL_RULES_PROJECT, AE_APPLY_VAL_STROKE_SPECS, MAX_FRAMES_PER_ANIMATION, aeApplyEffectPathPrefix, aeApplyFrameShapeValid,
  aeApplyIsRecordValue, aeApplyKeyframeModeValid, aeApplyRequest, aeApplyValFirstFailed, aeHasOwn, aeSafe */
/* exported aeApplyDuplicateLayerPlaceholder, aeApplyDuplicatedCompositionBefore, aeApplyEarlierOperation, aeApplyIsLockOperation,
  aeApplyItemReferencedEarlier, aeApplyNormalizeTypedOperation, aeApplyOperationShape, aeApplyPlannedAnimationBefore, aeApplyPlannedAnimatorBefore,
  aeApplyPlannedCompositionBefore, aeApplyPlannedEnsureBefore, aeApplyPlannedFolderBefore, aeApplyPlannedItemBefore, aeApplyPlannedLayerBefore,
  aeApplyPlannedLockState, aeApplyPlannedMaskBefore, aeApplyPlannedShapeGroupBefore, aeApplyValidFrames, aeApplyValidationFailure */
function aeApplyIsMarkerKind(kind) { return kind === "add_marker" || kind === "update_marker" || kind === "remove_marker"; }
function aeApplyRuleFor(table, kind) { return aeHasOwn(table, kind) ? table[kind] : null; }
/**
 * Preflight order is fixed: project-level kinds, then the compositionId requirement, composition-level kinds, then the
 * layerId requirement, then layer kinds. Reports exactly what the host received, because live AE rejected single-field
 * markers that pass in the Node host VM.
 */
function aeApplyOperationShape(operation) {
    if (!operation || typeof operation.operation !== "string") return "INVALID_COMMAND";
    var kind = operation.operation, rule = aeApplyRuleFor(AE_APPLY_VAL_RULES_PROJECT, kind);
    if (rule) return rule(operation);
    if (typeof operation.compositionId !== "string" || operation.compositionId.length < 1) return "INVALID_COMMAND";
    rule = aeApplyRuleFor(AE_APPLY_VAL_RULES_COMPOSITION, kind);
    if (rule) return rule(operation);
    return aeApplyLayerLevelShape(operation, kind);
}
function aeApplyLayerLevelShape(operation, kind) {
    var compositionMarker = operation.layerId === undefined && aeApplyIsMarkerKind(kind);
    if (typeof operation.layerId !== "string" && !compositionMarker) return "INVALID_COMMAND";
    var rule = aeApplyRuleFor(AE_APPLY_VAL_RULES_LAYER, kind);
    return rule ? rule(operation) : "UNSUPPORTED_OPERATION";
}
function aeApplyFramesOrdered(frames) {
    var previousTime = -1;
    for (var i = 0; i < frames.length; i += 1) {
        if (!aeApplyFrameShapeValid(frames[i], i === frames.length - 1) || frames[i].time <= previousTime) return false;
        previousTime = frames[i].time;
    }
    return true;
}
/** True when the keyframes are 1 to MAX_FRAMES_PER_ANIMATION in order, there is no expression, and the keyframe mode is valid. */
function aeApplyValidFrames(operation) {
    if (operation.expression || !aeApplyKeyframeModeValid(operation.keyframeMode)) return false;
    var frames = operation.keyframes;
    return frames instanceof Array && frames.length >= 1 && frames.length <= MAX_FRAMES_PER_ANIMATION && aeApplyFramesOrdered(frames);
}
function aeApplyMarkerFieldTypes(operation) { var names = ["time", "comment", "duration", "chapter", "url", "cuePointName", "label"], parts = [], i, value; for (i = 0; i < names.length; i += 1) { value = aeSafe(function () { return operation[names[i]]; }, undefined); parts.push(names[i] + ":" + (value === null ? "null" : typeof value)); } var keys = []; try { for (var key in operation) keys.push(key); } catch (ignored) {} return parts.join(",") + " keys=" + keys.join("|").slice(0, 160); }
function aeApplyShapePaintFailure(operation) {
    var failed = aeApplyValFirstFailed(operation, operation.operation === "ensure_shape_stroke" ? AE_APPLY_VAL_STROKE_SPECS : AE_APPLY_VAL_FILL_SPECS);
    return failed ? failed[5] : "the shape paint payload did not match the host contract";
}
var AE_APPLY_VALIDATION_MESSAGES = {
    set_composition_settings: "INVALID_VALUE: set_composition_settings requires a non-empty bounded settings object (width, height, pixelAspect, durationSeconds, frameRate, backgroundColor, workAreaStart, workAreaDuration, motionBlur, shutterAngle, shutterPhase, motionBlurSamplesPerFrame, motionBlurAdaptiveSampleLimit, or renderer).",
    draw_vector_shapes: "INVALID_VALUE: draw_vector_shapes requires 1-256 shapes, each with a name, 1-64 Shape DTO paths and a fill or stroke (fill {color, opacity?, rule? 1|2}; stroke {color, width, opacity?, cap? 1-3, join? 1-3, miterLimit?}), at most 12000 path points in all.",
    set_camera_options: "INVALID_VALUE: set_camera_options requires non-empty bounded camera options.",
    set_light_options: "INVALID_VALUE: set_light_options requires non-empty bounded light options."
};
/** Failure text for a validation code: the code itself, or "INVALID_VALUE: <reason>" for the operation kind. */
function aeApplyValidationFailure(operation, code) {
    if (code !== "INVALID_VALUE") return code;
    var kind = operation.operation;
    if (aeHasOwn(AE_APPLY_VALIDATION_MESSAGES, kind)) return AE_APPLY_VALIDATION_MESSAGES[kind];
    if (kind === "add_marker" || kind === "update_marker") return "INVALID_VALUE: marker requires finite time and at least one bounded marker field (comment, duration, chapter, url, cuePointName, or label). Host saw " + aeApplyMarkerFieldTypes(operation) + ".";
    if (kind === "ensure_shape_fill" || kind === "ensure_shape_stroke") return "INVALID_VALUE: " + kind + " " + aeApplyShapePaintFailure(operation) + ".";
    return code;
}
/** True when any operation before index satisfies the matches predicate. */
function aeApplyEarlierOperation(index, matches) {
    for (var previous = 0; previous < index; previous += 1) {
        var candidate = aeApplyRequest.operations[previous];
        if (candidate && matches(candidate)) return true;
    }
    return false;
}
function aeApplyNamesItem(candidate, itemId) { return candidate.itemId === itemId || candidate.newFolderId === itemId
  || candidate.newItemId === itemId || candidate.parentFolderId === itemId || candidate.destinationFolderId === itemId
    || candidate.folderId === itemId; }
/** True when an earlier operation ensures the same effect path on the same layer. */
function aeApplyPlannedEnsureBefore(index, operation) { return aeApplyEarlierOperation(index, function (candidate) { return candidate.operation === "ensure_effect" && candidate.compositionId === operation.compositionId && candidate.layerId === operation.layerId && candidate.effectPath === aeApplyEffectPathPrefix(operation); }); }
var AE_APPLY_LAYER_PRODUCERS = { create_layer: "layerId", duplicate_layer: "newLayerId", derive_layer: "newLayerId", precompose_layers: "newLayerId" };
function aeApplyMakesLayer(candidate, compositionId, layerId, producers) {
  return !!candidate && candidate.compositionId === compositionId && aeHasOwn(producers, candidate.operation)
    && candidate[producers[candidate.operation]] === layerId; }
// A duplicate_composition copy holds the source's layers under the source's layer ids, so any id in it is planned.
function aeApplyDuplicatedCompositionBefore(index, compositionId) { return aeApplyEarlierOperation(index, function (candidate) { return candidate.operation === "duplicate_composition" && candidate.newCompositionId === compositionId; }); }
// A layer's lock at an operation: the live state, changed by every earlier set_layer_attribute locked in the plan, so a plan can unlock, edit and relock.
function aeApplyIsLockOperation(operation) { return operation.operation === "set_layer_attribute" && operation.role === "locked"; }
/** The layer's lock state at this operation: the live state changed by every earlier lock operation. Returns a boolean. */
function aeApplyPlannedLockState(index, compositionId, layerId, liveLocked) {
    var locked = liveLocked === true;
    for (var previous = 0; previous < index; previous += 1) {
        var candidate = aeApplyRequest.operations[previous];
        if (candidate && aeApplyIsLockOperation(candidate) && candidate.compositionId === compositionId
          && candidate.layerId === layerId) locked = candidate.value === true;
    }
    return locked;
}
/** True when an earlier operation makes the layer with this id in the composition. */
function aeApplyPlannedLayerBefore(index, compositionId, layerId) {
  return aeApplyEarlierOperation(index, function (candidate) {
    return aeApplyMakesLayer(candidate, compositionId, layerId, AE_APPLY_LAYER_PRODUCERS); }); }
var AE_APPLY_LAYER_PLACEHOLDER_PRODUCERS = { create_layer: "layerId", duplicate_layer: "newLayerId", derive_layer: "newLayerId" };
/** True when a different operation of the plan makes the layer through a placeholder producer (a duplicate). */
function aeApplyDuplicateLayerPlaceholder(index, compositionId, layerId) {
  for (var candidateIndex = 0; candidateIndex < aeApplyRequest.operations.length; candidateIndex += 1) {if (
    candidateIndex !== index && aeApplyMakesLayer(aeApplyRequest.operations[candidateIndex], compositionId, layerId,
      AE_APPLY_LAYER_PLACEHOLDER_PRODUCERS)) return true;} return false; }
var AE_APPLY_VAL_SELECTOR_PREFIX = "ADBE Text Properties/ADBE Text Animators/ADBE Text Animator/ADBE Text Selectors/ADBE Text Selector/";
var AE_APPLY_VAL_SELECTOR_RANGES = ["ADBE Text Percent Start", "ADBE Text Percent End", "ADBE Text Percent Offset"];
function aeApplyIsSelectorRangeAnimation(operation) {
    if (operation.operation !== "animate_property") return false;
    for (var i = 0; i < AE_APPLY_VAL_SELECTOR_RANGES.length; i += 1) {if (
      operation.propertyPath === AE_APPLY_VAL_SELECTOR_PREFIX + AE_APPLY_VAL_SELECTOR_RANGES[i]) return true;}
    return false;
}
/** True for a selector-range animation when an earlier operation ensures the text opacity animator on the same layer. */
function aeApplyPlannedAnimatorBefore(index, operation) { return aeApplyIsSelectorRangeAnimation(operation) && aeApplyEarlierOperation(index, function (candidate) { return candidate.operation === "ensure_text_animator" && candidate.compositionId === operation.compositionId && candidate.layerId === operation.layerId && candidate.role === "text.opacity"; }); }
/** True when an earlier operation animates the same property of the same layer. */
function aeApplyPlannedAnimationBefore(index, operation) { return aeApplyEarlierOperation(index, function (candidate) { return (candidate.operation === "animate_property" || candidate.operation === "animate_control") && candidate.compositionId === operation.compositionId && candidate.layerId === operation.layerId && candidate.propertyPath === operation.propertyPath; }); }
/** True when an earlier operation creates, duplicates or precomposes into the composition with this new id. */
function aeApplyPlannedCompositionBefore(index, newCompositionId) { return aeApplyEarlierOperation(index, function (candidate) { return (candidate.operation === "create_composition" || candidate.operation === "duplicate_composition" || candidate.operation === "precompose_layers") && candidate.newCompositionId === newCompositionId; }); }
/** True when an earlier operation creates the folder with this new id. */
function aeApplyPlannedFolderBefore(index, newFolderId) { return aeApplyEarlierOperation(index, function (candidate) { return candidate.operation === "create_folder" && candidate.newFolderId === newFolderId; }); }
/** True when an earlier operation imports, creates vector artwork or a folder under this new item id. */
function aeApplyPlannedItemBefore(index, newItemId) { return aeApplyEarlierOperation(index, function (candidate) { return ((candidate.operation === "import_file" || candidate.operation === "create_vector_artwork") && candidate.newItemId === newItemId) || (candidate.operation === "create_folder" && candidate.newFolderId === newItemId); }); }
/** True when an operation before index names the item id. */
function aeApplyItemReferencedEarlier(index, itemId) { return aeApplyEarlierOperation(
  index, function (candidate) { return aeApplyNamesItem(candidate, itemId); }); }
/** True when an earlier operation adds the mask with this id on the layer. */
function aeApplyPlannedMaskBefore(index, compositionId, layerId, maskId) { return aeApplyEarlierOperation(index, function (candidate) { return candidate.operation === "add_mask" && candidate.compositionId === compositionId && candidate.layerId === layerId && candidate.newMaskId === maskId; }); }
/** True when an earlier operation creates the shape group with this id on the layer. */
function aeApplyPlannedShapeGroupBefore(index, compositionId, layerId, groupId) { return aeApplyEarlierOperation(index, function (candidate) { return candidate.operation === "create_shape_group" && candidate.compositionId === compositionId && candidate.layerId === layerId && candidate.newGroupId === groupId; }); }
var AE_APPLY_VAL_MARKER_FIELDS = { time: true, comment: true, duration: true, chapter: true, url: true, cuePointName: true, label: true };
function aeApplyAdoptNestedTarget(operation) {
    if (!aeApplyIsRecordValue(operation.target)) return;
    if (operation.compositionId === undefined && typeof operation.target.compositionId === "string") operation.compositionId = operation.target.compositionId;
    if (operation.layerId === undefined && typeof operation.target.layerId === "string") operation.layerId = operation.target.layerId;
}
function aeApplyFlatCompositionSettings(operation) {
    if (operation.operation !== "set_composition_settings" || aeApplyIsRecordValue(operation.settings)) return;
    var normalized = {}, key;
    for (key in AE_APPLY_VAL_COMPOSITION_SETTING_KEYS) if (operation[key] !== undefined) normalized[key] = operation[key];
    operation.settings = normalized;
}
function aeApplyNestedMarkerFields(operation) {
    if ((operation.operation !== "add_marker" && operation.operation !== "update_marker") || !aeApplyIsRecordValue(operation.marker)) return;
    for (var key in AE_APPLY_VAL_MARKER_FIELDS) if (operation[key] === undefined && operation.marker[key] !== undefined) operation[key] = operation.marker[key];
    try { delete operation.marker; } catch (ignoredMarker) {}
}
/**
 * This runs before aeApplyOperationShape so the same bounded checks protect both wire representations. Accepts only
 * the known target fields from a nested typed operation, and the allowlisted composition fields flat or under
 * settings; marker payloads are copied only from the typed nested marker object.
 */
function aeApplyNormalizeTypedOperation(operation) {
    if (!operation || typeof operation !== "object") return operation;
    aeApplyAdoptNestedTarget(operation);
    aeApplyFlatCompositionSettings(operation);
    aeApplyNestedMarkerFields(operation);
    return operation;
}
