/* Apply preflight: every operation is normalised, shape-checked and target-checked before any of them is applied. It
 * runs first in apply-flow.jsx.
 */
/* global AE_LAYER_STYLES_INERT, aeApplyDuplicateLayerPlaceholder, aeApplyDuplicatedCompositionBefore, aeApplyFindComp, aeApplyFindItem,
   aeApplyFindLayer, aeApplyFindProperty, aeApplyIsFolder, aeApplyIsLockOperation, aeApplyItemReferencedEarlier, aeApplyLayerStyleCommandsLive,
   aeApplyLayerStyleNeedsCommand, aeApplyLayerStyleProperty, aeApplyMaskByOrdinal, aeApplyMaskIsNewPlaceholder, aeApplyMaskLayerKeyOf,
   aeApplyMaskOrdinalId, aeApplyMaskOrdinalOf, aeApplyNormalizeTypedOperation, aeApplyOperationShape, aeApplyPlannedAnimationBefore,
   aeApplyPlannedAnimatorBefore, aeApplyPlannedCompositionBefore, aeApplyPlannedEnsureBefore, aeApplyPlannedFolderBefore, aeApplyPlannedItemBefore,
   aeApplyPlannedLayerBefore, aeApplyPlannedLockState, aeApplyPlannedMaskBefore, aeApplyPlannedShapeGroupBefore, aeApplyPlannedTimeRemapBefore,
   aeApplyPresetFilePath, aeApplyRendererListed, aeApplyRendererNames, aeApplyRequest, aeApplyResolveMask, aeApplyResolveShapeGroup,
   aeApplySeparationProblem, aeApplyValidateKeyShapes, aeApplyValidateNativeLayerPropertyWrite, aeApplyValidationFailure, aeHasOwn, aeListHas, aeSafeGet */
