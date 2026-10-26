/* Read-only detail read: Source Text, marker, mask and shape path and layer reference values and keyframe digests for
 * listed layers, at the probe's own property paths.
 */
/* global AE_KEY_DIGEST_LIMIT, aeEditFailure, aeEditParse, aeErrorTextShort, aeIsArray, aeIsFiniteNumber, aeKeyDigest, aeKeyShapeSummary, aeOwnValue,
   aeProbeEntryPath, aeProbeJsonValue, aeProbeMarkerList, aeProbePropertyKind, aeProbeTextDocumentValue, aeSafe, aeSafeGet, aeSafeLayer, aeSafeProperty */
/* exported aeReadPropertyDetails */
var AE_DETAILS_HARD_MAX_LAYERS = 256;
var AE_DETAILS_MAX_SCOPES = 256;
var AE_DETAILS_MAX_VERTICES = 1000;
var AE_DETAILS_KINDS = { textDocument: "text", keyDigest: "keys", marker: "marker", maskPath: "maskPath", shapePath: "shapePath", layerRef: "layerRef" };
var AE_DETAILS_KIND_COUNT = 6;
var AE_DETAILS_MAX_DEPTH = 16;
var AE_DETAILS_MAX_MS = 5000;
var AE_DETAILS_MAX_PROPERTIES = 20000;

function aeDetailsIsObject(value) { return !!value && typeof value === "object" && !(value instanceof Array); }
function aeDetailsIdValid(value) { return typeof value === "string" && /^[0-9]{1,15}$/.test(value); }
function aeDetailsIdsValid(ids) {
    if (!(ids instanceof Array) || ids.length > AE_DETAILS_HARD_MAX_LAYERS) return false;
    for (var i = 0; i < ids.length; i += 1) if (!aeDetailsIdValid(ids[i])) return false;
    return true;
}
function aeDetailsScopeValid(scope) {
    if (!aeDetailsIsObject(scope) || !aeDetailsIdValid(scope.compId)) return false;
    return scope.layerIds === undefined || aeDetailsIdsValid(scope.layerIds);
}
function aeDetailsScopesValid(scopes, allowEmpty) {
    if (!(scopes instanceof Array) || scopes.length < (allowEmpty ? 0 : 1) || scopes.length > AE_DETAILS_MAX_SCOPES) return false;
    for (var i = 0; i < scopes.length; i += 1) if (!aeDetailsScopeValid(scopes[i])) return false;
    return true;
}
function aeDetailsInclude(include) {
    if (!(include instanceof Array) || include.length < 1 || include.length > AE_DETAILS_KIND_COUNT) return null;
    var flags = { text: false, keys: false, marker: false, maskPath: false, shapePath: false, layerRef: false };
    for (var i = 0; i < include.length; i += 1) {
        var flag = typeof include[i] === "string" ? aeOwnValue(AE_DETAILS_KINDS, include[i]) : undefined;
        if (flag === undefined) return null;
        flags[flag] = true;
    }
    return flags;
}
function aeDetailsLayerLimit(value) {
    if (value === undefined) return AE_DETAILS_HARD_MAX_LAYERS;
    if (typeof value !== "number" || Math.floor(value) !== value || value < 1) return 0;
    return Math.min(value, AE_DETAILS_HARD_MAX_LAYERS);
}
function aeDetailsMarkerComps(ids) {
    if (ids === undefined) return [];
    return aeDetailsIdsValid(ids) ? ids : null;
}
function aeDetailsRequest(request) {
    if (!aeDetailsIsObject(request)) return null;
    var markerComps = aeDetailsMarkerComps(request.markerCompositions);
    if (!markerComps || !aeDetailsScopesValid(request.scopes, markerComps.length > 0)) return null;
    var flags = aeDetailsInclude(request.include), limit = aeDetailsLayerLimit(request.maxLayers);
    if (!flags || limit < 1) return null;
    flags.markerCompositions = markerComps;
    flags.scopes = request.scopes;
    flags.maxLayers = limit;
    return flags;
}

