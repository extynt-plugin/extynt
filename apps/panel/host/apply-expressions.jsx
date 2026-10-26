/* Apply: expression writes, evaluation evidence and markers. It sits under apply-flow.jsx, which dispatches the
 * expression and marker operations here.
 */
/* global aeApplyExpressionProbe, aeApplyFindProperty, aeApplyWritableProperty, aeErrorTextShort, aeKeyValueText, aeSafe, aeSafeGet */
/* exported aeApplyIsCompositionMarker, aeApplyRemoveMarker, aeApplySetExpression, aeApplyWriteMarker */
function aeApplyWriteExpression(property, operation) {
    try { property.expression = operation.source; property.expressionEnabled = operation.enabled; } catch (expressionError) { throw new Error("EXPRESSION_WRITE_FAILED"); }
}
function aeApplyRestoreExpression(property, source, enabled) {
    return aeSafe(function () { property.expression = source; property.expressionEnabled = enabled; return String(property.expression) === source
      && property.expressionEnabled === enabled; }, false);
}
function aeApplyInvalidExpressionMessage(evaluationError, restored) {
    return "EXPRESSION_INVALID: " + evaluationError + (restored ? " (previous expression restored)" : " (EXPRESSION_RESTORE_FAILED)");
}
function aeApplyExpressionApi(property) { return typeof property.expression !== "undefined" && typeof property.expressionEnabled !== "undefined"; }
/**
 * Sets a property expression. Returns {enabled,expressionError,source,motion}. After Effects accepts a broken
 * expression and reports it only on evaluation, so a write never passes as applied while expressionError is set.
 * Motion is sampled at a fixed handful of bounded times, never per frame, and a failed sample read is reported rather
 * than thrown. Keyframe evidence is "unknown" unless the values prove the keys are dead.
 */
function aeApplySetExpression(layer, operation, comp) {
    var property = aeApplyFindProperty(layer, operation.propertyPath);
    if (!property) throw new Error("PROPERTY_NOT_FOUND");
    if (!aeApplyExpressionApi(property)) throw new Error("EXPRESSIONS_UNSUPPORTED");
    var previousSource = aeSafe(function () { return String(property.expression); }, ""), previousEnabled = aeSafe(function () { return property.expressionEnabled === true; }, false);
    aeApplyWriteExpression(property, operation);
    var evaluationError = (operation.enabled && operation.source) ? aeApplyExpressionEvaluationError(property) : "";
    if (evaluationError) {
        var restored = aeApplyRestoreExpression(property, previousSource, previousEnabled);
        throw new Error(aeApplyInvalidExpressionMessage(evaluationError, restored));
    }
    var motion = operation.enabled ? aeApplyExpressionMotion(property, comp, operation.source) : null;
    return { enabled: aeSafeGet(property, "expressionEnabled", false), expressionError: evaluationError, source: aeSafe(function () { return String(property.expression); }, null), motion: motion };
}
function aeApplyExpressionMotion(property, comp, source) { var motion = aeApplyExpressionMotionEvidence(property, comp);
  motion.probe = aeApplyExpressionProbe(property, source, aeApplyExpressionSampleTimes(property, comp)); return motion; }