/* exported aeApplyPreflight */
function aeApplyPreMissingComp(index, compositionId) { return !aeApplyFindComp(compositionId) && !aeApplyPlannedCompositionBefore(index, compositionId); }
function aeApplyPreMissingItem(index, itemId) { return !aeApplyFindItem(itemId) && !aeApplyPlannedItemBefore(index, itemId); }
function aeApplyPreMissingFolder(index, folderId) { return !aeApplyFindItem(folderId) && !aeApplyPlannedFolderBefore(index, folderId); }
function aeApplyPreNothing() { return true; }
function aeApplyPreMembers(index, operation, flatComp) {
    for (var memberIndex = 0; memberIndex < operation.layerIds.length; memberIndex += 1) {
        var memberLayer = aeApplyFindLayer(flatComp, operation.layerIds[memberIndex]);
        if (!memberLayer && !aeApplyPlannedLayerBefore(index, operation.compositionId, operation.layerIds[memberIndex])) throw new Error("TARGET_NOT_FOUND");
        if (memberLayer && memberLayer.locked) throw new Error("TARGET_LOCKED");
    }
}
function aeApplyPreMogrtSaved(operation) {
    if (operation.operation === "export_mogrt"
      && app.project.file === null) throw new Error("MOGRT_PROJECT_UNSAVED: the project has never been saved, so After Effects would open a Save As dialog. Ask the user to save the project (File > Save), then export the .mogrt; do not retry until they have.");
}
function aeApplyPreFlatComp(index, operation) {
    aeApplyPreMogrtSaved(operation);
    var flatComp = aeApplyFindComp(operation.compositionId);
    if (!flatComp && !aeApplyPlannedCompositionBefore(index, operation.compositionId)) throw new Error("TARGET_NOT_FOUND");
    if (operation.operation === "precompose_layers") aeApplyPreMembers(index, operation, flatComp);
    return true;
}
function aeApplyPreCreateLayer(index, operation) {
    if (operation.layerType === "footage" && !aeApplyFindItem(operation.sourceItemId) && !aeApplyPlannedItemBefore(index, operation.sourceItemId)
      && !aeApplyPlannedCompositionBefore(index, operation.sourceItemId)) throw new Error("TARGET_NOT_FOUND");
    return false;
}
function aeApplyPreCompositionSettings(index, operation) {
    var settingsComp = aeApplyFindComp(operation.compositionId);
    if (!settingsComp && aeApplyPlannedCompositionBefore(index, operation.compositionId)) return true;
    if (!settingsComp) throw new Error("TARGET_NOT_FOUND");
    if (operation.settings.renderer !== undefined && !aeApplyRendererListed(settingsComp,
      operation.settings.renderer)) throw new Error("INVALID_VALUE: renderer " + String(operation.settings.renderer) + " is not in this composition's renderers (" + aeApplyRendererNames(settingsComp).join(", ") + ").");
    return true;
}
function aeApplyPreCompositionMarker(index, operation) {
    if (operation.layerId !== undefined) return false;
    if (aeApplyPreMissingComp(index, operation.compositionId)) throw new Error("TARGET_NOT_FOUND");
    return true;
}
function aeApplyPreRender(index, operation) {
    if (aeApplyPreMissingComp(index, operation.compositionId)) throw new Error("TARGET_NOT_FOUND");
    return true;
}
function aeApplyPreCleanup(index, operation) {
    for (var cleanupIndex = 0; operation.compositionIds
      && cleanupIndex < operation.compositionIds.length; cleanupIndex += 1) {if (aeApplyPreMissingComp(index,
      operation.compositionIds[cleanupIndex])) throw new Error("TARGET_NOT_FOUND");}
    return true;
}
function aeApplyPreCreateFolder(index, operation) {
    if (operation.parentFolderId !== undefined && operation.parentFolderId !== null && aeApplyPreMissingFolder(index,
      operation.parentFolderId)) throw new Error("TARGET_NOT_FOUND");
    return true;
}
function aeApplyPreDestination(index, operation) {
    if (operation.destinationFolderId === undefined || operation.destinationFolderId === null) return true;
    var destination = aeApplyFindItem(operation.destinationFolderId);
    if (!destination && !aeApplyPlannedFolderBefore(index, operation.destinationFolderId)) throw new Error("TARGET_NOT_FOUND");
    if (destination && !aeApplyIsFolder(destination)) throw new Error("TARGET_NOT_FOUND");
    return true;
}
function aeApplyPreItem(index, operation) {
    if (aeApplyPreMissingItem(index, operation.itemId)) throw new Error("TARGET_NOT_FOUND");
    if (operation.operation === "move_item_to_folder" && operation.folderId !== null && aeApplyPreMissingFolder(index,
      operation.folderId)) throw new Error("TARGET_NOT_FOUND");
    if (operation.operation === "delete_project_item" && aeApplyItemReferencedEarlier(index, operation.itemId)) throw new Error("ITEM_REFERENCED_EARLIER");
    return true;
}
var AE_APPLY_PREFLIGHT_EARLY = {
    create_composition: aeApplyPreNothing, set_project_settings: aeApplyPreNothing, save_project: aeApplyPreNothing,
      collect_project: aeApplyPreNothing, switch_project: aeApplyPreNothing, cleanup_project: aeApplyPreCleanup,
    duplicate_composition: aeApplyPreFlatComp, precompose_layers: aeApplyPreFlatComp, export_mogrt: aeApplyPreFlatComp,
      export_frame: aeApplyPreFlatComp, open_composition: aeApplyPreFlatComp, set_composition_guides: aeApplyPreFlatComp,
    create_layer: aeApplyPreCreateLayer, set_composition_settings: aeApplyPreCompositionSettings, render_composition: aeApplyPreRender,
    create_folder: aeApplyPreCreateFolder, import_file: aeApplyPreDestination, create_vector_artwork: aeApplyPreDestination,
    set_item_name: aeApplyPreItem, move_item_to_folder: aeApplyPreItem, delete_project_item: aeApplyPreItem,
    replace_footage: aeApplyPreItem, set_footage_proxy: aeApplyPreItem, clear_footage_proxy: aeApplyPreItem, set_footage_interpretation: aeApplyPreItem,
    add_marker: aeApplyPreCompositionMarker, update_marker: aeApplyPreCompositionMarker, remove_marker: aeApplyPreCompositionMarker
};
function aeApplyPreLayerMissing(t, layerId) { return !aeApplyFindLayer(t.comp, layerId) && !aeApplyPlannedLayerBefore(t.index,
  t.operation.compositionId, layerId); }
