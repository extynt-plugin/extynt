/* Apply steps that make a second layer from a layer (split, audio to keyframes, shapes from a layer, path nulls) and
 * the time-remap retimes (reverse, freeze). It sits under apply-flow.jsx.
 */
/* global aeApplyEarlierOperation, AE_APPLY_LAYER_STEPS, AE_APPLY_VAL_CHECKS, AE_APPLY_VAL_NEW_ID, AE_APPLY_VAL_RULES_LAYER, aeApplyCreatedLayers,
   aeApplyDuplicateLayer, aeApplyFindProperty, aeApplyLayerKey, aeApplySetTimeRemap, aeApplyValSpecRule, aeSafe, aeSafeGet */
/* exported aeApplyPlannedTimeRemapBefore */
var AE_DERIVE_COMMANDS = { "audio-keyframes": "Convert Audio to Keyframes", "shapes-from-vector": "Create Shapes from Vector Layer",
  "shapes-from-text": "Create Shapes from Text" };
var AE_DERIVE_KINDS = ["split", "audio-keyframes", "shapes-from-vector", "shapes-from-text", "path-null"];
var AE_DERIVE_POINT_KINDS = ["vertex", "inTangent", "outTangent"];
var AE_DERIVE_RESULT_TYPE = { "audio-keyframes": "null", "shapes-from-vector": "shape", "shapes-from-text": "shape", "path-null": "null" };
var AE_DERIVE_POINT_CALLS = { vertex: "points()", inTangent: "inTangents()", outTangent: "outTangents()" };
var AE_DERIVE_TIME_REMAP = "ADBE Time Remapping";

function aeDerivePathFieldsValid(operation) {
    return AE_APPLY_VAL_CHECKS.integer(operation.pointIndex, 0, 9999) && AE_APPLY_VAL_CHECKS.str(operation.propertyPath, 1, Infinity) &&
        (operation.pointKind === undefined || AE_APPLY_VAL_CHECKS.enumOf(operation.pointKind, AE_DERIVE_POINT_KINDS)) && (operation.name === undefined
          || AE_APPLY_VAL_CHECKS.str(operation.name, 1, 256));
}
function aeDeriveStrayFields(operation) {
    var kind = operation.kind, stray = kind !== "split" && operation.time !== undefined;
    return stray || (kind !== "path-null" && (operation.pointIndex !== undefined || operation.pointKind !== undefined || operation.name !== undefined
      || operation.propertyPath !== undefined));
}
function aeDeriveFieldsValid(operation) {
    if (aeDeriveStrayFields(operation)) return false;
    if (operation.kind === "split") return AE_APPLY_VAL_CHECKS.num(operation.time, 0, 86400);
    return operation.kind !== "path-null" || aeDerivePathFieldsValid(operation);
}
function aeDeriveRetimeFieldsValid(operation) {
    if (operation.mode === "reverse") return operation.time === undefined;
    return operation.mode === "freeze" && AE_APPLY_VAL_CHECKS.num(operation.time, 0, 86400);
}
AE_APPLY_VAL_CHECKS.deriveFields = function (operation) { return AE_APPLY_VAL_CHECKS.enumOf(operation.kind, AE_DERIVE_KINDS)
  && aeDeriveFieldsValid(operation); };
AE_APPLY_VAL_CHECKS.retimeFields = function (operation) { return aeDeriveRetimeFieldsValid(operation); };
AE_APPLY_VAL_RULES_LAYER.derive_layer = aeApplyValSpecRule([["newLayerId", "regex", AE_APPLY_VAL_NEW_ID], [null, "deriveFields"]]);
AE_APPLY_VAL_RULES_LAYER.retime_layer = aeApplyValSpecRule([[null, "retimeFields"]]);

function aeApplyEnablesTimeRemapOn(candidate, operation) {
    if (!candidate || candidate.compositionId !== operation.compositionId || candidate.layerId !== operation.layerId) return false;
    return candidate.operation === "retime_layer" || (candidate.operation === "set_time_remap" && candidate.enabled === true);
}
/**
 * A Time Remapping property appears once an earlier step of the plan enabled it, so a later keyframe write may name
 * it. Reverse and freeze rewrite the two keys After Effects seeds when time remap turns on, and a layer with its own
 * remap keys is refused. A rerun of a reverse finds the keys already running down and leaves them, so it never un-
 * reverses.
 */
