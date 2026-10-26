/* Apply: text animator creation and animator property writes. It sits under apply-flow.jsx. */
/* global aeApplyAnimate, aeApplyAnimatedInPlan, aeApplyExpressionEvaluationError, aeApplyFindProperty, aeApplyIsNewItemId, aeApplyReadKeys,
  aeApplySetEffectControl, aeApplyValidFrames, aeApplyValidStaticControlValue, aeEncodePathSegment, aeHasOwn, aeListHas, aeSafe, aeSafeGet,
  aeSafeProperty */
/* exported aeApplyNthChildIndex, aeApplyResolveTextAnimatorLeaf, aeApplyTextAnimator, aeApplyValidTextAnimatorOperation */
var HOST_TEXT_ANIMATOR_PATHS = {"properties":["ADBE Text Animator Properties/ADBE Text Anchor Point 3D","ADBE Text Animator Properties/ADBE Text Position 3D","ADBE Text Animator Properties/ADBE Text Scale 3D","ADBE Text Animator Properties/ADBE Text Skew","ADBE Text Animator Properties/ADBE Text Skew Axis","ADBE Text Animator Properties/ADBE Text Rotation","ADBE Text Animator Properties/ADBE Text Rotation X","ADBE Text Animator Properties/ADBE Text Rotation Y","ADBE Text Animator Properties/ADBE Text Opacity","ADBE Text Animator Properties/ADBE Text Fill Color","ADBE Text Animator Properties/ADBE Text Fill Hue","ADBE Text Animator Properties/ADBE Text Fill Saturation","ADBE Text Animator Properties/ADBE Text Fill Brightness","ADBE Text Animator Properties/ADBE Text Fill Opacity","ADBE Text Animator Properties/ADBE Text Stroke Color","ADBE Text Animator Properties/ADBE Text Stroke Hue","ADBE Text Animator Properties/ADBE Text Stroke Saturation","ADBE Text Animator Properties/ADBE Text Stroke Brightness","ADBE Text Animator Properties/ADBE Text Stroke Opacity","ADBE Text Animator Properties/ADBE Text Stroke Width","ADBE Text Animator Properties/ADBE Text Line Anchor","ADBE Text Animator Properties/ADBE Text Line Spacing","ADBE Text Animator Properties/ADBE Text Track Type","ADBE Text Animator Properties/ADBE Text Tracking Amount","ADBE Text Animator Properties/ADBE Text Character Change Type","ADBE Text Animator Properties/ADBE Text Character Range","ADBE Text Animator Properties/ADBE Text Character Replace","ADBE Text Animator Properties/ADBE Text Character Offset","ADBE Text Animator Properties/ADBE Text Blur"],"selectors":{"ADBE Text Selector":["ADBE Text Percent Start","ADBE Text Percent End","ADBE Text Percent Offset","ADBE Text Index Start","ADBE Text Index End","ADBE Text Index Offset","ADBE Text Range Advanced/ADBE Text Range Units","ADBE Text Range Advanced/ADBE Text Range Type2","ADBE Text Range Advanced/ADBE Text Selector Mode","ADBE Text Range Advanced/ADBE Text Selector Max Amount","ADBE Text Range Advanced/ADBE Text Range Shape","ADBE Text Range Advanced/ADBE Text Selector Smoothness","ADBE Text Range Advanced/ADBE Text Levels Max Ease","ADBE Text Range Advanced/ADBE Text Levels Min Ease","ADBE Text Range Advanced/ADBE Text Randomize Order","ADBE Text Range Advanced/ADBE Text Random Seed"],"ADBE Text Wiggly Selector":["ADBE Text Selector Mode","ADBE Text Wiggly Max Amount","ADBE Text Wiggly Min Amount","ADBE Text Range Type2","ADBE Text Temporal Freq","ADBE Text Character Correlation","ADBE Text Temporal Phase","ADBE Text Spatial Phase","ADBE Text Wiggly Lock Dim","ADBE Text Wiggly Random Seed"],"ADBE Text Expressible Selector":["ADBE Text Range Type2","ADBE Text Expressible Amount"]}};
function aeApplyChildSegment(group, index) {
    var wanted = String(aeSafe(function () { return group.property(index).matchName; }, "")), ordinal = 0;
    for (var c = 1; c <= index; c += 1) if (String(aeSafe(function () { return group.property(c).matchName; }, "")) === wanted) ordinal += 1;
    var base = aeEncodePathSegment(wanted);
    return ordinal > 1 ? base + "#" + ordinal : base;
}
/** 1-based index of the ordinal-th child of group with this matchName, or 0 when there is none. */
function aeApplyNthChildIndex(group, matchName, ordinal) { var count = aeSafeGet(group, "numProperties", 0), seen = 0; for (var c = 1; c <= count; c += 1) if (String(aeSafe(function () { return group.property(c).matchName; }, "")) === matchName) { seen += 1; if (seen === ordinal) return c; } return 0; }
function aeApplySpecListValid(list, allowed, valueValid) {
    for (var i = 0; i < list.length; i += 1) { var item = list[i]; if (!item || typeof item.path !== "string" || !allowed(item.path) || !valueValid(item)) return false; }
    return true;
}
function aeApplySpecWritesValid(operation, allowed) {
    if (!(operation.writes instanceof Array) || !(operation.animations instanceof Array) || operation.writes.length
      + operation.animations.length > 64) return false;
    if (!aeApplySpecListValid(operation.writes, allowed, function (write) { return aeApplyValidStaticControlValue(write.value); })) return false;
    return aeApplySpecListValid(operation.animations, allowed, function (animation) { return aeApplyValidFrames(animation); });
}
function aeApplyTextAnimatorPathAllowed(selectorMatchName) {
    return function (path) {
        if (path.indexOf("ADBE Text Animator Properties/") === 0) return aeListHas(HOST_TEXT_ANIMATOR_PATHS.properties, path);
        var prefix = "ADBE Text Selectors/" + selectorMatchName + "/";
        return path.indexOf(prefix) === 0 && aeHasOwn(HOST_TEXT_ANIMATOR_PATHS.selectors, selectorMatchName)
          && aeListHas(HOST_TEXT_ANIMATOR_PATHS.selectors[selectorMatchName], path.slice(prefix.length));
    };
}
function aeApplyAnimatorRefValid(operation) {
    if (operation.operation === "add_text_animator") return aeApplyIsNewItemId(operation.newAnimatorId);
    return typeof operation.animatorId === "string" && (/^animator:[1-9][0-9]{0,2}$/.test(operation.animatorId) || aeApplyIsNewItemId(operation.animatorId));
}
function aeApplyAnimatorNameValid(name) { return name === undefined || (typeof name === "string" && name.length >= 1 && name.length <= 256); }
function aeApplyAnimatorAmountExpressionValid(operation) {
    if (operation.amountExpression === undefined) return true;
    return operation.selectorMatchName === "ADBE Text Expressible Selector" && typeof operation.amountExpression === "string" && operation.amountExpression.length <= 65536;
}
/** True when a text animator operation names a valid animator, selector, expression amount and path-allowed writes and animations. */
function aeApplyValidTextAnimatorOperation(operation) {
    if (!aeApplyAnimatorRefValid(operation) || !aeApplyAnimatorNameValid(operation.name)) return false;
    if (typeof operation.selectorMatchName !== "string" || !aeHasOwn(HOST_TEXT_ANIMATOR_PATHS.selectors, operation.selectorMatchName)) return false;
    if (!aeApplyAnimatorAmountExpressionValid(operation)) return false;
    return aeApplySpecWritesValid(operation, aeApplyTextAnimatorPathAllowed(operation.selectorMatchName));
}
function aeApplyWriteSpecValues(container, containerPath, operation, animationKeyPrefix) {
    var written = [], animated = [], w, a;
    for (w = 0; w < operation.writes.length; w += 1) { var write = operation.writes[w]; written.push({ path: containerPath ? containerPath + "/" + write.path : null, value: aeApplySetEffectControl(container, { propertyPath: write.path, value: write.value }) }); }
    for (a = 0; a < operation.animations.length; a += 1) {
        var animation = operation.animations[a], property = aeApplyFindProperty(container, animation.path), key = animationKeyPrefix + animation.path;
        var result = aeApplyAnimate(property, { keyframes: animation.keyframes, keyframeMode: animation.keyframeMode, propertyPath: animation.path },
          aeApplyAnimatedInPlan[key] === true); aeApplyAnimatedInPlan[key] = true;
        animated.push({ path: containerPath ? containerPath + "/" + animation.path : null, keyframes: result.keyframes, keyframeMode: result.keyframeMode, afterKeys: aeSafeGet(property, "numKeys", 0), keys: aeApplyReadKeys(property) });
    }
    return { writes: written, animations: animated };
}
function aeApplyTextAnimatorsGroup(layer) { return aeApplyFindProperty(layer, "ADBE Text Properties/ADBE Text Animators"); }
function aeApplyTextAnimatorAt(layer, ordinal) { var group = aeApplyTextAnimatorsGroup(layer), count = group ? aeSafeGet(group, "numProperties", 0) : 0; if (ordinal < 1 || ordinal > count) return null; var animator = aeSafeProperty(group, ordinal); return (animator && String(aeSafeGet(animator, "matchName", "")) === "ADBE Text Animator") ? animator : null; }
function aeApplyAcceptsWrites(property) {
    if (!property || aeSafe(function () { return property.isHidden === true; }, false)) return false;
    if (typeof PropertyType !== "undefined" && aeSafe(function () { return property.propertyType !== PropertyType.PROPERTY; }, false)) return aeSafe(function () { return property.isHidden !== true; }, true);
    if (aeSafeGet(property, "numKeys", 0) > 0) return true;
    if (aeSafe(function () { return property.expressionEnabled === true; }, false)) return true;
    try { property.setValue(property.value); return true; } catch (placeholderError) { return false; }
}
function aeApplyWritableChildIndex(group, childMatchName) {
    var count = group ? aeSafeGet(group, "numProperties", 0) : 0;
    for (var c = count; c >= 1; c -= 1) { var child = aeSafeProperty(group, c); if (child && String(aeSafeGet(child, "matchName", "")) === childMatchName && aeApplyAcceptsWrites(child)) return c; }
    return 0;
}
function aeApplyEnsureAnimatorChild(layer, ordinal, groupMatchName, childMatchName) {
    function lookup() { var animator = aeApplyTextAnimatorAt(layer, ordinal), group = animator ? aeApplyFindProperty(animator, groupMatchName) : null;
      return { group: group, index: aeApplyWritableChildIndex(group, childMatchName) }; }
    var found = lookup(); if (!found.group) throw new Error("TEXT_ANIMATOR_UNSUPPORTED: " + groupMatchName + " is unavailable.");
    if (found.index) return found;
    if (!aeSafe(function () { return found.group.addProperty(childMatchName); }, null)) throw new Error("TEXT_ANIMATOR_UNSUPPORTED: " + childMatchName + " could not be added.");
    found = lookup(); if (!found.index) throw new Error("TEXT_ANIMATOR_PROPERTY_HIDDEN: " + childMatchName + " was added but After Effects still rejects writes to it.");
    return found;
}
/**
 * Generic animate_property on ".../ADBE Text Animator Properties/<leaf>" gets the same placeholder handling. A leaf
 * counts only once AE accepts a no-op write of its own value or it already carries keys, since AE 26 enumerates
 * inactive placeholder leaves with the same matchName; the newest is tried first.
 */