function aeApplyPreMask(t) {
    var operation = t.operation, isNew = String(operation.maskId).indexOf("__new__:") === 0;
    if (isNew && !aeApplyPlannedMaskBefore(t.index, operation.compositionId, operation.layerId, operation.maskId)) throw new Error("TARGET_NOT_FOUND");
    if (t.layer && !isNew && !aeApplyResolveMask(t.layer, operation.maskId, t.run.createdMasks)) throw new Error("TARGET_NOT_FOUND");
}
function aeApplyPreShapeGroup(t) {
    var operation = t.operation, isNew = String(operation.groupId).indexOf("__new__:") === 0;
    if (isNew && !aeApplyPlannedShapeGroupBefore(t.index, operation.compositionId, operation.layerId, operation.groupId)) throw new Error("TARGET_NOT_FOUND");
    if (t.layer && !isNew && !aeApplyResolveShapeGroup(t.layer, operation.groupId, t.run.createdShapeGroups)) throw new Error("TARGET_NOT_FOUND");
}
function aeApplyPreDuplicate(t) { if (aeApplyDuplicateLayerPlaceholder(t.index, t.operation.compositionId,
  t.operation.newLayerId)) throw new Error("INVALID_VALUE"); }
var AE_APPLY_PREFLIGHT_BEFORE_LOCK = {
    update_mask: aeApplyPreMask, remove_mask: aeApplyPreMask, set_shape_path: aeApplyPreShapeGroup, ensure_shape_fill: aeApplyPreShapeGroup,
    ensure_shape_stroke: aeApplyPreShapeGroup, duplicate_layer: aeApplyPreDuplicate, derive_layer: aeApplyPreDuplicate
};
function aeApplyPreKeyConflict(t, property) {
    var operation = t.operation, keys = property ? aeSafeGet(property, "numKeys", 0) : 0;
    if (keys > 0 && (operation.keyframeMode === undefined || operation.keyframeMode === "reject") && !aeApplyPlannedAnimationBefore(t.index,
      operation)) throw new Error("CONFLICTING_KEYS: " + operation.propertyPath + " already has " + keys + " keyframe(s); set keyframeMode to merge or replace.");
}
function aeApplyPreKeys(t) {
    if (!t.layer) return;
    var operation = t.operation, property = aeApplyFindProperty(t.layer, operation.propertyPath);
    aeApplyPreKeyConflict(t, property);
    var separation = property ? aeApplySeparationProblem(property) : null;
    if (separation) throw new Error(separation);
    if (property) {aeApplyValidateKeyShapes(property, operation.keyframes || [], operation.keyframeMode === "merge"
      || (operation.keyframeMode === undefined && aeApplyPlannedAnimationBefore(t.index, operation)));}
}
function aeApplyPreAnimateProperty(t) {
    if (t.layer && !aeApplyFindProperty(t.layer, t.operation.propertyPath) && !aeApplyPlannedAnimatorBefore(t.index, t.operation)
      && !aeApplyPlannedTimeRemapBefore(t.index, t.operation)) throw new Error("PROPERTY_NOT_FOUND");
    aeApplyPreKeys(t);
}
function aeApplyPreAnimateControl(t) {
    if (t.layer && !aeApplyFindProperty(t.layer, t.operation.propertyPath) && !aeApplyPlannedEnsureBefore(t.index,
      t.operation)) throw new Error("PROPERTY_NOT_FOUND");
    aeApplyPreKeys(t);
}
function aeApplyPreLayerProperty(t) {
    if (!t.layer) return;
    var plannedProperty = aeApplyFindProperty(t.layer, t.operation.propertyPath);
    if (!plannedProperty) throw new Error("PROPERTY_NOT_FOUND");
    aeApplyValidateNativeLayerPropertyWrite(t.layer, t.operation, plannedProperty);
}
function aeApplyPreParent(t) {
    var operation = t.operation;
    if (operation.parentLayerId === operation.layerId) throw new Error("INVALID_VALUE");
    if (operation.parentLayerId !== null && t.comp && aeApplyPreLayerMissing(t, operation.parentLayerId)) throw new Error("TARGET_NOT_FOUND");
}
function aeApplyPreReorder(t) {
    var operation = t.operation;
    if (operation.placement !== "before" && operation.placement !== "after") return;
    if (operation.referenceLayerId === operation.layerId || aeApplyPreLayerMissing(t, operation.referenceLayerId)) throw new Error("TARGET_NOT_FOUND");
}
function aeApplyPreMatte(t) {
    var operation = t.operation;
    if (operation.matteLayerId !== null && (operation.matteLayerId === operation.layerId || aeApplyPreLayerMissing(t,
      operation.matteLayerId))) throw new Error("TARGET_NOT_FOUND");
}
var AE_APPLY_PREFLIGHT_AFTER_LOCK = {
    animate_property: aeApplyPreAnimateProperty, animate_control: aeApplyPreAnimateControl, set_layer_property: aeApplyPreLayerProperty,
    set_layer_parent: aeApplyPreParent, reorder_layer: aeApplyPreReorder, set_track_matte: aeApplyPreMatte
};
function aeApplyPrePlanAddMask(t) {
    var operation = t.operation, plannedKey = aeApplyMaskLayerKeyOf(operation.compositionId, operation.layerId);
    if (!t.run.plannedMaskAdds[plannedKey]) t.run.plannedMaskAdds[plannedKey] = [];
    t.run.plannedMaskAdds[plannedKey].push(String(operation.newMaskId));
}
function aeApplyPreResolveBinding(t, targetKey, ordinal) {
    var maskId = t.operation.maskId;
    if (aeApplyMaskIsNewPlaceholder(maskId)) return { binding: String(maskId), key: targetKey + "|" + String(maskId) };
    if (t.layer) return { binding: aeApplyMaskByOrdinal(t.layer, ordinal) ? aeApplyMaskOrdinalId(ordinal) : null, key: targetKey + "|ordinal:" + ordinal };
    var plannedAdds = t.run.plannedMaskAdds[targetKey];
    if (plannedAdds && ordinal >= 1 && ordinal <= plannedAdds.length) {return { binding: plannedAdds[ordinal - 1],
      key: targetKey + "|" + plannedAdds[ordinal - 1] };}
    return { binding: null, key: null };
}
function aeApplyPreBindMask(t) {
    var operation = t.operation, run = t.run, targetKey = aeApplyMaskLayerKeyOf(operation.compositionId, operation.layerId),
      ordinal = aeApplyMaskOrdinalOf(operation.maskId);
    var found = aeApplyPreResolveBinding(t, targetKey, ordinal);
    if (!found.binding) throw new Error("TARGET_NOT_FOUND");
    if (aeListHas(run.removedMaskBindingKeys,
      found.key)) throw new Error("MASK_REMOVED_EARLIER: " + String(operation.maskId) + " names a mask an earlier operation in this plan already removed");
    run.maskBindings[t.index] = found.binding;
    if (operation.operation === "remove_mask") run.removedMaskBindingKeys.push(found.key);
}
var AE_APPLY_PREFLIGHT_PLAN = { add_mask: aeApplyPrePlanAddMask, update_mask: aeApplyPreBindMask, remove_mask: aeApplyPreBindMask };
function aeApplyPreRunKind(table, t) {
    var kind = t.operation.operation;
    if (typeof kind === "string" && aeHasOwn(table, kind)) table[kind](t);
}
function aeApplyPrePlannedLayer(index, operation) { return aeApplyPlannedLayerBefore(index, operation.compositionId, operation.layerId)
  || aeApplyDuplicatedCompositionBefore(index, operation.compositionId); }
