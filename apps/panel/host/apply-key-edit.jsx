/* Apply edit_keyframes: delete, move, scale or copy the keys a property already has. Each key is read whole, removed,
 * written back at its new time, and the result read back. An unmatched
 * time or index is a refusal, and every expected time must read back.
 */
/* exported aeApplyAnimateSourceText, aeApplyIsSourceText, aeKeyEditReportRestores */
/* global AE_APPLY_LAYER_STEPS, AE_APPLY_VAL_CHECKS, AE_APPLY_VAL_RULES_LAYER, aeApplyCreatedComps, aeApplyCreatedLayers, aeApplyFindComp,
  aeApplyFindLayer, aeApplyFindProperty, aeApplyValSpecRule, aeHasOwn, aeIsArray, aeOwnValue, aeSafe, aeSafeGet */
var AE_KEYEDIT_ACTIONS = { "delete": true, move: true, scale: true, copy: true };
var AE_KEYEDIT_FIELDS = { "delete": "", move: "offset", scale: "about factor", copy: "source timeOffset keyframeMode" };

function aeKeyEditNumbers(list, min, max, integer) {
    if (!(list instanceof Array) || list.length < 1 || list.length > 256) return false;
    for (var i = 0; i < list.length; i += 1) if (!AE_APPLY_VAL_CHECKS.num(list[i], min, max) || (integer && Math.floor(list[i]) !== list[i])) return false;
    return true;
}
function aeKeyEditSourceValid(source) {
    return !!source && typeof source === "object" && AE_APPLY_VAL_CHECKS.str(source.compositionId, 1, 512) && AE_APPLY_VAL_CHECKS.str(source.layerId, 1, 512) && AE_APPLY_VAL_CHECKS.str(source.propertyPath, 1, 1024);
}
function aeKeyEditCopyValid(operation) {
    return aeKeyEditSourceValid(operation.source) && (operation.timeOffset === undefined || AE_APPLY_VAL_CHECKS.num(operation.timeOffset, -86400, 86400)) && (operation.keyframeMode === undefined || operation.keyframeMode === "merge" || operation.keyframeMode === "replace");
}
function aeKeyEditActionValid(operation) {
    if (operation.action === "move") return AE_APPLY_VAL_CHECKS.num(operation.offset, -86400, 86400) && operation.offset !== 0;
    if (operation.action === "scale") return AE_APPLY_VAL_CHECKS.num(operation.about, 0, 86400) && AE_APPLY_VAL_CHECKS.num(operation.factor, 0.001, 1000) && operation.factor !== 1;
    if (operation.action !== "copy") return true;
    return aeKeyEditCopyValid(operation);
}
function aeKeyEditChosen(operation) { return (operation.times !== undefined ? 1 : 0) + (operation.indices !== undefined ? 1 : 0)
  + (operation.all !== undefined ? 1 : 0); }
var AE_KEYEDIT_LISTS = [["times", 0, 86400, false], ["indices", 1, 4096, true]];
function aeKeyEditListsValid(operation) {
    for (var i = 0; i < AE_KEYEDIT_LISTS.length; i += 1) {
        var rule = AE_KEYEDIT_LISTS[i];
        if (operation[rule[0]] !== undefined && !aeKeyEditNumbers(operation[rule[0]], rule[1], rule[2], rule[3])) return false;
    }
    return true;
}
function aeKeyEditSelectionValid(operation) {
    var chosen = aeKeyEditChosen(operation);
    if (chosen > 1 || (chosen === 0 && operation.action === "delete")) return false;
    if (operation.all !== undefined && operation.all !== true) return false;
    return aeKeyEditListsValid(operation);
}
function aeKeyEditFieldsValid(operation) {
    for (var action in AE_KEYEDIT_FIELDS) {
        if (!aeHasOwn(AE_KEYEDIT_FIELDS, action) || action === operation.action || AE_KEYEDIT_FIELDS[action] === "") continue;
        var names = AE_KEYEDIT_FIELDS[action].split(" ");
        for (var n = 0; n < names.length; n += 1) {if (operation[names[n]] !== undefined
          && AE_KEYEDIT_FIELDS[operation.action].indexOf(names[n]) < 0) return false;}
    }
    return true;
}
AE_APPLY_VAL_CHECKS.keyEdit = function (operation) {
    return aeHasOwn(AE_KEYEDIT_ACTIONS, operation.action) && aeKeyEditFieldsValid(operation) && aeKeyEditSelectionValid(operation)
      && aeKeyEditActionValid(operation);
};
AE_APPLY_VAL_RULES_LAYER.edit_keyframes = aeApplyValSpecRule([["propertyPath", "str", 1, 1024], [null, "keyEdit"]]);

