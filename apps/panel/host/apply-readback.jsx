/* Apply: bounded host read-backs of exactly what a write left behind, for the panel to compare against the request.
 * Arrays are tested with aeIsArray, never instanceof alone, since values can come from another script realm.
 */
/* global aeAllFinite, aeApplyFindProperty, aeIsArray, aeHasOwn, aeSafe, aeSafeGet, aeSafeProperty */
/* exported aeApplyBoundedPath, aeApplyEnabledState, aeApplyEssentialState, aeApplyExpressionProbe, aeApplyLayerBounds, aeApplyMaskCount,
  aeApplyPathBudget, aeApplyReadGroupChildren, aeApplyReadGroupTransform, aeApplyReadKeys, aeApplyReadShapeKeyValues, aeApplyTimeRemapState */
var AE_APPLY_PATH_FULL_LIMIT = 256, AE_APPLY_PATH_EDGE = 8, AE_APPLY_PATH_BUDGET = 4096, AE_APPLY_CHILD_LIMIT = 64, AE_APPLY_KEY_LIMIT = 32,
  AE_APPLY_ESSENTIAL_LIMIT = 128;
function aeApplyFinitePoint(point) { return aeIsArray(point) && point.length === 2 && typeof point[0] === "number" && typeof point[1] === "number" && isFinite(point[0]) && isFinite(point[1]); }
function aeApplyCopyPoints(points, from, to) { var copied = []; for (var index = from; index < to; index += 1) {
  if (!aeApplyFinitePoint(points[index])) return null; copied.push([points[index][0], points[index][1]]); } return copied; }
function aeApplyCopyPathArrays(path, from, to) { var vertices = aeApplyCopyPoints(path.vertices, from, to),
  ins = aeApplyCopyPoints(path.inTangents, from, to), outs = aeApplyCopyPoints(path.outTangents, from, to); return (vertices && ins && outs) ? {
    vertices: vertices, inTangents: ins, outTangents: outs } : null; }
