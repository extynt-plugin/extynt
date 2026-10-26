/* Apply remove_effect and reorder_effect: take an effect off a layer, or move it within the layer's effect stack. The
 * effect is resolved live from its effect path, and the stack is read back after the write.
 */
/* global AE_APPLY_LAYER_STEPS, AE_APPLY_VAL_CHECKS, AE_APPLY_VAL_RULES_LAYER, aeApplyFindProperty, aeApplyValConfirmThenValidate, aeApplyValSpecRule,
  aeSafe, aeSafeGet */
var AE_EFFECT_EDIT_PARADE = "ADBE Effect Parade/";

AE_APPLY_VAL_CHECKS.effectStackPath = function (value) {
    return typeof value === "string" && value.length > AE_EFFECT_EDIT_PARADE.length && value.length <= 256 && value.indexOf(AE_EFFECT_EDIT_PARADE) === 0 && value.indexOf("/", AE_EFFECT_EDIT_PARADE.length) < 0;
};
AE_APPLY_VAL_RULES_LAYER.remove_effect = aeApplyValConfirmThenValidate([["effectPath", "effectStackPath"]]);
AE_APPLY_VAL_RULES_LAYER.reorder_effect = aeApplyValSpecRule([["effectPath", "effectStackPath"], ["index", "integer", 1, 128]]);

function aeEffectEditResolve(layer, operation) {
    var parade = aeApplyFindProperty(layer, "ADBE Effect Parade"), effect = aeApplyFindProperty(layer, operation.effectPath);
    if (!parade || !effect) throw new Error("EFFECT_NOT_FOUND: " + operation.effectPath + " is not on this layer");
    return { parade: parade, effect: effect };
}
function aeEffectEditNames(parade) {
    var names = [], count = parade.numProperties;
    for (var i = 1; i <= count; i += 1) names.push(String(parade.property(i).name));
    return names;
}
function aeApplyStepRemoveEffect(run, operation, scope) {
    var found = aeEffectEditResolve(scope.layer, operation), before = aeEffectEditNames(found.parade), removedName = String(found.effect.name),
      removedIndex = aeSafe(function () { return found.effect.propertyIndex; }, 0);
    try { found.effect.remove(); } catch (removeError) { throw new Error("EFFECT_REMOVE_FAILED: After Effects refused to remove " + removedName); }
    var after = aeEffectEditNames(found.parade);
    if (after.length !== before.length - 1) throw new Error("EFFECT_REMOVE_FAILED: the effect stack still holds " + after.length + " effect(s) after removing " + removedName);
    for (var i = 0, j = 0; removedIndex > 0 && i < after.length; i += 1, j += 1) {
        if (j === removedIndex - 1) j += 1;
        if (after[i] !== before[j]) throw new Error("EFFECT_REMOVE_FAILED: the effect stack is not what it was without " + removedName + " (position " + (i + 1) + " is now " + after[i] + ").");
    }
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, effectPath: operation.effectPath, removedName: removedName, stackBefore: before, stackAfter: after, verification: "effect-removed" };
}
function aeApplyStepReorderEffect(run, operation, scope) {
    var found = aeEffectEditResolve(scope.layer, operation), before = aeEffectEditNames(found.parade);
    found.matchName = String(found.effect.matchName); found.name = String(found.effect.name);
    if (operation.index > before.length) throw new Error("INVALID_VALUE: the effect stack holds " + before.length + " effect(s); there is no place " + operation.index);
    try { found.effect.moveTo(operation.index); } catch (moveError) { throw new Error("EFFECT_REORDER_FAILED: After Effects refused to move " + String(found.effect.name)); }
    var atIndex = aeSafe(function () { return found.parade.property(operation.index); }, null), placed = (atIndex && String(aeSafeGet(atIndex, "matchName", "")) === String(found.matchName) && String(aeSafeGet(atIndex, "name", "")) === String(found.name)) ? operation.index : -1;
    if (placed !== operation.index) throw new Error("EFFECT_REORDER_FAILED: the effect is not at place " + operation.index + " after the move.");
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, effectPath: operation.effectPath, index: operation.index, observedIndex: placed, stackBefore: before, stackAfter: aeEffectEditNames(found.parade), verification: "effect-reordered" };
}
AE_APPLY_LAYER_STEPS.remove_effect = aeApplyStepRemoveEffect;
AE_APPLY_LAYER_STEPS.reorder_effect = aeApplyStepReorderEffect;
