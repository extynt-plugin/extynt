/* Runtime effect-catalogue probe, read side: the control-tree reader and the one-instance read, loaded by
 * catalogue.jsx. Nothing here is shipped data; every row is an observation of the user's own After Effects.
 */
/* global AE_CATALOGUE_SCHEMA, aeCatalogueGuarded, aeCatalogueRefuse, aeCatalogueItemAt, aeCatalogueItemCount, aeIsArray, aeIsFiniteNumber, aeSafe,
  aeSafeGet, aeSafeLayer */
/* exported aeCatalogueBoundedText, aeCatalogueHasMenuLike, aeCatalogueHostInfo, aeCatalogueInvalid, aeCatalogueIsComp, aeCatalogueItemId,
  aeCatalogueParseEnvelope, aeCatalogueReadControls, aeCatalogueReadInstance */
var AE_CATALOGUE_MAX_ROWS = 4096;
var AE_CATALOGUE_MAX_DEPTH = 16;
var AE_CATALOGUE_MAX_MENU_ITEMS = 512;
var AE_CATALOGUE_MAX_INSTANCE_ITEMS = 20000;
var AE_CATALOGUE_MAX_INSTANCE_LAYERS = 5000;
var AE_CATALOGUE_TYPE_NAMES = aeCataloguePropertyTypeNames();

function aeCataloguePropertyTypeNames() {
    var names = {};
    aeSafe(function () { for (var key in PropertyValueType) {
      if (PropertyValueType.hasOwnProperty(key)) names[PropertyValueType[key]] = key; } return true; }, false);
    return names;
}
/** `{ version: string, build: string | null }` of the running After Effects. */
function aeCatalogueHostInfo() {
    return { version: aeSafe(function () { return String(app.version); }, "unknown"), build: aeSafe(function () { var build = app.buildNumber; return (build === null || build === undefined) ? null : String(build); }, null) };
}
/** The project item's id as a string, or "" when it has none. */
function aeCatalogueItemId(item) { return aeSafe(function () { return String(item.id); }, ""); }
/** True when `item` is a composition. */
function aeCatalogueIsComp(item) { return aeSafe(function () { return typeof CompItem !== "undefined" && item instanceof CompItem; }, false); }
function aeCatalogueNumberList(value) {
    if (!aeIsArray(value) || value.length < 1 || value.length > 16) return null;
    var out = [];
    for (var i = 0; i < value.length; i += 1) { if (!aeIsFiniteNumber(value[i])) return null; out.push(value[i]); }
    return out;
}
function aeCatalogueDefaultValue(property) {
    var value = aeSafe(function () { return property.value; }, null);
    if (aeIsFiniteNumber(value)) return value;
    if (value === true) return 1;
    if (value === false) return 0;
    return aeCatalogueNumberList(value);
}
function aeCatalogueDropdownItems(property) {
    var items = aeSafe(function () { return property.propertyParameters; }, null), list = [];
    if (!items || typeof items.length !== "number") return null;
    for (var k = 0; k < items.length && k < AE_CATALOGUE_MAX_MENU_ITEMS; k += 1) list.push(String(items[k]).slice(0, 80));
    return list;
}
function aeCatalogueUnitsLabel(property) {
    return aeSafe(function () {
        var raw = property.unitsText;
        if (typeof raw !== "string") return null;
        var text = raw.replace(/^\s+|\s+$/g, "").slice(0, 80);
        return text.length > 0 ? text : null;
    }, null);
}
function aeCatalogueBoolOrNull(value) { return (value === true || value === false) ? value : null; }
function aeCatalogueNumberOrNull(value) { return aeIsFiniteNumber(value) ? value : null; }
function aeCatalogueChildCount(node) {
    var count = aeSafe(function () { return Number(node.numProperties); }, 0);
    return (isFinite(count) && count >= 0) ? count : 0;
}
function aeCatalogueFillProperty(row, property) {
    row.valueType = AE_CATALOGUE_TYPE_NAMES[aeSafe(function () { return property.propertyValueType; }, -1)] || null;
    row.defaultValue = aeCatalogueDefaultValue(property);
    row.hasMin = aeSafeGet(property, "hasMin", null) === true;
    row.min = row.hasMin ? aeCatalogueNumberOrNull(aeSafeGet(property, "minValue", null)) : null;
    row.hasMax = aeSafeGet(property, "hasMax", null) === true;
    row.max = row.hasMax ? aeCatalogueNumberOrNull(aeSafeGet(property, "maxValue", null)) : null;
    row.unitsText = aeCatalogueUnitsLabel(property);
    row.isDropdown = aeSafeGet(property, "isDropdownEffect", null) === true;
    row.items = row.isDropdown ? aeCatalogueDropdownItems(property) : null;
    row.canVary = aeCatalogueBoolOrNull(aeSafeGet(property, "canVaryOverTime", null));
    row.canSetExpression = aeCatalogueBoolOrNull(aeSafeGet(property, "canSetExpression", null));
    row.hidden = aeCatalogueBoolOrNull(aeSafeGet(property, "isHidden", null));
}
function aeCatalogueFillGroup(row, property, scan) {
    row.childCount = scan.children; row.children = [];
    if (scan.depth < AE_CATALOGUE_MAX_DEPTH) aeCatalogueReadRows(property, scan.depth + 1, scan.state, row.children);
    else if (scan.children > 0) scan.state.truncated = true;
}
function aeCatalogueReadRow(property, index, state, depth) {
    var matchName = aeSafe(function () { return String(property.matchName); }, "");
    var children = aeCatalogueChildCount(property);
    var group = aeSafe(function () { return property.propertyType !== PropertyType.PROPERTY; }, children > 0);
    var row = { matchName: matchName, name: aeSafe(function () { return String(property.name).slice(0, 80); }, matchName), index: index, kind: group ? "group" : "property" };
    if (group) aeCatalogueFillGroup(row, property, { children: children, state: state, depth: depth });
    else aeCatalogueFillProperty(row, property);
    return row;
}
function aeCatalogueReadRows(group, depth, state, out) {
    var count = aeCatalogueChildCount(group);
    for (var i = 1; i <= count; i += 1) {
        if (state.rows >= AE_CATALOGUE_MAX_ROWS) { state.truncated = true; return; }
        var property = aeSafe(function () { return group.property(i); }, null);
        if (!property) continue;
        state.rows += 1;
        out.push(aeCatalogueReadRow(property, i, state, depth));
    }
}
/**
 * `{ controls: Row[], truncated: boolean }`: the effect's whole control tree, bounded by the safety limits;
 * `truncated` says a bound was hit. Reads the whole control tree under safety bounds far past any shipped effect, and
 * reports unitsText as null whenever it is absent, non-text, throwing or empty, never a guess.
 */