function aeApplyExpressionEvaluationError(property) {
    aeSafe(function () { return property.valueAtTime(0, false); }, null);
    return aeSafe(function () { return typeof property.expressionError === "string" ? property.expressionError : ""; }, "").slice(0, 200);
}
function aeApplyExpressionBaseTimes(comp) {
    var duration = aeSafeGet(comp, "duration", 0);
    if (typeof duration === "number" && isFinite(duration) && duration > 0) return [0, duration / 4, duration / 2, duration * 3 / 4, duration];
    return [0];
}
function aeApplyExpressionKeyTimes(property) {
    var keyCount = aeSafeGet(property, "numKeys", 0), keyLimit = Math.min(keyCount, 3), times = [];
    for (var index = 1; index <= keyLimit; index += 1) times.push(aeSafe(function () { return property.keyTime(index); }, 0));
    return times;
}
function aeApplyTimeSeen(unique, time) {
    for (var seen = 0; seen < unique.length; seen += 1) if (Math.abs(unique[seen] - time) < 0.0005) return true;
    return false;
}
function aeApplyExpressionSampleTimes(property, comp) {
    var times = aeApplyExpressionBaseTimes(comp), unique = [], index;
    times = times.concat(aeApplyExpressionKeyTimes(property));
    for (index = 0; index < times.length; index += 1) {
        var time = times[index];
        if (typeof time !== "number" || !isFinite(time) || time < 0) continue;
        if (!aeApplyTimeSeen(unique, time)) unique.push(Math.round(time * 100000) / 100000);
    }
    return unique;
}
function aeApplyExpressionSample(property, time) {
    var value = aeSafe(function () { return property.valueAtTime(time, false); }, undefined);
    if (value === undefined) return null;
    var text = aeSafe(function () { return aeKeyValueText(value); }, null);
    if (text === null) return null;
    return { time: time, value: String(text).slice(0, 400), error: aeSafe(function () { return typeof property.expressionError === "string" ? property.expressionError : ""; }, "").slice(0, 200) };
}
function aeApplyExpressionKeyValues(property) {
    var count = aeSafeGet(property, "numKeys", 0), limit = Math.min(count, 3), times = [], valueTexts = [], distinct = false, index, other;
    for (index = 1; index <= limit; index += 1) {
        var time = aeSafe(function () { return property.keyTime(index); }, null);
        var text = aeSafe(function () { return aeKeyValueText(property.keyValue(index)); }, null);
        if (time === null || text === null || text === undefined) continue;
        times.push(time);
        valueTexts.push(String(text).slice(0, 400));
    }
    for (index = 0; index < valueTexts.length; index += 1) {for (other = index + 1; other < valueTexts.length; other += 1) {if (
      valueTexts[index] !== valueTexts[other]) distinct = true;}}
    return { count: count, sampled: valueTexts.length, times: times, valueTexts: valueTexts, distinct: distinct };
}
function aeApplyExpressionMatchedKeys(keyEvidence, samples) {
    var matched = [], index, other;
    for (index = 0; index < keyEvidence.times.length; index += 1) {
        for (other = 0; other < samples.length; other += 1) {if (Math.abs(samples[other].time - keyEvidence.times[index]) < 0.0005) {matched.push(
          { key: keyEvidence.valueTexts[index], value: samples[other].value });}}
    }
    return matched;
}
function aeApplyExpressionMatchesDiffer(matched) {
    for (var index = 0; index < matched.length; index += 1) {
        for (var other = index + 1; other < matched.length; other += 1) {
            if (matched[index].key !== matched[other].key && matched[index].value !== matched[other].value) return true;
        }
    }
    return false;
}
function aeApplyExpressionKeyEqualsValue(matched) {
    for (var index = 0; index < matched.length; index += 1) if (matched[index].key === matched[index].value) return true;
    return false;
}
var AE_APPLY_EXPRESSION_KEY_RULES = [
    [function (keys, matched) { return matched.length < 2; }, "unknown"],
    [function (keys, matched) { return aeApplyExpressionMatchesDiffer(matched); }, "referenced"],
    [function (keys, matched) { return keys.sampled !== keys.count; }, "unknown"],
    [function (keys, matched) { return aeApplyExpressionKeyEqualsValue(matched); }, "unknown"]
];
function aeApplyExpressionKeysReferenced(keyEvidence, samples) {
    if (!keyEvidence || keyEvidence.count < 2 || keyEvidence.distinct !== true) return "unknown";
    var matched = aeApplyExpressionMatchedKeys(keyEvidence, samples);
    for (var i = 0; i < AE_APPLY_EXPRESSION_KEY_RULES.length; i += 1) {if (
      AE_APPLY_EXPRESSION_KEY_RULES[i][0](keyEvidence, matched)) return AE_APPLY_EXPRESSION_KEY_RULES[i][1];}
    return "ignored";
}
function aeApplyExpressionMotionEvidence(property, comp) {
    var times = aeApplyExpressionSampleTimes(property, comp), samples = [], changes = false, misses = 0, reference = null, errorText = "", index;
    for (index = 0; index < times.length; index += 1) {
        var sample = aeApplyExpressionSample(property, times[index]);
        if (!sample) { misses += 1; continue; }
        if (sample.error && !errorText) errorText = sample.error;
        samples.push({ time: sample.time, value: sample.value });
        if (reference === null) { reference = sample.value; } else if (sample.value !== reference) { changes = true; }
    }
    var keys = aeApplyExpressionKeyValues(property);
    return { samples: samples, changes: changes, misses: misses, error: errorText, keys: keys.count, keyValues: keys.valueTexts,
      keysReferenced: aeApplyExpressionKeysReferenced(keys, samples) };
}
// A marker operation without a layerId writes the composition's own marker stream (CompItem.markerProperty).
function aeApplyIsCompositionMarker(operation) { return operation.layerId === undefined && (operation.operation === "add_marker" || operation.operation === "update_marker" || operation.operation === "remove_marker"); }
function aeApplyMarkerProperty(owner, operation) { return aeApplyIsCompositionMarker(operation) ? aeSafeGet(owner, "markerProperty", null) : aeApplyFindProperty(owner, "ADBE Marker"); }
function aeApplyMarkerKeyAtTime(property, time) { var count = aeSafeGet(property, "numKeys", 0); for (var markerIndex = 1; markerIndex <= count; markerIndex += 1) if (Math.abs(aeSafe(function () { return property.keyTime(markerIndex); }, -1) - time) < 0.000001) return markerIndex; return 0; }
var AE_APPLY_MARKER_FIELDS = ["comment", "duration", "chapter", "url", "cuePointName", "label"];
function aeApplyMarkerValue(operation, existing) {
    if (typeof MarkerValue === "undefined") throw new Error("MARKERS_UNSUPPORTED");
    var value = existing || new MarkerValue(operation.comment || "");
    for (var i = 0; i < AE_APPLY_MARKER_FIELDS.length; i += 1) {
        var field = AE_APPLY_MARKER_FIELDS[i];
        if (operation[field] !== undefined) value[field] = operation[field];
    }
    return value;
}
function aeApplyMarkerMatches(existing, operation) {
    if (!existing) return false;
    var fields = ["comment", "duration", "chapter", "url", "cuePointName", "label"];
    for (var i = 0; i < fields.length; i += 1) {
        var field = fields[i];
        if (operation[field] !== undefined && aeSafe(function () { return existing[field]; }, undefined) !== operation[field]) return false;
    }
    return true;
}
function aeApplyMarkerPreflight(property, operation) {
    var key = aeApplyMarkerKeyAtTime(property, operation.time);
    if (operation.operation === "add_marker" && key) {
        var existing = aeSafe(function () { return property.keyValue(key); }, null);
        if (aeApplyMarkerMatches(existing, operation)) return -key;
        var comment = existing ? String(aeSafeGet(existing, "comment", "")).slice(0, 80) : "";
        throw new Error("MARKER_EXISTS: a different marker (\"" + comment + "\") is already at " + operation.time + "s; use update_marker to change it");
    }
    if (operation.operation === "update_marker" && !key) throw new Error("MARKER_NOT_FOUND");
    return key;
}
function aeApplyReplaceMarker(property, operation, key, existing) {
    if (operation.operation === "update_marker" && typeof property.removeKey === "function") {
        try { property.removeKey(key); } catch (removeMarkerError) { throw new Error("MARKER_WRITE_FAILED: remove existing marker: " + aeErrorTextShort(removeMarkerError)); }
    }
    try { property.setValueAtTime(operation.time, aeApplyMarkerValue(operation, existing)); }
    catch (markerWriteError) { throw new Error("MARKER_WRITE_FAILED: time " + operation.time + ": " + aeErrorTextShort(markerWriteError)); }
}
/**
 * Adds or updates a marker. Returns {key[,alreadyPresent:true]}. An identical marker already present is left alone, so
 * undo has nothing to remove.
 */
function aeApplyWriteMarker(owner, operation) {
    var property = aeApplyMarkerProperty(owner, operation); if (!aeApplyWritableProperty(property, "setValueAtTime")) throw new Error("MARKERS_UNSUPPORTED: the marker stream was not writable on the target " + (aeApplyIsCompositionMarker(operation) ? "composition." : "layer."));
    var key = aeApplyMarkerPreflight(property, operation);
    if (key < 0) return { key: -key, alreadyPresent: true };
    var existing = key ? aeSafe(function () { return property.keyValue(key); }, null) : null;
    aeApplyReplaceMarker(property, operation, key, existing);
    return { key: aeApplyMarkerKeyAtTime(property, operation.time) };
}
/** Removes the marker at the operation's time. Returns nothing; throws Error(MARKERS_UNSUPPORTED or MARKER_NOT_FOUND). */
function aeApplyRemoveMarker(owner, operation) { var property = aeApplyMarkerProperty(owner, operation); if (!property || typeof property.removeKey !== "function") throw new Error("MARKERS_UNSUPPORTED"); var key = aeApplyMarkerKeyAtTime(property, operation.time); if (!key) throw new Error("MARKER_NOT_FOUND"); property.removeKey(key); }
