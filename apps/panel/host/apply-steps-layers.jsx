/* Apply steps for layer operations: layer lifecycle and order, masks, shapes, 3D options, timing, audio, parenting and
 * switches. Each step is function (run, operation, scope), as in apply-steps-project.jsx.
 */
/* global AE_GLOBAL, HOST_LAYER_SWITCHES, aeApplyAddMask, aeApplyCreateLayer, aeApplyCreateShapeGroup, aeApplyCreatedLayers, aeApplyDetectSceneEdits,
   aeApplyDrawVectorShapes, aeApplyDuplicateLayer, aeApplyEnsureShapeFill, aeApplyEnsureShapeStroke, aeApplyFindLayer, aeApplyFindProperty,
   aeApplyLayerBounds, aeApplyMaskAt, aeApplyMaskCount, aeApplyMaskLedger, aeApplyMaskNameOf, aeApplyMaskPosition, aeApplyMaskReadback, aeApplyMaskValues,
   aeApplyMetadataGuard, aeApplyReadShapeGroup, aeApplyReorderLayer, aeApplyRequest, aeApplyResolveShapeGroup, aeApplySetCameraOptions,
   aeApplySetLayerSwitch, aeApplySetLightOptions, aeApplySetMaterialOptions, aeApplySetShapePath, aeApplySetTimeRemap, aeApplySetTrackMatte,
   aeApplyShapeItem, aeApplyTimeRemapState, aeApplyWriteNativeLayerProperty, aeCollectionStamp, aeHasOwn, aeMetadataBeforeOperation, aeSafe, aeSafeGet */
