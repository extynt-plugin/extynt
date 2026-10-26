/* Apply: keyframe ease, interpolation and key-shape writes, and animate_control. It sits under apply-flow.jsx, which
 * dispatches the animation operations here.
 */
/* global aeApplyAnimateSourceText, aeIsArray, aeApplyIsJsonValue, aeApplyIsSourceText, aeApplyNativeShape, aeApplyShapePathValid, aeErrorText,
   aeHasOwn, aeKeyDigest, aeKeyShapeSummary, aeNumberInRange, aeSafe, aeSafeGet */
/* exported aeApplyAnimate, aeApplyKeyframeModeValid, aeApplyReadState, aeApplyVisibleWritableProperty */
var AE_APPLY_INTERPOLATION_NAMES = { LINEAR: true, HOLD: true, BEZIER: true, EASE: true, EASE_IN: true, EASE_OUT: true, EASE_IN_OUT: true };
function aeApplyInterpolationType(value) {
    if (value === undefined || value === null) return null;
    var normalized = String(value).toUpperCase().replace(/[- \t\r\n]+/g, "_");
    return aeHasOwn(AE_APPLY_INTERPOLATION_NAMES, normalized) ? normalized : null;
}
function aeApplyInterpolationConstant(value) { if (typeof KeyframeInterpolationType === "undefined") return null;
  if (value === "HOLD") return KeyframeInterpolationType.HOLD; if (value === "LINEAR") return KeyframeInterpolationType.LINEAR;
  return KeyframeInterpolationType.BEZIER; }
function aeApplyEaseFor(value) { if (value === "EASE" || value === "EASE_IN" || value === "EASE_OUT" || value === "EASE_IN_OUT"
  || value === "BEZIER") return true; return false; }
function aeApplyMakeEases(count, influence, speed) {
  if (typeof KeyframeEase === "undefined") throw new Error("EASING_UNSUPPORTED: KeyframeEase is unavailable."); var result = [],
  bounded = Math.max(0.1, Math.min(100, influence)); for (var i = 0; i < count; i += 1) { var dimensionSpeed = 0;
  if (speed instanceof Array) dimensionSpeed = speed[i]; else if (typeof speed === "number") dimensionSpeed = speed;
  result.push(new KeyframeEase(dimensionSpeed, bounded)); } return result; }
var MAX_FRAMES_PER_ANIMATION = 1024;
function aeApplyEaseSpecValid(value) { return !!value && typeof value === "object" && !(value instanceof Array) && aeNumberInRange(value.speed,
  -10000000, 10000000) && aeNumberInRange(value.influence, 0.1, 100); }
function aeApplyEaseSideValid(value) { if (value === undefined) return true; if (value instanceof Array) { if (value.length < 1
  || value.length > 3) return false; for (var i = 0; i < value.length; i += 1) if (!aeApplyEaseSpecValid(value[i])) return false; return true;
  } return aeApplyEaseSpecValid(value); }
function aeApplyCurveValid(curve) { return !!curve && typeof curve === "object" && aeNumberInRange(curve.x1, 0, 1) && aeNumberInRange(curve.x2, 0, 1)
  && aeNumberInRange(curve.y1, -10, 10) && aeNumberInRange(curve.y2, -10, 10); }
function aeApplyTangentValid(tangent) { if (!(tangent instanceof Array) || tangent.length < 2 || tangent.length > 3) return false;
  for (var i = 0; i < tangent.length; i += 1) if (!aeNumberInRange(tangent[i], -10000000, 10000000)) return false; return true; }
function aeApplyOptionalBoolean(value) { return value === undefined || typeof value === "boolean"; }
function aeApplyInterpolationSideValid(type) { return type === undefined || !!aeApplyInterpolationType(type); }
function aeApplyInterpolationShapeValid(interpolation) { return !interpolation || (aeApplyInterpolationSideValid(interpolation.inType)
  && aeApplyInterpolationSideValid(interpolation.outType)); }
function aeApplyEaseShapeValid(ease) { return ease === undefined || (!!ease && typeof ease === "object" && aeApplyEaseSideValid(ease["in"])
  && aeApplyEaseSideValid(ease.out)); }
