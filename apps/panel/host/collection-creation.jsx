/* Explicit Gaussian Blur creation for collection.jsx, with no inferred control defaults and no property references
 * kept across addProperty. A missing cache row is never absence evidence.
 */
/* global aeCollectionControlFailure, aeCollectionControlRequestInvalid, aeCollectionEnvelopeInvalid, aeCollectionGuardMaps,
  aeCollectionLocalMetadata, aeCollectionSameStamp, aeCollectionSameValues, aeCollectionSequence, aeCollectionStamp, aeCollectionTargetLayer,
  aeCollectionTargetRef, aeIsFiniteNumber */
/* exported aeCollectEffectCreation, aeCreateGaussian, aeCreationReadback */
function aeCreationCountValid(count, created) { return typeof count === "number" && Math.floor(count) === count && count >= 0 && count <= (created ? 16 : 15); }
function aeCreationInventory(parade, created) {
    var count = parade.numProperties, started = (new Date()).getTime(), found = { inventory: [], effect: null, count: count };
    if (!aeCreationCountValid(count, created)) throw new Error("LOCAL_EFFECT_BUDGET");
    for (var i = 1; i <= count; i += 1) {
        if (i > 1 && (new Date()).getTime() - started >= 25) throw new Error("LOCAL_EFFECT_BUDGET");
        aeCreationNote(found, parade.property(i), i, created);
    }
    return found;
}
function aeCreationNote(found, candidate, i, created) {
    var match = String(candidate.matchName);
    found.inventory.push({ index: i, matchName: match });
    if (match === "ADBE Gaussian Blur 2") { if (found.effect || !created) throw new Error("EFFECT_ALREADY_PRESENT"); found.effect = candidate; }
}
function aeCreationControlShapeInvalid(property, name) {
    return !property || String(property.matchName) !== name || typeof PropertyValueType === "undefined" || property.propertyValueType !== PropertyValueType.OneD || property.numKeys !== 0 || property.expressionEnabled !== false || property.expression !== "" || typeof property.setValue !== "function";
}
function aeCreationControlRangeInvalid(property) {
    return property.hasMin !== true || property.hasMax !== true || !aeIsFiniteNumber(property.minValue) || !aeIsFiniteNumber(property.maxValue)
      || property.minValue > property.maxValue || !aeIsFiniteNumber(property.value);
}
function aeCreationControl(effect, c) {
    var name = "ADBE Gaussian Blur 2-000" + c, property = effect.property(name);
    if (aeCreationControlShapeInvalid(property, name) || aeCreationControlRangeInvalid(property)) throw new Error("LOCAL_CONTROL_UNSUPPORTED");
    return { matchName: name, value: property.value, minimum: property.minValue, maximum: property.maxValue, keyframeCount: 0, expressionEnabled: false, expression: "" };
}
var AE_CREATION_GAUSSIAN_CONTROLS = { "ADBE Gaussian Blur 2-0001": true, "ADBE Gaussian Blur 2-0002": true, "ADBE Gaussian Blur 2-0003": true };
function aeCreationIsStrayMatch(match) { return match.indexOf("ADBE Gaussian Blur 2-") === 0 && AE_CREATION_GAUSSIAN_CONTROLS[match] !== true; }
function aeCreationStrayControl(effect) {
    var count = effect.numProperties;
    if (typeof count !== "number" || count < 3 || count > 32) return true;
    for (var i = 1; i <= count; i += 1) {
        var match = String(effect.property(i).matchName);
        if (aeCreationIsStrayMatch(match)) return true;
    }
    return false;
}
function aeCreationCreatedLocal(found) {
    var effect = found.effect, controls = [];
    if (!effect || found.inventory[found.count - 1].matchName !== "ADBE Gaussian Blur 2" || typeof effect.enabled !== "boolean" || aeCreationStrayControl(effect)) throw new Error("READBACK_MISMATCH");
    for (var c = 1; c <= 3; c += 1) controls.push(aeCreationControl(effect, c));
    return { effectMatchName: "ADBE Gaussian Blur 2", inventory: found.inventory, effectIndex: found.count, enabled: effect.enabled, controls: controls, dependencyPolicy: "local-effect-creation" };
}
function aeCreationParade(layer) {
    if (typeof layer.selected !== "boolean") throw new Error("STALE_READ_SET");
    var parade = layer.property("ADBE Effect Parade");
    if (!parade || String(parade.matchName) !== "ADBE Effect Parade") throw new Error("LOCAL_CONTROL_UNSUPPORTED");
    return parade;
}
function aeCreationAbsentLocal(parade, found) {
    if (typeof parade.canAddProperty !== "function" || parade.canAddProperty("ADBE Gaussian Blur 2") !== true || typeof parade.addProperty !== "function") throw new Error("EFFECT_NOT_AVAILABLE");
    return { effectMatchName: "ADBE Gaussian Blur 2", inventory: found.inventory, absent: true, canAdd: true, dependencyPolicy: "local-effect-creation" };
}
function aeCreationLocal(target, created) {
    var base = aeCollectionTargetLayer(target, "STALE_READ_SET"), layer = base.layer;
    var parade = aeCreationParade(layer);
    var found = aeCreationInventory(parade, created);
    var adder = created ? null : parade.addProperty;
    var local = created ? aeCreationCreatedLocal(found) : aeCreationAbsentLocal(parade, found);
    var metadata = aeCollectionLocalMetadata(target, base.comp, layer, layer.selected);
    if (!aeCollectionSameStamp(base.stamp)) throw new Error("PROJECT_CHANGED");
    return { stamp: base.stamp, local: local, metadata: metadata, comp: base.comp, layer: layer, parade: parade, adder: adder, effect: found.effect };
}
/**
 * Reads the layer state before a Gaussian Blur creation. Returns JSON {ok:true,requestId,sessionId,kind:"effect-
 * create",stamp,localCreation,metadata,rows}, or the aeCollectionControlFailure JSON. Only a stray Gaussian control
 * (matchName beyond -0001 to -0003) is refused; the effect group's Compositing Options child is expected.
 */
