/* Apply: footage interpretation (read, write, read back) and scene edit detection. */
/* global AlphaMode, FieldSeparationType, FileSource, PulldownMethod, PulldownPhase, SceneEditDetectionMode, aeApplyFindProperty,
  aeApplyRequireFootage, aeSafe, aeSafeGet */
/* exported aeApplyDetectSceneEdits, aeApplySetFootageInterpretation, aeFootageInterpretation */
var AE_FOOTAGE_MEMBERS = {
    alphaMode: { ignore: "IGNORE", straight: "STRAIGHT", premultiplied: "PREMULTIPLIED" },
    fieldSeparationType: { off: "OFF", "upper-field-first": "UPPER_FIELD_FIRST", "lower-field-first": "LOWER_FIELD_FIRST" },
    removePulldown: { off: "OFF", WSSWW: "WSSWW", SSWWW: "SSWWW", SWWWS: "SWWWS", WWWSS: "WWWSS", WWSSW: "WWSSW" }
};
var AE_FOOTAGE_PULLDOWN_METHODS = { "pulldown-3-2": "PULLDOWN_3_2", "advance-24p": "ADVANCE_24P" };
var AE_SCENE_EDIT_MEMBERS = { markers: "MARKERS", split: "SPLIT", "split-precomp": "SPLIT_PRECOMP" };
var AE_SCENE_EDIT_REPORT_LIMIT = 200;
var AE_FOOTAGE_MOTION_ONLY = ["conformFrameRate", "loop", "fieldSeparationType", "highQualityFieldSeparation", "removePulldown", "guessPulldown", "resetFrameRate"];
var AE_FOOTAGE_ALPHA_ONLY = ["alphaMode", "invertAlpha", "guessAlpha"];
var AE_FOOTAGE_WRITE_ORDER = ["alphaMode", "premulColor", "invertAlpha", "conformFrameRate", "loop", "pixelAspect", "fieldSeparationType", "highQualityFieldSeparation", "removePulldown"];
function aeFootageEnum(key) {
    if (key === "alphaMode") return typeof AlphaMode === "undefined" ? null : AlphaMode;
    if (key === "removePulldown") return typeof PulldownPhase === "undefined" ? null : PulldownPhase;
    return typeof FieldSeparationType === "undefined" ? null : FieldSeparationType;
}
function aeFootageEnumName(key, value) {
    var enumObject = aeFootageEnum(key), members = AE_FOOTAGE_MEMBERS[key], name;
    if (!enumObject) return null;
    for (name in members) if (Object.prototype.hasOwnProperty.call(members, name) && enumObject[members[name]] === value) return name;
    return null;
}
function aeFootageEnumValue(key, name) {
    var enumObject = aeFootageEnum(key);
    return enumObject ? enumObject[AE_FOOTAGE_MEMBERS[key][name]] : undefined;
}
function aeFootageNumberList(value) {
    if (!value || typeof value.length !== "number") return null;
    var list = [], i;
    for (i = 0; i < value.length; i += 1) list.push(Number(value[i]));
    return list;
}
// The interpretation as the snapshot and the readback both see it; a field AE will not answer is left out, never guessed.
function aeFootageInterpretation(item) {
    var source = aeSafeGet(item, "mainSource", null), read = {};
    if (!source) return null;
    var keys = ["nativeFrameRate", "conformFrameRate", "displayFrameRate", "hasAlpha", "loop", "pixelAspect", "isStill", "invertAlpha", "highQualityFieldSeparation"], i;
    for (i = 0; i < keys.length; i += 1) {(function (key) { var value = aeSafe(function () { return source[key]; }, undefined);
      if (value !== undefined && value !== null) read[key] = value; })(keys[i]);}
    var alpha = aeFootageEnumName("alphaMode", aeSafeGet(source, "alphaMode", undefined));
    var fields = aeFootageEnumName("fieldSeparationType", aeSafeGet(source, "fieldSeparationType", undefined));
    var premul = aeFootageNumberList(aeSafeGet(source, "premulColor", null));
    if (alpha) read.alphaMode = alpha;
    var pulldown = aeFootageEnumName("removePulldown", aeSafeGet(source, "removePulldown", undefined));
    if (pulldown) read.removePulldown = pulldown;
    if (fields) read.fieldSeparationType = fields;
    if (premul && premul.length >= 3) read.premulColor = premul.slice(0, 3);
    return read;
}
function aeFootageSameValue(wanted, actual) {
    if (wanted instanceof Array) {
        if (!(actual instanceof Array) || actual.length !== wanted.length) return false;
        for (var i = 0; i < wanted.length; i += 1) if (Math.abs(wanted[i] - actual[i]) > 0.0001) return false;
        return true;
    }
    if (typeof wanted === "number") return typeof actual === "number" && Math.abs(wanted - actual) < 0.0001;
    return wanted === actual;
}
function aeFootageNamesAny(interpretation, fields) {
    for (var i = 0; i < fields.length; i += 1) if (interpretation[fields[i]] !== undefined) return true;
    return false;
}
function aeFootageRefuse(source, interpretation) {
    if (source.isStill === true && aeFootageNamesAny(interpretation, AE_FOOTAGE_MOTION_ONLY)) throw new Error("FOOTAGE_STILL_INTERPRETATION");
    if (source.hasAlpha === false && aeFootageNamesAny(interpretation, AE_FOOTAGE_ALPHA_ONLY)) throw new Error("ALPHA_MODE_UNAVAILABLE");
    if (typeof FileSource !== "undefined" && !(source instanceof FileSource)) throw new Error("FOOTAGE_SOURCE_UNSUPPORTED");
}
function aeFootageWriteField(source, key, value) {
    var written = AE_FOOTAGE_MEMBERS[key] ? aeFootageEnumValue(key, value) : value;
    if (written === undefined) throw new Error("INTERPRETATION_WRITE_FAILED");
    try { source[key] = written; } catch (writeError) { throw new Error("INTERPRETATION_WRITE_FAILED"); }
}
function aeFootageVerifyField(after, interpretation, key) {
    if (interpretation[key] === undefined || (key === "conformFrameRate" && interpretation[key] === 0)) return;
    if (!aeFootageSameValue(interpretation[key], after[key])) throw new Error("INTERPRETATION_READBACK_MISMATCH");
}
function aeFootageGuessPulldown(source, name) {
    var method = (typeof PulldownMethod !== "undefined") ? PulldownMethod[AE_FOOTAGE_PULLDOWN_METHODS[name]] : undefined;
    if (method === undefined) throw new Error("INTERPRETATION_WRITE_FAILED");
    try { source.guessPulldown(method); } catch (pulldownError) { throw new Error("INTERPRETATION_WRITE_FAILED"); }
}
function aeFootageResetFrameRate(source) {
    var nativeRate = aeSafeGet(source, "nativeFrameRate", 0);
    if (!(nativeRate > 0)) throw new Error("INTERPRETATION_WRITE_FAILED");
    aeFootageWriteField(source, "conformFrameRate", nativeRate);
    if (!aeFootageSameValue(nativeRate, aeSafeGet(source, "conformFrameRate", undefined))) throw new Error("INTERPRETATION_READBACK_MISMATCH");
}
function aeFootageRunCalls(source, interpretation) {
    if (interpretation.guessAlpha === true) { try { source.guessAlphaMode(); } catch (guessError) { throw new Error("INTERPRETATION_WRITE_FAILED"); } }
    if (interpretation.guessPulldown !== undefined) aeFootageGuessPulldown(source, interpretation.guessPulldown);
    if (interpretation.resetFrameRate === true) aeFootageResetFrameRate(source);
}
/**
 * Writes the interpretation fields. Returns {before,after}. guessAlpha, guessPulldown and resetFrameRate are calls run
 * first, and the readback reports what After Effects settled on; conformFrameRate 0 asks for the file's own rate and
 * is not compared.
 */
