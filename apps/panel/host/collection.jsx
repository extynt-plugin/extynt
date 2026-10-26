/* Entry file for the read-only collection pages, loaded by probe.jsx through $.evalFile; the collection-*.jsx parts
 * load after it and hold the pages. It holds the cached host objects and shared helpers for one replaceable session,
 * and pages are observations, never an atomic snapshot or write authorization.
 */
/* global __extyntProjectEpoch, aeHostDirectory, aeHostLoadFailed */
/* exported aeCollectionActiveCompositionId, aeCollectionCompInfo, aeCollectionDetailSession, aeCollectionNotOrdinal, aeCollectionPageSize,
   aeCollectionPulse, aeCollectionReadRequest, aeCollectionRefusal, aeCollectionRuntimeInfo, aeCollectionSameStamp, aeCollectionSameValues,
   aeCollectionSequence, aeCollectionSession, aeCollectionValueSession */
/** The cached host objects of the current collection session, or null when none is open. */
var aeCollectionSession = null;
/** The open properties-detail session (one layer's resumable walk), or null. */
var aeCollectionDetailSession = null;
/** The open value-read session, or null. */
var aeCollectionValueSession = null;
/** The counter that numbers value-read sessions, giving each its "value-<n>" id. */
var aeCollectionSequence = 0;
/** Refusal reply. Returns JSON {ok:false,error:{code[,detail]}}. */
function aeCollectionRefusal(code, detail) { return JSON.stringify({ ok: false, error: detail ? { code: code, detail: detail } : { code: code } }); }
/** The parsed request, or null unless it is a 0.1 request with a request id (non-empty when requireId). */
function aeCollectionReadRequest(raw, requireId) {
    var request;
    try { request = JSON.parse(raw); } catch (ignored) { return null; }
    if (!request || request.schemaVersion !== "0.1" || typeof request.requestId !== "string" || request.requestId.length > 128) return null;
    if (requireId && !request.requestId) return null;
    return request;
}
/** True unless the value is an integer number of at least 1; the upper limit is the caller's check, so it is read only when needed. */
function aeCollectionNotOrdinal(value) { return typeof value !== "number" || Math.floor(value) !== value || value < 1; }
function aeCollectionSameMembers(a, b) {
    var key;
    for (key in a) if (a.hasOwnProperty(key) && !(b.hasOwnProperty(key) && aeCollectionSameValues(a[key], b[key]))) return false;
    for (key in b) if (b.hasOwnProperty(key) && !a.hasOwnProperty(key)) return false;
    return true;
}
/**
 * True when two values are equal: numbers within 1e-4 absolute and relative (AE stores controls as 32-bit floats),
 * objects and arrays member by member. A cached host object dies when its project closes and comparing it then throws,
 * so a dead or unreadable object is simply not the same.
 */
function aeCollectionSameValues(a, b) {
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(a), Math.abs(b));
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
    return aeCollectionSameMembers(a, b);
}
/** Requested page size clamped to 1..25 (default 25). */
function aeCollectionPageSize(request) { return typeof request.pageSize === "number" ? Math.max(1, Math.min(25, Math.floor(request.pageSize))) : 25; }
function aeCollectionPlatform() {
    var os = typeof $ !== "undefined" ? $.os : "";
    return os.indexOf("Mac") >= 0 ? "macOS" : (os.indexOf("Windows") >= 0 ? "Windows" : "unknown");
}
/** Returns {id,itemIndex,name,width,height,duration,frameRate} for a composition. */
function aeCollectionCompInfo(comp, itemIndex) { return { id: String(comp.id), itemIndex: itemIndex, name: String(comp.name), width: comp.width,
  height: comp.height, duration: comp.duration, frameRate: comp.frameRate }; }
function aeCollectionProjectInfo() { return { name: app.project.file ? String(app.project.file.name).slice(0, 4096) : "Untitled",
  filePath: app.project.file ? String(app.project.file.fsName).slice(0, 4096) : null }; }