function aeCollectEffectCreation(raw) {
    try {
        var request = JSON.parse(raw);
        if (aeCollectionControlRequestInvalid(request, "effect-create")) throw new Error("INVALID_REQUEST");
        var observed = aeCreationLocal(request, false); aeCollectionSequence += 1;
        return JSON.stringify({ ok: true, requestId: request.requestId, sessionId: "effect-create-" + aeCollectionSequence, kind: "effect-create", stamp: observed.stamp, localCreation: observed.local, metadata: observed.metadata, rows: [{ id: "gaussian-creation", name: "Gaussian Blur creation availability", absent: true, canAdd: true }], nextCursor: null, deepComplete: false, downstreamExpressions: "unknown" });
    } catch (error) { return aeCollectionControlFailure(error); }
}
function aeCreationInitializationKeys(init) {
    var count = 0;
    for (var key in init) if (init.hasOwnProperty(key)) { if (key !== "blurriness" && key !== "dimensions" && key !== "repeatEdgePixels") return false; count += 1; }
    return count === 3;
}
function aeCreationOperationInvalid(operation, target) {
    return operation.compositionId !== target.compositionId || operation.layerId !== target.layerId || operation.effectMatchName !== "ADBE Gaussian Blur 2" || operation.effectPath !== "ADBE Effect Parade/ADBE Gaussian Blur 2" || operation.enabled !== target.enabled || typeof target.enabled !== "boolean";
}
function aeCreationDimensionsValid(dimensions) { return dimensions === 1 || dimensions === 2 || dimensions === 3; }
function aeCreationInitializationInvalid(init, operation) {
    if (!init || !aeCreationInitializationKeys(init) || !aeIsFiniteNumber(init.blurriness) || init.blurriness < 0) return true;
    return !aeCreationDimensionsValid(init.dimensions) || typeof init.repeatEdgePixels !== "boolean" || JSON.stringify(operation.initialization) !== JSON.stringify(init);
}
function aeCheckCreationReadSet(request) {
    if (aeCollectionEnvelopeInvalid(request, "gaussian-create-read-set/1", "ensure_effect")) return { ok: false, code: "INVALID_READ_SET" };
    var rs = request.readSet, target = rs.targets[0], op = request.operations[0];
    if (aeCreationOperationInvalid(op, target) || aeCreationInitializationInvalid(target.initialization, op)) return { ok: false, code: "INVALID_READ_SET" };
    try {
        var observed = aeCreationLocal(aeCollectionTargetRef(target, rs.stamp), false);
        if (observed.metadata.layer.name !== target.name || JSON.stringify(observed.local) !== JSON.stringify(target.localCreation) || !aeCollectionSameStamp(rs.stamp)) throw new Error("STALE_READ_SET");
        var maps = aeCollectionGuardMaps(target, observed.comp, observed.layer);
        return { ok: true, comps: maps.comps, layers: maps.layers, creation: true, progress: [] };
    } catch (error) { return { ok: false, code: "STALE_READ_SET" }; }
}
function aeCreationState(request, stamp) {
    var t = request.readSet.targets[0], observed = aeCreationLocal(aeCollectionTargetRef(t, stamp), true);
    var inventory = t.localCreation.inventory.concat([{ index: t.localCreation.inventory.length + 1, matchName: "ADBE Gaussian Blur 2" }]);
    if (JSON.stringify(observed.local.inventory) !== JSON.stringify(inventory) || observed.metadata.layer.name !== t.name || observed.stamp.epoch !== request.readSet.stamp.epoch) throw new Error("READBACK_MISMATCH");
    return observed;
}
function aeCreationWanted(t) { return [t.initialization.blurriness, t.initialization.dimensions, t.initialization.repeatEdgePixels ? 1 : 0]; }
function aeCreationCheckRanges(wanted, observed) {
    for (var r = 0; r < 3; r += 1) if (wanted[r] < observed.local.controls[r].minimum || wanted[r] > observed.local.controls[r].maximum) throw new Error("INVALID_VALUE");
}
function aeCreationWriteStep(request, guard, run, w) {
    var t = request.readSet.targets[0], wanted = run.wanted;
    var observed = aeCreationState(request, run.stamp);
    if (!aeCollectionSameValues(observed.local, run.expected)) throw new Error("STALE_READ_SET");
    var property = w === 0 ? null : observed.effect.property("ADBE Gaussian Blur 2-000" + w), setter = property ? property.setValue : null;
    if (!aeCollectionSameStamp(run.stamp)) throw new Error("STALE_READ_SET");
    var label = w === 0 ? "enabled" : "control-" + w;
    guard.progress.push({ action: label, state: "attempted" });
    if (w === 0) { observed.effect.enabled = t.enabled; run.expected.enabled = t.enabled; } else {
      setter.call(property, wanted[w - 1]); run.expected.controls[w - 1].value = wanted[w - 1]; }
    observed = aeCreationState(request, aeCollectionStamp());
    if (!aeCollectionSameValues(observed.local, run.expected)) throw new Error("READBACK_MISMATCH");
    run.stamp = observed.stamp; guard.progress.push({ action: label, state: "observed" });
}
/**
 * Adds a Gaussian Blur and writes its defaults. Returns
 * {created:true,defaults:[{matchName,value,state:"written"}],...}; throws Error with the refusal code. Validates all
 * native ranges before the first initialization write, and re-observes the whole effect before and after each step.
 */
