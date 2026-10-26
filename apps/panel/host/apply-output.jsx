/* Apply: render output settings, Send to Media Encoder and destructive project cleanup. It sits under apply-flow.jsx. */
/* global aeApplyFindComp, aeApplyOutsideUndoGroup, aeApplyRenderRestoreFlags, aeApplyRenderStatusName, aeErrorText, aeHasOwn, aeListHas, aeSafe, aeSafeGet */
/* exported AE_OUTPUT_CLEANUP_MODES, AE_OUTPUT_MODULE_ROWS, AE_OUTPUT_RENDER_ROWS, aeOutputApplySettings, aeOutputAssertAccepted,
  aeOutputAssertMediaEncoder, aeOutputCleanup, aeOutputCleanupIdsValid, aeOutputSendToMediaEncoder, aeOutputSettingsValid */
var AE_OUTPUT_KEYS_SHOWN = 40;
var AE_OUTPUT_BLEND = ["On for Checked Layers", "Off for All Layers"];
function aeOutputSampleRateText(hertz) { return (hertz / 1000).toFixed(3) + " kHz"; }
function aeOutputBitDepthText(bits) { return bits + " Bit"; }
/** The output-module settings rows the output operations may write, with each row's accepted values. */
var AE_OUTPUT_MODULE_ROWS = [
    ["format", "Format"], ["videoCodec", "Video Codec"], ["videoOutput", "Video Output", null, "bool"], ["channels", "Channels", null, ["RGB", "RGB + Alpha", "Alpha"]], ["depth", "Depth"],
    ["resize.width", "Resize to", "Resize", "int"], ["resize.height", "Resize to", "Resize", "int"], ["resize.quality", "Resize Quality", "Resize", ["Low", "Medium", "High", "Best"]],
    ["crop.top", "Crop Top", "Crop", "crop"], ["crop.left", "Crop Left", "Crop", "crop"], ["crop.bottom", "Crop Bottom", "Crop", "crop"], ["crop.right", "Crop Right", "Crop", "crop"],
    ["audio.output", "Output Audio", null, ["Auto", "On", "Off"]], ["audio.sampleRate", "Audio Sample Rate", null, [22050, 32000, 44100, 48000, 96000], aeOutputSampleRateText], ["audio.bitDepth", "Audio Bit Depth", null, [8, 16], aeOutputBitDepthText], ["audio.channels", "Audio Channels", null, ["Mono", "Stereo"]]
];
/** The render-queue settings rows the output operations may write, with each row's accepted values. */
var AE_OUTPUT_RENDER_ROWS = [
    ["quality", "Quality", null, ["Best", "Draft", "Wireframe"]], ["resolution", "Resolution", null, ["Full", "Half", "Third", "Quarter"]], ["motionBlur", "Motion Blur", null, AE_OUTPUT_BLEND],
    ["frameBlending", "Frame Blending", null, AE_OUTPUT_BLEND], ["effects", "Effects", null, ["All On", "Current Settings", "All Off"]], ["timeSpan", "Time Span", null, ["Length of Comp", "Work Area Only"]]
];
/** The project cleanup modes the cleanup operation accepts. */
var AE_OUTPUT_CLEANUP_MODES = ["reduce", "remove_unused_footage", "consolidate_footage"];
var AE_OUTPUT_REMOVED_LIMIT = 200;

