/* Apply steps for effects, presets, layer styles, text, expressions, markers and keyframe animation. Each step is
 * function (run, operation, scope), as in apply-steps-project.jsx. The keyframe step reports whether the property
 * already held an enabled expression, since the digest is then no proof of motion.
 */
/* global aeApplyAddEssentialProperty, aeApplyAnimate, aeApplyAnimatedInPlan, aeApplyEffectPathPrefix, aeApplyEnabledState, aeApplyEnsureEffect,
  aeApplyEnsureLayerStyle, aeApplyEnsureTextAnimator, aeApplyFindLayer, aeApplyFindProperty, aeApplyIsCompositionMarker, aeApplyMetadataGuard,
  aeApplyPathHasPrefix, aeApplyPresetToLayer, aeApplyReadBackTextRanges, aeApplyReadShapeKeyValues, aeApplyReadState, aeApplyRemoveMarker,
  aeApplyRequest, aeApplyResolveTextAnimatorLeaf, aeApplyResolvedControlPath, aeApplyResolvedEffectPath, aeApplySetEffectControl, aeApplySetExpression,
  aeApplySetTextDocument, aeApplyTextAnimator, aeApplyTextWriteFallbacks, aeApplyWriteMarker, aeCreateGaussian, aeSafe, aeWriteBlurLocal */