function aeApplyPlannedTimeRemapBefore(index, operation) {
    if (operation.propertyPath !== AE_DERIVE_TIME_REMAP) return false;
    return aeApplyEarlierOperation(index, function (candidate) { return aeApplyEnablesTimeRemapOn(candidate, operation); });
}

function aeDeriveSplit(scope, operation) {
    var source = scope.layer, time = operation.time;
    if (!(time > source.inPoint && time < source.outPoint)) throw new Error("INVALID_VALUE");
    var out = source.outPoint, copy = aeApplyDuplicateLayer(source);
    source.outPoint = time;
    copy.inPoint = time;
    if (copy.outPoint !== out) copy.outPoint = out;
    return copy;
}

function aeDeriveLayerIds(comp) {
    var ids = {};
    for (var i = 1; i <= comp.numLayers; i += 1) ids[String(comp.layer(i).id)] = true;
    return ids;
}
function aeDeriveNewLayer(comp, before) {
    for (var i = 1; i <= comp.numLayers; i += 1) if (!before[String(comp.layer(i).id)]) return comp.layer(i);
    return null;
}
function aeDeriveSelectOnly(comp, layer) {
    var saved = [], selected = comp.selectedLayers, i;
    for (i = 0; i < selected.length; i += 1) saved.push(selected[i]);
    for (i = 0; i < saved.length; i += 1) saved[i].selected = false;
    layer.selected = true;
    return saved;
}
function aeDeriveRestoreSelection(comp, layer, saved) {
    var now = comp.selectedLayers, i;
    layer.selected = false;
    for (i = 0; i < now.length; i += 1) now[i].selected = false;
    for (i = 0; i < saved.length; i += 1) saved[i].selected = true;
}
function aeDeriveActivate(comp) {
    if (app.project.activeItem !== comp && typeof comp.openInViewer === "function") comp.openInViewer();
    if (app.project.activeItem !== comp) throw new Error("DERIVE_COMMAND_FAILED");
}
function aeDeriveCommandId(kind) {
    var id = typeof app.findMenuCommandId === "function" ? aeSafe(function () { return app.findMenuCommandId(AE_DERIVE_COMMANDS[kind]); }, 0) : 0;
    if (!id) throw new Error("DERIVE_COMMAND_UNAVAILABLE");
    return id;
}
function aeDeriveSourceReady(kind, layer) {
    if (kind === "audio-keyframes" && layer.hasAudio !== true) throw new Error("INVALID_TARGET");
    if (kind === "shapes-from-text" && !layer.property("ADBE Text Properties")) throw new Error("INVALID_TARGET");
}
function aeDeriveByCommand(scope, operation) {
    var comp = scope.comp, layer = scope.layer, commandId = aeDeriveCommandId(operation.kind);
    aeDeriveSourceReady(operation.kind, layer);
    aeDeriveActivate(comp);
    var before = aeDeriveLayerIds(comp), saved = aeDeriveSelectOnly(comp, layer);
    try { app.executeCommand(commandId); } catch (commandError) { aeDeriveRestoreSelection(comp, layer, saved); throw new Error("DERIVE_COMMAND_FAILED"); }
    aeDeriveRestoreSelection(comp, layer, saved);
    var created = aeDeriveNewLayer(comp, before);
    if (!created) throw new Error("DERIVE_COMMAND_FAILED");
    return created;
}

