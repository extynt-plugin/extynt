/* Apply: shape groups, paint and path writes, vector artwork drawing, shape item operations. It sits under apply-
 * flow.jsx.
 */
/* global aeApplyValSpecsPass, aeApplyBoundedPath, aeApplyChildSegment, aeApplyFindProperty, aeIsArray, aeApplyIsNewItemId, aeApplyIsRecordValue,
  aeApplyLayerBounds, aeApplyNthChildIndex, aeApplyPathBudget, aeApplyReadGroupChildren, aeApplyReadGroupTransform, aeApplySpecWritesValid,
  aeApplyWritableProperty, aeApplyWriteSpecValues, aeHasOwn, aeListHas, aeNumberInRange, aeOwnValue, aeSafe, aeSafeGet, aeSafeProperty */
/* exported aeApplyCreateShapeGroup, aeApplyDrawVectorShapes, aeApplyEnsureShapeFill, aeApplyEnsureShapeStroke, aeApplyReadShapeGroup,
  aeApplyResolveShapeGroup, aeApplySetShapePath, aeApplyShapeItem, aeApplyValidShapeItemOperation, aeApplyVectorShapesValid */
function aeApplyShapePointValid(point) { return point instanceof Array && point.length === 2 && typeof point[0] === "number" && typeof point[1] === "number" && isFinite(point[0]) && isFinite(point[1]) && Math.abs(point[0]) <= 1000000 && Math.abs(point[1]) <= 1000000; }
var AE_APPLY_SHAPE_PATH_KEYS = ["vertices", "inTangents", "outTangents", "closed"];
function aeApplyShapePointsValid(points) { for (var pointIndex = 0; pointIndex < points.length; pointIndex += 1) {if (
  !aeApplyShapePointValid(points[pointIndex])) return false;} return true; }
function aeApplyShapePathKeysValid(path) { for (var key in path) {if (
  !path.hasOwnProperty(key) || !aeListHas(AE_APPLY_SHAPE_PATH_KEYS, key)) return false;} return true; }
function aeApplyShapeTangentsValid(path) {
    var tangentNames = ["inTangents", "outTangents"];
    for (var tangentIndex = 0; tangentIndex < tangentNames.length; tangentIndex += 1) {
        var tangents = path[tangentNames[tangentIndex]];
        if (tangents === undefined) continue;
        if (!(tangents instanceof Array) || tangents.length !== path.vertices.length || !aeApplyShapePointsValid(tangents)) return false;
    }
    return true;
}
function aeApplyShapePathKeysetValid(path) {
    if (!path || typeof path !== "object" || path instanceof Array) return false;
    return path.hasOwnProperty("vertices") && path.hasOwnProperty("closed") && aeApplyShapePathKeysValid(path);
}
function aeApplyShapePathValid(path) {
    if (!aeApplyShapePathKeysetValid(path)) return false;
    if (!(path.vertices instanceof Array) || path.vertices.length < 1 || path.vertices.length > 1000 || typeof path.closed !== "boolean") return false;
    return aeApplyShapePointsValid(path.vertices) && aeApplyShapeTangentsValid(path);
}
function aeApplyNativeShape(path) { if (!aeApplyShapePathValid(path) || typeof Shape === "undefined") throw new Error("INVALID_VALUE"); var value = new Shape(), zeroTangents = [], index; for (index = 0; index < path.vertices.length; index += 1) zeroTangents.push([0, 0]); value.vertices = path.vertices; value.inTangents = path.inTangents === undefined ? zeroTangents : path.inTangents; value.outTangents = path.outTangents === undefined ? zeroTangents : path.outTangents; value.closed = path.closed; return value; }
function aeApplyShapeValuesValidColor(color) {
    if (!aeIsArray(color) || color.length !== 3) return false;
    for (var channel = 0; channel < 3; channel += 1) if (typeof color[channel] !== "number" || !isFinite(color[channel]) || color[channel] < 0 || color[channel] > 1) return false;
    return true;
}
function aeApplyShapeGroupIdValid(value) { return typeof value === "string" && (value === "root" || /^shape:[1-9][0-9]{0,2}$/.test(value) || aeApplyIsNewItemId(value)); }
function aeApplyShapeRoot(layer) { return aeApplyFindProperty(layer, "ADBE Root Vectors Group"); }
function aeApplyShapeByOrdinal(layer, ordinal) { var root = aeApplyShapeRoot(layer); if (!root) return null; var count = aeSafeGet(root, "numProperties", 0); if (ordinal < 1 || ordinal > count) return null; var group = aeSafeProperty(root, ordinal); return (group && String(aeSafeGet(group, "matchName", "")) === "ADBE Vector Group") ? group : null; }
/**
 * The shape group for an id: the root, a group created in this plan, or a "shape:<n>" ordinal; otherwise null.
 * Resolves a created group by AE's propertyIndex backed by the ordinal recorded at creation, because a property() call
 * returns a fresh wrapper that is never ===.
 */