function aeApplyOptionalTangent(tangent) { return tangent === undefined || aeApplyTangentValid(tangent); }
function aeApplySpatialShapeValid(spatial) {
    if (spatial === undefined) return true;
    if (!spatial || typeof spatial !== "object") return false;
    return aeApplyOptionalTangent(spatial.inTangent) && aeApplyOptionalTangent(spatial.outTangent) && aeApplyOptionalBoolean(spatial.continuous)
      && aeApplyOptionalBoolean(spatial.autoBezier);
}
function aeApplyTemporalShapeValid(temporal) {
    if (temporal === undefined) return true;
    if (!temporal || typeof temporal !== "object") return false;
    return aeApplyOptionalBoolean(temporal.continuous) && aeApplyOptionalBoolean(temporal.autoBezier);
}
function aeApplyFrameBaseValid(frame) { return !!frame && typeof frame === "object" && typeof frame.time === "number" && isFinite(frame.time)
  && frame.time >= 0 && aeApplyIsJsonValue(frame.value); }
function aeApplyCurveShapeValid(curve, isLast) { return curve === undefined || (aeApplyCurveValid(curve) && !isLast); }
function aeApplyFrameShapeValid(frame, isLast) {
    if (!aeApplyFrameBaseValid(frame) || !aeApplyInterpolationShapeValid(frame.interpolation) || !aeApplyEaseShapeValid(frame.ease)) return false;
    if (!aeApplyCurveShapeValid(frame.curve, isLast)) return false;
    return aeApplySpatialShapeValid(frame.spatial) && aeApplyTemporalShapeValid(frame.temporal) && aeApplyOptionalBoolean(frame.roving);
}
/** True when the keyframe mode is undefined, "reject", "merge" or "replace". */
function aeApplyKeyframeModeValid(mode) { return mode === undefined || mode === "reject" || mode === "merge" || mode === "replace"; }
function aeApplySpatialProperty(property) {
    if (typeof PropertyValueType !== "undefined") { var type = aeSafeGet(property, "propertyValueType", null); if (type !== null
      && type !== undefined) return type === PropertyValueType.TwoD_SPATIAL || type === PropertyValueType.ThreeD_SPATIAL; }
    return aeSafe(function () { return property.isSpatial === true; }, false);
}
function aeApplyEaseDimensions(property, sample) {
    if (typeof PropertyValueType !== "undefined") { var type = aeSafeGet(property, "propertyValueType", null); if (type !== null
      && type !== undefined) { if (type === PropertyValueType.TwoD) return 2; if (type === PropertyValueType.ThreeD) return 3; return 1; } }
    if (aeApplySpatialProperty(property)) return 1;
    return sample instanceof Array ? Math.max(1, Math.min(3, sample.length)) : 1;
}
function aeApplyNumericVector(value) { if (typeof value === "number") return [value]; if (!(value instanceof Array) || value.length < 1) return null;
  for (var i = 0; i < value.length; i += 1) if (typeof value[i] !== "number" || !isFinite(value[i])) return null; return value; }
function aeApplyShapeValued(property) { var name = String(aeSafeGet(property, "matchName", "")); return name === "ADBE Mask Shape"
  || name === "ADBE Vector Shape"; }
function aeApplySegmentVelocity(property, from, to, dims) {
    if (aeApplyShapeValued(property)) return [0];
    return aeApplyNumericVelocity(property, from, to, dims);
}
function aeApplyDistance(from, to, count) {
    var sum = 0;
    for (var index = 0; index < count; index += 1) sum += (to[index] - from[index]) * (to[index] - from[index]);
    return Math.sqrt(sum);
}
function aeApplyScalarSpeed(property, from, to, count) {
    if (count === 1 && !aeApplySpatialProperty(property)) return to[0] - from[0];
    return aeApplyDistance(from, to, count);
}
function aeApplyNumericVelocity(property, from, to, dims) {
    var a = aeApplyNumericVector(from.value), b = aeApplyNumericVector(to.value), duration = to.time - from.time;
    if (!a || !b || duration <= 0) throw new Error("EASING_UNSUPPORTED: custom curves require numeric keyframe values.");
    var count = Math.min(a.length, b.length), result = [];
    if (dims === 1) return [aeApplyScalarSpeed(property, a, b, count) / duration];
    for (var index = 0; index < dims; index += 1) result.push(index < count ? (b[index] - a[index]) / duration : 0);
    return result;
}
function aeApplyScaledSpeeds(velocity, ratio, nonNegative) { var result = []; for (var i = 0; i < velocity.length; i += 1) {
  var speed = velocity[i] * ratio; if (nonNegative && speed < 0) speed = 0; result.push(speed); } return result; }
