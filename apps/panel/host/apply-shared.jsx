/* Apply: per-call state, lookups and path/value predicates shared by every operation family. */
/* global aeEncodePathSegment, aeIsArray, aeSafe, aeSafeGet, aeSafeProperty */
/* exported aeApplyAnimatedInPlan, aeApplyForgetRun, aeApplyViewerSettled, aeApplyCreatedComps, aeApplyCreatedItems, aeApplyCreatedLayers,
   aeApplyEffectPathPrefix, aeApplyFindComp, aeApplyFindItem, aeApplyFindLayer, aeApplyFindProperty, aeApplyIsAbsolutePath, aeApplyIsFolder,
   aeApplyIsNewItemId, aeApplyIsRecordValue, aeApplyOtherSelections, aeApplyPathHasPrefix, aeApplyRequest, aeApplyResolvedControlPath,
   aeApplyResolvedEffectPath, aeApplySavedSelection, aeApplySelectionComp, aeApplyTextWriteFallbacks, aeApplyViewerMoved */
/** Per-call state of the apply in flight: the request, its metadata guard, text-write fallbacks, selection and viewer bookkeeping, and what the plan has
 * created so far. Reset by aeApplyForgetRun. */
var aeApplyRequest, aeApplyMetadataGuard, aeApplyTextWriteFallbacks, aeApplySelectionComp, aeApplySavedSelection, aeApplyViewerMoved,
  aeApplyOtherSelections, aeApplyCreatedLayers, aeApplyCreatedComps, aeApplyCreatedItems, aeApplyAnimatedInPlan;
function aeApplyItemById(id) { if (typeof app.project.itemByID !== "function" || !/^[0-9]{1,15}$/.test(String(id))) return null;
  var direct = aeSafe(function () { return app.project.itemByID(Number(id)); }, null); return (direct && String(aeSafeGet(direct, "id",
  "")) === String(id)) ? direct : null; }
/** Forgets everything the previous run left: its selection, viewer movement and the comps, layers and items it created. */
function aeApplyForgetRun() { aeApplySelectionComp = null; aeApplyOtherSelections = []; aeApplyViewerMoved = false; aeApplyCreatedComps = {};
  aeApplyCreatedLayers = {}; aeApplyCreatedItems = {}; }
/** Records that the viewer shows the composition the plan opened, so a later move is detected against it. */
function aeApplyViewerSettled() { aeApplyViewerMoved = false; }
/**
 * The project item with this id, or null. Looks up directly by itemByID where the host has it, and walks the project
 * for an id it does not answer.
 */
function aeApplyFindItem(id) { var byId = aeApplyItemById(id); if (byId) return byId;
  for (var itemIndex = 1; itemIndex <= app.project.numItems; itemIndex += 1) { var observedItem = app.project.item(itemIndex); if (observedItem
  && String(aeSafeGet(observedItem, "id", "")) === String(id)) return observedItem; } return null; }
/** The composition with this id (the metadata guard's map, itemByID, then a scan), or null. */
function aeApplyFindComp(id) { if (aeApplyMetadataGuard) return aeApplyMetadataGuard.comps["k:" + id] || null; var byId = aeApplyItemById(id); if (byId
  && byId instanceof CompItem) return byId; for (var i = 1; i <= app.project.numItems; i += 1) { var item = app.project.item(i);
  if (item instanceof CompItem && String(item.id) === id) return item; } return null; }
/** The layer of comp with this id, or null. */
function aeApplyFindLayer(comp, id) { if (!comp) return null;
  if (aeApplyMetadataGuard) return aeApplyMetadataGuard.layers["k:" + String(comp.id) + ":" + id] || null;
  for (var i = 1; i <= comp.numLayers; i += 1) if (String(comp.layer(i).id) === id) return comp.layer(i); return null; }
/** True when the item is a folder item. */
function aeApplyIsFolder(item) { return !!item && ((typeof FolderItem !== "undefined" && item instanceof FolderItem) || aeSafe(function () {
  return item.typeName === "Folder"; }, false)); }
/** True when the value is a "__new__:<name>" placeholder id. */
function aeApplyIsNewItemId(value) { return typeof value === "string" && /^__new__:[A-Za-z0-9._-]{1,128}$/.test(value); }
function aeApplyIsDriveLetter(code) { return (code >= 65 && code <= 90) || (code >= 97 && code <= 122); }
function aeApplyIsWindowsPath(value) {
    return value.length >= 3 && aeApplyIsDriveLetter(value.charCodeAt(0)) && value.charAt(1) === ":" && (value.charAt(2) === "/" || value.charAt(2) === "\\");
}
/**
 * True when the value is a string of 1 to 1024 characters that is a POSIX or Windows absolute path. Uses plain
 * character checks for the two absolute-path forms, because AE 26's ExtendScript parser rejects a regex character
 * class holding the Windows separator.
 */