function aeKeyEditTolerance(layer) {
    var rate = aeSafe(function () { return layer.containingComp.frameRate; }, 0);
    return rate > 0 ? 0.5 / rate : 0.001;
}
function aeKeyEditTemporalEases(property, side, index) {
    var eases = aeSafe(function () { return side === "in" ? property.keyInTemporalEase(index) : property.keyOutTemporalEase(index); }, null), copy = [];
    if (!eases) return null;
    for (var i = 0; i < eases.length; i += 1) copy.push({ speed: eases[i].speed, influence: eases[i].influence });
    return copy;
}
function aeKeyEditReadFlags(property, index, record) {
    record.temporalContinuous = aeSafe(function () { return property.keyTemporalContinuous(index); }, null);
    record.temporalAutoBezier = aeSafe(function () { return property.keyTemporalAutoBezier(index); }, null);
    record.roving = aeSafe(function () { return property.keyRoving(index); }, null);
    if (!aeSafeGet(property, "isSpatial", false)) return record;
    record.spatialContinuous = aeSafe(function () { return property.keySpatialContinuous(index); }, null);
    record.spatialAutoBezier = aeSafe(function () { return property.keySpatialAutoBezier(index); }, null);
    record.inTangent = aeSafe(function () { return property.keyInSpatialTangent(index); }, null);
    record.outTangent = aeSafe(function () { return property.keyOutSpatialTangent(index); }, null);
    return record;
}
function aeKeyEditRead(property, index) {
    var record = { time: property.keyTime(index), value: property.keyValue(index) };
    record.inType = aeSafe(function () { return property.keyInInterpolationType(index); }, null);
    record.outType = aeSafe(function () { return property.keyOutInterpolationType(index); }, null);
    record.inEase = aeKeyEditTemporalEases(property, "in", index);
    record.outEase = aeKeyEditTemporalEases(property, "out", index);
    return aeKeyEditReadFlags(property, index, record);
}
function aeKeyEditReadAll(property) {
    var records = [], count = property.numKeys;
    for (var i = 1; i <= count; i += 1) records.push(aeKeyEditRead(property, i));
    return records;
}
function aeKeyEditMakeEases(list) {
    var eases = [];
    for (var i = 0; i < list.length; i += 1) eases.push(new KeyframeEase(list[i].speed, list[i].influence));
    return eases;
}
function aeKeyEditHasBezierEases(record) {
    return !!record.inEase && !!record.outEase && record.inType === KeyframeInterpolationType.BEZIER && record.outType === KeyframeInterpolationType.BEZIER;
}
function aeKeyEditRestoreTemporal(property, index, record) {
    if (record.inType !== null && record.outType !== null) property.setInterpolationTypeAtKey(index, record.inType, record.outType);
    if (aeKeyEditHasBezierEases(record)) property.setTemporalEaseAtKey(index, aeKeyEditMakeEases(record.inEase), aeKeyEditMakeEases(record.outEase));
    if (record.temporalContinuous !== null) property.setTemporalContinuousAtKey(index, record.temporalContinuous);
    if (record.temporalAutoBezier !== null) property.setTemporalAutoBezierAtKey(index, record.temporalAutoBezier);
}
function aeKeyEditRestoreSpatial(property, index, record) {
    if (record.inTangent && record.outTangent) property.setSpatialTangentsAtKey(index, record.inTangent, record.outTangent);
    if (record.spatialContinuous !== null && record.spatialContinuous !== undefined) property.setSpatialContinuousAtKey(index, record.spatialContinuous);
    if (record.spatialAutoBezier !== null && record.spatialAutoBezier !== undefined) property.setSpatialAutoBezierAtKey(index, record.spatialAutoBezier);
}
function aeKeyEditRestoreFailures(property, index, record) {
    var failed = aeSafe(function () { aeKeyEditRestoreTemporal(property, index, record); return 0; }, 1);
    if (aeSafeGet(property, "isSpatial", false)) failed += aeSafe(function () { aeKeyEditRestoreSpatial(property, index, record); return 0; }, 1);
    if (record.roving === true && index > 1 && index < property.numKeys) failed += aeSafe(function () { property.setRovingAtKey(index, true); return 0; }, 1);
    return failed;
}
function aeKeyEditWrite(property, record, time) {
    property.setValueAtTime(time, record.value);
    return aeKeyEditRestoreFailures(property, property.nearestKeyIndex(time), record);
}
/** The reply with `restoreFailed` (how many tangent, spatial or roving restores After Effects refused) added only when that count is above zero. */
function aeKeyEditReportRestores(reply, restoreFailed) {
    if (restoreFailed > 0) reply.restoreFailed = restoreFailed;
    return reply;
}
function aeKeyEditMatchTime(records, time, tolerance) {
    for (var i = 0; i < records.length; i += 1) if (Math.abs(records[i].time - time) <= tolerance) return i;
    return -1;
}
function aeKeyEditPickTimes(operation, records, tolerance) {
    var picked = [];
    for (var i = 0; i < operation.times.length; i += 1) { var at = aeKeyEditMatchTime(records, operation.times[i], tolerance); if (at < 0) throw new Error("KEY_NOT_FOUND: no key at " + operation.times[i] + "s on " + operation.propertyPath); picked.push(at); }
    return picked;
}
function aeKeyEditPickIndices(operation, records) {
    var picked = [];
    for (var i = 0; i < operation.indices.length; i += 1) { if (operation.indices[i] > records.length) throw new Error("KEY_NOT_FOUND: " + operation.propertyPath + " has " + records.length + " key(s); no key " + operation.indices[i]); picked.push(operation.indices[i] - 1); }
    return picked;
}
function aeKeyEditPickAll(records) {
    var picked = [];
    for (var i = 0; i < records.length; i += 1) picked.push(i);
    return picked;
}
function aeKeyEditSelect(operation, records, tolerance) {
    var picked, i;
    if (operation.times !== undefined) picked = aeKeyEditPickTimes(operation, records, tolerance);
    else if (operation.indices !== undefined) picked = aeKeyEditPickIndices(operation, records);
    else picked = aeKeyEditPickAll(records);
    picked.sort(function (a, b) { return a - b; });
    for (i = 1; i < picked.length; i += 1) if (picked[i] === picked[i - 1]) throw new Error("INVALID_VALUE: edit_keyframes selects the same key twice");
    if (picked.length === 0) throw new Error("KEY_NOT_FOUND: " + operation.propertyPath + " has no keyframes");
    return picked;
}
function aeKeyEditNewTime(operation, time) { return operation.action === "move" ? time + operation.offset : operation.about + (time - operation.about) * operation.factor; }
function aeKeyEditCollides(times, tolerance) {
    var sorted = times.slice(0).sort(function (a, b) { return a - b; });
    for (var i = 1; i < sorted.length; i += 1) if (sorted[i] - sorted[i - 1] <= tolerance) return true;
    return false;
}
function aeKeyEditKeyTimes(property) { var times = [], count = property.numKeys; for (var i = 1; i <= count; i += 1) times.push(property.keyTime(i));
  return times; }