/* exported AE_APPLY_LAYER_STEPS */
function aeApplyLayerKey(operation, layerId) { return operation.compositionId + ":" + layerId; }
function aeApplyStepCreateLayer(run, operation, scope) {
    var createdLayer = aeApplyCreateLayer(scope.comp, operation);
    aeApplyCreatedLayers[aeApplyLayerKey(operation, operation.layerId)] = createdLayer; run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, requestedLayerId: operation.layerId,
      layerId: String(aeSafeGet(createdLayer, "id", "")), layerType: operation.layerType, name: String(createdLayer.name) };
}
function aeApplyStepDuplicateLayer(run, operation, scope) {
    var duplicatedLayer = aeApplyDuplicateLayer(scope.layer);
    aeApplyCreatedLayers[aeApplyLayerKey(operation, operation.newLayerId)] = duplicatedLayer; run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, sourceLayerId: operation.layerId,
      requestedLayerId: operation.newLayerId, layerId: String(aeSafeGet(duplicatedLayer, "id", "")), name: String(aeSafeGet(duplicatedLayer, "name", "")) };
}
function aeApplyStepRemoveLayer(run, operation, scope) {
    var layer = scope.layer, removedLayerId = String(aeSafeGet(layer, "id", operation.layerId));
    if (typeof layer.remove !== "function") throw new Error("REMOVE_LAYER_UNSUPPORTED");
    try { layer.remove(); } catch (removeError) { throw new Error("REMOVE_LAYER_FAILED"); }
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      removedLayerId: removedLayerId, verification: "layer-absent" };
}
function aeApplyStepReorderLayer(run, operation, scope) {
    aeApplyReorderLayer(scope.layer, operation, aeApplyCreatedLayers);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      placement: operation.placement, referenceLayerId: operation.referenceLayerId };
}
function aeApplyMatteHiddenNote(matteLayer, operation) {
    return "matte source " + aeSafeGet(matteLayer, "name",
      String(operation.matteLayerId)) + " is hidden (After Effects hides a layer used as a matte); showMatteLayer: true keeps it rendering";
}
function aeApplyStepTrackMatte(run, operation, scope) {
    var matteLayer = operation.matteLayerId === null ? null : (aeApplyCreatedLayers[aeApplyLayerKey(operation, operation.matteLayerId)]
      || aeApplyFindLayer(scope.comp, operation.matteLayerId));
    aeApplySetTrackMatte(scope.layer, matteLayer, operation);
    run.touched.push(operation.operation);
    var step = { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      matteLayerId: operation.matteLayerId, mode: operation.mode, verification: operation.matteLayerId === null ? "track-matte-cleared" : "track-matte-set" };
    if (matteLayer) { step.matteSourceEnabled = aeSafe(function () { return matteLayer.enabled === true; }, false);
      if (!step.matteSourceEnabled) step.matteSourceNote = aeApplyMatteHiddenNote(matteLayer, operation); }
    return step;
}
function aeApplyStepAddMask(run, operation, scope) {
    var ledger = aeApplyMaskLedger(run, operation, scope.layer), addedMask = aeApplyAddMask(scope.layer, operation, ledger);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      requestedMaskId: operation.newMaskId, name: String(aeSafeGet(addedMask, "name", "")), readback: aeApplyMaskReadback(addedMask),
      verification: "mask-created" };
}
function aeApplyStepUpdateMask(run, operation, scope) {
    var updatedMask = aeApplyMaskAt(scope.layer, aeApplyMaskPosition(run, operation, scope));
    aeApplyMaskValues(updatedMask, operation.values);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      requestedMaskId: operation.maskId, name: aeApplyMaskNameOf(updatedMask), readback: aeApplyMaskReadback(updatedMask),
      verification: "mask-values-written" };
}
function aeApplyStepRemoveMask(run, operation, scope) {
    var position = aeApplyMaskPosition(run, operation, scope), removedMask = aeApplyMaskAt(scope.layer, position);
    var removedMaskName = aeApplyMaskNameOf(removedMask), maskCountBefore = aeApplyMaskCount(scope.layer);
    if (typeof removedMask.remove !== "function") throw new Error("MASK_UNSUPPORTED");
    try { removedMask.remove(); } catch (removeMaskError) { throw new Error("REMOVE_MASK_FAILED"); }
    aeApplyMaskLedger(run, operation, scope.layer).splice(position, 1);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      requestedMaskId: operation.maskId, name: removedMaskName, maskCountBefore: maskCountBefore, maskCountAfter: aeApplyMaskCount(scope.layer),
      verification: "mask-absent" };
}
function aeApplyStepCreateShapeGroup(run, operation, scope) {
    var createdShapeGroup = aeApplyCreateShapeGroup(scope.layer, operation, run.createdShapeGroups),
      createdShapeReadback = aeApplyReadShapeGroup(scope.layer, createdShapeGroup, run.createdShapeGroups[operation.newGroupId + "#index"]);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      requestedGroupId: operation.newGroupId, name: String(aeSafeGet(createdShapeGroup, "name", "")), readback: createdShapeReadback,
      verification: "shape-group-read-back" };
}
function aeApplyShapeGroupStep(run, operation, readback, verification) {
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      requestedGroupId: operation.groupId, readback: readback, verification: verification };
}
function aeApplyStepSetShapePath(run, operation, scope) {
    var pathGroup = aeApplyResolveShapeGroup(scope.layer, operation.groupId, run.createdShapeGroups);
    if (!pathGroup) throw new Error("TARGET_NOT_FOUND");
    var pathReadback = aeApplySetShapePath(pathGroup, operation.path);
    if (pathReadback) pathReadback.bounds = aeApplyLayerBounds(scope.layer, 0);
    return aeApplyShapeGroupStep(run, operation, pathReadback, "shape-path-read-back");
}
function aeApplyStepEnsureShapeFill(run, operation, scope) {
    var fillGroup = aeApplyResolveShapeGroup(scope.layer, operation.groupId, run.createdShapeGroups);
    if (!fillGroup) throw new Error("TARGET_NOT_FOUND");
    return aeApplyShapeGroupStep(run, operation, aeApplyEnsureShapeFill(fillGroup, operation), "shape-fill-read-back");
}
function aeApplyStepEnsureShapeStroke(run, operation, scope) {
    var strokeGroup = aeApplyResolveShapeGroup(scope.layer, operation.groupId, run.createdShapeGroups);
    if (!strokeGroup) throw new Error("TARGET_NOT_FOUND");
    return aeApplyShapeGroupStep(run, operation, aeApplyEnsureShapeStroke(strokeGroup, operation), "shape-stroke-read-back");
}
function aeApplyStepDrawVectorShapes(run, operation, scope) {
    var vectorReadback = aeApplyDrawVectorShapes(scope.layer, operation);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      readback: vectorReadback, verification: "vector-shapes-read-back" };
}
function aeApplyStepShapeItem(run, operation, scope) {
    var itemResult = aeApplyShapeItem(scope.layer, operation, run.createdShapeGroups, run.createdShapeItems);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      groupId: operation.groupId, requestedItemId: operation.newItemId || operation.itemId, created: itemResult.created,
      containerPath: itemResult.itemPath, writes: itemResult.writes, animations: itemResult.animations, groupTransform: itemResult.groupTransform };
}
function aeApplyOptionsStep(run, operation, verification) {
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      verification: verification };
}
function aeApplyStepCameraOptions(run, operation, scope) { aeApplySetCameraOptions(scope.layer, operation);
  return aeApplyOptionsStep(run, operation, "camera-options-written"); }