function aeApplyExpandEaseSpecs(specs, dims) {
    if (specs.length === 1 && dims > 1) {
        var repeated = [];
        for (var r = 0; r < dims; r += 1) repeated.push(specs[0]);
        return repeated;
    }
    return (specs.length === 2 && dims === 3) ? [specs[0], specs[1], specs[1]] : specs;
}
function aeApplyExplicitEases(side, dims) {
    if (side === undefined) return null;
    var specs = aeApplyExpandEaseSpecs(side instanceof Array ? side : [side], dims);
    if (specs.length !== dims) throw new Error("EASING_UNSUPPORTED: this property expects " + dims + " ease value(s) per side.");
    var result = []; for (var i = 0; i < specs.length; i += 1) result.push(aeApplyMakeEases(1, specs[i].influence, specs[i].speed)[0]);
    return result;
}
function aeApplyCurveEases(property, frames, eases, shape) {
    var dims = shape.dims, nonNegative = shape.nonNegative;
    for (var i = 0; i < frames.length - 1; i += 1) {
        var curve = frames[i].curve; if (!curve) continue;
        var velocity = aeApplySegmentVelocity(property, frames[i], frames[i + 1], dims), outInfluence = Math.max(0.001, curve.x1),
          inInfluence = Math.max(0.001, 1 - curve.x2);
        eases[i].out = aeApplyMakeEases(dims, outInfluence * 100, aeApplyScaledSpeeds(velocity, curve.y1 / outInfluence, nonNegative));
        eases[i + 1]["in"] = aeApplyMakeEases(dims, inInfluence * 100, aeApplyScaledSpeeds(velocity, (1 - curve.y2) / inInfluence, nonNegative));
    }
}
function aeApplyLegacyEase(current, type, dims) {
    if (current || type === undefined || !aeApplyEaseFor(aeApplyInterpolationType(type))) return current;
    return aeApplyMakeEases(dims, 75, 0);
}
function aeApplyFrameEases(frame, slot, dims) {
    var ease = frame.ease || {}, interpolation = frame.interpolation || {};
    if (ease["in"] !== undefined) slot["in"] = aeApplyExplicitEases(ease["in"], dims);
    if (ease.out !== undefined) slot.out = aeApplyExplicitEases(ease.out, dims);
    slot["in"] = aeApplyLegacyEase(slot["in"], interpolation.inType, dims);
    slot.out = aeApplyLegacyEase(slot.out, interpolation.outType, dims);
}
function aeApplyResolveEases(property, frames) {
    var dims = aeApplyEaseDimensions(property, frames[0].value), nonNegative = (dims === 1) && aeApplySpatialProperty(property), eases = [], i;
    for (i = 0; i < frames.length; i += 1) eases.push({ "in": null, out: null });
    aeApplyCurveEases(property, frames, eases, { dims: dims, nonNegative: nonNegative });
    for (i = 0; i < frames.length; i += 1) aeApplyFrameEases(frames[i], eases[i], dims);
    return eases;
}
function aeApplyKeyIndexAtTime(property, time) {
    var nearest = aeSafe(function () { return property.nearestKeyIndex(time); }, 0);
    if (nearest > 0 && Math.abs(aeSafe(function () { return property.keyTime(nearest); }, -1) - time) < 0.0005) return nearest;
    var count = aeSafeGet(property, "numKeys", 0);
    for (var index = 1; index <= count; index += 1) if (Math.abs(aeSafe(function () { return property.keyTime(index); }, -1) - time) < 0.0005) return index;
    throw new Error("KEYFRAME_WRITE_FAILED: no keyframe was observed at time " + time + ".");
}
function aeApplySideInterpolation(requested, eased, defaultLinear, current) {
    if (requested !== undefined) return aeApplyInterpolationConstant(aeApplyInterpolationType(requested));
    if (eased) return KeyframeInterpolationType.BEZIER;
    if (defaultLinear || !current) return KeyframeInterpolationType.LINEAR;
    return current;
}
function aeApplyHasKeyAtTime(property, time) { var count = aeSafeGet(property, "numKeys", 0);
  for (var index = 1; index <= count; index += 1) {if (Math.abs(aeSafe(function () { return property.keyTime(index); },
  -1) - time) < 0.0005) return true;} return false; }
