/* Apply replace_layer_source, center_anchor and copy_effects. */
/* global AE_APPLY_LAYER_STEPS, AE_APPLY_VAL_CHECKS, AE_APPLY_VAL_RULES_LAYER, aeApplyCreatedComps, aeApplyCreatedItems, aeApplyCreatedLayers,
  aeApplyFindComp, aeApplyFindItem, aeApplyFindLayer, aeApplyFindProperty, aeApplyValSpecRule, aeErrorTextShort, aeKeyEditReadAll,
  aeKeyEditReportRestores, aeKeyEditWrite, aeOwnValue, aeSafe, aeSafeGet */

AE_APPLY_VAL_RULES_LAYER.replace_layer_source = aeApplyValSpecRule([["sourceItemId", "str", 1, 512]]);
function aeLayerMoreItem(itemId) { return aeOwnValue(aeApplyCreatedComps, itemId) || aeOwnValue(aeApplyCreatedItems, itemId) || aeApplyFindItem(itemId); }
function aeApplyStepReplaceLayerSource(run, operation, scope) {
    var layer = scope.layer, item = aeLayerMoreItem(operation.sourceItemId);
    if (!item) throw new Error("TARGET_NOT_FOUND: source item " + operation.sourceItemId);
    if (typeof layer.replaceSource !== "function") throw new Error("INVALID_TARGET: " + String(aeSafeGet(layer, "name", "this layer")) + " cannot take a new source (only footage, solid and composition layers can).");
    if (item === scope.comp) throw new Error("INVALID_VALUE: a layer cannot show the composition it sits in.");
    var previous = String(aeSafe(function () { return layer.source.id; }, ""));
    try { layer.replaceSource(item, false); } catch (replaceError) { throw new Error("PROPERTY_WRITE_FAILED: replaceSource: " + aeErrorTextShort(replaceError)); }
    var now = String(aeSafe(function () { return layer.source.id; }, ""));
    if (now !== String(item.id)) throw new Error("PROPERTY_WRITE_FAILED: the layer reports source " + now + " after replaceSource, expected " + String(item.id));
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, previousSourceId: previous, sourceId: now, sourceName: String(aeSafeGet(item, "name", "")), verification: "layer-source-replaced" };
}