function aeApplyResolveShapeGroup(layer, groupId, createdGroups) { if (groupId === "root") return aeApplyShapeRoot(layer); var created = aeOwnValue(createdGroups, groupId); if (created) return created; var match = /^shape:([1-9][0-9]{0,2})$/.exec(String(groupId)); return match ? aeApplyShapeByOrdinal(layer, Number(match[1])) : null; }
function aeApplyShapeContents(group) { return aeApplyFindProperty(group, "ADBE Vectors Group"); }
function aeApplyEnsureShapeGraphic(group, matchName) { var root = String(aeSafeGet(group, "matchName", "")) === "ADBE Root Vectors Group", contents = root ? group : aeApplyShapeContents(group), path = root ? matchName : "ADBE Vectors Group/" + matchName; if (!contents || typeof contents.addProperty !== "function") throw new Error("SHAPE_UNSUPPORTED"); var existing = aeApplyFindProperty(group, path); if (existing) return existing; var created = aeSafe(function () { return contents.addProperty(matchName); }, null); if (!created) throw new Error("SHAPE_UNSUPPORTED"); return aeApplyFindProperty(group, path) || created; }
function aeApplyReadShapePath(property) { var path = aeApplyBoundedPath(aeSafeGet(property, "value", null), null); if (path) path.matchName = String(aeSafeGet(property, "matchName", "")); return path; }
function aeApplyReadShapePaint(graphic, bindings) { var result = { matchName: String(aeSafeGet(graphic, "matchName", "")) }, key; for (key in bindings) { var property = aeApplyFindProperty(graphic, bindings[key]); if (!property) return null; result[key] = aeSafeGet(property, "value", null); } return result; }
function aeApplyOrdinalInRange(value, count) { return typeof value === "number" && value >= 1 && value <= count; }
function aeApplyShapeGroupOrdinal(root, group, recordedOrdinal) {
    var count = aeSafeGet(root, "numProperties", 0), indexed = aeSafeGet(group, "propertyIndex", 0);
    if (aeApplyOrdinalInRange(indexed, count)) return indexed;
    for (var index = 1; index <= count; index += 1) if (aeSafeProperty(root, index) === group) return index;
    return aeApplyOrdinalInRange(recordedOrdinal, count) ? recordedOrdinal : 0;
}
/** Reads a shape group back. Returns {matchName,name,ordinal,contents,transform}. */
function aeApplyReadShapeGroup(layer, group, recordedOrdinal) { var root = aeApplyShapeRoot(layer), ordinal = root ? aeApplyShapeGroupOrdinal(root, group, recordedOrdinal) : 0, found = ordinal ? aeSafeProperty(root, ordinal) : null; return { matchName: String(aeSafeGet(found, "matchName", "")), name: String(aeSafeGet(found, "name", "")), ordinal: ordinal, contents: found ? aeApplyReadGroupChildren(found) : null, transform: found ? aeApplyReadGroupTransform(found) : null }; }
/** Adds a named shape group. Returns the group; throws Error(SHAPE_UNSUPPORTED or PROPERTY_WRITE_FAILED). */
function aeApplyCreateShapeGroup(layer, operation, createdGroups) { var root = aeApplyShapeRoot(layer); if (!root || typeof root.addProperty !== "function") throw new Error("SHAPE_UNSUPPORTED"); var group = aeSafe(function () { return root.addProperty("ADBE Vector Group"); }, null); if (!group || String(aeSafeGet(group, "matchName", "")) !== "ADBE Vector Group") throw new Error("SHAPE_UNSUPPORTED"); try { group.name = operation.name; } catch (shapeNameError) { throw new Error("PROPERTY_WRITE_FAILED"); } createdGroups[operation.newGroupId] = group; createdGroups[operation.newGroupId + "#index"] = aeSafe(function () { return aeApplyShapeRoot(layer).numProperties; }, 0); return group; }
var VECTOR_FILL_PATHS = { color: "ADBE Vector Fill Color", opacity: "ADBE Vector Fill Opacity", rule: "ADBE Vector Fill Rule" };
var VECTOR_STROKE_PATHS = { color: "ADBE Vector Stroke Color", width: "ADBE Vector Stroke Width", opacity: "ADBE Vector Stroke Opacity", cap: "ADBE Vector Stroke Line Cap", join: "ADBE Vector Stroke Line Join", miterLimit: "ADBE Vector Stroke Miter Limit" };
function aeApplyVectorMenuValid(value, max) { return value === undefined || (aeNumberInRange(value, 1, max) && Math.floor(value) === value); }
function aeApplyVectorKeysValid(value, allowed) { for (var key in value) if (aeHasOwn(value, key) && !aeHasOwn(allowed, key)) return false; return true; }
function aeApplyVectorOptionalNumberValid(value, min, max) { return value === undefined || aeNumberInRange(value, min, max); }
function aeApplyVectorFillValid(fill) { if (fill === undefined) return true; return aeApplyIsRecordValue(fill)
  && aeApplyVectorKeysValid(fill, VECTOR_FILL_PATHS) && aeApplyShapeValuesValidColor(fill.color)
    && aeApplyVectorOptionalNumberValid(fill.opacity, 0, 100) && aeApplyVectorMenuValid(fill.rule, 2); }