function aeApplySpatialTangentArray(tangent) { return (aeIsArray(tangent) && tangent.length === 2) ? [tangent[0], tangent[1], 0] : tangent; }
function aeApplyRequireInterpolationApi(property) {
    if (typeof property.setInterpolationTypeAtKey !== "function"
      || typeof KeyframeInterpolationType === "undefined") throw new Error("EASING_UNSUPPORTED: interpolation methods are unavailable.");
}
function aeApplyKeyInterpolation(property, keyIndex, frame, edit) {
    var ease = edit.ease, newKey = edit.newKey, interpolation = frame.interpolation || {}, hasInterpolation = interpolation.inType !== undefined
      || interpolation.outType !== undefined || newKey === true;
    if (!(hasInterpolation || ease["in"] || ease.out)) return;
    aeApplyRequireInterpolationApi(property);
    var currentIn = aeSafe(function () { return property.keyInInterpolationType(keyIndex); }, null), currentOut = aeSafe(function () {
      return property.keyOutInterpolationType(keyIndex); }, null);
    var inType = aeApplySideInterpolation(interpolation.inType, ease["in"], hasInterpolation, currentIn),
      outType = aeApplySideInterpolation(interpolation.outType, ease.out, hasInterpolation, currentOut);
    try { property.setInterpolationTypeAtKey(keyIndex, inType, outType); } catch (interpolationError) {
      throw new Error("EASING_UNSUPPORTED: " + aeErrorText(interpolationError)); }
}
function aeApplyCurrentEase(read, dims) { return aeSafe(read, null) || aeApplyMakeEases(dims, 16.666667, 0); }
function aeApplyKeyTemporalEase(property, keyIndex, frame, ease) {
    if (!(ease["in"] || ease.out)) return;
    if (typeof property.setTemporalEaseAtKey !== "function") throw new Error("EASING_UNSUPPORTED: setTemporalEaseAtKey is unavailable.");
    var dims = aeApplyEaseDimensions(property, frame.value);
    var inEase = ease["in"] || aeApplyCurrentEase(function () { return property.keyInTemporalEase(keyIndex); }, dims);
    var outEase = ease.out || aeApplyCurrentEase(function () { return property.keyOutTemporalEase(keyIndex); }, dims);
    try { property.setTemporalEaseAtKey(keyIndex, inEase, outEase); } catch (easeError) { throw new Error("EASING_UNSUPPORTED: " + aeErrorText(easeError)); }
}
function aeApplyKeyTemporalFlags(property, keyIndex, temporal) {
    if (!temporal) return;
    try { if (temporal.continuous !== undefined) property.setTemporalContinuousAtKey(keyIndex, temporal.continuous);
      if (temporal.autoBezier !== undefined) property.setTemporalAutoBezierAtKey(keyIndex, temporal.autoBezier); } catch (temporalError) {
      throw new Error("EASING_UNSUPPORTED: " + aeErrorText(temporalError)); }
}
function aeApplySpatialTangentIn(property, keyIndex, spatial) {
  return aeApplySpatialTangentArray(spatial.inTangent !== undefined ? spatial.inTangent : property.keyInSpatialTangent(keyIndex)); }
function aeApplySpatialTangentOut(property, keyIndex, spatial) {
  return aeApplySpatialTangentArray(spatial.outTangent !== undefined ? spatial.outTangent : property.keyOutSpatialTangent(keyIndex)); }
