/* Visual evidence adapter (frame capture to a local PNG) and plan undo. It sits beside the apply adapters and is
 * called through the bridge. Undo only presses Edit > Undo per group and is refused when the live stamp is unreadable
 * or changed.
 */
/* global aeCollectionSameStamp, aeEditFailure, aeEditFindComp, aeEditParse, aeEntryGuard, aeErrorTextShort, aeSafe, aeSafeGet */
/* exported aeCaptureFrame, aeDiscardCaptureFrame */
/* exported aeUndoPlan */
function aeCaptureOutputFiles(captureId) {
    var base = Folder.userData.fsName + "/extynt captures/" + captureId + ".png";
    return [new File(base), new File(base + ".png")];
}

function aeFindCaptureOutput(captureId) {
    var checks = 0;
    while (checks < 8) {
        var candidates = aeCaptureOutputFiles(captureId);
        if (candidates[0].exists) return { file: candidates[0], extensionAppended: false, checks: checks + 1 };
        if (candidates[1].exists) return { file: candidates[1], extensionAppended: true, checks: checks + 1 };
        checks += 1;
        if (checks < 8 && typeof $ !== "undefined" && $ && typeof $.sleep === "function") $.sleep(50);
    }
    return null;
}

var AE_CAPTURE_ID_PATTERN = /^[A-Za-z0-9._-]{1,96}$/;
function aeCaptureErrorNumber(error) { return (error && typeof error.number === "number") ? Math.max(-9999, Math.min(9999, Math.floor(error.number))) : -1; }
function aeCaptureIdValid(captureId) { return typeof captureId === "string" && AE_CAPTURE_ID_PATTERN.test(captureId); }
function aeCaptureCommandValid(request) {
    return !!request && request.operation === "capture_frame" && aeCaptureIdValid(request.captureId) && typeof request.compositionId === "string"
      && typeof request.time === "number" && typeof request.width === "number" && typeof request.height === "number" && request.format === "png";
}
function aeCaptureDimensionsInvalid(request) {
    return request.width < 16 || request.width > 4096 || request.height < 16 || request.height > 4096 || Math.floor(request.width) !== request.width
      || Math.floor(request.height) !== request.height;
}
function aeCaptureStorageNote(existedBefore, root) { return "storage=userData,parentExists=" + existedBefore + ",parentWritable=" + (root.readonly !== true); }
function aeCaptureRestoreFactor(comp, factor, changed) { return !changed || aeSafe(function () { comp.resolutionFactor = factor; return true; }, false); }
function aeCaptureReply(fields, restored) { if (!restored) fields.restoreFailed = true; return JSON.stringify(fields); }
function aeCaptureWaitForFile(captureId) {
    for (var waited = 0; waited < 8000 && !aeFindCaptureOutput(captureId); waited += 100) { if (typeof $ !== "undefined"
      && typeof $.sleep === "function") $.sleep(100); else break; }
    if (typeof $ !== "undefined" && typeof $.sleep === "function") $.sleep(150);
}
function aeCaptureLowerFactor(comp, factorBefore) {
    if (!factorBefore || (factorBefore[0] === 1 && factorBefore[1] === 1)) return false;
    return aeSafe(function () { comp.resolutionFactor = [1, 1]; return true; }, false);
}
function aeCapturePendingResult(request, comp, restored) {
    var pending = aeCaptureOutputFiles(request.captureId);
    return aeCaptureReply({ ok: true, operation: "capture_frame", captureId: request.captureId, compositionId: request.compositionId,
      time: request.time, width: comp.width, height: comp.height, format: "png", storage: "userData", fileExists: false, pending: true,
      localPath: pending[0].fsName, alternatePath: pending[1].fsName, providerShared: false }, restored);
}
function aeCaptureSave(request, comp) {
    var root = new Folder(Folder.userData.fsName + "/extynt captures");
    var existedBefore = root.exists;
    if (!root.exists && !root.create()) {return aeEditFailure("CAPTURE_OUTPUT_UNAVAILABLE",
      "A local app-data capture directory could not be created (storage=userData,parentExists=false).");}
    var output = aeCaptureOutputFiles(request.captureId)[0];
    var factorBefore = request.keepResolution === true ? null : aeSafeGet(comp, "resolutionFactor", null), factorChanged = aeCaptureLowerFactor(comp,
      factorBefore);
    var restored = true;
    try { comp.saveFrameToPng(request.time, output); if (factorChanged) aeCaptureWaitForFile(request.captureId);
      restored = aeCaptureRestoreFactor(comp, factorBefore, factorChanged); } catch (writeError) { var writeRestored = aeCaptureRestoreFactor(comp,
      factorBefore, factorChanged); var writeNumber = aeCaptureErrorNumber(writeError); return aeEditFailure("CAPTURE_WRITE_FAILED",
      "After Effects could not write PNG evidence (" + aeCaptureStorageNote(existedBefore,
      root) + ",outputExists=false,exception=" + writeNumber + (writeRestored ? "" : ",resolutionRestoreFailed=true") + ")."); }
    var completedOutput = aeFindCaptureOutput(request.captureId);
    if (!completedOutput) return aeCapturePendingResult(request, comp, restored);
    return aeCaptureReply({ ok: true, operation: "capture_frame", captureId: request.captureId, compositionId: request.compositionId,
      time: request.time, width: comp.width, height: comp.height, format: "png", storage: "userData", fileExists: true,
      extensionAppended: completedOutput.extensionAppended, localPath: completedOutput.file.fsName, providerShared: false }, restored);
}
function aeCaptureComposition(request) {
    var comp = aeEditFindComp(request.compositionId);
    if (!comp) return aeEditFailure("TARGET_NOT_FOUND", "Composition target was not found.");
    if (request.width !== comp.width || request.height !== comp.height) {return aeEditFailure("NATIVE_SIZE_REQUIRED",
      "saveFrameToPng captures the composition at its native dimensions.");}
    if (request.time < 0 || request.time > comp.duration) return aeEditFailure("INVALID_VALUE", "Capture time must be inside the composition duration.");
    return aeCaptureSave(request, comp);
}
/**
 * Renders one PNG frame to local storage. Takes the capture command JSON; returns the capture success JSON, or
 * {ok:false,error:{code,message}} with INVALID_COMMAND, INVALID_VALUE, NO_PROJECT or CAPTURE_FAILED. The destination
 * is never supplied by the panel: both candidate file names derive from the validated capture id, in AE's own user-
 * data folder. The frame is taken at full resolution and the preview setting restored once the file is complete,
 * except for a keepResolution thumbnail, which leaves it alone. A file not yet seen is pending, not failed. When the
 * preview setting cannot be restored, the success reply carries restoreFailed:true.
 */