function aeKeyEditRequireKeyed(property, operation) {
    if (!property) throw new Error("PROPERTY_NOT_FOUND: " + operation.propertyPath + " is not a property of this layer");
    if (aeSafeGet(property, "numKeys", 0) < 1 && operation.action !== "copy") throw new Error("KEY_NOT_FOUND: " + operation.propertyPath + " has no keyframes");
}
function aeKeyEditHasKeyNear(times, wanted, tolerance) {
    for (var i = 0; i < times.length; i += 1) if (Math.abs(times[i] - wanted) <= tolerance) return true;
    return false;
}
function aeKeyEditAssertTimes(property, expected, check) {
    var actual = aeKeyEditKeyTimes(property).sort(function (a, b) { return a - b; }), wanted = expected.slice(0).sort(function (a, b) { return a - b; });
    var path = check.operation.propertyPath;
    if (check.exact && actual.length !== wanted.length) throw new Error("PROPERTY_WRITE_FAILED: " + path + " has " + actual.length + " key(s) after the edit, expected " + wanted.length);
    for (var i = 0; i < wanted.length; i += 1) {
        if (!aeKeyEditHasKeyNear(actual, wanted[i], check.tolerance)) throw new Error("PROPERTY_WRITE_FAILED: " + path + " has no key at " + wanted[i] + "s after the edit");
    }
}
function aeKeyEditRemove(property, positions) {
    for (var i = positions.length - 1; i >= 0; i -= 1) property.removeKey(positions[i] + 1);
}
function aeKeyEditDelete(property, operation, tolerance) {
    var records = aeKeyEditReadAll(property), picked = aeKeyEditSelect(operation, records, tolerance), before = aeKeyEditKeyTimes(property);
    aeKeyEditRemove(property, picked);
    if (property.numKeys !== records.length - picked.length) throw new Error("PROPERTY_WRITE_FAILED: keys were not removed from " + operation.propertyPath);
    var remaining = [], isPicked = {}, r;
    for (r = 0; r < picked.length; r += 1) isPicked[picked[r]] = true;
    for (r = 0; r < records.length; r += 1) if (!isPicked[r]) remaining.push(records[r].time);
    aeKeyEditAssertTimes(property, remaining, { tolerance: tolerance, operation: operation, exact: true });
    return { selected: picked.length, beforeTimes: before, afterTimes: aeKeyEditKeyTimes(property) };
}
function aeKeyEditShift(property, operation, tolerance) {
    var records = aeKeyEditReadAll(property), picked = aeKeyEditSelect(operation, records, tolerance), before = aeKeyEditKeyTimes(property),
      moved = [], kept = [], i;
    for (i = 0; i < records.length; i += 1) kept.push(records[i].time);
    for (i = 0; i < picked.length; i += 1) { moved.push(aeKeyEditNewTime(operation, records[picked[i]].time)); kept[picked[i]] = moved[i]; }
    if (aeKeyEditCollides(kept, tolerance)) throw new Error("KEY_TIME_COLLISION: the new times land two keys on the same frame; choose an offset or scale that keeps them apart");
    aeKeyEditRemove(property, picked);
    var restoreFailed = 0;
    for (i = 0; i < picked.length; i += 1) restoreFailed += aeKeyEditWrite(property, records[picked[i]], moved[i]);
    if (property.numKeys !== records.length) throw new Error("PROPERTY_WRITE_FAILED: " + operation.propertyPath + " has " + property.numKeys + " key(s) after the edit, expected " + records.length);
    aeKeyEditAssertTimes(property, kept, { tolerance: tolerance, operation: operation, exact: true });
    return aeKeyEditReportRestores({ selected: picked.length, beforeTimes: before, afterTimes: aeKeyEditKeyTimes(property), movedTo: moved }, restoreFailed);
}
function aeKeyEditSourceProperty(source) {
    var comp = aeOwnValue(aeApplyCreatedComps, source.compositionId) || aeApplyFindComp(source.compositionId);
    if (!comp) throw new Error("TARGET_NOT_FOUND: copy source composition " + source.compositionId);
    var layer = aeApplyCreatedLayers[source.compositionId + ":" + source.layerId] || aeApplyFindLayer(comp, source.layerId);
    if (!layer) throw new Error("TARGET_NOT_FOUND: copy source layer " + source.layerId);
    var property = aeApplyFindProperty(layer, source.propertyPath);
    if (!property) throw new Error("PROPERTY_NOT_FOUND: copy source " + source.propertyPath + " is not a property of that layer");
    return property;
}
function aeKeyEditCompatible(from, to) {
    var fromType = aeSafe(function () { return String(from.propertyValueType); }, "from"), toType = aeSafe(function () { return String(to.propertyValueType); }, "to");
    if (fromType !== toType) throw new Error("INVALID_VALUE: the source property holds a different kind of value than the target, so its keys cannot be copied");
    if (aeSafeGet(to, "canVaryOverTime", true) === false) throw new Error("PROPERTY_NOT_ANIMATABLE: " + to.name + " cannot take keyframes");
}
function aeKeyEditCopy(property, operation, tolerance) {
    var from = aeKeyEditSourceProperty(operation.source);
    aeKeyEditCompatible(from, property);
    if (aeSafeGet(from, "numKeys", 0) < 1) throw new Error("KEY_NOT_FOUND: copy source " + operation.source.propertyPath + " has no keyframes");
    var records = aeKeyEditReadAll(from), picked = aeKeyEditSelect(
      { times: operation.times, indices: operation.indices, propertyPath: operation.source.propertyPath }, records, tolerance),
        before = aeKeyEditKeyTimes(property), offset = operation.timeOffset || 0, i;
    if (operation.keyframeMode !== "merge") { var existing = []; for (i = 0; i < property.numKeys; i += 1) existing.push(i); aeKeyEditRemove(property, existing); }
    var restoreFailed = 0;
    for (i = 0; i < picked.length; i += 1) restoreFailed += aeKeyEditWrite(property, records[picked[i]], records[picked[i]].time + offset);
    var copied = [];
    for (i = 0; i < picked.length; i += 1) copied.push(records[picked[i]].time + offset);
    aeKeyEditAssertTimes(property, copied, { tolerance: tolerance, operation: operation, exact: operation.keyframeMode !== "merge" });
    return aeKeyEditReportRestores({ selected: picked.length, beforeTimes: before, afterTimes: aeKeyEditKeyTimes(property),
      sourceKeys: records.length }, restoreFailed);
}
function aeApplyStepEditKeyframes(run, operation, scope) {
    var property = aeApplyFindProperty(scope.layer, operation.propertyPath);
    aeKeyEditRequireKeyed(property, operation);
    var tolerance = aeKeyEditTolerance(scope.layer);
    var result = operation.action === "delete" ? aeKeyEditDelete(property, operation, tolerance) : (operation.action === "copy" ? aeKeyEditCopy(property, operation, tolerance) : aeKeyEditShift(property, operation, tolerance));
    run.touched.push(operation.operation);
    return aeKeyEditReportRestores({
        operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, propertyPath: operation.propertyPath, action: operation.action,
        selectedKeys: result.selected, beforeTimes: result.beforeTimes, afterTimes: result.afterTimes, movedTo: result.movedTo, afterKeys: aeSafeGet(property, "numKeys", 0), verification: "keyframe-edit-read-back"
    }, result.restoreFailed || 0);
}
AE_APPLY_LAYER_STEPS.edit_keyframes = aeApplyStepEditKeyframes;