var AE_APPLY_VECTOR_STROKE_SPECS = [["color", "color"], ["width", "numAbove", 0, 10000], ["opacity", "num", 0, 100, 1], ["cap", "integer", 1, 3, 1], ["join", "integer", 1, 3, 1], ["miterLimit", "num", 1, 100, 1]];
function aeApplyVectorStrokeFieldsValid(stroke) { return aeApplyValSpecsPass(stroke, AE_APPLY_VECTOR_STROKE_SPECS); }
function aeApplyVectorStrokeValid(stroke) {
    if (stroke === undefined) return true;
    if (!aeApplyIsRecordValue(stroke) || !aeApplyVectorKeysValid(stroke, VECTOR_STROKE_PATHS)) return false;
    return aeApplyVectorStrokeFieldsValid(stroke);
}
function aeApplyVectorShapeHeadValid(shape) {
    if (typeof shape.name !== "string" || shape.name.length < 1 || shape.name.length > 256) return false;
    if (!aeIsArray(shape.paths) || shape.paths.length < 1 || shape.paths.length > 64) return false;
    return shape.fill !== undefined || shape.stroke !== undefined;
}
function aeApplyVectorShapeValid(shape) {
    if (!aeApplyIsRecordValue(shape) || !aeApplyVectorKeysValid(shape, { name: true, paths: true, fill: true, stroke: true, opacity: true })) return false;
    if (!aeApplyVectorShapeHeadValid(shape)) return false;
    for (var p = 0; p < shape.paths.length; p += 1) if (!aeApplyShapePathValid(shape.paths[p])) return false;
    return aeApplyVectorFillValid(shape.fill) && aeApplyVectorStrokeValid(shape.stroke) && aeApplyVectorOptionalNumberValid(shape.opacity, 0, 100);
}
/** True when the shapes array has 1 to 256 valid shapes within the total point budget. */
function aeApplyVectorShapesValid(shapes) { if (!aeIsArray(shapes) || shapes.length < 1 || shapes.length > 256) return false; var points = 0;
  for (var s = 0; s < shapes.length; s += 1) { if (!aeApplyVectorShapeValid(shapes[s])) return false;
    for (var p = 0; p < shapes[s].paths.length; p += 1) points += shapes[s].paths[p].vertices.length; } return points <= 12000; }
