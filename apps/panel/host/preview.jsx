/* Effect-control preview adapter: sets chosen values, saves frames, restores the control. It sits beside evidence.jsx,
 * whose aeCaptureFrame it reuses. The run is one undo group named "extynt preview" and restores the control in a
 * finally, reporting an inexact restore as unresolved.
 */
/* global aeAllFinite, aeCaptureFrame, aeEncodePathSegment, aeEntryGuard, aeErrorTextShort, aeIsArray, aeIsFiniteNumber, aeSafe, aeSafeGet, aeSafeProperty */
/* exported aePreviewControlValues */
var AE_PREVIEW_UNDO_GROUP = "extynt preview";
function aePreviewCopy(value) {
    if (typeof value === "number") return aeIsFiniteNumber(value) ? value : null;
    return (aeIsArray(value) && value.length >= 2 && value.length <= 4 && aeAllFinite(value)) ? value.slice(0) : null;
}
function aePreviewListsEqual(left, right) {
    if (left.length !== right.length) return false;
    for (var i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
    return true;
}
function aePreviewSame(left, right) {
    if (typeof left === "number" || typeof right === "number") return typeof left === "number" && typeof right === "number" && left === right;
    return aeIsArray(left) && aeIsArray(right) && aePreviewListsEqual(left, right);
}
function aePreviewRefusal(code, message) {
    return JSON.stringify({ ok: false, operation: "preview_control_values", mayHaveMutated: false, mutationState: "not-applied", error: { code: code, message: message } });
}
function aePreviewIdOk(value, max) { return typeof value === "string" && value.length >= 1 && value.length <= max && /^[A-Za-z0-9._-]+$/.test(value); }
function aePreviewRequestShape(request) {
    return !!request && request.operation === "preview_control_values" && typeof request.compositionId === "string" && typeof request.layerId === "string" && typeof request.effectMatchName === "string" && typeof request.propertyPath === "string" && request.undoGroup === AE_PREVIEW_UNDO_GROUP;
}
function aePreviewCaptureOk(capture) {
    return !!capture && aePreviewIdOk(capture.idPrefix, 64) && typeof capture.time === "number" && typeof capture.width === "number" && typeof capture.height === "number";
}
function aePreviewCandidatesOk(candidates) {
    if (!aeIsArray(candidates) || candidates.length < 1 || candidates.length > 4) return false;
    for (var i = 0; i < candidates.length; i += 1) if (!candidates[i] || !aePreviewIdOk(candidates[i].id, 24)) return false;
    return true;
}
function aePreviewRequest(raw) {
    var request; try { request = JSON.parse(raw); } catch (ignored) { return null; }
    if (!aePreviewRequestShape(request)) return null;
    if (!aePreviewCaptureOk(request.capture)) return null;
    if (!aePreviewCandidatesOk(request.candidates)) return null;
    return request;
}
function aePreviewSegment(wanted) {
    var hashAt = wanted.lastIndexOf("#");
    if (hashAt > 0 && /^[1-9][0-9]{0,3}$/.test(wanted.slice(hashAt + 1))) return { name: wanted.slice(0, hashAt), ordinal: Number(wanted.slice(hashAt + 1)) };
    return { name: wanted, ordinal: 1 };
}
function aePreviewChild(parent, segment, count) {
    var ordinal = segment.ordinal;
    for (var p = 1; p <= count; p += 1) {
        var candidate = aeSafeProperty(parent, p);
        if (candidate && aeEncodePathSegment(aeSafeGet(candidate, "matchName", "")) === segment.name) { ordinal -= 1; if (ordinal === 0) return candidate; }
    }
    return null;
}
function aePreviewFindProperty(layer, path) {
    var segments = String(path).split("/"), current = layer;
    for (var s = 0; s < segments.length; s += 1) {
        var wanted = segments[s], count = aeSafeGet(current, "numProperties", 0);
        if (!wanted) return null;
        var found = aePreviewChild(current, aePreviewSegment(wanted), count);
        if (!found) return null;
        current = found;
    }
    return current;
}
function aePreviewFindComp(compositionId) {
    var comp = null;
    for (var i = 1; i <= app.project.numItems && !comp; i += 1) {
      var item = app.project.item(i); if (item instanceof CompItem && String(item.id) === compositionId) comp = item; }
    return comp;
}
function aePreviewFindLayer(comp, layerId) {
    var layer = null;
    for (var j = 1; j <= comp.numLayers && !layer; j += 1) if (String(comp.layer(j).id) === layerId) layer = comp.layer(j);
    return layer;
}
function aePreviewPropertyRefusal(property) {
    if (aeSafeGet(property, "numKeys", 0) > 0 || aeSafe(function () { return property.expressionEnabled === true; }, false)) return aePreviewRefusal("PROPERTY_NOT_STATIC", "The control has keyframes or an expression, so one value cannot stand for it.");
    if (aeSafe(function () { return property.canSetValue === false; }, false)) return aePreviewRefusal("PROPERTY_NOT_SETTABLE", "After Effects reports this control is not settable.");
    return null;
}
function aePreviewTarget(request) {
    var comp = aePreviewFindComp(request.compositionId);
    if (!comp) return { refusal: aePreviewRefusal("TARGET_NOT_FOUND", "Composition target was not found.") };
    var layer = aePreviewFindLayer(comp, request.layerId);
    if (!layer) return { refusal: aePreviewRefusal("TARGET_NOT_FOUND", "Layer target was not found.") };
    if (layer.locked) return { refusal: aePreviewRefusal("TARGET_LOCKED", "The target layer is locked.") };
    var property = aePreviewFindProperty(layer, request.propertyPath);
    if (!property) return { refusal: aePreviewRefusal("PROPERTY_NOT_FOUND", "The control was not found on the layer.") };
    var refusal = aePreviewPropertyRefusal(property);
    if (refusal) return { refusal: refusal };
    return { comp: comp, layer: layer, property: property };
}
function aePreviewSameShape(value, original) {
    if (value === null) return false;
    return typeof value === "number" ? typeof original === "number" : (aeIsArray(original) && value.length === original.length);
}
function aePreviewShaped(candidate, original) {
    var value = aePreviewCopy(candidate);
    if (aeIsArray(value) && value.length === 3 && aeIsArray(original) && original.length === 4) value = [value[0], value[1], value[2], 1];
    return aePreviewSameShape(value, original) ? value : null;
}
function aePreviewValues(candidates, original) {
    var values = [];
    for (var i = 0; i < candidates.length; i += 1) {
        var value = aePreviewShaped(candidates[i].value, original);
        if (value === null) return { refusal: aePreviewRefusal("INVALID_VALUE", "A candidate value does not have the shape of the control's current value.") };
        values.push(value);
    }
    return { values: values };
}
function aePreviewCapture(request, id) {
    var out = null;
    try { out = JSON.parse(aeCaptureFrame(JSON.stringify({ operation: "capture_frame", captureId: request.capture.idPrefix + "-" + id, compositionId: request.compositionId, time: request.capture.time, width: request.capture.width, height: request.capture.height, format: "png" }))); } catch (ignored) { out = null; }
    return out;
}
function aePreviewStep(request, property, step, progress) {
    var id = request.candidates[step.index].id, value = step.value, frame = { id: id, ok: false, shown: null };
    if (!aePreviewSame(value, aePreviewCopy(aeSafeGet(property, "value", null)))) { progress.wrote = true; property.setValue(value); }
    frame.shown = aePreviewCopy(aeSafeGet(property, "value", null));
    var saved = aePreviewCapture(request, id);
    if (saved && saved.ok === true && typeof saved.localPath === "string") { frame.ok = true; frame.captureId = saved.captureId; frame.localPath = saved.localPath; }
    else frame.error = { code: (saved && saved.error && typeof saved.error.code === "string") ? saved.error.code : "CAPTURE_FAILED" };
    return frame;
}
function aePreviewRestore(property, original, wrote) {
    var restoreError = null;
    if (wrote && !aePreviewSame(original, aePreviewCopy(aeSafeGet(property, "value", null)))) { try { property.setValue(original); } catch (error) { restoreError = aeErrorTextShort(error); } }
    var value = aePreviewCopy(aeSafeGet(property, "value", null));
    return { restored: restoreError === null && aePreviewSame(original, value), value: value, error: restoreError };
}
function aePreviewCandidates(request, target, values, run) {
    try {
        for (var i = 0; i < values.length; i += 1) run.frames.push(aePreviewStep(request, target.property, { index: i, value: values[i] }, run.progress));
    } catch (error) {
        run.failure = { code: "PREVIEW_FAILED", message: aeErrorTextShort(error) };
    }
}
function aePreviewReport(request, original, run) {
    var back = run.back;
    return JSON.stringify({ ok: run.failure === null && back.restored, operation: "preview_control_values", compositionId: request.compositionId, layerId: request.layerId, propertyPath: request.propertyPath, original: original, restored: back.restored, restoredValue: back.value, frames: run.frames, mayHaveMutated: run.progress.wrote, mutationState: back.restored ? (run.progress.wrote ? "restored" : "not-applied") : "unknown", undoGroup: AE_PREVIEW_UNDO_GROUP, error: run.failure });
}
function aePreviewRun(request, target, original, values) {
    var run = { frames: [], failure: null, progress: { wrote: false }, back: null };
    app.beginUndoGroup(AE_PREVIEW_UNDO_GROUP);
    try {
        aePreviewCandidates(request, target, values, run);
    } finally {
        run.back = aePreviewRestore(target.property, original, run.progress.wrote);
        try { app.endUndoGroup(); } catch (ignoredEnd) {}
    }
    if (run.back.error && !run.failure) run.failure = { code: "RESTORE_FAILED", message: run.back.error };
    return aePreviewReport(request, original, run);
}
function aePreviewControlValuesRun(raw) {
    var request = aePreviewRequest(raw);
    if (!request) return aePreviewRefusal("INVALID_COMMAND", "Only the typed preview_control_values command is accepted.");
    if (!app.project) return aePreviewRefusal("NO_PROJECT", "No project is open.");
    var target = aePreviewTarget(request);
    if (target.refusal) return target.refusal;
    var original = aePreviewCopy(aeSafe(function () { return target.property.value; }, null));
    if (original === null) return aePreviewRefusal("PROPERTY_NOT_NUMERIC", "The control does not hold a number or a short list of numbers.");
    var wanted = aePreviewValues(request.candidates, original);
    if (wanted.refusal) return wanted.refusal;
    return aePreviewRun(request, target, original, wanted.values);
}
/**
 * Previews one static effect control at the requested candidate values, saves a frame for each,
   then restores the control inside one undo group named "extynt preview". Takes the preview_control_values command JSON.
 * Returns {ok,operation:"preview_control_values",compositionId,layerId,propertyPath,original,restored,restoredValue,
   frames:[{id,ok,shown,captureId?,localPath?,error?:{code}}],mayHaveMutated,mutationState:"not-applied"|"restored"|"unknown",undoGroup,error:null|{
     code,message}} with error.code PREVIEW_FAILED or RESTORE_FAILED on a part-way failure.
 * The restore runs in a finally, and an inexact restore is reported as mutationState "unknown",
   never as success. A refusal before the first write has the same envelope with ok:false, mayHaveMutated:false,
     mutationState "not-applied" and error.code INVALID_COMMAND, NO_PROJECT, TARGET_NOT_FOUND, TARGET_LOCKED, PROPERTY_NOT_FOUND, PROPERTY_NOT_STATIC,
       PROPERTY_NOT_SETTABLE, PROPERTY_NOT_NUMERIC or INVALID_VALUE.
 * An escaped error returns {ok:false,error:{code:"HOST_SCRIPT_ERROR",message}}.
 */
function aePreviewControlValues(raw) { return aeEntryGuard(aePreviewControlValuesRun)(raw); }