// Source Text keys: each frame value is the text; the host writes it into the layer's own TextDocument so styling is untouched, and reads every key back.
function aeApplyIsSourceText(property) { return aeSafe(function () { return property.matchName === "ADBE Text Document"; }, false); }
function aeSourceTextFrameInvalid(frame, previous) { return !frame || typeof frame.value !== "string" || frame.value.length > 4096 || typeof frame.time !== "number" || !isFinite(frame.time) || frame.time < 0 || frame.time <= previous; }
function aeSourceTextFrames(operation) {
    var frames = operation.keyframes || [], previous = -1;
    if (!(frames instanceof Array) || frames.length < 1 || frames.length > 256) throw new Error("BOUNDS_EXCEEDED");
    for (var i = 0; i < frames.length; i += 1) {
        var frame = frames[i];
        if (aeSourceTextFrameInvalid(frame, previous)) throw new Error("INVALID_VALUE: Source Text keyframes need increasing times and a string value each");
        previous = frame.time;
    }
    return frames;
}
function aeSourceTextNormal(text) { return String(text).replace(/\r\n/g, "\r").replace(/\n/g, "\r"); }
function aeSourceTextWrite(property, frames) {
    for (var i = 0; i < frames.length; i += 1) {
        var document = property.value;
        document.text = frames[i].value;
        property.setValueAtTime(frames[i].time, document);
        var index = property.nearestKeyIndex(frames[i].time);
        aeSafe(function () { property.setInterpolationTypeAtKey(index, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD); return true; }, false);
    }
}
function aeSourceTextReadBack(property, frames) {
    for (var i = 0; i < frames.length; i += 1) {
        var index = property.nearestKeyIndex(frames[i].time), got = aeSafe(function () { return property.keyValue(index).text; }, null);
        if (got === null || aeSourceTextNormal(got) !== aeSourceTextNormal(frames[i].value) || Math.abs(property.keyTime(index) - frames[i].time) > 0.001) throw new Error("KEYFRAME_WRITE_FAILED: Source Text key " + (i + 1) + " did not read back as written");
    }
}
/** Writes Source Text keyframes. Returns {keyframes,keyframeMode,removedKeys}. */
function aeApplyAnimateSourceText(property, operation, mode) {
    var frames = aeSourceTextFrames(operation), existing = aeSafeGet(property, "numKeys", 0), removed = 0;
    if (existing > 0 && mode === "reject") throw new Error("CONFLICTING_KEYS: " + String(operation.propertyPath) + " already has " + existing + " keyframe(s); set keyframeMode to merge or replace.");
    if (mode === "replace" && existing > 0) { for (var k = existing; k >= 1; k -= 1) property.removeKey(k); removed = existing; }
    aeSourceTextWrite(property, frames);
    aeSourceTextReadBack(property, frames);
    return { keyframes: frames.length, keyframeMode: mode, removedKeys: removed };
}