/** Returns {appVersion,platform} of the running After Effects. */
function aeCollectionRuntimeInfo() { return { appVersion: String(app.version || "unknown").slice(0, 256), platform: aeCollectionPlatform() }; }
var aeCollectionProject = null, aeCollectionProjectFile = null, aeCollectionEpoch = 0;
function aeCollectionSameObject(cached, current) {
    try {
        if (cached !== current) return false;
        if (cached !== null && cached !== undefined) cached.toString;
        return true;
    } catch (ignored) { return false; }
}
function aeCollectionErrorDetail(error) {
    try { return (String(error) + " (line " + ((error && error.line !== undefined) ? error.line : "?") + ")").slice(0, 300); }
    catch (ignored) { return "unreadable error"; }
}
function aeCollectionProjectPath(project, fallback) {
    try { return (project && project.file) ? String(project.file.fsName) : null; }
    catch (ignored) { return fallback; }
}
var aeCollectionInjectedEpoch = null;
function aeCollectionInjectedValue() {
    if (typeof __extyntProjectEpoch === "undefined") return null;
    var value = __extyntProjectEpoch;
    return (typeof value === "number" && isFinite(value) && Math.floor(value) === value && value >= 0) ? value : null;
}
function aeCollectionResetSessions() { aeCollectionSession = null; aeCollectionDetailSession = null; aeCollectionValueSession = null; }
function aeCollectionRevisionOf(project) {
    var revision = project ? project.revision : null;
    return (typeof revision === "number" && isFinite(revision) && Math.floor(revision) === revision) ? revision : null;
}
function aeCollectionStamp() {
    var current = app.project, path = aeCollectionProjectPath(current, aeCollectionProjectFile), injected = aeCollectionInjectedValue();
    var changed = !aeCollectionSameObject(aeCollectionProject, current) || path !== aeCollectionProjectFile;
    if (changed) { aeCollectionProject = current; aeCollectionProjectFile = path; aeCollectionEpoch += 1; }
    if (changed || injected !== aeCollectionInjectedEpoch) { aeCollectionResetSessions(); aeCollectionInjectedEpoch = injected; }
    return { epoch: injected === null ? aeCollectionEpoch : injected, revision: aeCollectionRevisionOf(current) };
}
/** True when the stamp {epoch,revision} still matches the live project. */
function aeCollectionSameStamp(stamp) { var current = aeCollectionStamp(); return stamp.epoch === current.epoch && stamp.revision === current.revision; }
function aeCollectionSelection(layers) {
    var selected = [], named = [];
    for (var i = 0; i < layers.length && i < 256; i += 1) {
        selected.push(String(layers[i].id));
        if (i < 64) named.push({ id: String(layers[i].id), index: layers[i].index, name: String(layers[i].name).slice(0, 128) });
    }
    return { selected: selected, named: named };
}
function aeCollectionFocus() {
    try {
        var item = app.project ? app.project.activeItem : null;
        if (!item || !(item instanceof CompItem)) return { active: null, activeName: null, selected: [], selectedLayers: [] };
        var picked = aeCollectionSelection(item.selectedLayers || []);
        return { active: String(item.id), activeName: String(item.name).slice(0, 128), selected: picked.selected, selectedLayers: picked.named };
    } catch (ignored) { return { active: undefined, activeName: undefined, selected: undefined, selectedLayers: undefined }; }
}
function aeCollectionPulseProject() {
    try { var info = aeCollectionProjectInfo(); return { projectPath: info.filePath, projectName: info.name }; }
    catch (ignored) { return {}; }
}
/**
 * Revision pulse. Returns JSON {ok:true,project,revision,items,active,activeName,selected,selectedLayers,projectPath,p
 * rojectName,coverage:"revision-only"}, or {ok:false,error:{code:"REVISION_READ_FAILED",detail}}. Opening a
 * composition or selecting layers leaves the project revision alone, so the pulse carries both; `selected` keeps every
 * id up to 256 and `selectedLayers` names the first 64.
 */
function aeCollectionPulse() {
    try {
        var stamp = aeCollectionStamp(), focus = aeCollectionFocus(), identity = aeCollectionPulseProject();
        return JSON.stringify({ ok: true, project: stamp.epoch, revision: stamp.revision, items: app.project ? app.project.numItems : 0,
          active: focus.active, activeName: focus.activeName, selected: focus.selected, selectedLayers: focus.selectedLayers,
          projectPath: identity.projectPath, projectName: identity.projectName, coverage: "revision-only" });
    }
    catch (error) { return JSON.stringify({ ok: false, error: { code: "REVISION_READ_FAILED", detail: aeCollectionErrorDetail(error) } }); }
}
/** Id of the active composition as a string, or null when none is active. */
function aeCollectionActiveCompositionId() {
    var active = app.project.activeItem;
    return active instanceof CompItem ? String(active.id) : null;
}

if (typeof aeHostDirectory === "string") {
    try { $.evalFile(new File(aeHostDirectory + "/collection-descriptors.jsx")); } catch (loadError) {
      if (typeof aeHostLoadFailed === "function") aeHostLoadFailed("collection-descriptors.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/collection-index.jsx")); } catch (loadError) {
      if (typeof aeHostLoadFailed === "function") aeHostLoadFailed("collection-index.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/collection-detail.jsx")); } catch (loadError) {
      if (typeof aeHostLoadFailed === "function") aeHostLoadFailed("collection-detail.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/collection-values.jsx")); } catch (loadError) {
      if (typeof aeHostLoadFailed === "function") aeHostLoadFailed("collection-values.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/collection-local.jsx")); } catch (loadError) {
      if (typeof aeHostLoadFailed === "function") aeHostLoadFailed("collection-local.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/collection-metadata.jsx")); } catch (loadError) {
      if (typeof aeHostLoadFailed === "function") aeHostLoadFailed("collection-metadata.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/collection-blur.jsx")); } catch (loadError) {
      if (typeof aeHostLoadFailed === "function") aeHostLoadFailed("collection-blur.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/collection-creation.jsx")); } catch (loadError) {
      if (typeof aeHostLoadFailed === "function") aeHostLoadFailed("collection-creation.jsx", loadError); }
}
