/* Probe read: one layer's property tree, walked in pre-order within the read budget. It sits under the probe in
 * probe.jsx.
 */
/* global AE_KEY_DIGEST_LIMIT, AE_TEXT_FIELDS, aeEncodePathSegment, aeKeyDigest, aeKeyShapeSummary, aeProbeReadBudget, aeProbeReadProgress, aeSafe,
  aeSafeGet, aeSafeProperty, aeTextEnumName */
/* exported aeProbePropertyPaths */
function aeProbePropertyKind(property) {
    return aeSafe(function () {
        if (property.parentProperty && String(property.parentProperty.matchName) === "ADBE Effect Parade") return "effect";
        return property.propertyType === PropertyType.PROPERTY ? "property" : "group";
    }, "property");
}
function aeProbeIsScalar(value) { return typeof value === "number" || typeof value === "string" || typeof value === "boolean"; }
function aeProbeJsonValue(value) {
    if (value === null || value === undefined) return null;
    if (aeProbeIsScalar(value)) return value;
    if (value instanceof Array) { var array = []; for (var i = 0; i < value.length; i += 1) array.push(aeProbeJsonValue(value[i])); return array; }
    if (typeof value === "object" && typeof aeSafeGet(value, "text", null) === "string") return aeProbeTextDocumentValue(value);
    return String(value);
}
var AE_PROBE_VALUE_KINDS = null;
function aeProbeBuildValueKinds() {
    var kinds = {};
    kinds[PropertyValueType.OneD] = "number";
    kinds[PropertyValueType.TwoD] = "vector";
    kinds[PropertyValueType.TwoD_SPATIAL] = "vector";
    kinds[PropertyValueType.ThreeD] = "vector";
    kinds[PropertyValueType.ThreeD_SPATIAL] = "vector";
    kinds[PropertyValueType.COLOR] = "color";
    kinds[PropertyValueType.LAYER_INDEX] = "layer";
    return kinds;
}
function aeProbeValueType(property) {
    if (AE_PROBE_VALUE_KINDS === null && typeof PropertyValueType !== "undefined") AE_PROBE_VALUE_KINDS = aeProbeBuildValueKinds();
    return (AE_PROBE_VALUE_KINDS || {})[aeSafeGet(property, "propertyValueType", 0)] || "unknown";
}
function aeProbeNativeLeafSettable(property, kind, childCount) {
    if (kind !== "property" || childCount > 0 || aeSafe(function () { return property.isHidden === true; }, false)) return false;
    if (aeSafe(function () { return typeof property.setValue !== "function"; }, true)) return false;
    if (typeof PropertyValueType === "undefined") return true;
    var type = aeSafeGet(property, "propertyValueType", null);
    return type !== PropertyValueType.NO_VALUE && type !== PropertyValueType.CUSTOM_VALUE;
}
var AE_MARKER_LIMIT = 1000;
function aeProbeMarkerList(property) {
    var count = aeSafeGet(property, "numKeys", 0), markers = [];
    for (var index = 1; index <= count && index <= AE_MARKER_LIMIT; index += 1) {
        var marker = aeSafe(function () { return property.keyValue(index); }, null);
        markers.push({ time: aeSafe(function () { return property.keyTime(index); }, null), comment: aeSafe(function () { return String(marker.comment); }, ""), duration: aeSafeGet(marker, "duration", 0), chapter: aeSafe(function () { return marker.chapter ? String(marker.chapter) : null; }, null), url: aeSafe(function () { return marker.url ? String(marker.url) : null; }, null), label: aeSafeGet(marker, "label", 0), cuePointName: aeSafe(function () { return marker.cuePointName ? String(marker.cuePointName) : null; }, null) });
    }
    return count > AE_MARKER_LIMIT ? { count: count, markers: markers, truncated: true } : { count: count, markers: markers };
}
function aeProbeTextFieldInto(out, value, key) {
    var spec = AE_TEXT_FIELDS[key], raw;
    if (spec.scope === "box" && !aeSafe(function () { return value.boxText === true; }, false)) return;
    raw = aeSafe(function () { return value[key]; }, undefined);
    if (raw === undefined || raw === null) return;
    if (spec.hostScale && typeof raw === "number") raw = Math.round(raw / spec.hostScale * 10000) / 10000;
    aeProbeTextFieldAssign(out, key, spec, raw);
}
function aeProbeTextRawType(kind) { return kind === "string" ? "string" : kind; }
function aeProbeTextFieldAssign(out, key, spec, raw) {
    if (spec.kind === "enum") out[key] = aeTextEnumName(key, raw);
    else if (spec.kind === "color" || spec.kind === "vec2") out[key] = raw instanceof Array ? aeProbeJsonValue(raw) : null;
    else if (typeof raw === aeProbeTextRawType(spec.kind)) out[key] = raw;
}
function aeProbeTextRangeJustification(value, out) {
    return aeSafe(function () { var length = out.text.length; return (length > 0 && typeof value.characterRange === "function") ? aeTextEnumName("justification", value.characterRange(0, length).justification) : null; }, null);
}
function aeProbeTextDocumentValue(value) {
    var out = { text: aeSafe(function () { return String(value.text); }, "") }, key;
    for (key in AE_TEXT_FIELDS) {
        if (!AE_TEXT_FIELDS.hasOwnProperty(key) || key === "text") continue;
        aeProbeTextFieldInto(out, value, key);
    }
    var rangeJustification = aeProbeTextRangeJustification(value, out);
    if (rangeJustification && rangeJustification !== out.justification) out.justification = rangeJustification;
    out.fontFamily = aeSafe(function () { return String(value.fontFamily); }, null);
    out.fontStyle = aeSafe(function () { return String(value.fontStyle); }, null);
    out.boxText = aeSafe(function () { return value.boxText === true; }, false);
    out.pointText = aeSafe(function () { return value.pointText === true; }, false);
    if (out.boxText) out.boxOverflow = aeSafe(function () { return value.boxOverflow === true; }, null);
    return out;
}
function aeProbeBudgetStops(config, kind) {
    try { aeProbeReadBudget(config, kind); return false; } catch (budget) {
      if (!budget || !budget.readBudgetExceeded) throw budget; return aeProbeReadProgress > 0; }
}
function aeProbeFirstReadBudget(config) {
    try { aeProbeReadBudget(config, "property"); } catch (budget) { if (!budget || !budget.readBudgetExceeded || aeProbeReadProgress > 0) throw budget; }
}
function aeProbeRootOrder(group, count, config) {
    var order = [], candidate;
    for (var orderedIndex = 1; orderedIndex <= count; orderedIndex += 1) {
        aeProbeFirstReadBudget(config);
        candidate = aeSafeProperty(group, orderedIndex);
        if (candidate && aeSafe(function () { return String(candidate.matchName); }, "") === "ADBE Transform Group") order.unshift(orderedIndex);
        else order.push(orderedIndex);
    }
    return order;
}
function aeProbeEntryPath(property, matchName, prefix, seen) {
    var segment = aeEncodePathSegment(matchName || aeSafe(function () { return String(property.name); }, "unknown")), seenKey = "k:" + segment;
    seen[seenKey] = (seen[seenKey] || 0) + 1;
    if (seen[seenKey] > 1) segment += "#" + seen[seenKey];
    return prefix ? prefix + "/" + segment : segment;
}
function aeProbeEffectLeafSettable(property, kind, childCount) {
    return kind === "property" && aeProbeParentIsEffect(property) && childCount === 0 && aeSafe(function () { return property.propertyValueType !== undefined && property.value !== undefined; }, false);
}
function aeProbeBaseEntry(property, info) {
    var reportedSettable = !!aeSafeGet(property, "canSetValue", false);
    var effectLeafSettable = aeProbeEffectLeafSettable(property, info.kind, info.childCount);
    return { path: info.path, matchName: info.matchName, displayName: aeSafe(function () { return String(property.name); }, ""), kind: info.kind, valueType: aeProbeValueType(property), value: aeSafe(function () { return aeProbeJsonValue(property.value); }, null), canSetValue: reportedSettable || effectLeafSettable || aeProbeNativeLeafSettable(property, info.kind, info.childCount) };
}
function aeProbeAddLeafFields(entry, property) {
    entry.expression = aeSafe(function () { return property.expressionEnabled ? String(property.expression) : null; }, null);
    entry.expressionEnabled = !!aeSafeGet(property, "expressionEnabled", false);
    var keyCount = aeSafeGet(property, "numKeys", 0);
    if (typeof keyCount === "number" && keyCount > 0) { entry.keyframeCount = keyCount; entry.keyDigest = aeKeyDigest(property, keyCount); if (keyCount > AE_KEY_DIGEST_LIMIT) entry.keyDigestTruncated = true; var shapeKeys = aeKeyShapeSummary(property, keyCount); if (shapeKeys) entry.shapeKeys = shapeKeys; }
    if (aeSafe(function () { return property.canVaryOverTime === false; }, false)) entry.animatable = false;
}
function aeProbeAddHidden(entry, property) {
    if (aeSafe(function () { return property.isHidden === true; }, false)) entry.hidden = true;
    if (!entry.hidden && aeSafe(function () { return property.isSeparationFollower === true && property.separationLeader.dimensionsSeparated !== true;
      }, false)) entry.hidden = true;
}
function aeProbeReadEntry(property, info) {
    var entry = aeProbeBaseEntry(property, info);
    if (info.kind === "property") aeProbeAddLeafFields(entry, property);
    aeProbeAddHidden(entry, property);
    if (info.kind === "effect" || info.prefix === "ADBE Layer Styles") { var enabledState = aeSafeGet(property, "enabled", null); if (typeof enabledState === "boolean") entry.enabled = enabledState; }
    if (info.matchName === "ADBE Marker") entry.value = aeProbeMarkerList(property);
    return entry;
}
function aeProbeVisitEntry(scan, site, i) {
    var walk = scan.walk, config = scan.config, group = site.group, prefix = site.prefix;
    if (walk.index >= config.maxPropertiesPerLayer) {
        scan.warnings.push("property-count-limit:" + scan.layer.name);
        return false;
    }
    var skipping = walk.index < walk.skip;
    if (!skipping && aeProbeBudgetStops(config, "property")) { walk.stopped = true; return false; }
    var property = aeSafeProperty(group, i);
    if (!property) return true;
    var matchName = aeSafe(function () { return String(property.matchName); }, "");
    var path = aeProbeEntryPath(property, matchName, prefix, site.seen);
    var kind = aeProbePropertyKind(property);
    var childCount = aeSafeGet(property, "numProperties", 0);
    if (!skipping) scan.result.push(aeProbeReadEntry(property, { path: path, matchName: matchName, kind: kind, childCount: childCount, prefix: prefix }));
    walk.index += 1;
    if (!skipping) aeProbeReadProgress += 1;
    if (childCount > 0) aeProbeVisitGroup(scan, property, path, site.depth + 1);
    return !walk.stopped;
}
function aeProbeVisitRoot(scan, site, order) {
    for (var orderIndex = 0; orderIndex < order.length; orderIndex += 1) if (!aeProbeVisitEntry(scan, site, order[orderIndex])) return;
}
function aeProbeVisitGroup(scan, group, prefix, depth) {
    var walk = scan.walk;
    if (depth > scan.config.maxPropertyDepth) {
        scan.warnings.push("property-depth-limit:" + scan.layer.name);
        return;
    }
    if (walk.stopped || (walk.index >= walk.skip && aeProbeBudgetStops(scan.config))) { walk.stopped = true; return; }
    var count = aeSafeGet(group, "numProperties", 0), site = { group: group, prefix: prefix, depth: depth, seen: {} };
    if (depth === 0) aeProbeVisitRoot(scan, site, aeProbeRootOrder(group, count, scan.config));
    else for (var index = 1; index <= count; index += 1) if (!aeProbeVisitEntry(scan, site, index)) return;
}
/**
 * Property entries of a layer in host order. Returns the array of read entries; walk, when given, carries the resume
 * position {skip,index,stopped}. The walk resumes across calls through walk.skip and walk.index, and the first entry
 * of a call is never refused for budget, so every call advances. The layer's Transform group is read first so
 * Position, Rotation and Opacity stay available, percent fields are in the API's units, and a marker list over the
 * limit says `truncated`.
 */
function aeProbePropertyPaths(layer, config, warnings, walk) {
    var scan = { layer: layer, config: config, warnings: warnings, walk: walk || { skip: 0, index: 0, stopped: false }, result: [] };
    aeProbeVisitGroup(scan, layer, "", 0);
    return scan.result;
}
function aeProbeParentIsEffect(property) { return !!aeSafe(function () { var ancestor = property; for (var depth = 0; depth < 8 && ancestor; depth += 1) { if (String(ancestor.matchName) === "ADBE Effect Parade") return true; ancestor = ancestor.parentProperty; } return false; }, false); }