function aeCatalogueReadControls(effect) {
    var state = { rows: 0, truncated: false }, controls = [];
    aeCatalogueReadRows(effect, 1, state, controls);
    return { controls: controls, truncated: state.truncated };
}
function aeCatalogueIsWhole(value) { return typeof value === "number" && isFinite(value) && Math.floor(value) === value; }
function aeCataloguePopupRange(row) {
    return row.valueType === "OneD" && row.hasMin === true && row.hasMax === true && row.min === 1 && aeCatalogueIsWhole(row.max) && row.max >= 2 && row.max <= 256 && aeCatalogueIsWhole(row.defaultValue);
}
/** True when any row, at any depth, is a dropdown or a whole-number popup range. */
function aeCatalogueHasMenuLike(rows) {
    for (var i = 0; i < rows.length; i += 1) {
        var row = rows[i];
        if (row.kind === "group" ? aeCatalogueHasMenuLike(row.children || []) : (row.isDropdown === true || aeCataloguePopupRange(row))) return true;
    }
    return false;
}
/** True for a string of 1 to 512 characters. */
function aeCatalogueBoundedText(value) { return typeof value === "string" && value.length >= 1 && value.length <= 512; }
/** `{ error: refusal }` for an INVALID_REQUEST with `message`. */
function aeCatalogueInvalid(requestId, message) { return { error: aeCatalogueRefuse(requestId, "INVALID_REQUEST", message) }; }
/** `{ request, requestId }` for a JSON request carrying the schema version and a bounded id; otherwise `{ error: refusal }`. */
function aeCatalogueParseEnvelope(raw) {
    var request; try { request = JSON.parse(raw); } catch (ignored) { return { error: aeCatalogueRefuse("", "INVALID_REQUEST", "Request was not valid JSON.") }; }
    var requestId = (request && typeof request.requestId === "string") ? request.requestId : "";
    if (!request || request.schemaVersion !== AE_CATALOGUE_SCHEMA || !requestId || requestId.length > 128) return aeCatalogueInvalid(requestId, "Expected schemaVersion 0.1 and a bounded requestId.");
    return { request: request, requestId: requestId };
}
function aeCatalogueFindComp(project, compId) {
    var count = aeCatalogueItemCount(project);
    for (var i = 1; i <= count && i <= AE_CATALOGUE_MAX_INSTANCE_ITEMS; i += 1) {
        var item = aeCatalogueItemAt(project, i);
        if (item && aeCatalogueIsComp(item) && aeCatalogueItemId(item) === compId) return item;
    }
    return null;
}
function aeCatalogueFindLayer(comp, layerId) {
    var count = aeSafeGet(comp, "numLayers", 0);
    for (var i = 1; i <= count && i <= AE_CATALOGUE_MAX_INSTANCE_LAYERS; i += 1) {
        var layer = aeSafeLayer(comp, i);
        if (layer && String(aeSafeGet(layer, "id", "")) === layerId) return layer;
    }
    return null;
}
function aeCatalogueEffectIndexInvalid(value) { return typeof value !== "number" || value < 1 || value > 1000 || Math.floor(value) !== value; }
function aeCatalogueParseInstanceRequest(raw) {
    var parsed = aeCatalogueParseEnvelope(raw);
    if (parsed.error) return parsed;
    var request = parsed.request, requestId = parsed.requestId, texts = [request.matchName, request.compId, request.layerId];
    for (var i = 0; i < texts.length; i += 1) if (!aeCatalogueBoundedText(texts[i])) return aeCatalogueInvalid(requestId, "matchName, compId and layerId must be bounded non-empty strings.");
    if (aeCatalogueEffectIndexInvalid(request.effectIndex)) return aeCatalogueInvalid(requestId, "effectIndex must be a whole number from 1 to 1000.");
    return { request: { requestId: requestId, matchName: request.matchName, compId: request.compId, layerId: request.layerId,
      effectIndex: request.effectIndex } };
}
function aeCatalogueInstanceEffect(project, request) {
    var comp = aeCatalogueFindComp(project, request.compId);
    if (!comp) return { code: "COMP_NOT_FOUND", message: "The composition is no longer in the open project." };
    var layer = aeCatalogueFindLayer(comp, request.layerId);
    if (!layer) return { code: "LAYER_NOT_FOUND", message: "The layer is no longer in that composition." };
    var parade = aeSafe(function () { return layer.property("ADBE Effect Parade"); }, null);
    var effect = parade ? aeSafe(function () { return parade.property(request.effectIndex); }, null) : null;
    if (!effect) return { code: "EFFECT_NOT_FOUND", message: "The layer has no effect at that position." };
    if (aeSafe(function () { return String(effect.matchName); }, "") !== request.matchName) return { code: "EFFECT_MISMATCH", message: "The effect at that position is not the one asked for." };
    return { effect: effect };
}
function aeCatalogueInstanceAnswer(raw) {
    var parsed = aeCatalogueParseInstanceRequest(raw);
    if (parsed.error) return parsed.error;
    var request = parsed.request, project = aeSafe(function () { return app.project; }, null);
    if (!project) return aeCatalogueRefuse(request.requestId, "NO_PROJECT", "No project is open.");
    var found = aeCatalogueInstanceEffect(project, request);
    if (!found.effect) return aeCatalogueRefuse(request.requestId, found.code, found.message);
    var read = aeSafe(function () { return aeCatalogueReadControls(found.effect); }, null);
    if (!read) return aeCatalogueRefuse(request.requestId, "READ_FAILED", "The effect's controls could not be read.");
    var displayName = aeSafe(function () { return String(found.effect.name).slice(0, 120); }, request.matchName);
    return { schemaVersion: AE_CATALOGUE_SCHEMA, ok: true, requestId: request.requestId, host: aeCatalogueHostInfo(), instance: {
      matchName: request.matchName, displayName: displayName, controls: read.controls, truncated: read.truncated } };
}
/**
 * JSON text of `{ schemaVersion, ok: true, requestId, host, instance: { matchName, displayName, controls, truncated }
 * }` for the effect at the requested composition, layer and index, or of `{ ok: false, error: { code, message } }`.
 * Read-only: it adds, removes and sets nothing and opens no undo group. The effect is located by id and index and its
 * matchName checked before anything is read, so a project that moved since the snapshot is reported as a mismatch
 * rather than read from the wrong effect.
 */
function aeCatalogueReadInstance(raw) { return aeCatalogueGuarded(function () { return aeCatalogueInstanceAnswer(raw); }); }