function aeDetailsAddKeys(row, property) {
    var keyCount = aeSafeGet(property, "numKeys", 0);
    if (typeof keyCount !== "number" || keyCount <= 0) return;
    row.keyframeCount = keyCount;
    row.keyDigest = aeKeyDigest(property, keyCount);
    if (keyCount > AE_KEY_DIGEST_LIMIT) row.keyDigestTruncated = true;
    var shapeKeys = aeKeyShapeSummary(property, keyCount);
    if (shapeKeys) row.shapeKeys = shapeKeys;
}
function aeDetailsPointValid(point) {
    return aeIsArray(point) && point.length === 2 && aeIsFiniteNumber(point[0]) && aeIsFiniteNumber(point[1]);
}
function aeDetailsPoints(value) {
    if (!aeIsArray(value) || value.length > AE_DETAILS_MAX_VERTICES) return null;
    var points = [];
    for (var i = 0; i < value.length; i += 1) {
        var point = value[i];
        if (!aeDetailsPointValid(point)) return null;
        points.push([point[0], point[1]]);
    }
    return points;
}
function aeDetailsShapeValue(property) {
    var shape = aeSafeGet(property, "value", null);
    if (!shape) return null;
    var raw = aeSafeGet(shape, "vertices", null);
    if (aeIsArray(raw) && raw.length > AE_DETAILS_MAX_VERTICES) return "large";
    var value = { vertices: aeDetailsPoints(raw), inTangents: aeDetailsPoints(aeSafeGet(shape, "inTangents", null)),
      outTangents: aeDetailsPoints(aeSafeGet(shape, "outTangents", null)), closed: aeSafeGet(shape, "closed", null) };
    return (value.vertices && value.inTangents && value.outTangents && typeof value.closed === "boolean") ? value : null;
}
function aeDetailsPathValue(property, path, ctx) {
    var value = aeDetailsShapeValue(property);
    if (value !== "large") return value === null ? undefined : value;
    ctx.warnings.push("value-too-large:" + path);
    return undefined;
}
function aeDetailsLayerRefValue(property) {
    var value = aeSafe(function () { return aeProbeJsonValue(property.value); }, null);
    return typeof value === "number" ? value : undefined;
}
function aeDetailsSimpleValue(property, matchName, request) {
    if (request.text && matchName === "ADBE Text Document") return aeSafe(function () { return aeProbeTextDocumentValue(property.value); }, undefined);
    if (request.marker && matchName === "ADBE Marker") return aeProbeMarkerList(property);
    return undefined;
}
function aeDetailsTypedValue(property, matchName, path, ctx) {
    var request = ctx.request;
    if (!request.shapePath && !request.layerRef) return undefined;
    var type = aeSafeGet(property, "propertyValueType", 0);
    if (request.shapePath && matchName !== "ADBE Mask Shape" && type === PropertyValueType.SHAPE) return aeDetailsPathValue(property, path, ctx);
    if (request.layerRef && type === PropertyValueType.LAYER_INDEX) return aeDetailsLayerRefValue(property);
    return undefined;
}
function aeDetailsKindValue(property, matchName, path, ctx) {
    var request = ctx.request, simple = aeDetailsSimpleValue(property, matchName, request);
    if (simple !== undefined) return simple;
    if (request.maskPath && matchName === "ADBE Mask Shape") return aeDetailsPathValue(property, path, ctx);
    return aeDetailsTypedValue(property, matchName, path, ctx);
}
function aeDetailsLeafRow(property, matchName, path, ctx) {
    var row = { path: path }, value = aeDetailsKindValue(property, matchName, path, ctx);
    if (value !== undefined) row.value = value;
    if (ctx.request.keys) aeDetailsAddKeys(row, property);
    return (row.value !== undefined || row.keyframeCount !== undefined) ? row : null;
}
function aeDetailsVisitChild(group, index, site, ctx) {
    var property = aeSafeProperty(group, index);
    if (!property) return;
    ctx.visited += 1;
    var matchName = aeSafe(function () { return String(property.matchName); }, "");
    var path = aeProbeEntryPath(property, matchName, site.prefix, site.seen);
    var childCount = aeSafeGet(property, "numProperties", 0);
    if (childCount > 0) {
        if (site.depth + 1 <= AE_DETAILS_MAX_DEPTH) aeDetailsVisitGroup(property, path, site.depth + 1, ctx);
        return;
    }
    if (aeProbePropertyKind(property) !== "property") return;
    var row = aeDetailsLeafRow(property, matchName, path, ctx);
    if (row) ctx.properties.push(row);
}
function aeDetailsVisitGroup(group, prefix, depth, ctx) {
    var count = aeSafeGet(group, "numProperties", 0), site = { prefix: prefix, depth: depth, seen: {} };
    for (var index = 1; index <= count; index += 1) aeDetailsVisitChild(group, index, site, ctx);
}
function aeDetailsLayerRow(layer, compId, state) {
    var ctx = { request: state.request, properties: [], warnings: state.warnings, visited: 0 };
    aeDetailsVisitGroup(layer, "", 0, ctx);
    state.visited += ctx.visited;
    return { compId: compId, layerId: String(layer.id), properties: ctx.properties };
}