function aeApplyResolveTextAnimatorLeaf(layer, path) {
    var marker = "/ADBE Text Animator Properties/", at = String(path).indexOf(marker);
    if (at < 0) return aeApplyFindProperty(layer, path);
    var leafName = String(path).slice(at + marker.length);
    if (leafName.indexOf("/") >= 0 || leafName.indexOf("#") >= 0) return aeApplyFindProperty(layer, path);
    var groupPath = String(path).slice(0, at + marker.length - 1), group = aeApplyFindProperty(layer, groupPath);
    if (!group) return null;
    var index = aeApplyWritableChildIndex(group, leafName);
    if (!index) { if (!aeSafe(function () { return group.addProperty(leafName); }, null)) return aeApplyFindProperty(layer, path);
      group = aeApplyFindProperty(layer, groupPath); index = aeApplyWritableChildIndex(group, leafName); }
    if (!index) throw new Error("TEXT_ANIMATOR_PROPERTY_HIDDEN: " + leafName + " exists only as a hidden placeholder; After Effects rejects writes to it.");
    return aeApplyFindProperty(layer, groupPath + "/" + aeApplyChildSegment(group, index));
}
function aeApplyAddTextAnimator(layer, operation, createdAnimators, key) {
    var group = aeApplyTextAnimatorsGroup(layer); if (!group || typeof group.addProperty !== "function") throw new Error("TEXT_ANIMATOR_UNSUPPORTED: this layer has no Text Animators group.");
    var before = aeSafeGet(group, "numProperties", 0);
    if (!aeSafe(function () { return group.addProperty("ADBE Text Animator"); }, null)) throw new Error("TEXT_ANIMATOR_UNSUPPORTED: ADBE Text Animator could not be added.");
    var ordinal = aeSafe(function () { return aeApplyTextAnimatorsGroup(layer).numProperties; }, 0); if (ordinal !== before + 1 || !aeApplyTextAnimatorAt(layer, ordinal)) throw new Error("TEXT_ANIMATOR_UNSUPPORTED: the new animator was not found.");
    if (operation.name) { try { aeApplyTextAnimatorAt(layer, ordinal).name = operation.name; } catch (animatorNameError) { throw new Error("PROPERTY_WRITE_FAILED: animator name"); } }
    createdAnimators[key + operation.newAnimatorId] = ordinal;
    return ordinal;
}
function aeApplyExistingTextAnimator(layer, operation, createdAnimators, key) {
    var ordinal = createdAnimators[key + operation.animatorId] || 0;
    if (!ordinal) { var match = /^animator:([1-9][0-9]{0,2})$/.exec(operation.animatorId); ordinal = match ? Number(match[1]) : 0; }
    if (!aeApplyTextAnimatorAt(layer, ordinal)) throw new Error("TARGET_NOT_FOUND: " + operation.animatorId);
    return ordinal;
}
function aeApplyEnsureAnimatorLeaves(layer, ordinal, all) {
    for (var p = 0; p < all.length; p += 1) if (all[p].path.indexOf("ADBE Text Animator Properties/") === 0) aeApplyEnsureAnimatorChild(layer, ordinal, "ADBE Text Animator Properties", all[p].path.split("/")[1]);
}
function aeApplyAnimatorNeedsSelector(operation, all, created) {
    if (created || operation.amountExpression !== undefined) return true;
    for (var p = 0; p < all.length; p += 1) if (all[p].path.indexOf("ADBE Text Selectors/") === 0) return true;
    return false;
}
function aeApplyAnimatorSelectorSegment(layer, ordinal, operation) {
    var selector = aeApplyEnsureAnimatorChild(layer, ordinal, "ADBE Text Selectors", operation.selectorMatchName);
    return "ADBE Text Selectors/" + aeApplyChildSegment(selector.group, selector.index);
}
function aeApplyAnimatorEntryPath(context, entry) {
    var segments = entry.path.split("/"), groupName = segments[0];
    if (groupName !== "ADBE Text Animator Properties") return context.selectorSegment + "/" + segments.slice(2).join("/");
    var leaf = aeApplyEnsureAnimatorChild(context.layer, context.ordinal, groupName, segments[1]);
    return groupName + "/" + aeApplyChildSegment(leaf.group, leaf.index);
}
function aeApplyWriteAnimatorEntry(context, p) {
    var entry = context.all[p], leafPath = aeApplyAnimatorEntryPath(context, entry), single = { writes: [], animations: [] };
    if (p < context.operation.writes.length) single.writes.push({ path: leafPath, value: entry.value });
    else single.animations.push({ path: leafPath, keyframes: entry.keyframes, keyframeMode: entry.keyframeMode });
    return aeApplyWriteSpecValues(aeApplyTextAnimatorAt(context.layer, context.ordinal), context.animatorPath, single, context.key + context.animatorPath + "/");
}
function aeApplyWriteAmountExpression(layer, ordinal, selectorSegment, expression) {
    var amount = aeApplyFindProperty(aeApplyTextAnimatorAt(layer, ordinal), selectorSegment + "/ADBE Text Expressible Amount"); if (!amount) throw new Error("PROPERTY_NOT_FOUND: ADBE Text Expressible Amount");
    try { amount.expression = expression; amount.expressionEnabled = expression.length > 0; } catch (selectorExpressionError) { throw new Error("EXPRESSION_WRITE_FAILED"); }
    var selectorEvaluationError = expression.length > 0 ? aeApplyExpressionEvaluationError(amount) : "";
    if (selectorEvaluationError) { aeSafe(function () { amount.expression = ""; amount.expressionEnabled = false; return true; }, false); throw new Error("EXPRESSION_INVALID: " + selectorEvaluationError); }
}
/**
 * Creates or reuses a text animator and applies its writes and animations. Returns
 * {ordinal,created,animatorPath,writes,animations}. Paths come from the typed tables in packages/action-
 * plan/src/extended.ts and are re-checked against a contract-tested mirror here; animators are addressed by index
 * because addProperty invalidates held references on indexed groups.
 */