function aeApplyKeySpatialTangents(property, keyIndex, spatial) {
    if (spatial.inTangent === undefined && spatial.outTangent === undefined) return;
    property.setSpatialTangentsAtKey(keyIndex, aeApplySpatialTangentIn(property, keyIndex, spatial), aeApplySpatialTangentOut(property, keyIndex, spatial));
}
function aeApplyKeySpatial(property, keyIndex, spatial) {
    if (!spatial) return;
    if (!aeApplySpatialProperty(property)) throw new Error("SPATIAL_UNSUPPORTED: spatial tangents require a spatial property such as Position.");
    try {
        aeApplyKeySpatialTangents(property, keyIndex, spatial);
        if (spatial.continuous !== undefined) property.setSpatialContinuousAtKey(keyIndex, spatial.continuous);
        if (spatial.autoBezier !== undefined) property.setSpatialAutoBezierAtKey(keyIndex, spatial.autoBezier);
    } catch (spatialError) { throw new Error("SPATIAL_UNSUPPORTED: " + aeErrorText(spatialError)); }
}
function aeApplyKeyShape(property, keyIndex, frame, edit) {
    aeApplyKeyInterpolation(property, keyIndex, frame, edit);
    aeApplyKeyTemporalEase(property, keyIndex, frame, edit.ease);
    aeApplyKeyTemporalFlags(property, keyIndex, frame.temporal);
    aeApplyKeySpatial(property, keyIndex, frame.spatial);
}
function aeApplyWritableProperty(property, writeMethod) {
    if (!property || typeof writeMethod !== "string") return false;
    if (typeof PropertyType !== "undefined" && aeSafe(function () { return property.propertyType !== PropertyType.PROPERTY; }, false)) return false;
    return aeSafe(function () { return typeof property[writeMethod] === "function"; }, false);
}
/**
 * `isHidden` is meaningful for native AE leaf properties.  In particular, an indexed Text Animator group can hand back
 * a hidden/stale property while it is rebuilding.  Never attempt a write through it: resolve the leaf again from the
 * layer tree and require it to be visible. Only dimensionsSeparated is authoritative for Position: a separated leader
 * is hidden and a follower is inactive until its leader is separated.
 */
function aeApplyVisibleWritableProperty(property, writeMethod) {
    return aeApplyWritableProperty(property, writeMethod) && !aeSafe(function () { return property.isHidden === true; }, false);
}
function aeApplyStateValue(value) { if (value === null || value === undefined) return null; if (typeof value === "number" || typeof value === "string"
  || typeof value === "boolean") return value; if (value instanceof Array) { var values = [];
  for (var n = 0; n < value.length; n += 1) values.push(aeApplyStateValue(value[n])); return values; } return String(value); }
/** Snapshot of a property. Returns {value,numKeys,digest[,shapeKeys]}. */
function aeApplyReadState(property) {
    var numKeys = aeSafeGet(property, "numKeys", 0);
    var state = { value: aeSafe(function () { return aeApplyStateValue(property.value); }, null), numKeys: numKeys,
      digest: numKeys > 0 ? aeSafe(function () { return aeKeyDigest(property, numKeys); }, null) : null };
    var shapeKeys = numKeys > 0 ? aeSafe(function () { return aeKeyShapeSummary(property, numKeys); }, null) : null;
    if (shapeKeys) state.shapeKeys = shapeKeys;
    return state;
}
function aeApplySeparationProblem(property) {
    if (aeSafe(function () { return property.dimensionsSeparated === true; },
      false)) return "SEPARATED_DIMENSIONS_UNSUPPORTED: dimensions are separated; animate ADBE Position_0/ADBE Position_1 instead.";
    if (aeSafe(function () { return property.isSeparationFollower === true; }, false) && !aeSafe(function () {
      return property.separationLeader.dimensionsSeparated === true; },
      false)) return "SEPARATED_DIMENSIONS_UNSUPPORTED: X/Y Position is inactive until Separate Dimensions is enabled; animate ADBE Position instead.";
    return null;
}
function aeApplyFrameShaped(frame) { return !!(frame.interpolation || frame.ease || frame.curve || frame.spatial || frame.temporal
  || frame.roving !== undefined); }