function aeApplyAddVectorItem(contents, matchName) {
    var added = aeSafe(function () { return contents.addProperty(matchName); }, null);
    if (!added) throw new Error("SHAPE_UNSUPPORTED");
    var count = aeSafeGet(contents, "numProperties", 0), last = count ? aeSafeProperty(contents, count) : null;
    return (last && String(aeSafeGet(last, "matchName", "")) === matchName) ? last : added;
}
function aeApplyWriteVectorValue(item, path, value) { var property = aeApplyFindProperty(item, path); if (!aeApplyWritableProperty(property, "setValue")) throw new Error("PROPERTY_NOT_SETTABLE: " + path); try { property.setValue(value); } catch (vectorWriteError) { throw new Error("PROPERTY_WRITE_FAILED: " + path); } }
function aeApplyAddVectorPaint(contents, matchName, paint, paths) {
  var item = aeApplyAddVectorItem(contents, matchName); for (var key in paths) {if (
    aeHasOwn(paths, key) && paint[key] !== undefined) aeApplyWriteVectorValue(item, paths[key], paint[key]);} }
function aeApplyAddNamedVectorGroup(root, name) {
    var group = aeSafe(function () { return root.addProperty("ADBE Vector Group"); }, null);
    if (!group || String(aeSafeGet(group, "matchName", "")) !== "ADBE Vector Group") throw new Error("SHAPE_UNSUPPORTED");
    try { group.name = name; } catch (vectorNameError) { throw new Error("PROPERTY_WRITE_FAILED"); }
    return group;
}
function aeApplyVectorGroupContents(group) {
    var contents = aeApplyShapeContents(group);
    if (!contents || typeof contents.addProperty !== "function") throw new Error("SHAPE_UNSUPPORTED");
    return contents;
}
function aeApplyDrawVectorShape(root, shape) {
    var group = aeApplyAddNamedVectorGroup(root, shape.name);
    if (shape.opacity !== undefined) aeApplyWriteVectorValue(group, "ADBE Vector Transform Group/ADBE Vector Group Opacity", shape.opacity);
    var contents = aeApplyVectorGroupContents(group);
    for (var p = 0; p < shape.paths.length; p += 1) aeApplyWriteVectorValue(aeApplyAddVectorItem(contents, "ADBE Vector Shape - Group"), "ADBE Vector Shape", aeApplyNativeShape(shape.paths[p]));
    if (shape.stroke) aeApplyAddVectorPaint(contents, "ADBE Vector Graphic - Stroke", shape.stroke, VECTOR_STROKE_PATHS);
    if (shape.fill) aeApplyAddVectorPaint(contents, "ADBE Vector Graphic - Fill", shape.fill, VECTOR_FILL_PATHS);
}
function aeApplyVectorPathDigest(value) {
    var vertices = aeSafeGet(value, "vertices", null), ins = aeSafeGet(value, "inTangents", null), outs = aeSafeGet(value, "outTangents", null), sum = 0;
    if (!vertices || !ins || !outs || ins.length !== vertices.length || outs.length !== vertices.length) return null;
    for (var v = 0; v < vertices.length; v += 1) sum += vertices[v][0] + 2 * vertices[v][1] + 3 * ins[v][0] + 5 * ins[v][1] + 7 * outs[v][0] + 11 * outs[v][1];
    return { points: vertices.length, closed: aeSafe(function () { return value.closed === true; }, false), sum: sum };
}
function aeApplyReadVectorItem(result, item, budget) {
    var matchName = item ? String(aeSafeGet(item, "matchName", "")) : "";
    if (matchName === "ADBE Vector Graphic - Fill") { result.fill = aeApplyReadShapePaint(item, VECTOR_FILL_PATHS); return; }
    if (matchName === "ADBE Vector Graphic - Stroke") { result.stroke = aeApplyReadShapePaint(item, VECTOR_STROKE_PATHS); return; }
    if (matchName === "ADBE Vector Shape - Group") aeApplyReadVectorPath(result, item, budget);
}
function aeApplyReadVectorPath(result, item, budget) {
    var shapeProperty = aeApplyFindProperty(item, "ADBE Vector Shape"), shapeValue = shapeProperty ? aeSafeGet(shapeProperty, "value", null) : null, digest = shapeValue ? aeApplyVectorPathDigest(shapeValue) : null;
    result.paths += 1; result.pathValues.push(shapeValue ? aeApplyBoundedPath(shapeValue, budget) : null);
    if (!digest || result.checksum === null) { result.checksum = null; return; }
    result.points += digest.points; result.checksum += digest.sum; if (digest.closed) result.closedPaths += 1;
}
function aeApplyReadVectorGroup(group, ordinal, budget) {
    var contents = aeApplyShapeContents(group), count = contents ? aeSafeGet(contents, "numProperties", 0) : 0, opacity = aeApplyFindProperty(group, "ADBE Vector Transform Group/ADBE Vector Group Opacity");
    var result = { ordinal: ordinal, matchName: String(aeSafeGet(group, "matchName", "")), name: String(aeSafeGet(group, "name", "")), paths: 0, points: 0, closedPaths: 0, checksum: 0, fill: null, stroke: null, opacity: opacity ? aeSafeGet(opacity, "value", null) : null, pathValues: [], contents: aeApplyReadGroupChildren(group), transform: aeApplyReadGroupTransform(group) };
    for (var i = 1; i <= count; i += 1) aeApplyReadVectorItem(result, aeSafeProperty(contents, i), budget);
    return result;
}
function aeApplyReadVectorShapes(layer, existing, count) {
    var root = aeApplyShapeRoot(layer), total = root ? aeSafeGet(root, "numProperties", 0) : 0, groups = [], budget = aeApplyPathBudget();
    for (var i = 0; i < count; i += 1) { var ordinal = existing + count - i, group = ordinal <= total ? aeSafeProperty(root, ordinal) : null;
      groups.push(group ? aeApplyReadVectorGroup(group, ordinal, budget) : null); }
    return { matchName: "ADBE Root Vectors Group", existing: existing, total: total, groups: groups, bounds: aeApplyLayerBounds(layer, 0) };
}
/**
 * Draws the operation's vector shapes onto the layer. Returns the shapes read back from the layer; throws
 * Error(SHAPE_UNSUPPORTED). Draws a whole design layer in one step: the frontmost shape is added first, since
 * addProperty appends at the back, each group is finished before the next so no reference crosses an addProperty, and
 * one point budget spans the layer.
 */