function aeApplyTextAnimator(layer, operation, createdAnimators) {
    var key = operation.compositionId + ":" + operation.layerId + ":", created = operation.operation === "add_text_animator";
    var ordinal = created ? aeApplyAddTextAnimator(layer, operation, createdAnimators, key)
      : aeApplyExistingTextAnimator(layer, operation, createdAnimators, key);
    var animatorPath = "ADBE Text Properties/ADBE Text Animators/" + aeApplyChildSegment(aeApplyTextAnimatorsGroup(layer), ordinal), all = operation.writes.concat(operation.animations);
    aeApplyEnsureAnimatorLeaves(layer, ordinal, all);
    var selectorSegment = aeApplyAnimatorNeedsSelector(operation, all, created) ? aeApplyAnimatorSelectorSegment(layer, ordinal, operation) : null;
    var context = { layer: layer, ordinal: ordinal, operation: operation, all: all, selectorSegment: selectorSegment, animatorPath: animatorPath,
      key: key }, written = [], animatedResults = [];
    for (var p = 0; p < all.length; p += 1) { var result = aeApplyWriteAnimatorEntry(context, p); written = written.concat(result.writes);
      animatedResults = animatedResults.concat(result.animations); }
    if (operation.amountExpression !== undefined) aeApplyWriteAmountExpression(layer, ordinal, selectorSegment, operation.amountExpression);
    return { ordinal: ordinal, created: created, animatorPath: animatorPath, writes: written, animations: animatedResults };
}