function aeApplyValidateKeyFrame(frame, isEdge, spatial, merging) {
    if (frame.spatial && !spatial) throw new Error("SPATIAL_UNSUPPORTED: spatial tangents require a spatial property such as Position.");
    if (frame.roving === undefined) return;
    if (!spatial) throw new Error("SPATIAL_UNSUPPORTED: roving requires a spatial property such as Position.");
    if (frame.roving === true && !merging && isEdge) throw new Error("SPATIAL_UNSUPPORTED: the first and last keyframes cannot rove.");
}
function aeApplyValidateKeyShapes(property, frames, merging) {
    if (!(frames instanceof Array) || !frames.length) return;
    var spatial = aeApplySpatialProperty(property), shaped = false;
    for (var i = 0; i < frames.length; i += 1) {
        var frame = frames[i]; if (!frame) continue;
        aeApplyValidateKeyFrame(frame, i === 0 || i === frames.length - 1, spatial, merging);
        if (aeApplyFrameShaped(frame)) shaped = true;
    }
    if (shaped) aeApplyRequireInterpolationApi(property);
    aeApplyResolveEases(property, frames);
}
function aeApplyCheckAnimatable(property, operation) {
    if (!property) throw new Error("PROPERTY_NOT_FOUND");
    if (!aeApplyWritableProperty(property, "setValueAtTime")) throw new Error("PROPERTY_NOT_SETTABLE");
    if (aeSafe(function () { return property.canVaryOverTime === false; }, false)) throw new Error("PROPERTY_NOT_ANIMATABLE");
    if (operation.expression) throw new Error("EXPRESSIONS_UNSUPPORTED");
    var separation = aeApplySeparationProblem(property); if (separation) throw new Error(separation);
}
function aeApplyAnimateFrames(operation) {
    var frames = operation.keyframes || [];
    if (!(frames instanceof Array) || frames.length < 1 || frames.length > MAX_FRAMES_PER_ANIMATION) throw new Error("BOUNDS_EXCEEDED");
    return frames;
}
function aeApplyKeyframeWriteMode(operation, alreadyAnimatedInPlan) {
    var mode = "reject"; if (operation.keyframeMode === "replace") mode = "replace"; else if (operation.keyframeMode === "merge"
      || alreadyAnimatedInPlan) mode = "merge";
    return mode;
}
function aeApplyCheckFrameOrder(frames) {
    var previousTime = -1;
    for (var i = 0; i < frames.length; i += 1) { if (!aeApplyFrameShapeValid(frames[i], i === frames.length - 1)
      || frames[i].time <= previousTime) throw new Error("INVALID_VALUE"); previousTime = frames[i].time; }
}
function aeApplyCheckShapeFrames(property, frames) {
    if (!aeApplyShapeValued(property)) return;
    for (var i = 0; i < frames.length; i += 1) if (!aeApplyShapePathValid(frames[i].value)) throw new Error("INVALID_VALUE: keyframe " + i + " is not a Shape ({vertices, closed, inTangents?, outTangents?}, at most 1000 vertices).");
}
function aeApplyRemoveExistingKeys(property) {
    if (typeof property.removeKey !== "function") throw new Error("KEYFRAME_WRITE_FAILED: removeKey is unavailable.");
    var removedKeys = 0;
    try { while (aeSafeGet(property, "numKeys", 0) > 0) { property.removeKey(property.numKeys); removedKeys += 1; } } catch (removeError) {
      throw new Error("KEYFRAME_WRITE_FAILED: remove existing keyframes: " + aeErrorText(removeError)); }
    return removedKeys;
}
function aeApplyKeyWritePlan(property, frames) {
    var plan = { times: [], values: [], shaped: false, preexisting: [], remainingKeys: aeSafeGet(property, "numKeys", 0) },
      shapeValued = aeApplyShapeValued(property);
    for (var i = 0; i < frames.length; i += 1) {
        plan.times.push(frames[i].time); plan.values.push(shapeValued ? aeApplyNativeShape(frames[i].value) : frames[i].value);
        if (aeApplyFrameShaped(frames[i])) plan.shaped = true;
        plan.preexisting.push(plan.remainingKeys > 0 && aeApplyHasKeyAtTime(property, frames[i].time));
    }
    return plan;
}
function aeApplyRollbackNewKeys(property, frames, preexisting) {
    try {
        for (var rollbackIndex = 0; rollbackIndex < frames.length; rollbackIndex += 1) {
            if (preexisting[rollbackIndex]) continue;
            var newIndex = aeSafe(function () { return aeApplyKeyIndexAtTime(property, frames[rollbackIndex].time); }, 0);
            if (newIndex) property.removeKey(newIndex);
        }
        return "";
    } catch (rollbackError) { return aeErrorText(rollbackError); }
}
function aeApplyRollbackNote(rollbackError) { return rollbackError ? "; rollback failed: " + rollbackError : ""; }
function aeApplyKeysPresent(property, frames) {
    for (var i = 0; i < frames.length; i += 1) aeApplyKeyIndexAtTime(property, frames[i].time);
}
function aeApplyWriteKeyValues(property, frames, plan) {
    try {
        if (typeof property.setValuesAtTimes === "function") property.setValuesAtTimes(plan.times, plan.values);
        else for (var i = 0; i < frames.length; i += 1) property.setValueAtTime(plan.times[i], plan.values[i]);
        aeApplyKeysPresent(property, frames);
    } catch (keyframeError) {
        var message = aeErrorText(keyframeError) + aeApplyRollbackNote(aeApplyRollbackNewKeys(property, frames, plan.preexisting));
        throw new Error(message.indexOf("KEYFRAME_WRITE_FAILED") === 0 ? message : "KEYFRAME_WRITE_FAILED: " + message);
    }
}
function aeApplyWriteRoving(property, frame) {
    try { property.setRovingAtKey(aeApplyKeyIndexAtTime(property, frame.time), frame.roving); } catch (rovingError) {
      throw new Error("SPATIAL_UNSUPPORTED: roving: " + aeErrorText(rovingError)); }
}
function aeApplyShapeKeys(property, frames, eases, preexisting) {
    var i;
    try {
        for (i = 0; i < frames.length; i += 1) {aeApplyKeyShape(property, aeApplyKeyIndexAtTime(property, frames[i].time), frames[i], { ease: eases[i],
          newKey: !preexisting[i] });}
        for (i = 0; i < frames.length; i += 1) if (frames[i].roving !== undefined) aeApplyWriteRoving(property, frames[i]);
    } catch (shapeError) {
        var rollbackNote = aeApplyRollbackNote(aeApplyRollbackNewKeys(property, frames, preexisting));
        throw rollbackNote ? new Error(aeErrorText(shapeError) + rollbackNote) : shapeError;
    }
}
/**
 * Writes the operation's keyframes. Returns {keyframes,keyframeMode,removedKeys}. Everything that can be rejected is
 * checked before the first keyframe write, and a failure partway drops exactly the keys this operation created, never
 * a preexisting key it merged into.
 */
