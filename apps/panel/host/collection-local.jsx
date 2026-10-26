/* Shared by the metadata, blur and effect-creation reads: read-set envelope checks, the target's layer, and the local observation metadata.
 * Each check reads host objects only through the guarded helpers of collection.jsx. */
/* global aeCollectionActiveCompositionId, aeCollectionCompInfo, aeCollectionNotOrdinal, aeCollectionSameStamp, aeCollectionStamp */
/* exported aeCollectionControlFailure, aeCollectionControlRequestInvalid, aeCollectionEnvelopeInvalid, aeCollectionGuardMaps,
  aeCollectionLocalMetadata, aeCollectionPositiveInteger, aeCollectionTargetLayer, aeCollectionTargetRef */
function aeCollectionIsDigest(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function aeCollectionEnvelopeTargetInvalid(request, operationName) {
    var target = request.readSet.targets[0], operation = request.operations[0];
    return !target || target.operationIndex !== 0 || !operation || operation.operation !== operationName;
}
function aeCollectionEnvelopeCountInvalid(request, rs) {
    return !(request.operations instanceof Array) || request.operations.length !== 1 || !(rs.targets instanceof Array) || rs.targets.length !== 1;
}
/** True when the read-set envelope does not match the schema, plan id, counts, target, or digests. */
function aeCollectionEnvelopeInvalid(request, schema, operationName) {
    var rs = request.readSet;
    if (!rs || rs.schemaVersion !== schema || rs.planId !== request.planId) return true;
    return aeCollectionEnvelopeCountInvalid(request, rs) || aeCollectionEnvelopeTargetInvalid(request, operationName)
      || !aeCollectionIsDigest(rs.digest) || !aeCollectionIsDigest(rs.planDigest);
}
/** Returns {itemIndex,compositionId,layerIndex,layerId,expectedStamp} for a read-set target. */
function aeCollectionTargetRef(target, expectedStamp) {
    return { itemIndex: target.itemIndex, compositionId: target.compositionId, layerIndex: target.layerIndex, layerId: target.layerId,
      expectedStamp: expectedStamp };
}
/** Returns {comps,layers}, the guard lookup maps ("k:"-prefixed keys) holding the one target composition and layer. */
function aeCollectionGuardMaps(target, comp, layer) {
    var comps = {}, layers = {};
    comps["k:" + target.compositionId] = comp; layers["k:" + target.compositionId + ":" + target.layerId] = layer;
    return { comps: comps, layers: layers };
}
/** Resolves and checks a target. Returns {stamp,comp,layer}; throws Error(staleCode) when the stamp, composition, or layer is stale or the layer is locked. */
function aeCollectionTargetLayer(target, staleCode) {
    var stamp = aeCollectionStamp();
    if (stamp.revision === null || (target.expectedStamp && !aeCollectionSameStamp(target.expectedStamp))) throw new Error(staleCode);
    var comp = app.project.item(target.itemIndex);
    if (!(comp instanceof CompItem) || String(comp.id) !== target.compositionId) throw new Error(staleCode);
    var layer = comp.layer(target.layerIndex);
    if (String(layer.id) !== target.layerId || layer.locked !== false) throw new Error(staleCode);
    return { stamp: stamp, comp: comp, layer: layer };
}
/** Returns the metadata object {activeCompositionId,runtime,...} that accompanies a local control read. */
function aeCollectionLocalMetadata(target, comp, layer, selected) {
    return { activeCompositionId: aeCollectionActiveCompositionId(), runtime: { application: "After Effects", appVersion: String(app.version), buildNumber: String(app.buildNumber), buildName: null, platform: String($.os).indexOf("Windows") >= 0 ? "Windows" : "macOS", architecture: "unknown", compatible: true }, project: { name: app.project.file ? String(app.project.file.name) : "Untitled", filePath: app.project.file ? String(app.project.file.fsName) : null }, composition: aeCollectionCompInfo(comp, target.itemIndex), layer: { id: String(layer.id), index: target.layerIndex, name: String(layer.name), locked: false, selected: selected } };
}
/** True when a local control request is not a begin request of the given kind with a stamp and valid target ordinals. */
function aeCollectionControlRequestInvalid(request, kind) {
    return !request || request.schemaVersion !== "0.1" || typeof request.requestId !== "string" || request.kind !== kind || request.begin !== true || !request.expectedStamp || aeCollectionNotOrdinal(request.itemIndex) || aeCollectionNotOrdinal(request.layerIndex);
}
/** Failure reply for a local control read. Returns JSON {ok:false,error:{code}} with the error message as the code. */
function aeCollectionControlFailure(error) { return JSON.stringify({ ok: false, error: { code: String(error.message || "LOCAL_CONTROL_UNSUPPORTED") } }); }
/** True when the value is a positive integer number. */
function aeCollectionPositiveInteger(value) { return typeof value === "number" && value > 0 && Math.floor(value) === value; }