function aeApplySetFootageInterpretation(item, interpretation) {
    item = aeApplyRequireFootage(item);
    var source = aeSafeGet(item, "mainSource", null);
    if (!source) throw new Error("FOOTAGE_SOURCE_UNSUPPORTED");
    aeFootageRefuse(source, interpretation);
    var before = aeFootageInterpretation(item), i;
    aeFootageRunCalls(source, interpretation);
    for (i = 0; i < AE_FOOTAGE_WRITE_ORDER.length; i += 1) {if (interpretation[AE_FOOTAGE_WRITE_ORDER[i]] !== undefined) {aeFootageWriteField(
      source, AE_FOOTAGE_WRITE_ORDER[i], interpretation[AE_FOOTAGE_WRITE_ORDER[i]]);}}
    var after = aeFootageInterpretation(item) || {};
    for (i = 0; i < AE_FOOTAGE_WRITE_ORDER.length; i += 1) aeFootageVerifyField(after, interpretation, AE_FOOTAGE_WRITE_ORDER[i]);
    return { before: before, after: after };
}
function aeSceneEditMarkerTimes(layer) {
    var property = aeApplyFindProperty(layer, "ADBE Marker"), times = [], i;
    if (!property) return times;
    var count = aeSafeGet(property, "numKeys", 0);
    for (i = 1; i <= count; i += 1) times.push(Number(property.keyTime(i)));
    return times;
}
function aeSceneEditLayerIds(comp) {
    var ids = {}, i;
    for (i = 1; i <= comp.numLayers; i += 1) ids[String(comp.layer(i).id)] = true;
    return ids;
}
function aeSceneEditNewTimes(before, after) {
    var seen = {}, found = [], i;
    for (i = 0; i < before.length; i += 1) seen[String(before[i])] = true;
    for (i = 0; i < after.length; i += 1) if (seen[String(after[i])] !== true) found.push(after[i]);
    return found;
}
function aeSceneEditNewLayers(comp, before) {
    var found = [], i, layer;
    for (i = 1; i <= comp.numLayers; i += 1) { layer = comp.layer(i); if (before[String(layer.id)] !== true) found.push({ layerId: String(layer.id), name: String(aeSafeGet(layer, "name", "")), inPoint: Number(aeSafeGet(layer, "inPoint", 0)) }); }
    return found;
}
function aeSceneEditRefuse(layer, mode) {
    if (typeof layer.doSceneEditDetection !== "function" || typeof SceneEditDetectionMode === "undefined" || SceneEditDetectionMode[AE_SCENE_EDIT_MEMBERS[mode]] === undefined) throw new Error("SCENE_EDIT_UNSUPPORTED");
    if (aeSafeGet(layer, "timeRemapEnabled", false) === true) throw new Error("SCENE_EDIT_TIME_REMAPPED");
    var source = aeSafeGet(layer, "source", null);
    if (!source || aeSafeGet(layer, "hasVideo", true) === false || aeSafe(function () { return source.mainSource && source.mainSource.isStill; }, false) === true) throw new Error("SCENE_EDIT_NOT_VIDEO");
}
// The cuts are what the layer or comp gained: AE's own return value is not trusted, so the receipt diffs the project instead.
function aeApplyDetectSceneEdits(comp, layer, mode) {
    aeSceneEditRefuse(layer, mode);
    var markersBefore = aeSceneEditMarkerTimes(layer), layersBefore = aeSceneEditLayerIds(comp);
    try { layer.doSceneEditDetection(SceneEditDetectionMode[AE_SCENE_EDIT_MEMBERS[mode]]); } catch (detectError) { throw new Error("SCENE_EDIT_FAILED"); }
    var cuts = mode === "markers" ? aeSceneEditNewTimes(markersBefore, aeSceneEditMarkerTimes(layer)) : aeSceneEditNewLayers(comp, layersBefore);
    return { count: cuts.length, cuts: cuts.slice(0, AE_SCENE_EDIT_REPORT_LIMIT), truncated: cuts.length > AE_SCENE_EDIT_REPORT_LIMIT };
}