function aeApplyIsAbsolutePath(value) {
    if (typeof value !== "string" || value.length < 1 || value.length > 1024) return false;
    return value.charAt(0) === "/" || aeApplyIsWindowsPath(value);
}
function aeApplyNthChild(current, count, wanted, ordinal) {
    for (var p = 1; p <= count; p += 1) {
        var candidate = aeSafeProperty(current, p);
        if (candidate && aeEncodePathSegment(aeSafeGet(candidate, "matchName", "")) === wanted) { ordinal -= 1; if (ordinal === 0) return candidate; }
    }
    return null;
}
function aeApplyFindSegment(current, segment) {
    var wanted = segment, ordinal = 1, hashAt = wanted.lastIndexOf("#"), count = aeSafeGet(current, "numProperties", 0);
    if (!wanted || wanted.indexOf("/") >= 0) return null;
    if (hashAt > 0 && /^[1-9][0-9]{0,3}$/.test(wanted.slice(hashAt + 1))) { ordinal = Number(wanted.slice(hashAt + 1)); wanted = wanted.slice(0, hashAt); }
    return aeApplyNthChild(current, count, wanted, ordinal);
}
/** The property at a "/"-separated path of match names or indices below group, or null. */
function aeApplyFindProperty(group, path) {
    if (aeApplyMetadataGuard && aeApplyMetadataGuard.blur
      && path === "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001") return aeApplyMetadataGuard.blurProperty;
    var segments = String(path).split("/"), current = group;
    if (segments.length < 1) return null;
    for (var s = 0; s < segments.length; s += 1) { current = aeApplyFindSegment(current, segments[s]); if (!current) return null; }
    return current;
}
/** True when path is a string that begins with prefix followed by "/". */
function aeApplyPathHasPrefix(path, prefix) { return typeof path === "string" && typeof prefix === "string" && path.indexOf(prefix + "/") === 0; }
function aeApplyExactEffectPath(operation) { return "ADBE Effect Parade/" + aeEncodePathSegment(operation.effectMatchName); }
function aeApplyRawEffectPath(operation) { return "ADBE Effect Parade/" + operation.effectMatchName; }
function aeApplyEffectOrdinalSuffix(operation) { var path = String(operation.effectPath),
  base = (path.indexOf(aeApplyExactEffectPath(operation)) === 0) ? aeApplyExactEffectPath(operation) : aeApplyRawEffectPath(operation);
  return path.slice(base.length); }
/** The escaped path the property tree actually uses, ordinal preserved. */
function aeApplyResolvedEffectPath(operation) { return aeApplyExactEffectPath(operation) + aeApplyEffectOrdinalSuffix(operation); }
/** A control path under an effect, with the effect segment escaped the way the property tree spells it. */
function aeApplyResolvedControlPath(operation) { var path = String(operation.propertyPath), raw = aeApplyRawEffectPath(operation);
  return (path.indexOf(raw + "/") === 0) ? aeApplyExactEffectPath(operation) + path.slice(raw.length) : path; }
function aeApplyEffectPathMatches(path, base) {
    if (path === base) return true;
    if (path.slice(0, base.length + 1) !== base + "#") return false;
    var ordinal = Number(path.slice(base.length + 1));
    return isFinite(ordinal) && Math.floor(ordinal) === ordinal && ordinal >= 2 && ordinal <= 128;
}
function aeApplyEffectPathValid(operation) {
    var path = operation.effectPath; if (typeof path !== "string") return false;
    return aeApplyEffectPathMatches(path, aeApplyExactEffectPath(operation)) || aeApplyEffectPathMatches(path, aeApplyRawEffectPath(operation));
}
/** The operation's effect path: its effectPath when valid, else the path built from the raw fields. */
function aeApplyEffectPathPrefix(operation) { return (typeof operation.effectPath === "string"
  && aeApplyEffectPathValid(operation)) ? operation.effectPath : aeApplyRawEffectPath(operation); }
/** True for a non-null object that is not an array; an array is recognised by its ES3 object tag, since parsed JSON arrays can come from another realm. */
function aeApplyIsRecordValue(value) { return !!value && typeof value === "object" && !aeIsArray(value); }
function aeApplyIsJsonArray(value) { for (var i = 0; i < value.length; i += 1) if (!aeApplyIsJsonValue(value[i])) return false; return true; }
function aeApplyIsJsonObject(value) { for (var key in value) if (value.hasOwnProperty(key) && !aeApplyIsJsonValue(value[key])) return false; return true; }
function aeApplyIsJsonValue(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return isFinite(value);
    if (value instanceof Array) return aeApplyIsJsonArray(value);
    return typeof value === "object" ? aeApplyIsJsonObject(value) : false;
}
