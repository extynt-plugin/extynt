/* Demanded layer and property descriptors for collection.jsx, paged separately with values left not-read. Host
 * references are retained only for the replaceable observational session, so these pages cannot supply write
 * preconditions or prove dependency closure.
 */
/* global aeCollectionActiveCompositionId, aeCollectionCompInfo, aeCollectionDescriptorTypes, aeCollectionDetailSession, aeCollectionEffectContext,
  aeCollectionErrorDetail, aeCollectionNativeState, aeCollectionNotOrdinal, aeCollectionPageSize, aeCollectionPlatform, aeCollectionProjectInfo,
  aeCollectionReadRequest, aeCollectionRefusal, aeCollectionRuntimeInfo, aeCollectionSameObject, aeCollectionSameStamp, aeCollectionSequence,
  aeCollectionStamp, aeEncodePathSegment */
/* exported aeCollectDetailPage */
function aeDetailRefusal(code, detail) { aeCollectionDetailSession = null; return aeCollectionRefusal(code, detail); }
function aeDetailNewFrame(group, path, total, where) {
    return { group: group, path: path, next: 1, total: total, seen: {}, seenCount: 0, indices: where.indices, effectContext: where.effectContext,
        relativeMatchNames: where.effectContext ? where.effectContext.relativeMatchNames : [] };
}
function aeDetailSeedProperties(session, request) {
    var comp = session.comp;
    if (aeCollectionNotOrdinal(request.layerIndex) || request.layerIndex > comp.numLayers) return "INVALID_TARGET";
    var layer = comp.layer(request.layerIndex);
    if (String(layer.id) !== request.layerId) return "STALE_TARGET";
    session.layer = layer; session.layerIndex = request.layerIndex;
    session.stack = [aeDetailNewFrame(layer, "", layer.numProperties, { indices: [], effectContext: null })];
    return "";
}
function aeDetailLocateComp(request) {
    if (aeCollectionNotOrdinal(request.itemIndex) || request.itemIndex > app.project.numItems) return { code: "INVALID_TARGET" };
    var comp = app.project.item(request.itemIndex);
    if (!(comp instanceof CompItem) || String(comp.id) !== request.compositionId) return { code: "STALE_TARGET" };
    return { comp: comp };
}
function aeDetailBegin(request) {
    var located = aeDetailLocateComp(request), comp = located.comp;
    if (located.code) return located.code;
    if (request.kind !== "layers" && request.kind !== "properties") return "INVALID_REQUEST";
    aeCollectionSequence += 1;
    var session = { id: "detail-" + aeCollectionSequence, project: app.project, stamp: aeCollectionStamp(), total: app.project.numItems, comp: comp, layers: comp.numLayers, kind: request.kind, cursor: 1, stack: null, layer: null, layerIndex: null };
    var code = request.kind === "properties" ? aeDetailSeedProperties(session, request) : "";
    if (code) return code;
    aeCollectionDetailSession = session;
    return "";
}
function aeDetailProjectChanged(state) {
    if (!aeCollectionSameStamp(state.stamp) || !aeCollectionSameObject(state.project, app.project) || state.total !== app.project.numItems) return true;
    return state.comp.numLayers !== state.layers || !!(state.layer && state.comp.layer(state.layerIndex).id !== state.layer.id);
}
function aeDetailStale(request, state) { return !state || (request.begin !== true && request.sessionId !== state.id); }
function aeDetailResume(request) {
    var code = request.begin === true ? aeDetailBegin(request) : "";
    if (code) return code;
    var state = aeCollectionDetailSession;
    if (aeDetailStale(request, state)) return "STALE_COLLECTION";
    if (aeDetailProjectChanged(state)) return "PROJECT_CHANGED";
    return (request.begin !== true && request.cursor !== state.cursor) ? "INVALID_CURSOR" : "";
}
function aeDetailLayerStep(state, rows) {
    if (state.cursor > state.layers) return "@end";
    var item = state.comp.layer(state.cursor);
    rows.push({ id: String(item.id), index: state.cursor, name: String(item.name), locked: item.locked === true, selected: item.selected === true, layerIndex: state.cursor, detail: "layer-index", properties: "unknown", values: "not-read" });
    return "";
}
function aeDetailMemoryLimit(frame, key) {
    if (frame.seen[key]) return false;
    frame.seenCount += 1;
    return frame.seenCount > 1024;
}
function aeDetailPath(frame, property) {
    var segment = aeEncodePathSegment(property.matchName || property.name), key = "k:" + segment;
    if (segment.length > 512) return { code: "DESCRIPTOR_NAME_LIMIT" };
    if (aeDetailMemoryLimit(frame, key)) return { code: "DESCRIPTOR_MEMORY_LIMIT" };
    frame.seen[key] = (frame.seen[key] || 0) + 1;
    if (frame.seen[key] > 1) segment += "#" + frame.seen[key];
    var path = frame.path ? frame.path + "/" + segment : segment;
    return path.length > 4096 ? { code: "DESCRIPTOR_PATH_LIMIT" } : { code: "", path: path };
}
function aeDetailPropertyRow(frame, property, indices, path) {
    var children = typeof property.numProperties === "number" ? property.numProperties : 0;
    var descriptorTypes = aeCollectionDescriptorTypes(property);
    var nativeState = aeCollectionNativeState(property), effectContext = aeCollectionEffectContext(frame, property, indices, path);
    return { id: path, path: path, name: String(property.name), matchName: String(property.matchName), detail: "property-descriptor", valueState: "not-read", children: children, propertyIndices: indices,
        valueType: descriptorTypes.valueType, propertyType: descriptorTypes.propertyType, minimum: descriptorTypes.minimum, maximum: descriptorTypes.maximum,
        canVaryOverTime: descriptorTypes.canVaryOverTime, canSetExpression: descriptorTypes.canSetExpression,
        unitsText: nativeState.unitsText, keyframeCount: nativeState.keyframeCount, isTimeVarying: nativeState.isTimeVarying,
        expressionEnabled: nativeState.expressionEnabled, expressionPresent: nativeState.expressionPresent, canSetValue: nativeState.canSetValue,
          effectContext: effectContext };
}
function aeDetailPropertyStep(state, rows) {
    while (state.stack.length && state.stack[state.stack.length - 1].next > state.stack[state.stack.length - 1].total) state.stack.pop();
    if (!state.stack.length) return "@end";
    var frame = state.stack[state.stack.length - 1];
    if (frame.group.numProperties !== frame.total) return "PROJECT_CHANGED";
    var indices = frame.indices.concat([frame.next]);
    var property = frame.group.property(frame.next++);
    var located = aeDetailPath(frame, property);
    if (located.code) return located.code;
    var row = aeDetailPropertyRow(frame, property, indices, located.path);
    rows.push(row);
    if (row.children > 0) {
        if (state.stack.length >= 16) return "DETAIL_DEPTH_EXCEEDED";
        state.stack.push(aeDetailNewFrame(property, located.path, row.children, { indices: indices, effectContext: row.effectContext }));
    }
    return "";
}
function aeDetailReadRows(state, pageSize) {
    var started = (new Date()).getTime(), rows = [], work = 0, status;
    while (rows.length < pageSize && work < 50) {
        if (rows.length && (new Date()).getTime() - started >= 25) break;
        work += 1;
        status = state.kind === "layers" ? aeDetailLayerStep(state, rows) : aeDetailPropertyStep(state, rows);
        if (status === "@end") break;
        if (status) return { code: status };
        state.cursor += 1;
    }
    return { rows: rows };
}
function aeDetailRuntime() {
    return { application: "After Effects", appVersion: String(app.version || "unknown"), buildNumber: String(app.buildNumber || ""), buildName: null, platform: aeCollectionPlatform(), architecture: "unknown", compatible: true };
}
function aeDetailMetadata(state, request) {
    if (state.kind !== "layers" || state.stamp.revision === null) return null;
    var itemIndex = request.begin === true ? request.itemIndex : state.itemIndex;
    var metadata = { activeCompositionId: aeCollectionActiveCompositionId(), runtime: aeDetailRuntime(), project: { name: app.project.file ? String(app.project.file.name) : "Untitled", filePath: app.project.file ? String(app.project.file.fsName) : null }, composition: aeCollectionCompInfo(state.comp, itemIndex), layerCount: state.layers };
    if (request.begin === true) state.itemIndex = request.itemIndex;
    return metadata;
}
function aeDetailResponse(state, request, rows) {
    if (!aeCollectionSameStamp(state.stamp)) return aeDetailRefusal("PROJECT_CHANGED");
    var metadata = aeDetailMetadata(state, request);
    var projectInfo = aeCollectionProjectInfo(), runtimeInfo = aeCollectionRuntimeInfo();
    if (!aeCollectionSameStamp(state.stamp)) return aeDetailRefusal("PROJECT_CHANGED");
    var done = state.kind === "layers" ? state.cursor > state.layers : !state.stack.length;
    return JSON.stringify({ ok: true, requestId: request.requestId, sessionId: state.id, stamp: state.stamp, project: projectInfo, runtime: runtimeInfo, metadata: metadata, kind: state.kind, rows: rows, nextCursor: done ? null : state.cursor, descriptorCoverage: done ? "observed-end" : "partial", valueCoverage: "not-read", dependencyClosure: "unknown", deepComplete: false, consistency: "observational" });
}

  /** One page of layer or property descriptors. Takes the request JSON;
  returns JSON {ok:true,requestId,sessionId,stamp,project,runtime,metadata,kind,rows,nextCursor,
  descriptorCoverage,valueCoverage,dependencyClosure,deepComplete,consistency},
  or {ok:false,error:{code[,detail]}}. */
function aeCollectDetailPage(raw) {
    var request = aeCollectionReadRequest(raw, true);
    if (!request) return aeDetailRefusal("INVALID_REQUEST");
    if (!app.project) return aeDetailRefusal("NO_PROJECT");
    try {
        var code = aeDetailResume(request);
        if (code) return aeDetailRefusal(code);
        var state = aeCollectionDetailSession;
        var page = aeDetailReadRows(state, aeCollectionPageSize(request));
        if (page.code) return aeDetailRefusal(page.code);
        return aeDetailResponse(state, request, page.rows);
    } catch (error) { return aeDetailRefusal("DETAIL_READ_FAILED", aeCollectionErrorDetail(error)); }
}