function aeApplyPreLayerLocked(index, operation, layer) { return !!layer && !aeApplyIsLockOperation(operation) && aeApplyPlannedLockState(index,
  operation.compositionId, operation.layerId, layer.locked); }
function aeApplyPreLayerTarget(run, index, operation) {
    var comp = aeApplyFindComp(operation.compositionId), layer = aeApplyFindLayer(comp, operation.layerId), planned = aeApplyPrePlannedLayer(index, operation);
    var t = { run: run, index: index, operation: operation, comp: comp, layer: layer, planned: planned };
    if (!comp && !aeApplyPlannedCompositionBefore(index, operation.compositionId)) throw new Error("TARGET_NOT_FOUND");
    if (operation.operation === "create_layer") { if (aeApplyDuplicateLayerPlaceholder(index, operation.compositionId,
      operation.layerId)) throw new Error("INVALID_VALUE"); return; }
    if (!layer && !planned) throw new Error("TARGET_NOT_FOUND");
    aeApplyPreRunKind(AE_APPLY_PREFLIGHT_BEFORE_LOCK, t);
    if (aeApplyPreLayerLocked(index, operation, layer)) throw new Error("TARGET_LOCKED");
    aeApplyPreRunKind(AE_APPLY_PREFLIGHT_AFTER_LOCK, t);
    aeApplyPreRunKind(AE_APPLY_PREFLIGHT_PLAN, t);
}
function aeApplyPreflightTargets(run, index, operation) {
    var kind = operation.operation;
    if (typeof kind === "string" && aeHasOwn(AE_APPLY_PREFLIGHT_EARLY, kind) && AE_APPLY_PREFLIGHT_EARLY[kind](index, operation)) return;
    aeApplyPreLayerTarget(run, index, operation);
}
function aeApplyPreExtraPreset(index, operation) { if (!new File(aeApplyPresetFilePath(operation)).exists) throw new Error("PRESET_NOT_FOUND"); }
function aeApplyPreExtraStyle(index, operation, layer) {
    if (layer && !aeApplyLayerStyleProperty(layer, operation.styleMatchName)) throw new Error("LAYER_STYLES_UNSUPPORTED");
    if (aeApplyLayerStyleNeedsCommand(layer, operation) && !aeApplyLayerStyleCommandsLive()) throw new Error(AE_LAYER_STYLES_INERT);
}
function aeApplyPreExtraControl(index, operation, layer) {
    if (!layer) return;
    var extraProperty = aeApplyFindProperty(layer, operation.propertyPath);
    if (!extraProperty && !aeApplyPlannedEnsureBefore(index, operation)) throw new Error("PROPERTY_NOT_FOUND");
    if (extraProperty && aeSafeGet(extraProperty, "numKeys",
      0) > 0) throw new Error("CONFLICTING_KEYS: " + operation.propertyPath + " has keyframes; use animate_control.");
}
var AE_APPLY_PREFLIGHT_EXTRA = { apply_preset: aeApplyPreExtraPreset, ensure_layer_style: aeApplyPreExtraStyle, set_effect_control: aeApplyPreExtraControl };
function aeApplyPreflightExtra(index, operation) {
    var layer = aeApplyFindLayer(aeApplyFindComp(operation.compositionId), operation.layerId);
    if (typeof operation.operation === "string" && aeHasOwn(AE_APPLY_PREFLIGHT_EXTRA,
      operation.operation)) AE_APPLY_PREFLIGHT_EXTRA[operation.operation](index, operation, layer);
}
function aeApplyPreflightShape(run, index) {
    var operations = aeApplyRequest.operations;
    run.currentIndex = index; operations[index] = aeApplyNormalizeTypedOperation(operations[index]);
    var shapeError = aeApplyOperationShape(operations[index]);
    if (shapeError) throw new Error(aeApplyValidationFailure(operations[index], shapeError));
}
/**
 * Checks every operation's shape, targets and extras before any write. Returns nothing; throws the first refusal.
 * Makes three passes over request.operations (shape, targets, extras) and throws the first failure.
 * exportAsMotionGraphicsTemplate on an untitled project is refused, since After Effects would open a modal Save As; a
 * renderer list for a composition the plan creates is checked by its step.
 */
function aeApplyPreflight(run) {
    var count = aeApplyRequest.operations.length, index;
    for (index = 0; index < count; index += 1) aeApplyPreflightShape(run, index);
    for (index = 0; index < count; index += 1) { run.currentIndex = index; aeApplyPreflightTargets(run, index, aeApplyRequest.operations[index]); }
    for (index = 0; index < count; index += 1) { run.currentIndex = index; aeApplyPreflightExtra(index, aeApplyRequest.operations[index]); }
}