function aeApplyDrawVectorShapes(layer, operation) {
    var root = aeApplyShapeRoot(layer); if (!root || typeof root.addProperty !== "function") throw new Error("SHAPE_UNSUPPORTED");
    var existing = aeSafeGet(root, "numProperties", 0), count = operation.shapes.length;
    for (var s = count - 1; s >= 0; s -= 1) aeApplyDrawVectorShape(aeApplyShapeRoot(layer), operation.shapes[s]);
    return aeApplyReadVectorShapes(layer, existing, count);
}
/** Writes a path onto the group's path item. Returns nothing; throws on an unsettable property or failed write. */
function aeApplySetShapePath(group, path) { var shape = aeApplyEnsureShapeGraphic(group, "ADBE Vector Shape - Group"), property = aeApplyFindProperty(shape, "ADBE Vector Shape"), value = aeApplyNativeShape(path); if (!aeApplyWritableProperty(property, "setValue")) throw new Error("PROPERTY_NOT_SETTABLE"); try { property.setValue(value); } catch (shapePathError) { throw new Error("PROPERTY_WRITE_FAILED"); } return aeApplyReadShapePath(property); }
/** Adds or reuses the group's fill and writes colour and opacity. Returns nothing; throws PROPERTY_NOT_SETTABLE or PROPERTY_WRITE_FAILED. */
function aeApplyEnsureShapeFill(group, operation) { var fill = aeApplyEnsureShapeGraphic(group, "ADBE Vector Graphic - Fill"), color = aeApplyFindProperty(fill, "ADBE Vector Fill Color"), opacity = aeApplyFindProperty(fill, "ADBE Vector Fill Opacity"); if (!aeApplyWritableProperty(color, "setValue") || (operation.opacity !== undefined && !aeApplyWritableProperty(opacity, "setValue"))) throw new Error("PROPERTY_NOT_SETTABLE"); try { color.setValue(operation.color); if (operation.opacity !== undefined) opacity.setValue(operation.opacity); } catch (shapeFillError) { throw new Error("PROPERTY_WRITE_FAILED"); } return aeApplyReadShapePaint(fill, { color: "ADBE Vector Fill Color", opacity: "ADBE Vector Fill Opacity" }); }
/**
 * Adds or reuses the group's stroke and writes colour and width. Returns nothing; throws PROPERTY_NOT_SETTABLE or
 * PROPERTY_WRITE_FAILED. A stroke sits above its fill, the order AE's own tools use.
 */