function aeCaptureFrame(raw) {
    var parsed = aeEditParse(raw);
    if (!parsed) return aeEditFailure("INVALID_COMMAND", "Command was not valid JSON.");
    var request = parsed.request;
    if (!aeCaptureCommandValid(request)) return aeEditFailure("INVALID_COMMAND", "Only bounded PNG capture commands are accepted.");
    if (aeCaptureDimensionsInvalid(request)) return aeEditFailure("INVALID_VALUE", "Capture dimensions must be bounded integers.");
    if (!app.project) return aeEditFailure("NO_PROJECT", "No project is open.");
    try { return aeCaptureComposition(request); } catch (error) { return aeEditFailure("CAPTURE_FAILED",
      "After Effects could not create local PNG evidence (storage=userData,exception=" + aeCaptureErrorNumber(error) + ")."); }
}

function aeUndoCommandValid(request) {
    return !!request && request.operation === "undo_plan" && typeof request.undoGroup === "string"
      && /^extynt \u2014 [A-Za-z0-9._:-]{1,128}( \(\d{1,3}\/\d{1,3}\))?$/.test(request.undoGroup);
}
function aeUndoTimes(request) {
    return (typeof request.times === "number" && request.times >= 1 && request.times <= 1000
      && Math.floor(request.times) === request.times) ? request.times : 1;
}
function aeUndoStampField(value) { return value === null || typeof value === "number"; }
function aeUndoStampShapeValid(stamp) {
    if (stamp === undefined) return true;
    return !!stamp && typeof stamp === "object" && !(stamp instanceof Array) && aeUndoStampField(stamp.epoch) && aeUndoStampField(stamp.revision);
}
function aeUndoStampCurrent(stamp) {
    if (stamp === undefined) return true;
    try { return aeCollectionSameStamp(stamp); } catch (ignored) { return false; }
}
function aeUndoPress(times) {
    var undone = 0;
    for (var pass = 0; pass < times; pass += 1) {
        try { app.executeCommand(16); undone += 1; } catch (executeError) { return { undone: undone, failed: true, error: executeError }; }
    }
    return { undone: undone, failed: false, error: null };
}
function aeUndoPlanRun(raw) {
    var parsed = aeEditParse(raw);
    if (!parsed) return aeEditFailure("INVALID_COMMAND", "Command was not valid JSON.");
    var request = parsed.request;
    if (!aeUndoCommandValid(request)) return aeEditFailure("INVALID_COMMAND", "Only a bounded agent undo group can be undone.");
    if (!aeUndoStampShapeValid(request.expectedStamp)) return aeEditFailure("INVALID_COMMAND", "expectedStamp must be an object with epoch and revision.");
    if (!aeUndoStampCurrent(request.expectedStamp)) {return aeEditFailure("UNDO_PROJECT_CHANGED",
      "The project changed since the stamp was taken; nothing was undone.");}
    var pressed = aeUndoPress(aeUndoTimes(request));
    if (pressed.failed && pressed.undone === 0) return aeEditFailure("UNDO_FAILED", aeErrorTextShort(pressed.error));
    return JSON.stringify({ ok: true, operation: "undo_plan", planId: String(request.planId || "").slice(0, 128), method: "edit-undo", times: pressed.undone });
}
/** Runs `times` (default 1) Edit > Undo steps for one bounded agent undo group, only while the project still matches `expectedStamp`. Takes the
 * undo_plan command JSON; returns {ok:true,operation:"undo_plan",planId,method:"edit-undo",times}, or {ok:false,error:{code,message}} with
 * INVALID_COMMAND, UNDO_PROJECT_CHANGED or UNDO_FAILED; an escaped error returns HOST_SCRIPT_ERROR. */