function aeDeriveQuote(text) { return "\"" + String(text).replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\""; }
var AE_DERIVE_CONTAINER_MATCH = { "ADBE Mask Parade": true, "ADBE Vectors Group": true, "ADBE Root Vectors Group": true };
function aeDeriveSegment(group) {
    var match = group.matchName, name = aeDeriveQuote(group.name);
    if (match === "ADBE Mask Atom") return ".mask(" + name + ")";
    if (match === "ADBE Vector Group" || match === "ADBE Vector Shape - Group") return ".content(" + name + ")";
    return AE_DERIVE_CONTAINER_MATCH[match] ? "" : null;
}
function aeDerivePathChain(property) {
    var leaf = property.matchName === "ADBE Mask Shape" ? ".maskPath" : (property.matchName === "ADBE Vector Shape" ? ".path" : null);
    if (leaf === null) throw new Error("INVALID_TARGET");
    var chain = leaf, group = property.parentProperty;
    while (group && group.propertyDepth > 0) {
        var segment = aeDeriveSegment(group);
        if (segment === null) throw new Error("INVALID_TARGET");
        chain = segment + chain;
        group = group.parentProperty;
    }
    return chain;
}
function aeDeriveUniqueName(comp, layer) {
    var count = 0;
    for (var i = 1; i <= comp.numLayers; i += 1) if (comp.layer(i).name === layer.name) count += 1;
    if (count !== 1) throw new Error("AMBIGUOUS_LAYER_NAME");
}
function aeDeriveExpression(layer, chain, operation) {
    var kind = operation.pointKind || "vertex", index = operation.pointIndex,
      lead = "var L = thisComp.layer(" + aeDeriveQuote(layer.name) + "); var P = L" + chain + "; ";
    var point = kind === "vertex" ? "P.points()[" + index + "]" : "P.points()[" + index + "] + P." + AE_DERIVE_POINT_CALLS[kind] + "[" + index + "]";
    return lead + "var q = L.toComp(" + point + "); [q[0], q[1]];";
}
function aeDerivePathNull(scope, operation) {
    var comp = scope.comp, layer = scope.layer, property = aeApplyFindProperty(layer, operation.propertyPath);
    if (!property) throw new Error("PROPERTY_NOT_FOUND");
    aeDeriveUniqueName(comp, layer);
    var expression = aeDeriveExpression(layer, aeDerivePathChain(property), operation);
    var created = comp.layers.addNull(), position = created.property("ADBE Transform Group").property("ADBE Position");
    created.name = operation.name || layer.name + " point " + operation.pointIndex;
    position.expression = expression;
    var evaluated = aeSafeGet(position, "value", null), failure = String(aeSafeGet(position, "expressionError", ""));
    if (evaluated === null || failure !== "") { created.remove(); throw new Error("EXPRESSION_ERROR"); }
    return created;
}

function aeDeriveCreate(scope, operation) {
    if (operation.kind === "split") return aeDeriveSplit(scope, operation);
    if (operation.kind === "path-null") return aeDerivePathNull(scope, operation);
    return aeDeriveByCommand(scope, operation);
}
function aeApplyStepDeriveLayer(run, operation, scope) {
    var created = aeDeriveCreate(scope, operation);
    if (AE_DERIVE_RESULT_TYPE[operation.kind] === "null" && !aeSafe(function () { return created.nullLayer === true; },
      false)) throw new Error("DERIVE_COMMAND_FAILED");
    aeApplyCreatedLayers[aeApplyLayerKey(operation, operation.newLayerId)] = created; run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, sourceLayerId: operation.layerId,
      requestedLayerId: operation.newLayerId, kind: operation.kind, layerId: String(aeSafeGet(created, "id", "")), name: String(aeSafeGet(created,
      "name", "")) };
}

function aeDeriveRemapProperty(layer) {
    aeApplySetTimeRemap(layer, true);
    var remap = layer.property(AE_DERIVE_TIME_REMAP);
    if (!remap || remap.numKeys !== 2) throw new Error("CONFLICTING_KEYS: the layer already has time remap keyframes; remove them first.");
    return remap;
}
function aeDeriveWriteRemap(remap, first, last) {
    remap.setValueAtKey(1, first);
    remap.setValueAtKey(2, last);
}
function aeDeriveHeldValue(remap, time) {
    var t1 = remap.keyTime(1), t2 = remap.keyTime(2), v1 = remap.keyValue(1), v2 = remap.keyValue(2);
    var along = t2 > t1 ? Math.max(0, Math.min(1, (time - t1) / (t2 - t1))) : 0;
    return v1 + (v2 - v1) * along;
}
function aeApplyStepRetimeLayer(run, operation, scope) {
    var remap = aeDeriveRemapProperty(scope.layer);
    if (operation.mode === "reverse") { if (remap.keyValue(1) <= remap.keyValue(2)) aeDeriveWriteRemap(remap, remap.keyValue(2), remap.keyValue(1)); }
    else { var held = aeDeriveHeldValue(remap, operation.time); aeDeriveWriteRemap(remap, held, held); }
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      mode: operation.mode, verification: "time-remap-keys" };
}

AE_APPLY_LAYER_STEPS.derive_layer = aeApplyStepDeriveLayer;
AE_APPLY_LAYER_STEPS.retime_layer = aeApplyStepRetimeLayer;