AE_APPLY_VAL_RULES_LAYER.read_keyframes = aeApplyValSpecRule([["propertyPath", "str", 1, 1024], ["maxKeys", "integer", 1, 500, 1]]);
function aeKeyReadInterpolation(value) {
    if (typeof KeyframeInterpolationType === "undefined" || value === null || value === undefined) return null;
    var names = ["LINEAR", "BEZIER", "HOLD"];
    for (var i = 0; i < names.length; i += 1) {if (KeyframeInterpolationType[names[i]] === value
      || Number(KeyframeInterpolationType[names[i]]) === Number(value) || String(KeyframeInterpolationType[names[i]]) === String(value)) {return names[
        i];}}
    return null;
}
function aeKeyReadList(value) { var list = []; for (var i = 0; i < value.length && i < 16; i += 1) list.push(typeof value[i] === "number" ? value[i] : null); return list; }
function aeKeyReadObject(value) {
    var text = aeSafeGet(value, "text", undefined);
    if (typeof text === "string") return { text: text };
    var vertices = aeSafe(function () { return value.vertices.length; }, undefined);
    if (typeof vertices === "number") return { shapeVertices: vertices, closed: aeSafeGet(value, "closed", null) };
    return null;
}
function aeKeyReadValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
    if (aeIsArray(value)) return aeKeyReadList(value);
    return aeKeyReadObject(value);
}
function aeKeyReadSetTruthy(row, record, names, convert) { for (var i = 0; i < names.length; i += 1) {if (record[names[i]]) {row[names[i]] = convert
  ? aeKeyReadValue(record[names[i]]) : record[names[i]];}} }
