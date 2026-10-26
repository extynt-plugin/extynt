/* Revision-bound metadata authorization: the sidecar binds this deterministic read set to the exact plan digest and
 * its one-time approval capability.
 */
/* global aeBlurReadback, aeCheckBlurReadSet, aeCheckCreationReadSet, aeCollectionActiveCompositionId, aeCollectionCompInfo, aeCollectionIsDigest,
   aeCollectionNotOrdinal, aeCollectionSameStamp, aeCollectionStamp, aeCreationReadback */
/* exported aeCheckMetadataReadSet, aeMetadataBeforeOperation, aeMetadataReadback */
function aeMetadataTargetCountInvalid(targets, operationCount) {
    return !(targets instanceof Array) || targets.length !== operationCount || targets.length < 1 || targets.length > 16;
}
function aeMetadataReadSetInvalid(request) {
    var readSet = request.readSet;
    if (!readSet || readSet.schemaVersion !== "metadata-read-set/1" || readSet.planId !== request.planId) return true;
    if (!aeCollectionIsDigest(readSet.digest) || !aeCollectionIsDigest(readSet.planDigest)) return true;
    return aeMetadataTargetCountInvalid(readSet.targets, request.operations.length);
}
function aeMetadataTargetHeaderInvalid(target, operation, index) {
    return !target || target.operationIndex !== index || !operation || operation.operation !== "set_layer_name";
}
function aeMetadataTargetMatchInvalid(target, operation) {
    return operation.compositionId !== target.compositionId || operation.layerId !== target.layerId || operation.name !== target.desiredName
      || target.locked !== false;
}
function aeMetadataTargetNameInvalid(target) {
    return typeof target.name !== "string" || typeof target.desiredName !== "string" || target.desiredName.length < 1 || target.desiredName.length > 256;
}
function aeMetadataTargetPositionInvalid(target) {
    return aeCollectionNotOrdinal(target.itemIndex) || target.itemIndex > app.project.numItems || aeCollectionNotOrdinal(target.layerIndex);
}
function aeMetadataTargetInvalid(target, operation, index) {
    return aeMetadataTargetHeaderInvalid(target, operation, index) || aeMetadataTargetMatchInvalid(target, operation)
      || aeMetadataTargetNameInvalid(target) || aeMetadataTargetPositionInvalid(target);
}
function aeMetadataTargetComp(target) {
    var comp = app.project.item(target.itemIndex);
    return (comp instanceof CompItem && String(comp.id) === target.compositionId && target.layerIndex <= comp.numLayers) ? comp : null;
}
function aeMetadataLayerStale(layer, target) { return String(layer.id) !== target.layerId || String(layer.name) !== target.name || layer.locked !== false; }
function aeMetadataVerifyTarget(request, i, found) {
    var target = request.readSet.targets[i], operation = request.operations[i];
    if (aeMetadataTargetInvalid(target, operation, i)) return "INVALID_READ_SET";
    var comp = aeMetadataTargetComp(target);
    if (!comp) return "STALE_READ_SET";
    var layer = comp.layer(target.layerIndex), key = "k:" + target.compositionId + ":" + target.layerId;
    if (found.seen[key] || aeMetadataLayerStale(layer, target)) return "STALE_READ_SET";
    found.seen[key] = true; found.comps["k:" + target.compositionId] = comp; found.layers[key] = layer;
    return "";
}
function aeMetadataFail(code) { return { ok: false, code: code }; }
function aeMetadataVerifyTargets(request) {
    var readSet = request.readSet, found = { comps: {}, layers: {}, seen: {} };
    for (var i = 0; i < readSet.targets.length; i += 1) {
        var code = aeMetadataVerifyTarget(request, i, found);
        if (code) return aeMetadataFail(code);
    }
    if (!aeCollectionSameStamp(readSet.stamp)) return aeMetadataFail("STALE_READ_SET");
    return { ok: true, comps: found.comps, layers: found.layers };
}
function aeMetadataStampStale(stamp) { return !stamp || stamp.revision === null || !aeCollectionSameStamp(stamp); }
/**
 * Verifies a read set against the live project. Returns {ok:true,comps,layers[,blur|creation...]} or {ok:false,code}
 * with INVALID_READ_SET, STALE_READ_SET or READ_SET_UNREADABLE. Verifies every target and returns the guard { ok,
 * comps, layers } or a failure; may throw on an unreadable host object.
 */