function aeCreateGaussian(request, guard) {
    var checked = aeCheckCreationReadSet(request); if (!checked.ok) throw new Error(checked.code);
    var t = request.readSet.targets[0], observed = aeCreationLocal(aeCollectionTargetRef(t, request.readSet.stamp), false);
    if (JSON.stringify(observed.local) !== JSON.stringify(t.localCreation) || !aeCollectionSameStamp(request.readSet.stamp)) throw new Error("STALE_READ_SET");
    guard.progress.push({ action: "add-effect", state: "attempted" });
    observed.adder.call(observed.parade, "ADBE Gaussian Blur 2");
    observed = aeCreationState(request, aeCollectionStamp());
    guard.progress.push({ action: "add-effect", state: "observed", effectIndex: observed.local.effectIndex });
    var wanted = aeCreationWanted(t);
    aeCreationCheckRanges(wanted, observed);
    var run = { expected: JSON.parse(JSON.stringify(observed.local)), stamp: observed.stamp, wanted: wanted };
    for (var w = 0; w < 4; w += 1) aeCreationWriteStep(request, guard, run, w);
    guard.createdState = run.expected; guard.expectedStamp = run.stamp;
    return { created: true, defaults: [{ matchName: "ADBE Gaussian Blur 2-0001", value: wanted[0], state: "written" }, { matchName: "ADBE Gaussian Blur 2-0002", value: wanted[1], state: "written" }, { matchName: "ADBE Gaussian Blur 2-0003", value: wanted[2], state: "written" }] };
}

  /** Reads the created effect back. Returns {planId,readSetDigest,stamp,complete:true,createdEffect,metadata,
  rows:[{operationIndex,compositionId,layerId,layerIndex,...}],compositions}; throws on a stale read. */
function aeCreationReadback(request, guard) {
    var stamp = aeCollectionStamp(), observed = aeCreationState(request, stamp), t = request.readSet.targets[0];
    var wanted = aeCreationWanted(t);
    if (!aeCollectionSameValues(observed.local, guard.createdState)) throw new Error("READBACK_MISMATCH");
    if (observed.local.enabled !== t.enabled) throw new Error("READBACK_MISMATCH");
    for (var i = 0; i < 3; i += 1) if (!aeCollectionSameValues(observed.local.controls[i].value, wanted[i])) throw new Error("READBACK_MISMATCH");
    return { planId: request.planId, readSetDigest: request.readSet.digest, stamp: stamp, complete: true, createdEffect: observed.local,
      metadata: observed.metadata, rows: [{ operationIndex: 0, compositionId: t.compositionId, layerId: t.layerId, layerIndex: t.layerIndex,
        name: t.name, locked: false, selected: observed.metadata.layer.selected, created: true }] };
}