function aeOutputPick(requested, field) {
    var parts = field.split("."), value = requested;
    for (var i = 0; i < parts.length; i += 1) { if (!value || typeof value !== "object") return undefined; value = value[parts[i]]; }
    return value;
}
function aeOutputWholeNumber(value, min) { return typeof value === "number" && Math.floor(value) === value && value >= min && value <= 30000; }
function aeOutputRowValueValid(row, value) {
    var kind = row[3];
    if (kind === undefined) return typeof value === "string" && value.length >= 1 && value.length <= 64;
    if (kind === "bool") return typeof value === "boolean";
    if (kind === "int") return aeOutputWholeNumber(value, 1);
    return kind === "crop" ? aeOutputWholeNumber(value, 0) : aeListHas(kind, value);
}
function aeOutputKnownFields(requested, rows) {
    var known = {}, count = 0;
    for (var i = 0; i < rows.length; i += 1) { known[rows[i][0].split(".")[0]] = true; if (aeOutputPick(requested, rows[i][0]) !== undefined) count += 1; }
    for (var key in requested) if (Object.prototype.hasOwnProperty.call(requested, key) && !known[key]) return -1;
    return count;
}
function aeOutputValuesValid(requested, rows) {
    for (var i = 0; i < rows.length; i += 1) { var value = aeOutputPick(requested, rows[i][0]);
      if (value !== undefined && !aeOutputRowValueValid(rows[i], value)) return false; }
    return true;
}
function aeOutputResizeComplete(resize) { return resize === undefined || (resize.width !== undefined && resize.height !== undefined); }
/** True when the requested output settings object names known fields with valid values. */
function aeOutputSettingsValid(requested, rows) {
    if (!requested || typeof requested !== "object" || requested instanceof Array || aeOutputKnownFields(requested, rows) < 1) return false;
    return aeOutputValuesValid(requested, rows) && (rows !== AE_OUTPUT_MODULE_ROWS || aeOutputResizeComplete(requested.resize));
}
/** True when the mode's composition ids are valid (1 to 64 non-empty strings for reduce, absent otherwise). */
function aeOutputCleanupIdsValid(operation) {
    if (operation.mode !== "reduce") return operation.compositionIds === undefined;
    var ids = operation.compositionIds;
    if (!(ids instanceof Array) || ids.length < 1 || ids.length > 64) return false;
    for (var i = 0; i < ids.length; i += 1) if (typeof ids[i] !== "string" || ids[i].length < 1) return false;
    return true;
}

function aeOutputNormalise(value) {
    if (value === true) return "on";
    if (value === false) return "off";
    var text = String(value).toLowerCase();
    return text === "true" ? "on" : (text === "false" ? "off" : text);
}
function aeOutputLeadingNumber(value) { var match = /^[0-9]+(\.[0-9]+)?/.exec(String(value)); return match ? Number(match[0]) : null; }
function aeOutputSame(observed, requested) {
    if (typeof requested === "number") return Number(observed) === requested;
    var seenNumber = aeOutputLeadingNumber(observed), askedNumber = aeOutputLeadingNumber(requested);
    if (typeof requested === "string" && seenNumber !== null && askedNumber !== null) return seenNumber === askedNumber;
    return aeOutputNormalise(observed) === aeOutputNormalise(requested);
}
function aeOutputWrite(target, key, value) {
    var payload = {};
    payload[key] = value;
    try { target.setSettings(payload); return null; } catch (writeError) { return aeErrorText(writeError); }
}
function aeOutputAll(target) { return aeSafe(function () { return target.getSettings(GetSettingsFormat.STRING); }, null); }
function aeOutputRead(target, key) {
    var all = aeOutputAll(target);
    if (!aeHasOwn(all, key)) return { found: false, keys: all };
    return { found: true, value: all[key] };
}
function aeOutputUnreported(seen) {
    var names = [];
    if (seen.keys) for (var key in seen.keys) if (Object.prototype.hasOwnProperty.call(seen.keys, key) && names.length < AE_OUTPUT_KEYS_SHOWN) names.push(key);
    return "After Effects does not report this setting back for this output module" + (names.length ? " (it reports: " + names.join(", ") + ")" : "") + ".";
}
function aeOutputFieldReport(target, name, requested, convert) {
    var field = name.field, key = name.key;
    var written = convert ? convert(requested) : requested;
    var failure = aeOutputWrite(target, key, written);
    if (failure !== null) return { field: field, key: key, requested: requested, status: "refused", detail: "Refused by After Effects for this format: " + failure };
    var seen = aeOutputRead(target, key);
    if (!seen.found) return { field: field, key: key, requested: requested, status: "refused", detail: aeOutputUnreported(seen) };
    return { field: field, key: key, requested: requested, observed: seen.value, status: aeOutputSame(seen.value, written) ? "applied" : "adjusted" };
}
function aeOutputRefusedAll(rows, requested, detail) {
    var report = [];
    for (var i = 0; i < rows.length; i += 1) { var value = aeOutputPick(requested, rows[i][0]); if (value !== undefined) report.push({ field: rows[i][0], key: rows[i][1], requested: value, status: "refused", detail: detail }); }
    return report;
}
function aeOutputSizePair(value) {
    if (value && typeof value === "object") return [Number(value.x !== undefined ? value.x : value[0]), Number(value.y !== undefined ? value.y : value[1])];
    var numbers = String(value).match(/[0-9]+/g);
    return (numbers && numbers.length === 2) ? [Number(numbers[0]), Number(numbers[1])] : null;
}
function aeOutputSizeReport(field, requested, observed, detail) {
    if (observed === null) return { field: field, key: "Resize to", requested: requested, status: "refused", detail: detail };
    return { field: field, key: "Resize to", requested: requested, observed: observed, status: observed === requested ? "applied" : "adjusted" };
}
function aeOutputResizeObserved(target) {
    var seen = aeOutputRead(target, "Resize to");
    return seen.found ? aeOutputSizePair(seen.value) : null;
}
function aeOutputResizeToReports(target, resize) {
    var shapes = [[resize.width, resize.height], { x: resize.width, y: resize.height }], detail = "After Effects does not report Resize to back.", pair = null;
    for (var i = 0; i < shapes.length; i += 1) {
        var failure = aeOutputWrite(target, "Resize to", shapes[i]);
        if (failure !== null) { detail = "Refused by After Effects for this format: " + failure; continue; }
        pair = aeOutputResizeObserved(target);
        if (pair && pair[0] === resize.width && pair[1] === resize.height) break;
    }
    return [aeOutputSizeReport("resize.width", resize.width, pair ? pair[0] : null, detail), aeOutputSizeReport("resize.height", resize.height, pair ? pair[1] : null, detail)];
}
function aeOutputRowReports(target, row, requested, state) {
    var reports = [], enabler = row[2];
    if (enabler && !state.enabled[enabler]) {
        state.enabled[enabler] = true;
        reports.push(aeOutputFieldReport(target, { field: enabler.toLowerCase(), key: enabler }, true));
        if (enabler === "Resize") aeOutputWrite(target, "Lock Aspect Ratio", false);
    }
    if (row[0] === "resize.height") return reports;
    if (row[0] === "resize.width") return reports.concat(aeOutputResizeToReports(target, requested.resize));
    reports.push(aeOutputFieldReport(target, { field: row[0], key: row[1] }, aeOutputPick(requested, row[0]), row[4]));
    return reports;
}
function aeOutputApplyRows(target, rows, requested) {
    if (!target || typeof target.setSettings !== "function" || typeof target.getSettings !== "function") return aeOutputRefusedAll(rows, requested, "This After Effects version has no setSettings/getSettings here.");
    var report = [], state = { enabled: {} };
    for (var i = 0; i < rows.length; i += 1) {
        if (aeOutputPick(requested, rows[i][0]) !== undefined) report = report.concat(aeOutputRowReports(target, rows[i], requested, state));
    }
    return report;
}
function aeOutputPathReport(queueItem, operation) {
    var file = aeSafe(function () { return queueItem.outputModule(1).file; }, null);
    var observed = file ? String(aeSafeGet(file, "fsName", "")) : "";
    var same = observed.replace(/\\/g, "/").toLowerCase() === operation.outputPath.replace(/\\/g, "/").toLowerCase();
    return { field: "outputPath", key: "file", requested: operation.outputPath, observed: observed, status: same ? "applied" : "adjusted" };
}
/**
 * Output module fields, render settings fields and the output path, each with what was asked, what After Effects now
 * reports and a status. Each row is written alone and read straight back, so a key a build refuses is reported as that
 * one field instead of failing the whole object; width and height share the one "Resize to" key, and channels is read-
 * only to scripts in AE 26. Audio values keep plain numbers (hertz, bits) in the plan.
 */