function aeApplyAnimate(property, operation, alreadyAnimatedInPlan) {
    aeApplyCheckAnimatable(property, operation);
    if (aeApplyIsSourceText(property)) return aeApplyAnimateSourceText(property, operation, aeApplyKeyframeWriteMode(operation, alreadyAnimatedInPlan));
    var frames = aeApplyAnimateFrames(operation), mode = aeApplyKeyframeWriteMode(operation, alreadyAnimatedInPlan);
    var existingKeys = aeSafeGet(property, "numKeys", 0), removedKeys = 0;
    if (existingKeys > 0
      && mode === "reject") throw new Error("CONFLICTING_KEYS: " + String(operation.propertyPath) + " already has " + existingKeys + " keyframe(s); set keyframeMode to merge or replace.");
    aeApplyCheckFrameOrder(frames);
    aeApplyCheckShapeFrames(property, frames);
    var eases = aeApplyResolveEases(property, frames);
    aeApplyValidateKeyShapes(property, frames, mode === "merge");
    if (mode === "replace" && existingKeys > 0) removedKeys = aeApplyRemoveExistingKeys(property);
    var plan = aeApplyKeyWritePlan(property, frames);
    aeApplyWriteKeyValues(property, frames, plan);
    if (plan.shaped || plan.remainingKeys > 0) aeApplyShapeKeys(property, frames, eases, plan.preexisting);
    return { keyframes: frames.length, keyframeMode: mode, removedKeys: removedKeys };
}