function aeCheckMetadataReadSet(request) {
    var schema = request.readSet && request.readSet.schemaVersion;
    if (schema === "blur-control-read-set/1") return aeCheckBlurReadSet(request);
    if (schema === "gaussian-create-read-set/1") return aeCheckCreationReadSet(request);
    if (aeMetadataReadSetInvalid(request)) return aeMetadataFail("INVALID_READ_SET");
    if (aeMetadataStampStale(request.readSet.stamp)) return aeMetadataFail("STALE_READ_SET");
    try { return aeMetadataVerifyTargets(request); } catch (ignored) { return aeMetadataFail("READ_SET_UNREADABLE"); }
}
/** Guard run before one planned operation. Returns the expected layer name; throws Error("STALE_READ_SET") when the project moved. */
function aeMetadataBeforeOperation(request, guard, index) {
    var expected = guard.expectedStamp || request.readSet.stamp;
    if (!aeCollectionSameStamp(expected)) throw new Error("STALE_READ_SET");
    var target = request.readSet.targets[index], comp = aeMetadataTargetComp(target);
    if (!comp) throw new Error("STALE_READ_SET");
    if (aeMetadataLayerStale(comp.layer(target.layerIndex), target) || !aeCollectionSameStamp(expected)) throw new Error("STALE_READ_SET");
    return target.name;
}
function aeMetadataReadbackRow(request, guard, i, scope) {
    var seen = scope.seen, compositions = scope.compositions;
    var operation = request.operations[i], target = request.readSet.targets[i], comp = app.project.item(target.itemIndex);
    if (!(comp instanceof CompItem) || String(comp.id) !== target.compositionId) throw new Error("READBACK_STALE");
    var layer = guard.layers["k:" + operation.compositionId + ":" + operation.layerId], name = String(layer.name);
    var row = { operationIndex: i, compositionId: operation.compositionId, layerId: String(layer.id), layerIndex: layer.index,
      locked: layer.locked === true, selected: layer.selected === true, name: name, expectedName: operation.name };
    if (String(layer.id) !== operation.layerId || name !== operation.name) throw new Error("READBACK_MISMATCH");
    if (!seen["k:" + target.compositionId]) { seen["k:" + target.compositionId] = true; compositions.push(aeCollectionCompInfo(comp, target.itemIndex)); }
    return row;
}
/**
 * Reads the touched layers back after apply. Returns
 * {activeCompositionId,planId,readSetDigest,stamp,rows,compositions,complete:true}; throws Error with READBACK_STALE
 * or READBACK_MISMATCH. Reads back the operation's layer and records its composition once; throws when it is not what
 * the plan asked for.
 */
function aeMetadataReadback(request, guard) {
    if (guard.blur) return aeBlurReadback(request);
    if (guard.creation) return aeCreationReadback(request, guard);
    var stamp = aeCollectionStamp(), rows = [], compositions = [], seen = {};
    if (stamp.epoch !== request.readSet.stamp.epoch) throw new Error("READBACK_STALE");
    for (var i = 0; i < request.operations.length; i += 1) rows.push(aeMetadataReadbackRow(request, guard, i, { seen: seen, compositions: compositions }));
    var activeCompositionId = aeCollectionActiveCompositionId();
    if (!aeCollectionSameStamp(stamp)) throw new Error("READBACK_STALE");
    return { activeCompositionId: activeCompositionId, planId: request.planId, readSetDigest: request.readSet.digest, stamp: stamp, rows: rows,
      compositions: compositions, complete: true };
}