/* exported AE_APPLY_EFFECT_STEPS */
function aeApplyStepEnsureEffect(run, operation, scope) {
    var ensured = (aeApplyMetadataGuard && aeApplyMetadataGuard.creation) ? aeCreateGaussian(aeApplyRequest, aeApplyMetadataGuard)
      : aeApplyEnsureEffect(scope.layer, operation);
    if (!ensured) throw new Error("EFFECT_NOT_AVAILABLE");
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, effectPath: operation.effectPath, created: ensured.created, enabled: operation.enabled, observedEnabled: aeApplyEnabledState(ensured.property), defaults: ensured.defaults, effectMatchName: operation.effectMatchName, controls: ensured.controls };
}
function aeApplyStepApplyPreset(run, operation, scope) {
    var presetResult = aeApplyPresetToLayer(scope.comp, scope.layer, operation);
    aeApplyFindLayer(scope.comp, operation.layerId);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, presetId: operation.presetId, presetFile: operation.presetFile, changed: presetResult.changed, added: presetResult.added, after: presetResult.after };
}
function aeApplyStepEnsureLayerStyle(run, operation, scope) {
    run.touched.push(operation.operation);
    var styleResult = aeApplyEnsureLayerStyle(scope.comp, scope.layer, operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, style: operation.style, created: styleResult.created, enabled: styleResult.enabled, values: styleResult.values };
}
function aeApplyStepSetEffectControl(run, operation, scope) {
    var controlValue = (aeApplyMetadataGuard && aeApplyMetadataGuard.blur) ? aeWriteBlurLocal(aeApplyRequest) : aeApplySetEffectControl(scope.layer, operation);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, propertyPath: operation.propertyPath, value: controlValue };
}
function aeApplyStepTextAnimator(run, operation, scope) {
    var animatorResult = aeApplyTextAnimator(scope.layer, operation, run.createdAnimators);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, requestedAnimatorId: operation.newAnimatorId || operation.animatorId, animatorId: "animator:" + animatorResult.ordinal, created: animatorResult.created, containerPath: animatorResult.animatorPath, writes: animatorResult.writes, animations: animatorResult.animations };
}
function aeApplyStepEssentialProperty(run, operation, scope) {
    var essential = aeApplyAddEssentialProperty(scope.comp, scope.layer, operation);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, propertyPath: operation.propertyPath, named: essential.named, essential: essential.readback, verification: "essential-property-added" };
}
function aeApplyStepEnsureTextAnimator(run, operation, scope) {
    var ensuredAnimator = aeApplyEnsureTextAnimator(scope.layer, operation);
    if (!ensuredAnimator) throw new Error("EFFECT_NOT_AVAILABLE");
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, role: operation.role, value: operation.value, created: ensuredAnimator.created, observedValue: ensuredAnimator.observedValue, propertyPath: ensuredAnimator.propertyPath, animatorCount: ensuredAnimator.animatorCount };
}
function aeApplyStepSetTextDocument(run, operation, scope) {
    var textProperty = aeApplySetTextDocument(scope.layer, operation);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, propertyPath: "ADBE Text Properties/ADBE Text Document", verification: "source-text-written", rangeReadback: aeApplyReadBackTextRanges(textProperty, operation), writeFallbacks: aeApplyTextWriteFallbacks.length ? aeApplyTextWriteFallbacks.slice(0, 8) : undefined };
}
function aeApplyAddExpressionMotion(step, motion) {
    step.expressionSamples = motion.samples; step.expressionChanges = motion.changes; step.expressionSampleMisses = motion.misses;
    step.expressionExistingKeys = motion.keys; step.expressionKeyValues = motion.keyValues; step.expressionKeysReferenced = motion.keysReferenced;
    if (motion.error) step.expressionSampledError = motion.error;
    if (motion.probe) step.expressionProbe = motion.probe;
}
function aeApplyStepSetExpression(run, operation, scope) {
    var expressionResult = aeApplySetExpression(scope.layer, operation, scope.comp);
    run.touched.push(operation.operation);
    var expressionStep = { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, propertyPath: operation.propertyPath, verification: expressionResult.enabled ? "expression-enabled" : "expression-cleared", expressionError: expressionResult.expressionError, observedSource: expressionResult.source };
    if (expressionResult.motion) aeApplyAddExpressionMotion(expressionStep, expressionResult.motion);
    return expressionStep;
}
function aeApplyMarkerOwner(operation, scope) { return aeApplyIsCompositionMarker(operation) ? scope.comp : scope.layer; }
function aeApplyStepWriteMarker(run, operation, scope) {
    var written = aeApplyWriteMarker(aeApplyMarkerOwner(operation, scope), operation);
    if (!written.alreadyPresent) run.touched.push(operation.operation);
    var step = { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, time: operation.time, verification: "marker-present" };
    if (written.alreadyPresent) step.alreadyPresent = true;
    return step;
}
function aeApplyStepRemoveMarker(run, operation, scope) {
    aeApplyRemoveMarker(aeApplyMarkerOwner(operation, scope), operation);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, time: operation.time, verification: "marker-absent" };
}
function aeApplyAnimationTarget(operation, layer, targetPath) {
    var effectPath = (operation.operation === "animate_control" ? aeApplyEffectPathPrefix(operation) : null);
    if (effectPath && !aeApplyPathHasPrefix(targetPath, effectPath)) throw new Error("INVALID_TARGET");
    var property = effectPath ? aeApplyFindProperty(layer, aeApplyResolvedControlPath(operation)) : aeApplyResolveTextAnimatorLeaf(layer, targetPath);
    if (effectPath && !aeApplyFindProperty(layer, aeApplyResolvedEffectPath(operation))) throw new Error("EFFECT_NOT_AVAILABLE");
    return property;
}
function aeApplyStepAnimate(run, operation, scope) {
    var targetPath = operation.propertyPath, property = aeApplyAnimationTarget(operation, scope.layer, targetPath);
    var animationKey = operation.compositionId + ":" + operation.layerId + ":" + targetPath;
    var before = aeApplyReadState(property);
    var animated = aeApplyAnimate(property, operation, aeApplyAnimatedInPlan[animationKey] === true);
    aeApplyAnimatedInPlan[animationKey] = true;
    var after = aeApplyReadState(property);
    run.touched.push(operation.operation);
    var step = { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, propertyPath: targetPath, beforeValue: before.value, afterValue: after.value, beforeKeys: before.numKeys, afterKeys: after.numKeys, afterDigest: after.digest, keyframes: animated.keyframes, keyframeMode: animated.keyframeMode, removedKeys: animated.removedKeys, expressionEnabled: aeSafe(function () { return property.expressionEnabled === true; }, false) };
    if (after.shapeKeys) { step.shapeKeys = after.shapeKeys; step.shapeKeyValues = aeApplyReadShapeKeyValues(property, operation.keyframes); }
    return step;
}
/** The effect-scoped apply steps by operation name; each family file adds its entries. */
var AE_APPLY_EFFECT_STEPS = {
    ensure_effect: aeApplyStepEnsureEffect, apply_preset: aeApplyStepApplyPreset, ensure_layer_style: aeApplyStepEnsureLayerStyle,
      set_effect_control: aeApplyStepSetEffectControl,
    add_text_animator: aeApplyStepTextAnimator, update_text_animator: aeApplyStepTextAnimator, add_essential_property: aeApplyStepEssentialProperty,
    ensure_text_animator: aeApplyStepEnsureTextAnimator, set_text_document: aeApplyStepSetTextDocument, set_expression: aeApplyStepSetExpression,
    add_marker: aeApplyStepWriteMarker, update_marker: aeApplyStepWriteMarker, remove_marker: aeApplyStepRemoveMarker,
    animate_control: aeApplyStepAnimate, animate_property: aeApplyStepAnimate
};
