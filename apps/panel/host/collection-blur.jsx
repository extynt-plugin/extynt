/* A narrow, complete local literal-write observation of one Gaussian Blur Blurriness control, with no evaluated
 * expressions.
 */
/* global aeCollectionControlFailure, aeCollectionControlRequestInvalid, aeCollectionEnvelopeInvalid, aeCollectionGuardMaps, aeCollectionLocalMetadata,
   aeCollectionNativeState, aeCollectionOptionalField, aeCollectionPositiveInteger, aeCollectionSameStamp, aeCollectionSameValues, aeCollectionSequence,
   aeCollectionStamp, aeCollectionTargetLayer, aeCollectionTargetRef, aeIsFiniteNumber */
/* exported aeBlurReadback, aeCollectBlurControl, aeWriteBlurLocal */
function aeBlurCountValid(count) { return typeof count === "number" && Math.floor(count) === count && count >= 1 && count <= 16; }
function aeBlurNoteGaussian(found, candidate, ordinal) {
    if (found.effect) throw new Error("AMBIGUOUS_EFFECT");
    found.effect = candidate;
    found.ordinal = ordinal;
}
function aeBlurInventory(parade) {
    var count = parade.numProperties, found = { inventory: [], effect: null, ordinal: 0 }, started = (new Date()).getTime();
    if (!aeBlurCountValid(count)) throw new Error("LOCAL_EFFECT_BUDGET");
    for (var i = 1; i <= count; i += 1) {
        if (i > 1 && (new Date()).getTime() - started >= 25) throw new Error("LOCAL_EFFECT_BUDGET");
        var candidate = parade.property(i), match = String(candidate.matchName);
        found.inventory.push({ index: i, matchName: match });
        if (match === "ADBE Gaussian Blur 2") aeBlurNoteGaussian(found, candidate, i);
    }
    return found;
}
function aeBlurControlUnsupported(property, observed) {
    return typeof PropertyValueType === "undefined" || observed.type !== PropertyValueType.OneD || observed.keys !== 0 || observed.expressionEnabled
      || observed.expression !== "" || typeof property.setValue !== "function" || String(property.matchName) !== "ADBE Gaussian Blur 2-0001";
}
function aeBlurControlProperty(effect) {
    var property = effect.property("ADBE Gaussian Blur 2-0001"), type = property.propertyValueType, keys = property.numKeys,
      expressionEnabled = property.expressionEnabled, expression = property.expression;
    if (typeof expressionEnabled !== "boolean" || typeof expression !== "string") throw new Error("LOCAL_CONTROL_UNSUPPORTED");
    if (aeBlurControlUnsupported(property, { type: type, keys: keys, expressionEnabled: expressionEnabled,
      expression: expression })) throw new Error("LOCAL_CONTROL_UNSUPPORTED");
    return property;
}
function aeBlurControl(effect) {
    var property = aeBlurControlProperty(effect);
    var setter = property.setValue;
    var value = property.value, minimum = property.hasMin === true ? property.minValue : null, maximum = property.hasMax === true ? property.maxValue : null;
    if (!aeIsFiniteNumber(value) || !aeIsFiniteNumber(minimum) || !aeIsFiniteNumber(maximum) || minimum > maximum) throw new Error("LOCAL_CONTROL_UNSUPPORTED");
    return { property: property, setter: setter, value: value, minimum: minimum, maximum: maximum };
}
function aeBlurLocalSummary(parade, found, control) {
    var property = control.property, effect = found.effect;
    var nativeState = aeCollectionNativeState(property), propertyIndices = [], paradeIndex = aeCollectionOptionalField(parade, "propertyIndex"),
      controlIndex = aeCollectionOptionalField(property, "propertyIndex");
    if (aeCollectionPositiveInteger(paradeIndex) && aeCollectionPositiveInteger(controlIndex)) propertyIndices = [paradeIndex, found.ordinal, controlIndex];
    return { effectMatchName: "ADBE Gaussian Blur 2", effectIndex: found.ordinal, inventory: found.inventory, effectEnabled: effect.enabled === true,
      matchNames: ["ADBE Effect Parade", "ADBE Gaussian Blur 2", "ADBE Gaussian Blur 2-0001"], valueType: "number", canSetValue: true,
      keyframeCount: 0, expressionEnabled: false, expression: "", value: control.value, minimum: control.minimum, maximum: control.maximum,
      unitsText: nativeState.unitsText, isTimeVarying: nativeState.isTimeVarying, propertyIndices: propertyIndices,
      dependencyPolicy: "local-literal-assignment" };
}
function aeBlurLocal(target) {
    var base = aeCollectionTargetLayer(target, "STALE_TARGET"), layer = base.layer;
    var parade = layer.property("ADBE Effect Parade");
    if (!parade || String(parade.matchName) !== "ADBE Effect Parade" || typeof layer.selected !== "boolean") throw new Error("LOCAL_CONTROL_UNSUPPORTED");
    var found = aeBlurInventory(parade);
    if (!found.effect) throw new Error("LOCAL_EFFECT_ABSENT");
    if (typeof found.effect.enabled !== "boolean") throw new Error("LOCAL_CONTROL_UNSUPPORTED");
    var control = aeBlurControl(found.effect);
    var local = aeBlurLocalSummary(parade, found, control);
    var metadata = aeCollectionLocalMetadata(target, base.comp, layer, layer.selected === true);
    if (!aeCollectionSameStamp(base.stamp)) throw new Error("PROJECT_CHANGED");
    return { stamp: base.stamp, local: local, metadata: metadata, property: control.property, setter: control.setter, comp: base.comp, layer: layer };
}
/**
 * Reads the Gaussian Blur control for a local-control request. Returns JSON
 * {ok:true,requestId,sessionId,kind:"blur",stamp,localEffect,metadata,rows}, or the aeCollectionControlFailure JSON.
 * Throws unless the Blurriness control is a plain, writable, finite number; it returns the literal value and native
 * range.
 */