function aeApplyPathDigest(path) {
    var sum = 0;
    for (var v = 0; v < path.vertices.length; v += 1) {
        if (!aeApplyFinitePoint(path.vertices[v]) || !aeApplyFinitePoint(path.inTangents[v]) || !aeApplyFinitePoint(path.outTangents[v])) return null;
        sum += path.vertices[v][0] + 2 * path.vertices[v][1] + 3 * path.inTangents[v][0] + 5 * path.inTangents[v][1] + 7 * path.outTangents[v][0]
          + 11 * path.outTangents[v][1];
    }
    return sum;
}
function aeApplyPathSummary(path) {
    var count = path.vertices.length, edge = Math.min(AE_APPLY_PATH_EDGE, count), digest = aeApplyPathDigest(path);
    return digest === null ? null : { count: count, closed: path.closed, digest: digest, head: aeApplyCopyPathArrays(path, 0, edge),
      tail: aeApplyCopyPathArrays(path, count - edge, count) };
}
function aeApplyRawPath(value) {
    var path = { vertices: aeSafeGet(value, "vertices", null), inTangents: aeSafeGet(value, "inTangents", null), outTangents: aeSafeGet(value, "outTangents", null), closed: aeSafeGet(value, "closed", null) };
    if (!aeIsArray(path.vertices) || !aeIsArray(path.inTangents) || !aeIsArray(path.outTangents) || typeof path.closed !== "boolean") return null;
    return (path.inTangents.length === path.vertices.length && path.outTangents.length === path.vertices.length) ? path : null;
}
// A path of up to 256 vertices comes back whole, while the shared budget lasts; a longer one as its count, closed flag,
// weighted digest and its first and last 8 points of each array, so a 12000-point design stays a bounded reply.
function aeApplyBoundedPath(value, budget) {
    var path = value ? aeApplyRawPath(value) : null;
    if (!path) return null;
    var count = path.vertices.length;
    if (count > AE_APPLY_PATH_FULL_LIMIT || (budget && budget.points < count)) return aeApplyPathSummary(path);
    if (budget) budget.points -= count;
    var full = aeApplyCopyPathArrays(path, 0, count);
    if (full) full.closed = path.closed;
    return full;
}
/** Returns a fresh path-point budget {points}. */
function aeApplyPathBudget() { return { points: AE_APPLY_PATH_BUDGET }; }
function aeApplyNumericValue(value) {
    if (typeof value === "number") return isFinite(value) ? value : null;
    if (!aeIsArray(value) || value.length < 1 || value.length > 4 || !aeAllFinite(value)) return null;
    return value.slice(0);
}
function aeApplyPropertyNumber(property) { return property ? aeApplyNumericValue(aeSafeGet(property, "value", null)) : null; }
var AE_APPLY_GROUP_TRANSFORM = { anchor: "ADBE Vector Anchor", position: "ADBE Vector Position", scale: "ADBE Vector Scale", rotation: "ADBE Vector Rotation", opacity: "ADBE Vector Group Opacity" };
/** Reads a shape group's transform. Returns a map of transform field to number (null when unreadable). */
function aeApplyReadGroupTransform(group) {
    var transform = {};
    for (var key in AE_APPLY_GROUP_TRANSFORM) if (aeHasOwn(AE_APPLY_GROUP_TRANSFORM, key)) transform[key] = aeApplyPropertyNumber(aeApplyFindProperty(group, "ADBE Vector Transform Group/" + AE_APPLY_GROUP_TRANSFORM[key]));
    return transform;
}
// The ordered children of a vector group's Contents, front to back as AE stacks them, capped at 64.
function aeApplyReadGroupChildren(group) {
    var contents = aeApplyFindProperty(group, "ADBE Vectors Group"), count = contents ? aeSafeGet(contents, "numProperties", 0) : 0, children = [];
    if (!contents) return null;
    for (var index = 1; index <= count && index <= AE_APPLY_CHILD_LIMIT; index += 1) {
        var child = aeSafeProperty(contents, index);
        children.push({ matchName: String(aeSafeGet(child, "matchName", "")), name: String(aeSafeGet(child, "name", "")) });
    }
    return { count: count, children: children };
}
// Rendered-bounds evidence: the layer's own content rectangle without stroke extents, in layer space.
function aeApplyLayerBounds(layer, time) {
    var rect = aeSafe(function () { return typeof layer.sourceRectAtTime === "function" ? layer.sourceRectAtTime(time, false) : null; }, null);
    if (!rect) return null;
    var bounds = { left: aeSafeGet(rect, "left", null), top: aeSafeGet(rect, "top", null), width: aeSafeGet(rect, "width", null), height: aeSafeGet(rect, "height", null) };
    for (var key in bounds) if (aeHasOwn(bounds, key) && (typeof bounds[key] !== "number" || !isFinite(bounds[key]))) return null;
    return bounds;
}
/** Number of masks on the layer, or null when unreadable. */
function aeApplyMaskCount(layer) { var parade = aeApplyFindProperty(layer, "ADBE Mask Parade"), count = parade ? aeSafeGet(parade, "numProperties", null) : null; return (typeof count === "number" && isFinite(count)) ? count : null; }
/** The object's enabled flag as a boolean, or null when unreadable. */
function aeApplyEnabledState(object) { return object ? aeSafe(function () { return typeof object.enabled === "boolean" ? object.enabled : null; }, null) : null; }
/** Whether time remapping is enabled on the layer, as a boolean, or null when unreadable. */
function aeApplyTimeRemapState(layer) { return aeSafe(function () { return typeof layer.timeRemapEnabled === "boolean" ? layer.timeRemapEnabled : null; }, null); }
function aeApplyEssentialNames(comp, count) {
    var names = [];
    for (var index = 0; index <= count && index <= AE_APPLY_ESSENTIAL_LIMIT; index += 1) {
        var name = aeSafe(function () { return comp.getMotionGraphicsTemplateControllerName(index); }, null);
        if (typeof name === "string") names.push(name.slice(0, 256));
    }
    return names;
}
// Essential Graphics membership: the controller count and names, or null where this AE has no getter. The index base is
// not documented, so every index from 0 to count is read, each guarded, and a miss is skipped.
function aeApplyEssentialState(comp) {
    if (!comp || !aeSafe(function () { return typeof comp.getMotionGraphicsTemplateControllerName === "function"; }, false)) return null;
    var count = aeSafeGet(comp, "motionGraphicsTemplateControllerCount", null);
    if (typeof count !== "number" || !isFinite(count) || count < 0) return null;
    return { count: count, names: aeApplyEssentialNames(comp, count) };
}
/**
 * Returns the keys a write left: time and numeric value of each, capped at 32, with `count` the full key count. Every
 * read here is guarded: a getter this host lacks gives null, which the panel reports as unverified, never as a crash.
 */