function aeKeyReadSetDefined(row, record, names) { for (var i = 0; i < names.length; i += 1) {if (
  record[names[i]] !== null && record[names[i]] !== undefined) row[names[i]] = record[names[i]];} }
function aeKeyReadRow(record, index) {
    var row = { index: index + 1, time: record.time, value: aeKeyReadValue(record.value), inInterpolation: aeKeyReadInterpolation(record.inType),
      outInterpolation: aeKeyReadInterpolation(record.outType) };
    aeKeyReadSetTruthy(row, record, ["inEase", "outEase"], false);
    aeKeyReadSetDefined(row, record, ["temporalContinuous", "temporalAutoBezier", "roving"]);
    aeKeyReadSetTruthy(row, record, ["inTangent", "outTangent"], true);
    aeKeyReadSetDefined(row, record, ["spatialContinuous", "spatialAutoBezier"]);
    return row;
}
function aeApplyStepReadKeyframes(run, operation, scope) {
    var property = aeApplyFindProperty(scope.layer, operation.propertyPath);
    if (!property) throw new Error("PROPERTY_NOT_FOUND: " + operation.propertyPath + " is not a property of this layer");
    var total = aeSafeGet(property, "numKeys", 0), limit = operation.maxKeys === undefined ? 100 : operation.maxKeys, rows = [];
    for (var i = 1; i <= total && i <= limit; i += 1) rows.push(aeKeyReadRow(aeKeyEditRead(property, i), i - 1));
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, propertyPath: operation.propertyPath, totalKeys: total, keys: rows, truncated: total > limit, expressionEnabled: aeSafe(function () { return property.expressionEnabled === true; }, false), verification: "keyframes-read" };
}
AE_APPLY_LAYER_STEPS.read_keyframes = aeApplyStepReadKeyframes;