AE_APPLY_VAL_RULES_LAYER.center_anchor = aeApplyValSpecRule([["time", "num", 0, 86400, 1]]);
function aeAnchorStatic(property, label) {
    if (!property) throw new Error("PROPERTY_NOT_FOUND: " + label);
    if (aeSafeGet(property, "numKeys", 0) > 0 || aeSafe(function () { return property.expressionEnabled === true; }, false)) throw new Error("CONFLICTING_KEYS: " + label + " is animated, so there is no single anchor to compensate; centre the anchor on a layer whose anchor, position, scale and rotation are static.");
    return property;
}
function aeAnchorRect(layer, time) {
    if (typeof layer.sourceRectAtTime !== "function") throw new Error("INVALID_TARGET: this layer has no measurable content (sourceRectAtTime).");
    var rect = aeSafe(function () { return layer.sourceRectAtTime(time, false); }, null);
    if (!rect || !(rect.width >= 0) || !(rect.height >= 0)) throw new Error("INVALID_TARGET: the layer's content could not be measured at " + time + "s.");
    return rect;
}
function aeAnchorOffset(delta, scale, rotation) {
    var scaled = [delta[0] * scale[0] / 100, delta[1] * scale[1] / 100], radians = rotation * Math.PI / 180, cosine = Math.cos(radians),
      sine = Math.sin(radians);
    return [scaled[0] * cosine - scaled[1] * sine, scaled[0] * sine + scaled[1] * cosine];
}
function aeAnchorStaticTransform(layer) {
    return {
        anchor: aeAnchorStatic(aeApplyFindProperty(layer, "ADBE Transform Group/ADBE Anchor Point"), "Anchor Point"),
        position: aeAnchorStatic(aeApplyFindProperty(layer, "ADBE Transform Group/ADBE Position"), "Position"),
        scale: aeAnchorStatic(aeApplyFindProperty(layer, "ADBE Transform Group/ADBE Scale"), "Scale"),
        rotation: aeAnchorStatic(aeApplyFindProperty(layer, "ADBE Transform Group/ADBE Rotate Z"), "Rotation")
    };
}
function aeAnchorDiffers(read, wanted) { return Math.abs(read[0] - wanted[0]) > 0.01 || Math.abs(read[1] - wanted[1]) > 0.01; }
function aeApplyStepCenterAnchor(run, operation, scope) {
    var layer = scope.layer;
    if (aeSafe(function () { return layer.threeDLayer === true; }, false)) throw new Error("INVALID_TARGET: center_anchor handles 2D layers; a 3D layer's orientation would need a full matrix.");
    var transform = aeAnchorStaticTransform(layer), anchor = transform.anchor, position = transform.position, scale = transform.scale,
      rotation = transform.rotation;
    if (aeSafe(function () { return position.dimensionsSeparated === true; }, false)) throw new Error("SEPARATED_DIMENSIONS_UNSUPPORTED: Position has separated dimensions.");
    var rect = aeAnchorRect(layer, operation.time === undefined ? 0 : operation.time), oldAnchor = anchor.value,
      newAnchor = [rect.left + rect.width / 2, rect.top + rect.height / 2];
    var shift = aeAnchorOffset([newAnchor[0] - oldAnchor[0], newAnchor[1] - oldAnchor[1]], scale.value, rotation.value), oldPosition = position.value;
    var nextAnchor = oldAnchor.slice(0), nextPosition = oldPosition.slice(0);
    nextAnchor[0] = newAnchor[0]; nextAnchor[1] = newAnchor[1]; nextPosition[0] = oldPosition[0] + shift[0]; nextPosition[1] = oldPosition[1] + shift[1];
    try { anchor.setValue(nextAnchor); position.setValue(nextPosition); } catch (writeError) { throw new Error("PROPERTY_WRITE_FAILED: anchor point or position"); }
    var readAnchor = anchor.value, readPosition = position.value;
    if (aeAnchorDiffers(readAnchor, newAnchor) || aeAnchorDiffers(readPosition, nextPosition)) throw new Error("PROPERTY_WRITE_FAILED: the anchor point or position did not take the centred values.");
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, anchorBefore: [oldAnchor[0], oldAnchor[1]], anchorAfter: [readAnchor[0], readAnchor[1]], positionBefore: [oldPosition[0], oldPosition[1]], positionAfter: [readPosition[0], readPosition[1]], contentRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, verification: "anchor-centred" };
}

AE_APPLY_VAL_CHECKS.copyEffectsSource = function (source) { return !!source && typeof source === "object" && AE_APPLY_VAL_CHECKS.str(source.compositionId, 1, 512) && AE_APPLY_VAL_CHECKS.str(source.layerId, 1, 512); };
AE_APPLY_VAL_CHECKS.copyEffectPaths = function (paths) {
    if (!(paths instanceof Array) || paths.length < 1 || paths.length > 32) return false;
    for (var i = 0; i < paths.length; i += 1) if (typeof paths[i] !== "string" || paths[i].indexOf("ADBE Effect Parade/") !== 0 || paths[i].indexOf("/", 19) >= 0) return false;
    return true;
};
AE_APPLY_VAL_RULES_LAYER.copy_effects = aeApplyValSpecRule([["source", "copyEffectsSource"], ["effectPaths", "copyEffectPaths", 0, 0, 1]]);
function aeCopyEffectsSourceLayer(source) {
    var comp = aeOwnValue(aeApplyCreatedComps, source.compositionId) || aeApplyFindComp(source.compositionId);
    if (!comp) throw new Error("TARGET_NOT_FOUND: copy source composition " + source.compositionId);
    var layer = aeApplyCreatedLayers[source.compositionId + ":" + source.layerId] || aeApplyFindLayer(comp, source.layerId);
    if (!layer) throw new Error("TARGET_NOT_FOUND: copy source layer " + source.layerId);
    return layer;
}
function aeCopyEffectList(layer, parade, paths) {
    var effects = [], count = parade.numProperties, i;
    if (paths === undefined) { for (i = 1; i <= count; i += 1) effects.push(parade.property(i)); return effects; }
    for (i = 0; i < paths.length; i += 1) {
        var found = aeApplyFindProperty(layer, paths[i]);
        if (!found) throw new Error("EFFECT_NOT_FOUND: " + paths[i] + " is not on the source layer");
        effects.push(found);
    }
    return effects;
}
function aeCopyIsLeaf(property) { return aeSafe(function () { return property.propertyType === PropertyType.PROPERTY; },
  aeSafe(function () { return property.numProperties === 0; }, false)); }