function aeDetailsCapped(state) {
    if (!state.capped) { state.capped = true; state.warnings.push("max-layers-reached"); }
}
function aeDetailsOverBudget(state) {
    if (state.layers.length < 1) return false;
    if (state.visited < AE_DETAILS_MAX_PROPERTIES && (new Date()).getTime() - state.startedAt < AE_DETAILS_MAX_MS) return false;
    if (!state.budgetHit) { state.budgetHit = true; state.warnings.push("details-budget-reached"); }
    return true;
}
function aeDetailsWanted(ids) {
    var wanted = { ids: {}, pending: 0 };
    for (var i = 0; i < ids.length; i += 1) if (aeOwnValue(wanted.ids, ids[i]) === undefined) { wanted.ids[ids[i]] = false; wanted.pending += 1; }
    return wanted;
}
function aeDetailsWantedWarnings(wanted, compId, state) {
    for (var id in wanted.ids) if (wanted.ids.hasOwnProperty(id) && wanted.ids[id] === false) state.warnings.push("layer-not-found:" + compId + ":" + id);
}
function aeDetailsWantsLayer(wanted, layerId) {
    if (!wanted) return true;
    if (aeOwnValue(wanted.ids, layerId) !== false) return false;
    wanted.ids[layerId] = true; wanted.pending -= 1;
    return true;
}
function aeDetailsLayerWanted(wanted, layer) { return !!layer && aeDetailsWantsLayer(wanted, String(aeSafeGet(layer, "id", ""))); }
function aeDetailsWantedDone(wanted) { return !!wanted && wanted.pending === 0; }
function aeDetailsReadComp(comp, scope, state) {
    var wanted = scope.layerIds ? aeDetailsWanted(scope.layerIds) : null, count = aeSafeGet(comp, "numLayers", 0);
    for (var index = 1; index <= count && !aeDetailsWantedDone(wanted); index += 1) {
        var layer = aeSafeLayer(comp, index);
        if (!aeDetailsLayerWanted(wanted, layer)) continue;
        if (state.remaining <= 0) { aeDetailsCapped(state); return; }
        if (aeDetailsOverBudget(state)) return;
        state.layers.push(aeDetailsLayerRow(layer, scope.compId, state));
        state.remaining -= 1;
    }
    if (wanted) aeDetailsWantedWarnings(wanted, scope.compId, state);
}
function aeDetailsCompIndex(state) {
    if (state.comps) return state.comps;
    state.comps = {};
    for (var i = 1; i <= app.project.numItems; i += 1) { var item = app.project.item(i);
      if (item instanceof CompItem) state.comps["k:" + String(item.id)] = item; }
    return state.comps;
}
function aeDetailsFindComp(compId, state) {
    if (typeof app.project.itemByID !== "function") return aeDetailsCompIndex(state)["k:" + compId] || null;
    var item = aeSafe(function () { return app.project.itemByID(Number(compId)); }, null);
    return (item && item instanceof CompItem && String(aeSafeGet(item, "id", "")) === compId) ? item : null;
}
function aeDetailsCompMarkers(request, state) {
    var rows = [];
    for (var i = 0; i < request.markerCompositions.length; i += 1) {
        var comp = aeDetailsFindComp(request.markerCompositions[i], state);
        if (!comp) { state.warnings.push("comp-not-found:" + request.markerCompositions[i]); continue; }
        var property = aeSafeGet(comp, "markerProperty", null), list = property ? aeSafe(function () { return aeProbeMarkerList(property); }, null) : null;
        if (list) rows.push({ compId: request.markerCompositions[i], markers: list });
        else state.warnings.push("comp-markers-unreadable:" + request.markerCompositions[i]);
    }
    return rows;
}
function aeDetailsRun(request) {
    var state = { request: request, layers: [], warnings: [], remaining: request.maxLayers, capped: false, visited: 0,
      startedAt: (new Date()).getTime(), budgetHit: false, comps: null };
    for (var i = 0; i < request.scopes.length; i += 1) {
        if (state.remaining <= 0) { aeDetailsCapped(state); break; }
        if (aeDetailsOverBudget(state)) break;
        var comp = aeDetailsFindComp(request.scopes[i].compId, state);
        if (comp) aeDetailsReadComp(comp, request.scopes[i], state);
        else state.warnings.push("comp-not-found:" + request.scopes[i].compId);
    }
    var result = { ok: true, layers: state.layers };
    if (request.markerCompositions.length > 0) result.compositions = aeDetailsCompMarkers(request, state);
    if (state.warnings.length > 0) result.warnings = state.warnings;
    return JSON.stringify(result);
}
/**
 * Detail read for listed layers. Takes the request JSON; returns JSON {ok:true,layers[,compositions][,warnings]}, or
 * {ok:false,error:{code,message}} with INVALID_COMMAND, NO_PROJECT or READ_FAILED. Paths follow the probe walk's rules
 * (matchName segments, repeated siblings numbered per group in host order); a path larger than the bound shared with
 * the shape validators in apply-shapes.jsx is skipped with a warning, never cut. Item and layer ids are positive
 * integers carried as digit strings.
 */
function aeReadPropertyDetails(raw) {
    var parsed = aeEditParse(raw);
    if (!parsed) return aeEditFailure("INVALID_COMMAND", "Command was not valid JSON.");
    var request = aeDetailsRequest(parsed.request);
    if (!request) {return aeEditFailure("INVALID_COMMAND",
      "Expected scopes (or markerCompositions), include (textDocument, keyDigest, marker, maskPath, shapePath, layerRef) and an optional maxLayers.");}
    if (!app.project) return aeEditFailure("NO_PROJECT", "No project is open.");
    try { return aeDetailsRun(request); } catch (error) { return aeEditFailure("READ_FAILED", aeErrorTextShort(error)); }
}