function aeApplyEnsureShapeStroke(group, operation) { var stroke = aeApplyEnsureShapeGraphic(group, "ADBE Vector Graphic - Stroke"), color = aeApplyFindProperty(stroke, "ADBE Vector Stroke Color"), width = aeApplyFindProperty(stroke, "ADBE Vector Stroke Width"), opacity = aeApplyFindProperty(stroke, "ADBE Vector Stroke Opacity"); if (!aeApplyWritableProperty(color, "setValue") || !aeApplyWritableProperty(width, "setValue") || (operation.opacity !== undefined && !aeApplyWritableProperty(opacity, "setValue"))) throw new Error("PROPERTY_NOT_SETTABLE"); try { color.setValue(operation.color); width.setValue(operation.width); if (operation.opacity !== undefined) opacity.setValue(operation.opacity); } catch (shapeStrokeError) { throw new Error("PROPERTY_WRITE_FAILED"); } return aeApplyReadShapePaint(stroke, { color: "ADBE Vector Stroke Color", width: "ADBE Vector Stroke Width", opacity: "ADBE Vector Stroke Opacity" }); }
var HOST_SHAPE_ITEM_PATHS = {"ADBE Vector Shape - Rect":["ADBE Vector Rect Size","ADBE Vector Rect Position","ADBE Vector Rect Roundness","ADBE Vector Shape Direction"],"ADBE Vector Shape - Ellipse":["ADBE Vector Ellipse Size","ADBE Vector Ellipse Position","ADBE Vector Shape Direction"],"ADBE Vector Shape - Star":["ADBE Vector Star Type","ADBE Vector Star Points","ADBE Vector Star Position","ADBE Vector Star Rotation","ADBE Vector Star Inner Radius","ADBE Vector Star Outer Radius","ADBE Vector Star Inner Roundess","ADBE Vector Star Outer Roundess","ADBE Vector Shape Direction"],"ADBE Vector Graphic - G-Fill":["ADBE Vector Grad Type","ADBE Vector Grad Start Pt","ADBE Vector Grad End Pt","ADBE Vector Grad HiLite Length","ADBE Vector Grad HiLite Angle","ADBE Vector Fill Opacity","ADBE Vector Fill Rule","ADBE Vector Blend Mode"],"ADBE Vector Graphic - G-Stroke":["ADBE Vector Grad Type","ADBE Vector Grad Start Pt","ADBE Vector Grad End Pt","ADBE Vector Grad HiLite Length","ADBE Vector Grad HiLite Angle","ADBE Vector Stroke Opacity","ADBE Vector Stroke Width","ADBE Vector Stroke Line Cap","ADBE Vector Stroke Line Join","ADBE Vector Stroke Miter Limit","ADBE Vector Blend Mode"],"ADBE Vector Filter - Merge":["ADBE Vector Merge Type"],"ADBE Vector Filter - Offset":["ADBE Vector Offset Amount","ADBE Vector Offset Line Join","ADBE Vector Offset Miter Limit","ADBE Vector Offset Copies","ADBE Vector Offset Copy Offset"],"ADBE Vector Filter - PB":["ADBE Vector PuckerBloat Amount"],"ADBE Vector Filter - Repeater":["ADBE Vector Repeater Copies","ADBE Vector Repeater Offset","ADBE Vector Repeater Order","ADBE Vector Repeater Transform/ADBE Vector Repeater Anchor","ADBE Vector Repeater Transform/ADBE Vector Repeater Position","ADBE Vector Repeater Transform/ADBE Vector Repeater Scale","ADBE Vector Repeater Transform/ADBE Vector Repeater Rotation","ADBE Vector Repeater Transform/ADBE Vector Repeater Opacity 1","ADBE Vector Repeater Transform/ADBE Vector Repeater Opacity 2"],"ADBE Vector Filter - RC":["ADBE Vector RoundCorner Radius"],"ADBE Vector Filter - Trim":["ADBE Vector Trim Start","ADBE Vector Trim End","ADBE Vector Trim Offset","ADBE Vector Trim Type"],"ADBE Vector Filter - Twist":["ADBE Vector Twist Angle","ADBE Vector Twist Center"],"ADBE Vector Filter - Roughen":["ADBE Vector Roughen Size","ADBE Vector Roughen Detail","ADBE Vector Roughen Points","ADBE Vector Temporal Freq","ADBE Vector Correlation","ADBE Vector Temporal Phase","ADBE Vector Spatial Phase","ADBE Vector Random Seed"],"ADBE Vector Filter - Wiggler":["ADBE Vector Xform Temporal Freq","ADBE Vector Correlation","ADBE Vector Temporal Phase","ADBE Vector Spatial Phase","ADBE Vector Random Seed","ADBE Vector Wiggler Transform/ADBE Vector Wiggler Anchor","ADBE Vector Wiggler Transform/ADBE Vector Wiggler Position","ADBE Vector Wiggler Transform/ADBE Vector Wiggler Scale","ADBE Vector Wiggler Transform/ADBE Vector Wiggler Rotation"],"ADBE Vector Filter - Zigzag":["ADBE Vector Zigzag Size","ADBE Vector Zigzag Detail","ADBE Vector Zigzag Points"]};
function aeApplyShapeItemRefValid(operation) {
    if (operation.operation === "add_shape_item") return aeApplyIsNewItemId(operation.newItemId);
    return typeof operation.itemId === "string" && (/^item:[1-9][0-9]{0,2}$/.test(operation.itemId) || aeApplyIsNewItemId(operation.itemId));
}
function aeApplyShapeItemNameValid(name) { return name === undefined || (typeof name === "string" && name.length >= 1 && name.length <= 256); }
/** True when a shape item operation names a known item with valid group, ref, name and path-allowed writes. */
function aeApplyValidShapeItemOperation(operation) {
    if (typeof operation.itemMatchName !== "string" || !aeHasOwn(HOST_SHAPE_ITEM_PATHS, operation.itemMatchName)) return false;
    if (!aeApplyShapeGroupIdValid(operation.groupId) || !aeApplyShapeItemRefValid(operation) || !aeApplyShapeItemNameValid(operation.name)) return false;
    var paths = HOST_SHAPE_ITEM_PATHS[operation.itemMatchName];
    return aeApplySpecWritesValid(operation, function (path) { return aeListHas(paths, path); });
}
function aeApplyShapeGroupIndex(layer, groupId, createdShapeGroups) {
    var match = /^shape:([1-9][0-9]{0,2})$/.exec(String(groupId)); if (match) return aeApplyShapeByOrdinal(layer, Number(match[1])) ? Number(match[1]) : 0;
    var group = aeOwnValue(createdShapeGroups, groupId), root = aeApplyShapeRoot(layer);
    return (group && root) ? aeApplyShapeGroupOrdinal(root, group, createdShapeGroups[groupId + "#index"]) : 0;
}
function aeApplyShapeItemContents(layer, groupId, createdShapeGroups) {
    if (groupId === "root") { var root = aeApplyShapeRoot(layer); return root ? { contents: root, path: "ADBE Root Vectors Group" } : null; }
    var index = aeApplyShapeGroupIndex(layer, groupId, createdShapeGroups), group = index ? aeApplyShapeByOrdinal(layer, index)
      : aeOwnValue(createdShapeGroups, groupId);
    var contents = group ? aeApplyShapeContents(group) : null; if (!contents) return null;
    return { contents: contents, path: index ? "ADBE Root Vectors Group/" + aeApplyChildSegment(aeApplyShapeRoot(layer), index) + "/ADBE Vectors Group" : null };
}
function aeApplyShapeItemKey(operation) { return operation.compositionId + ":" + operation.layerId + ":" + operation.groupId + ":"; }
function aeApplyAddShapeItemAt(operation, scope, located) {
    var key = aeApplyShapeItemKey(operation);
    if (!aeSafe(function () { return located.contents.addProperty(operation.itemMatchName); }, null)) throw new Error("SHAPE_ITEM_UNSUPPORTED: " + operation.itemMatchName + " could not be added here.");
    located = aeApplyShapeItemContents(scope.layer, operation.groupId, scope.groups);
    var index = aeSafe(function () { return located.contents.numProperties; }, 0);
    if (String(aeSafe(function () { return located.contents.property(index).matchName; }, "")) !== operation.itemMatchName) throw new Error("SHAPE_ITEM_UNSUPPORTED: the new item was not found.");
    if (operation.name) { try { located.contents.property(index).name = operation.name; } catch (itemNameError) { throw new Error("PROPERTY_WRITE_FAILED: shape item name"); } }
    scope.items[key + operation.newItemId] = index;
    return { located: located, index: index };
}
function aeApplyExistingShapeItemIndex(operation, createdShapeItems, located) {
    var index = createdShapeItems[aeApplyShapeItemKey(operation) + operation.itemId] || 0;
    if (!index) { var match = /^item:([1-9][0-9]{0,2})$/.exec(operation.itemId); index = match
      ? aeApplyNthChildIndex(located.contents, operation.itemMatchName, Number(match[1])) : 0; }
    if (!index || String(aeSafe(function () { return located.contents.property(index).matchName; }, "")) !== operation.itemMatchName) throw new Error("TARGET_NOT_FOUND: " + operation.itemId);
    return index;
}
/** Adds or reuses a shape item and applies its writes and animations. Returns {index,created,itemPath,writes,animations,groupTransform}. */
function aeApplyShapeItem(layer, operation, createdShapeGroups, createdShapeItems) {
    var located = aeApplyShapeItemContents(layer, operation.groupId, createdShapeGroups); if (!located || typeof located.contents.addProperty !== "function") throw new Error("TARGET_NOT_FOUND: shape group " + operation.groupId);
    var key = aeApplyShapeItemKey(operation), index, created = false;
    if (operation.operation === "add_shape_item") {
        var added = aeApplyAddShapeItemAt(operation, { layer: layer, groups: createdShapeGroups, items: createdShapeItems }, located);
        located = added.located; index = added.index; created = true;
    } else index = aeApplyExistingShapeItemIndex(operation, createdShapeItems, located);
    var itemPath = located.path ? located.path + "/" + aeApplyChildSegment(located.contents, index) : null;
    var result = aeApplyWriteSpecValues(located.contents.property(index), itemPath, operation, key + index + "/"), group = operation.groupId === "root" ? null : aeApplyResolveShapeGroup(layer, operation.groupId, createdShapeGroups);
    return { index: index, created: created, itemPath: itemPath, writes: result.writes, animations: result.animations, groupTransform: group
      ? aeApplyReadGroupTransform(group) : null };
}