function aeOutputApplySettings(queueItem, operation) {
    var outputModule = aeSafe(function () { return queueItem.outputModule(1); }, null);
    var output = operation.outputSettings ? aeOutputApplyRows(outputModule, AE_OUTPUT_MODULE_ROWS, operation.outputSettings) : [];
    var render = operation.renderSettings ? aeOutputApplyRows(queueItem, AE_OUTPUT_RENDER_ROWS, operation.renderSettings) : [];
    var path = aeOutputPathReport(queueItem, operation), all = output.concat(render, [path]), refused = [], adjusted = [];
    for (var i = 0; i < all.length; i += 1) { if (all[i].status === "refused") refused.push(all[i].field); if (all[i].status === "adjusted") adjusted.push(all[i].field); }
    return { fields: all, refused: refused, adjusted: adjusted };
}
// Nothing is rendered or sent on settings After Effects refused: the plan asked for those fields.
function aeOutputAssertAccepted(report) {
    if (report.refused.length > 0) throw new Error("RENDER_SETTINGS_REFUSED: After Effects refused " + report.refused.join(", ") + "; nothing was rendered or sent.");
}

function aeOutputMediaEncoderError(sendError) {
    var message = aeErrorText(sendError);
    var missing = /media encoder/i.test(message) && /(not|isn't|cannot|can't|unable|no )/i.test(message);
    return new Error((missing ? "MEDIA_ENCODER_NOT_INSTALLED: " : "MEDIA_ENCODER_FAILED: ") + message);
}
// Refused before a queue item is added, so a refused send leaves nothing in the render queue.
// queueInAME called from inside an apply crashed After Effects 26.5 on Windows (2026-10-12) while the same call from a plain script did not;
// on macOS it was measured working both ways, so only Windows is refused until that is understood.
function aeOutputAssertMediaEncoder(queue) {
    if (typeof queue.queueInAME !== "function") throw new Error("MEDIA_ENCODER_UNSUPPORTED: this After Effects version has no queueInAME.");
    if (typeof $ !== "undefined" && /windows/i.test(String($.os))) throw new Error("MEDIA_ENCODER_UNSUPPORTED: sending to Media Encoder from a plan crashed After Effects 26.5 on Windows, so it is refused there; use Composition > Add to Adobe Media Encoder Queue.");
}
/**
 * Queues the item in Adobe Media Encoder. Returns {queueItem,status:"sent-to-media-encoder",queueStatus,mediaEncoder};
 * throws on a refusal. A render queue handoff, run between the plan's undo groups like a local render.
 */
