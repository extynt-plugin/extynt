/* Apply dolly_camera: a camera push-in or pull-out stated as a distance to the Point of Interest, with every Position
 * key derived on the viewing axis and read back. It mirrors packages/action-plan/src/camera-dolly.ts, and the two are
 * kept in step.
 */
/* global AE_APPLY_LAYER_STEPS, AE_APPLY_VAL_CHECKS, AE_APPLY_VAL_RULES_LAYER, aeApplyAnimate, aeApplyFindProperty, aeApplyValSpecRule, aeSafe, aeSafeGet */
var AE_DOLLY_POI_PATH = "ADBE Transform Group/ADBE Anchor Point";
var AE_DOLLY_POSITION_PATH = "ADBE Transform Group/ADBE Position";
var AE_DOLLY_MAX_KEYS = 64;
var AE_DOLLY_MAX_DISTANCE = 1000000;

function aeDollyPad(value) { return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0]; }
function aeDollyLength(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
function aeDollyMinus(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function aeDollyAxis(origin, poi) {
    if (!poi) return [0, 0, -1];
    var from = aeDollyMinus(aeDollyPad(origin), aeDollyPad(poi)), size = aeDollyLength(from);
    if (!(size > 0.000001)) return null;
    return [from[0] / size, from[1] / size, from[2] / size];
}
function aeDollyAnchor(origin, poi) {
    if (poi) return aeDollyPad(poi);
    return [Number(origin[0]) || 0, Number(origin[1]) || 0, 0];
}
function aeDollyPosition(origin, poi, axis, distance) {
    var anchor = aeDollyAnchor(origin, poi);
    return [anchor[0] + axis[0] * distance, anchor[1] + axis[1] * distance, anchor[2] + axis[2] * distance];
}
function aeDollyGeometry(position, origin, poi, axis) {
    var along = aeDollyMinus(aeDollyPad(position), aeDollyAnchor(origin, poi));
    var distance = along[0] * axis[0] + along[1] * axis[1] + along[2] * axis[2];
    var off = aeDollyLength(aeDollyMinus(along, [axis[0] * distance, axis[1] * distance, axis[2] * distance]));
    return { distance: distance, offAxis: off };
}

function aeDollyKeyframeValid(frame, previousTime) {
    if (!frame || typeof frame !== "object" || frame instanceof Array) return false;
    if (!AE_APPLY_VAL_CHECKS.num(frame.time, 0, 86400) || frame.time <= previousTime) return false;
    return AE_APPLY_VAL_CHECKS.numAbove(frame.distance, 0, AE_DOLLY_MAX_DISTANCE) && frame.value === undefined;
}
function aeDollyKeyframesValid(keyframes) {
    var previous = -1;
    for (var i = 0; i < keyframes.length; i += 1) {
        if (!aeDollyKeyframeValid(keyframes[i], previous)) return false;
        previous = keyframes[i].time;
    }
    return true;
}
AE_APPLY_VAL_CHECKS.dollyKeyframes = function (keyframes) { return keyframes instanceof Array && aeDollyKeyframesValid(keyframes); };
AE_APPLY_VAL_RULES_LAYER.dolly_camera = aeApplyValSpecRule([["keyframes", "arr", 2, AE_DOLLY_MAX_KEYS], ["keyframes", "dollyKeyframes"]]);

function aeDollyIsCamera(layer) {
    return aeSafe(function () { return layer.matchName === "ADBE Camera Layer"; }, false) || aeSafe(function () { return layer instanceof CameraLayer; }, false);
}
function aeDollyPointOfInterest(layer) {
    var anchor = aeApplyFindProperty(layer, AE_DOLLY_POI_PATH);
    if (!anchor) return null;
    var oriented = aeSafe(function () { return layer.autoOrient === AutoOrientType.CAMERA_OR_POINT_OF_INTEREST; }, true);
    return oriented ? aeSafeGet(anchor, "value", null) : null;
}
function aeDollyOrigin(position) {
    var keyed = aeSafeGet(position, "numKeys", 0) > 0;
    return keyed ? position.keyValue(1) : position.value;
}
function aeDollyFrames(operation, origin, poi, axis) {
    var frames = [];
    for (var i = 0; i < operation.keyframes.length; i += 1) {
        var source = operation.keyframes[i], frame = { time: source.time, value: aeDollyPosition(origin, poi, axis, source.distance) };
        if (source.curve !== undefined) frame.curve = source.curve;
        frames.push(frame);
    }
    return frames;
}
function aeDollyReadKeys(position, origin, poi, axis) {
    var keys = [], count = Math.min(position.numKeys, AE_DOLLY_MAX_KEYS);
    for (var i = 1; i <= count; i += 1) {
        var geometry = aeDollyGeometry(position.keyValue(i), origin, poi, axis);
        keys.push({ time: position.keyTime(i), distance: geometry.distance, offAxis: geometry.offAxis });
    }
    return keys;
}
function aeApplyStepDollyCamera(run, operation, scope) {
    var layer = scope.layer;
    if (!aeDollyIsCamera(layer)) throw new Error("INVALID_TARGET: dolly_camera applies to a camera layer.");
    var position = aeApplyFindProperty(layer, AE_DOLLY_POSITION_PATH);
    if (!position) throw new Error("PROPERTY_NOT_FOUND");
    var poi = aeDollyPointOfInterest(layer), origin = aeDollyOrigin(position), axis = aeDollyAxis(origin, poi);
    if (!axis) throw new Error("INVALID_VALUE: the camera sits on its point of interest, so it has no viewing axis to dolly along.");
    aeApplyAnimate(position, { operation: "animate_property", propertyPath: AE_DOLLY_POSITION_PATH, keyframes: aeDollyFrames(operation, origin, poi, axis), keyframeMode: "replace" }, false);
    run.touched.push(operation.operation);
    return {
        operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, propertyPath: AE_DOLLY_POSITION_PATH,
        hasPointOfInterest: !!poi, origin: aeDollyPad(origin), pointOfInterest: poi ? aeDollyPad(poi) : null, dollyKeys: aeDollyReadKeys(position, origin, poi, axis), verification: "camera-dolly-axis"
    };
}

AE_APPLY_LAYER_STEPS.dolly_camera = aeApplyStepDollyCamera;