function aeApplyStepLightOptions(run, operation, scope) { aeApplySetLightOptions(scope.layer, operation);
  return aeApplyOptionsStep(run, operation, "light-options-written"); }
function aeApplyStepMaterialOptions(run, operation, scope) { aeApplySetMaterialOptions(scope.layer, operation);
  return aeApplyOptionsStep(run, operation, "material-options-written"); }
function aeApplyStepSetLayerProperty(run, operation, scope) {
    var layerProperty = aeApplyFindProperty(scope.layer, operation.propertyPath), propertyWrite = aeApplyWriteNativeLayerProperty(scope.layer,
      operation, layerProperty);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      propertyPath: operation.propertyPath, beforeValue: propertyWrite.before.value, afterValue: propertyWrite.after.value,
      separatedDimensions: propertyWrite.separatedDimensions };
}
function aeApplyCheckReadSetEpoch() {
    if (!aeApplyMetadataGuard) return;
    aeApplyMetadataGuard.expectedStamp = aeCollectionStamp();
    if (aeApplyMetadataGuard.expectedStamp.epoch !== aeApplyRequest.readSet.stamp.epoch) throw new Error("STALE_READ_SET");
}
function aeApplyStepSetLayerName(run, operation, scope) {
    var layer = scope.layer, beforeName = aeApplyMetadataGuard ? aeMetadataBeforeOperation(aeApplyRequest, aeApplyMetadataGuard,
      scope.index) : String(layer.name);
    try { layer.name = operation.name; } catch (nameError) { throw new Error("PROPERTY_WRITE_FAILED"); }
    run.touched.push(operation.operation);
    run.steps.push({ operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      beforeValue: beforeName, afterValue: String(layer.name) });
    aeApplyCheckReadSetEpoch();
    return null;
}
function aeApplyShiftStartToIn(layer, operation) {
    if (operation.startTime !== undefined) layer.startTime = operation.startTime;
    else if (operation.inPoint !== undefined && operation.inPoint >= layer.outPoint) layer.startTime = layer.startTime + (operation.inPoint - layer.inPoint);
}
function aeApplyWriteLayerTiming(layer, operation) {
    if (operation.stretch !== undefined) layer.stretch = operation.stretch;
    aeApplyShiftStartToIn(layer, operation);
    if (operation.inPoint !== undefined && operation.outPoint !== undefined && operation.inPoint >= layer.outPoint) {
        layer.outPoint = operation.outPoint;
        layer.inPoint = operation.inPoint;
        return;
    }
    if (operation.inPoint !== undefined) layer.inPoint = operation.inPoint;
    if (operation.outPoint !== undefined) layer.outPoint = operation.outPoint;
}
function aeApplyStepSetLayerTiming(run, operation, scope) {
    var layer = scope.layer;
    try { aeApplyWriteLayerTiming(layer, operation); } catch (timingError) { throw new Error("TIMING_WRITE_FAILED"); }
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      inPoint: operation.inPoint, outPoint: operation.outPoint, startTime: operation.startTime, stretch: operation.stretch, observed: {
      inPoint: aeSafeGet(layer, "inPoint", null), outPoint: aeSafeGet(layer, "outPoint", null), startTime: aeSafeGet(layer, "startTime", null),
      stretch: aeSafeGet(layer, "stretch", null) } };
}
function aeApplyStepSetTimeRemap(run, operation, scope) {
    aeApplySetTimeRemap(scope.layer, operation.enabled);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      enabled: operation.enabled, observedEnabled: aeApplyTimeRemapState(scope.layer), verification: "time-remap-state-written" };
}
function aeApplyStepDetectSceneEdits(run, operation, scope) {
    var found = aeApplyDetectSceneEdits(scope.comp, scope.layer, operation.mode);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      mode: operation.mode, cutCount: found.count, cuts: found.cuts, truncated: found.truncated, verification: "scene-edits-diffed" };
}
function aeApplyStepSetAudio(run, operation, scope) {
    var layer = scope.layer;
    try { if (operation.enabled !== undefined) layer.audioEnabled = operation.enabled;
      if (operation.levelDb !== undefined) layer.audioLevels.setValue([operation.levelDb, operation.levelDb]); } catch (audioError) {
      throw new Error("AUDIO_WRITE_FAILED"); }
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      enabled: operation.enabled, levelDb: operation.levelDb };
}
function aeApplyAssertNoParentCycle(layer, newParent) {
    for (var ancestor = newParent, hops = 0; ancestor && hops < 1000; ancestor = aeSafeGet(ancestor, "parent", null), hops += 1) {if (ancestor === layer
      || String(ancestor.index) === String(layer.index)) throw new Error("PARENT_CYCLE");}
}
function aeApplyStepSetLayerParent(run, operation, scope) {
    var layer = scope.layer, newParent = operation.parentLayerId === null ? null : (aeApplyCreatedLayers[aeApplyLayerKey(operation,
      operation.parentLayerId)] || aeApplyFindLayer(scope.comp, operation.parentLayerId));
    if (operation.parentLayerId !== null && !newParent) throw new Error("TARGET_NOT_FOUND");
    aeApplyAssertNoParentCycle(layer, newParent);
    try { layer.parent = newParent; } catch (parentError) { throw new Error("PROPERTY_WRITE_FAILED"); }
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      parentLayerId: operation.parentLayerId };
}
var AE_APPLY_LAYER_ATTRIBUTE_PROPERTIES = { "three-d": "threeDLayer", shy: "shy", solo: "solo", enabled: "enabled", locked: "locked" };
function aeApplyWriteLayerAttribute(layer, operation) {
    var role = operation.role;
    if (role === "blend-mode") layer.blendingMode = BlendingMode[operation.value];
    else if (aeHasOwn(AE_APPLY_LAYER_ATTRIBUTE_PROPERTIES, role)) layer[AE_APPLY_LAYER_ATTRIBUTE_PROPERTIES[role]] = operation.value;
    else if (aeHasOwn(HOST_LAYER_SWITCHES, role)) aeApplySetLayerSwitch(layer, operation);
    else throw new Error("INVALID_OPERATION");
}
function aeApplyAttributeFailure(attributeError) {
    var keep = attributeError instanceof Error && (attributeError.message === "INVALID_OPERATION"
      || attributeError.message.indexOf("LAYER_SWITCH_UNSUPPORTED") === 0);
    return keep ? attributeError : new Error("PROPERTY_WRITE_FAILED");
}
function aeApplyLayerAttributeHeld(layer, operation) {
    var role = operation.role, value = operation.value;
    if (role === "blend-mode") return aeSafe(function () { return layer.blendingMode === BlendingMode[value]; }, false);
    if (aeHasOwn(AE_APPLY_LAYER_ATTRIBUTE_PROPERTIES, role)) {return aeSafe(function () {
      return layer[AE_APPLY_LAYER_ATTRIBUTE_PROPERTIES[role]] === value; }, false);}
    var spec = HOST_LAYER_SWITCHES[role];
    if (!spec) return false;
    if (spec.kind === "enum") return aeSafe(function () { return layer[spec.host] === AE_GLOBAL[spec.enumObject][value]; }, false);
    return aeSafe(function () { return layer[spec.host] === value; }, false);
}
function aeApplyStepSetLayerAttribute(run, operation, scope) {
    try { aeApplyWriteLayerAttribute(scope.layer, operation); } catch (attributeError) { throw aeApplyAttributeFailure(attributeError); }
    var held = aeApplyLayerAttributeHeld(scope.layer, operation);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      role: operation.role, value: operation.value, readBackMatches: held, verification: held ? "layer-attribute-read-back" : "layer-attribute-written" };
}
/** The layer-scoped apply steps by operation name; each family file adds its entries. */
var AE_APPLY_LAYER_STEPS = {
    create_layer: aeApplyStepCreateLayer, duplicate_layer: aeApplyStepDuplicateLayer, remove_layer: aeApplyStepRemoveLayer,
      reorder_layer: aeApplyStepReorderLayer,
    set_track_matte: aeApplyStepTrackMatte, add_mask: aeApplyStepAddMask, update_mask: aeApplyStepUpdateMask, remove_mask: aeApplyStepRemoveMask,
    create_shape_group: aeApplyStepCreateShapeGroup, set_shape_path: aeApplyStepSetShapePath, ensure_shape_fill: aeApplyStepEnsureShapeFill,
    ensure_shape_stroke: aeApplyStepEnsureShapeStroke, draw_vector_shapes: aeApplyStepDrawVectorShapes, add_shape_item: aeApplyStepShapeItem,
      update_shape_item: aeApplyStepShapeItem,
    set_camera_options: aeApplyStepCameraOptions, set_light_options: aeApplyStepLightOptions, set_material_options: aeApplyStepMaterialOptions,
    set_layer_property: aeApplyStepSetLayerProperty, set_layer_name: aeApplyStepSetLayerName, set_layer_timing: aeApplyStepSetLayerTiming,
      set_time_remap: aeApplyStepSetTimeRemap, detect_scene_edits: aeApplyStepDetectSceneEdits,
    set_audio: aeApplyStepSetAudio, set_layer_parent: aeApplyStepSetLayerParent, set_layer_attribute: aeApplyStepSetLayerAttribute
};