function aeOutputSendToMediaEncoder(queue, queueItem, flags, operation) {
    try {
        for (var index = 0; index < flags.length; index += 1) flags[index].item.render = false;
        queueItem.render = true;
        aeApplyOutsideUndoGroup(function () { queue.queueInAME(operation.mediaEncoder === "start"); });
    } catch (sendError) { throw aeOutputMediaEncoderError(sendError); }
    finally { aeApplyRenderRestoreFlags(flags); }
    return { queueItem: queueItem, status: "sent-to-media-encoder", queueStatus: aeApplyRenderStatusName(aeSafeGet(queueItem, "status", undefined)), mediaEncoder: operation.mediaEncoder };
}

function aeOutputCensus() {
    var items = {}, total = aeSafe(function () { return app.project.numItems; }, 0);
    for (var i = 1; i <= total; i += 1) {
        var item = aeSafe((function (at) { return function () { return app.project.item(at); }; })(i), null);
        if (item) items[String(item.id)] = { id: String(item.id), name: String(aeSafeGet(item, "name", "") || ""), type: String(aeSafeGet(item, "typeName", "") || "") };
    }
    return items;
}
function aeOutputKeptItems(compositionIds) {
    var kept = [];
    for (var i = 0; i < compositionIds.length; i += 1) { var comp = aeApplyFindComp(compositionIds[i]); if (!comp) throw new Error("TARGET_NOT_FOUND"); kept.push(comp); }
    return kept;
}
function aeOutputCleanupCall(operation) {
    var project = app.project;
    if (operation.mode === "reduce") return typeof project.reduceProject === "function" ? project.reduceProject(aeOutputKeptItems(operation.compositionIds)) : undefined;
    if (operation.mode === "remove_unused_footage") return typeof project.removeUnusedFootage === "function" ? project.removeUnusedFootage() : undefined;
    return typeof project.consolidateFootage === "function" ? project.consolidateFootage() : undefined;
}
function aeOutputRemovedList(before, after) {
    var removed = [];
    for (var id in before) if (Object.prototype.hasOwnProperty.call(before, id) && !after[id]) removed.push(before[id]);
    return removed;
}
/**
 * Runs the project cleanup (reduce or remove unused). Returns
 * {mode,hostReportedCount,removedCount,removed,removedTruncated,itemsBefore}; throws PROJECT_CLEANUP_FAILED or
 * PROJECT_CLEANUP_UNSUPPORTED. Lists the items before and after, so the receipt names what the call removed or merged.
 */
function aeOutputCleanup(operation) {
    var before = aeOutputCensus(), reported;
    try { reported = aeOutputCleanupCall(operation); } catch (cleanupError) { throw new Error("PROJECT_CLEANUP_FAILED: " + aeErrorText(cleanupError)); }
    if (reported === undefined) throw new Error("PROJECT_CLEANUP_UNSUPPORTED: this After Effects version has no " + operation.mode + " scripting call.");
    var removed = aeOutputRemovedList(before, aeOutputCensus());
    return { mode: operation.mode, hostReportedCount: typeof reported === "number" ? reported : null, removedCount: removed.length, removed: removed.slice(0, AE_OUTPUT_REMOVED_LIMIT), removedTruncated: removed.length > AE_OUTPUT_REMOVED_LIMIT, itemsBefore: aeOutputCount(before) };
}
function aeOutputCount(items) { var count = 0; for (var id in items) if (Object.prototype.hasOwnProperty.call(items, id)) count += 1; return count; }