function aeUndoPlan(raw) { return aeEntryGuard(aeUndoPlanRun)(raw); }
/**
 * Deletes a capture's temporary files. Returns JSON {ok:true,operation:"discard_capture_frame",captureId}, or
 * {ok:false,error:{code,message}} with INVALID_COMMAND or CAPTURE_CLEANUP_FAILED. Removes only the exact host-created
 * capture path derived from a bounded id.
 */
function aeDiscardCaptureFrame(raw) {
    var request; try { request = JSON.parse(raw); } catch (ignored) { return JSON.stringify({ ok: false, error: { code: "INVALID_COMMAND",
      message: "Command was not valid JSON." } }); }
    if (!request || request.operation !== "discard_capture_frame" || !aeCaptureIdValid(request.captureId)) {return JSON.stringify({ ok: false, error: {
      code: "INVALID_COMMAND", message: "Only bounded capture cleanup commands are accepted." } });}
    try {
        var outputs = aeCaptureOutputFiles(request.captureId);
        for (var i = 0; i < outputs.length; i += 1) if (outputs[i].exists) outputs[i].remove();
        return JSON.stringify({ ok: true, operation: "discard_capture_frame", captureId: request.captureId });
    } catch (error) { return JSON.stringify({ ok: false, error: { code: "CAPTURE_CLEANUP_FAILED",
      message: "Temporary capture cleanup could not be completed." } }); }
}