function aeApplyReadKeys(property) {
    var count = aeSafeGet(property, "numKeys", 0), keys = [];
    for (var index = 1; index <= count && index <= AE_APPLY_KEY_LIMIT; index += 1) {keys.push(
      { time: aeSafe(function () { return property.keyTime(index); }, null),
        value: aeApplyNumericValue(aeSafe(function () { return property.keyValue(index); }, null)) });}
    return { count: count, keys: keys, truncated: count > AE_APPLY_KEY_LIMIT };
}
function aeApplyKeyIndexAt(property, time) { var count = aeSafeGet(property, "numKeys", 0); for (var index = 1; index <= count; index += 1) if (Math.abs(aeSafe(function () { return property.keyTime(index); }, -1) - time) < 0.0005) return index; return 0; }
function aeApplyShapeKeyValue(property, keyframe, budget) {
    var time = keyframe ? keyframe.time : undefined, key = typeof time === "number" ? aeApplyKeyIndexAt(property, time) : 0;
    return { time: typeof time === "number" ? time : null, value: key ? aeApplyBoundedPath(aeSafe(function () { return property.keyValue(key); }, null), budget) : null };
}
// The full path at each requested key time of a shape-valued property, bounded like any path read; null for other properties.
function aeApplyReadShapeKeyValues(property, keyframes) {
    if (!aeIsArray(keyframes) || !aeSafe(function () { return !!property.keyValue(1).vertices; }, false)) return null;
    var values = [], budget = aeApplyPathBudget();
    for (var index = 0; index < keyframes.length && index < AE_APPLY_KEY_LIMIT; index += 1) {
        values.push(aeApplyShapeKeyValue(property, keyframes[index], budget));
    }
    return values;
}
function aeApplyProbeAt(property, time, preExpression) { return aeApplyNumericValue(
  aeSafe(function () { return property.valueAtTime(time, preExpression); }, null)); }
function aeApplyWiggleProbe(property, times) {
    var samples = [];
    for (var index = 0; index < times.length && index < 8; index += 1) {samples.push(
      { time: times[index], value: aeApplyProbeAt(property, times[index], false), base: aeApplyProbeAt(property, times[index], true) });}
    return samples;
}
function aeApplyLoopProbe(property, source) {
    var pingpong = /pingpong/.test(String(source));
    var count = aeSafeGet(property, "numKeys", 0), first = aeSafe(function () { return property.keyTime(1); }, null), last = aeSafe(function () { return property.keyTime(count); }, null), points = [];
    if (count < 2 || typeof first !== "number" || typeof last !== "number" || !(last > first)) return null;
    for (var step = 1; step <= 3; step += 1) { var offset = (last - first) * step / 4;
      points.push({ offset: offset, looped: aeApplyProbeAt(property, last + offset, false),
        keyed: aeApplyProbeAt(property, pingpong ? last - offset : first + offset, true) }); }
    return { firstKey: first, lastKey: last, points: points };
}
/**
 * Evaluates a wiggle or loopOut expression's effect. Returns {wiggle} or {loop}, or null for any other source. Returns
 * raw numbers at bounded times, only for the two source shapes the panel can check from values alone: wiggle(f, a) and
 * loopOut("cycle") or loopOut("pingpong").
 */
function aeApplyExpressionProbe(property, source, times) {
    var text = String(source);
    if (text.indexOf("wiggle") >= 0) return { wiggle: aeApplyWiggleProbe(property, times) };
    if (text.indexOf("loopOut") >= 0) return { loop: aeApplyLoopProbe(property, text) };
    return null;
}