function aeCopyLeaf(from, to, report) {
    if (aeSafeGet(from, "numKeys", 0) > 0) {
        if (!aeSafeGet(to, "canVaryOverTime", true)) { report.skipped.push(String(from.matchName)); return; }
        var records = aeKeyEditReadAll(from);
        for (var i = 0; i < records.length; i += 1) report.restoreFailed += aeKeyEditWrite(to, records[i], records[i].time);
        report.keyed += 1;
    } else if (aeSafe(function () { return to.canSetValue !== false && from.canSetValue !== false; }, true)) {
        try { to.setValue(from.value); report.values += 1; } catch (valueError) { report.skipped.push(String(from.matchName)); }
    }
    if (aeSafe(function () { return from.expressionEnabled === true; }, false)) { try { to.expression = from.expression; to.expressionEnabled = true; report.expressions += 1; } catch (expressionError) { report.skipped.push(String(from.matchName) + " (expression)"); } }
}
function aeCopyChild(sides, index, report, depth) {
    var source = sides.from.property(index), dest = sides.to.property(index);
    if (!source || !dest || source.matchName !== dest.matchName) { report.skipped.push(String(source ? source.matchName : index)); return; }
    if (aeCopyIsLeaf(source)) aeCopyLeaf(source, dest, report); else aeCopyGroup(source, dest, report, depth + 1);
}
function aeCopyGroup(from, to, report, depth) {
    var count = aeSafeGet(from, "numProperties", 0), toCount = aeSafeGet(to, "numProperties", 0);
    for (var i = 1; i <= count && i <= toCount && depth < 8; i += 1) aeCopyChild({ from: from, to: to }, i, report, depth);
}
function aeCopyOneEffect(sourceEffect, targetParade, report) {
    var added = aeSafe(function () { return targetParade.canAddProperty(sourceEffect.matchName) ? targetParade.addProperty(sourceEffect.matchName)
      : null; }, null);
    if (!added) { report.failedEffects.push(String(sourceEffect.matchName)); return; }
    aeSafe(function () { added.name = sourceEffect.name; return true; }, false);
    aeCopyGroup(sourceEffect, added, report, 0);
    report.copied.push(String(sourceEffect.matchName));
}
function aeApplyStepCopyEffects(run, operation, scope) {
    var source = aeCopyEffectsSourceLayer(operation.source), sourceParade = aeApplyFindProperty(source, "ADBE Effect Parade"), targetParade = aeApplyFindProperty(scope.layer, "ADBE Effect Parade");
    if (!sourceParade || !targetParade) throw new Error("EFFECT_NOT_FOUND: a layer without an effect stack cannot take or give effects.");
    var effects = aeCopyEffectList(source, sourceParade, operation.effectPaths), report = {
      copied: [], failedEffects: [], skipped: [], values: 0, keyed: 0, expressions: 0, restoreFailed: 0 };
    if (effects.length < 1) throw new Error("EFFECT_NOT_FOUND: the source layer has no effects to copy.");
    for (var i = 0; i < effects.length; i += 1) aeCopyOneEffect(effects[i], targetParade, report);
    if (report.copied.length < 1) throw new Error("EFFECT_NOT_AVAILABLE: none of the effects could be added on the target layer (" + report.failedEffects.join(", ") + ").");
    run.touched.push(operation.operation);
    return aeKeyEditReportRestores({ operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, copiedEffects: report.copied, failedEffects: report.failedEffects, valuesWritten: report.values, propertiesKeyed: report.keyed, expressionsCopied: report.expressions, skippedProperties: report.skipped.slice(0, 40), verification: "effects-copied" }, report.restoreFailed);
}
AE_APPLY_LAYER_STEPS.replace_layer_source = aeApplyStepReplaceLayerSource;
AE_APPLY_LAYER_STEPS.center_anchor = aeApplyStepCenterAnchor;
AE_APPLY_LAYER_STEPS.copy_effects = aeApplyStepCopyEffects;