function aeCollectBlurControl(raw) {
    try {
        var request = JSON.parse(raw);
        if (aeCollectionControlRequestInvalid(request, "blur")) throw new Error("INVALID_REQUEST");
        var observed = aeBlurLocal(request); aeCollectionSequence += 1;
        return JSON.stringify({ ok: true, requestId: request.requestId, sessionId: "blur-" + aeCollectionSequence, kind: "blur", stamp: observed.stamp,
          localEffect: observed.local, metadata: observed.metadata, rows: [{ id: "blur-static", name: "Gaussian Blur Blurriness",
          value: observed.local.value, valueState: "observed-static" }], nextCursor: null, deepComplete: false,
          dependencyClosure: "local-literal-assignment-only", downstreamExpressions: "unknown" });
    } catch (error) { return aeCollectionControlFailure(error); }
}
function aeBlurOperationInvalid(operation, target) {
    if (operation.effectMatchName !== "ADBE Gaussian Blur 2"
      || operation.propertyPath !== "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001") return true;
    if (operation.compositionId !== target.compositionId || operation.layerId !== target.layerId) return true;
    return !aeIsFiniteNumber(operation.value) || operation.value !== target.desiredValue;
}
function aeBlurReadSetStale(observed, target, operation, readSet) {
    return observed.metadata.layer.name !== target.name || JSON.stringify(observed.local) !== JSON.stringify(target.localEffect)
      || operation.value < observed.local.minimum || operation.value > observed.local.maximum || !aeCollectionSameStamp(readSet.stamp);
}
function aeCheckBlurReadSet(request) {
    if (aeCollectionEnvelopeInvalid(request, "blur-control-read-set/1", "set_effect_control")) return { ok: false, code: "INVALID_READ_SET" };
    var rs = request.readSet, target = rs.targets[0], operation = request.operations[0];
    if (aeBlurOperationInvalid(operation, target)) return { ok: false, code: "INVALID_READ_SET" };
    try {
        if (!aeCollectionSameStamp(rs.stamp)) throw new Error("STALE_READ_SET");
        var observed = aeBlurLocal(aeCollectionTargetRef(target, rs.stamp));
        if (aeBlurReadSetStale(observed, target, operation, rs)) throw new Error("STALE_READ_SET");
        var maps = aeCollectionGuardMaps(target, observed.comp, observed.layer);
        return { ok: true, comps: maps.comps, layers: maps.layers, blur: true, blurProperty: observed.property };
    } catch (error) { return { ok: false, code: "STALE_READ_SET" }; }
}
/** Writes the planned Gaussian Blur value after re-checking the read set. Returns the written desired value; throws Error with the refusal code
 * (INVALID_READ_SET or STALE_READ_SET). */
function aeWriteBlurLocal(request) {
    var checked = aeCheckBlurReadSet(request); if (!checked.ok) throw new Error(checked.code);
    var target = request.readSet.targets[0], observed = aeBlurLocal(aeCollectionTargetRef(target, request.readSet.stamp));
    if (JSON.stringify(observed.local) !== JSON.stringify(target.localEffect)
      || !aeCollectionSameStamp(request.readSet.stamp)) throw new Error("STALE_READ_SET");
    observed.setter.call(observed.property, target.desiredValue);
    return target.desiredValue;
}
/** Reads the Gaussian Blur row back after a write. Returns
 * {planId,readSetDigest,stamp,complete:true,localEffect,metadata,rows:[{operationIndex,compositionId,layerId,layerIndex,...}],compositions}; throws on
 * a stale read. */
function aeBlurReadback(request) {
    var rs = request.readSet, target = rs.targets[0], stamp = aeCollectionStamp();
    if (stamp.epoch !== rs.stamp.epoch) throw new Error("READBACK_STALE");
    var observed = aeBlurLocal(aeCollectionTargetRef(target, stamp));
    var expected = JSON.parse(JSON.stringify(target.localEffect)); expected.value = target.desiredValue;
    if (!aeCollectionSameValues(observed.local, expected) || !aeCollectionSameStamp(stamp)) throw new Error("READBACK_MISMATCH");
    return { planId: request.planId, readSetDigest: rs.digest, stamp: stamp, complete: true, localEffect: observed.local, metadata: observed.metadata,
      rows: [{ operationIndex: 0, compositionId: target.compositionId, layerId: target.layerId, layerIndex: target.layerIndex,
      name: observed.metadata.layer.name, locked: false, selected: observed.metadata.layer.selected, value: observed.local.value }] };
}
