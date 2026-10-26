/* Demanded numeric/static values and underlying key values. Expression evaluation
 * and arbitrary CUSTOM_VALUE/TextDocument/Shape payloads are deliberately unknown.
 * Pages never authorize writes; key interpolation/ease coverage is not claimed. */
/* global aeCollectionDescriptorTypes, aeCollectionErrorDetail, aeCollectionNativeState, aeCollectionNotOrdinal, aeCollectionOptionalField,
  aeCollectionPageSize, aeCollectionProjectInfo, aeCollectionReadRequest, aeCollectionRefusal, aeCollectionRuntimeInfo, aeCollectionSameStamp,
  aeCollectionSequence, aeCollectionStamp, aeCollectionValueSession */
/* exported aeCollectValuePage */
function aeValueRefusal(code, detail) { aeCollectionValueSession = null; return aeCollectionRefusal(code, detail); }
function aeValueNumeric(value) {
    if (typeof value === "number") return isFinite(value);
    if (!(value instanceof Array) || value.length < 1 || value.length > 16) return false;
    for (var n = 0; n < value.length; n += 1) if (typeof value[n] !== "number" || !isFinite(value[n])) return false;
    return true;
}
function aeValueReadable(property) {
    if (typeof PropertyValueType === "undefined") return false;
    var type = property.propertyValueType;
    return type === PropertyValueType.OneD || type === PropertyValueType.TwoD || type === PropertyValueType.ThreeD
      || type === PropertyValueType.TwoD_SPATIAL || type === PropertyValueType.ThreeD_SPATIAL || type === PropertyValueType.COLOR;
}
function aeValuePathInvalid(propertyIndices) { return !(propertyIndices instanceof Array) || propertyIndices.length < 1 || propertyIndices.length > 16; }
function aeValueCompProblem(comp, request) {
    if (!(comp instanceof CompItem) || String(comp.id) !== request.compositionId) return "STALE_TARGET";
    return (aeCollectionNotOrdinal(request.layerIndex) || request.layerIndex > comp.numLayers) ? "INVALID_TARGET" : "";
}
function aeValueTarget(request) {
    if (aeCollectionNotOrdinal(request.itemIndex) || request.itemIndex > app.project.numItems) return { code: "INVALID_TARGET" };
    var comp = app.project.item(request.itemIndex);
    var code = aeValueCompProblem(comp, request);
    if (code) return { code: code };
    var layer = comp.layer(request.layerIndex);
    if (String(layer.id) !== request.layerId || aeValuePathInvalid(request.propertyIndices)) return { code: "STALE_TARGET" };
    return { code: "", comp: comp, layer: layer };
}
function aeValueEffectContext(ordinal, property, propertyIndices, index) {
    return { effectIndex: ordinal, effectMatchName: String(property.matchName), effectName: String(property.name), effectEnabled: aeCollectionOptionalField(property, "enabled"), propertyIndices: propertyIndices.slice(0, index + 1), relativeIndices: [], relativeMatchNames: [] };
}
function aeValueWalked(property, effectContext, relativeMatchNames, propertyIndices) {
    if (typeof property.numProperties === "number" && property.numProperties > 0) return { code: "PROPERTY_IS_GROUP" };
    if (effectContext) { effectContext.relativeMatchNames = relativeMatchNames;
      effectContext.relativeIndices = propertyIndices.slice(effectContext.propertyIndices.length); }
    return { code: "", property: property, effectContext: effectContext };
}
function aeValueWalk(layer, propertyIndices) {
    var property = layer, effectContext = null, relativeMatchNames = [];
    for (var index = 0; index < propertyIndices.length; index += 1) {
        var ordinal = propertyIndices[index];
        if (aeCollectionNotOrdinal(ordinal) || ordinal > property.numProperties) return { code: "INVALID_PROPERTY_PATH" };
        var parent = property;
        property = property.property(ordinal);
        if (String(parent.matchName) === "ADBE Effect Parade") effectContext = aeValueEffectContext(ordinal, property, propertyIndices, index);
        else if (effectContext) relativeMatchNames.push(String(property.matchName));
    }
    return aeValueWalked(property, effectContext, relativeMatchNames, propertyIndices);
}
function aeValueNewSession(request, stamp, target, walked) {
    var property = walked.property;
    return { id: "value-" + aeCollectionSequence, stamp: stamp, comp: target.comp, layer: target.layer, layerIndex: request.layerIndex, property: property, keys: property.numKeys, cursor: 1, readable: aeValueReadable(property), name: String(property.name).slice(0, 4096), expressionEnabled: aeCollectionOptionalField(property, "expressionEnabled"), nativeState: aeCollectionNativeState(property), descriptorTypes: aeCollectionDescriptorTypes(property), effectContext: walked.effectContext, propertyIndices: request.propertyIndices };
}
function aeValueBegin(request) {
    var stamp = aeCollectionStamp();
    if (stamp.revision === null) return "REVISION_UNAVAILABLE";
    if (!request.expectedStamp || request.expectedStamp.epoch !== stamp.epoch || request.expectedStamp.revision !== stamp.revision) return "STALE_TARGET";
    var target = aeValueTarget(request);
    if (target.code) return target.code;
    var walked = aeValueWalk(target.layer, request.propertyIndices);
    if (walked.code) return walked.code;
    aeCollectionSequence += 1;
    aeCollectionValueSession = aeValueNewSession(request, stamp, target, walked);
    return "";
}
function aeValueProjectChanged(state) {
    return !aeCollectionSameStamp(state.stamp) || state.comp.layer(state.layerIndex).id !== state.layer.id || state.property.numKeys !== state.keys;
}
function aeValueStale(request, state) { return !state || (request.begin !== true && request.sessionId !== state.id); }
function aeValueResume(request) {
    var code = request.begin === true ? aeValueBegin(request) : "";
    if (code) return code;
    var state = aeCollectionValueSession;
    if (aeValueStale(request, state)) return "STALE_COLLECTION";
    if (aeValueProjectChanged(state)) return "PROJECT_CHANGED";
    return (request.begin !== true && request.cursor !== state.cursor) ? "INVALID_CURSOR" : "";
}
function aeValueStaticRow(state) {
    var value = null, valueState = "unknown";
    if (state.readable && state.expressionEnabled === false) { var observed = state.property.value; if (aeValueNumeric(observed)) { value = observed; valueState = "observed-static"; } }
    state.cursor += 1;
    return { id: "static", name: state.name, value: value, valueState: valueState };
}
function aeValueKeyRows(state, pageSize, rows) {
    var started = (new Date()).getTime();
    while (state.cursor <= state.keys && rows.length < pageSize) {
        if (rows.length && (new Date()).getTime() - started >= 25) break;
        var keyTime = state.property.keyTime(state.cursor), keyValue = state.property.keyValue(state.cursor);
        if (!aeValueNumeric(keyValue) || typeof keyTime !== "number" || !isFinite(keyTime)) return "UNSUPPORTED_VALUE";
        rows.push({ id: "key-" + state.cursor, name: state.name, keyIndex: state.cursor, time: keyTime, value: keyValue, valueState: "observed-key-value" });
        state.cursor += 1;
    }
    return "";
}
function aeValueCoverage(state, done) {
    if (!state.readable) return "unknown-type";
    if (state.expressionEnabled !== false && !state.keys) return "unknown-expression";
    return done ? "observed-end" : "partial";
}
function aeValueDescriptor(state) {
    return { valueType: state.descriptorTypes.valueType, minimum: state.descriptorTypes.minimum, maximum: state.descriptorTypes.maximum,
        unitsText: state.nativeState.unitsText, keyframeCount: state.nativeState.keyframeCount, isTimeVarying: state.nativeState.isTimeVarying,
        expressionEnabled: state.nativeState.expressionEnabled, expressionPresent: state.nativeState.expressionPresent,
          canSetValue: state.nativeState.canSetValue };
}
function aeValueResponse(state, request, rows) {
    var projectInfo = aeCollectionProjectInfo(), runtimeInfo = aeCollectionRuntimeInfo();
    if (!aeCollectionSameStamp(state.stamp)) return aeValueRefusal("PROJECT_CHANGED");
    var done = !state.keys || !state.readable || state.cursor > state.keys;
    var descriptor = aeValueDescriptor(state);
    return JSON.stringify({ ok: true, requestId: request.requestId, sessionId: state.id, stamp: state.stamp, project: projectInfo, runtime: runtimeInfo, kind: "values", rows: rows, nextCursor: done ? null : state.cursor, numKeys: state.keys, expressionEnabled: state.expressionEnabled, expressionPresent: state.nativeState.expressionPresent, expressionCoverage: "presence-only", nativeDescriptor: descriptor, effectContext: state.effectContext, propertyIndices: state.propertyIndices, valueCoverage: aeValueCoverage(state, done), keyMetadataCoverage: "not-read", dependencyClosure: state.expressionEnabled === false ? "local-value-only" : "unknown", deepComplete: false, consistency: "revision-guarded" });
}

  /** One page of keyframe or static values for a property. Takes the request JSON;
  returns JSON {ok:true,requestId,sessionId,stamp,project,runtime,kind:"values",rows,
  nextCursor,numKeys,...coverage fields},
  or {ok:false,error:{code[,detail]}}. */
function aeCollectValuePage(raw) {
    var request = aeCollectionReadRequest(raw, true);
    if (!request) return aeValueRefusal("INVALID_REQUEST");
    if (!app.project) return aeValueRefusal("NO_PROJECT");
    try {
        var code = aeValueResume(request);
        if (code) return aeValueRefusal(code);
        var state = aeCollectionValueSession, pageSize = aeCollectionPageSize(request), rows = [];
        if (!state.keys || !state.readable) rows.push(aeValueStaticRow(state));
        else code = aeValueKeyRows(state, pageSize, rows);
        if (code) return aeValueRefusal(code);
        return aeValueResponse(state, request, rows);
    } catch (error) { return aeValueRefusal("VALUE_READ_FAILED", aeCollectionErrorDetail(error)); }
}
