/* Collection index pages: the project's items, a bounded page at a time, inside one replaceable session. */
/* global aeCollectionErrorDetail, aeCollectionProjectInfo, aeCollectionReadRequest, aeCollectionRefusal, aeCollectionRuntimeInfo,
   aeCollectionSameObject, aeCollectionSameStamp, aeCollectionSequence, aeCollectionSession, aeCollectionStamp */
/* exported aeCollectIndexPage */
function aeIndexProjectChanged(session) {
    return !aeCollectionSameStamp(session.stamp) || !aeCollectionSameObject(session.project, app.project) || session.total !== app.project.numItems;
}
function aeIndexCursor(request, session) {
    var cursor = request.begin === true ? (request.startCursor === undefined ? 1 : request.startCursor) : request.cursor;
    return (typeof cursor !== "number" || Math.floor(cursor) !== cursor || cursor < 1 || cursor > session.total + 1) ? null : cursor;
}
function aeIndexPageSize(request) {
    var requested = request.pageSize;
    return (typeof requested === "number" && Math.floor(requested) === requested) ? Math.max(1, Math.min(25, requested)) : 25;
}
function aeIndexRow(item, index) {
    var isComp = item instanceof CompItem;
    return { id: String(item.id), name: String(item.name), itemIndex: index,
        type: isComp ? "composition" : (item instanceof FolderItem ? "folder" : "footage"),
        parentFolderId: item.parentFolder ? String(item.parentFolder.id) : null,
        layers: isComp ? item.numLayers : null, detail: "index", properties: "unknown" };
}
function aeIndexReadRows(session, cursor, pageSize) {
    var started = (new Date()).getTime(), rows = [], index = cursor;
    for (; index <= session.total && rows.length < pageSize; index += 1) {
        if (rows.length && (new Date()).getTime() - started >= 25) break;
        rows.push(aeIndexRow(app.project.item(index), index));
    }
    return { rows: rows, nextIndex: index };
}
function aeIndexBegin() {
    aeCollectionSequence += 1;
    aeCollectionSession = { id: "collection-" + aeCollectionSequence, project: app.project, stamp: aeCollectionStamp(), total: app.project.numItems };
}
function aeIndexSessionProblem(request, session) {
    if (!session || (request.begin !== true && request.sessionId !== session.id)) return "STALE_COLLECTION";
    return aeIndexProjectChanged(session) ? "PROJECT_CHANGED" : "";
}
function aeIndexRefuseSession(problem) {
    if (problem === "PROJECT_CHANGED") aeCollectionSession = null;
    return aeCollectionRefusal(problem);
}
function aeIndexResponse(request, session, page) {
    var projectInfo = aeCollectionProjectInfo(), runtimeInfo = aeCollectionRuntimeInfo();
    if (aeIndexProjectChanged(session)) { aeCollectionSession = null; return aeCollectionRefusal("PROJECT_CHANGED"); }
    return JSON.stringify({ ok: true, requestId: request.requestId, sessionId: session.id,
        stamp: session.stamp, project: projectInfo, runtime: runtimeInfo, totalItems: session.total, rows: page.rows,
          nextCursor: page.nextIndex <= session.total ? page.nextIndex : null,
        observedAt: (new Date()).getTime(), consistency: "observational", deepComplete: false });
}
function aeIndexPage(raw) {
    var request = aeCollectionReadRequest(raw, false);
    if (!request) return aeCollectionRefusal("INVALID_REQUEST");
    if (!app.project) return aeCollectionRefusal("NO_PROJECT");
    if (request.begin === true) aeIndexBegin();
    var session = aeCollectionSession, problem = aeIndexSessionProblem(request, session);
    if (problem) return aeIndexRefuseSession(problem);
    var cursor = aeIndexCursor(request, session);
    if (cursor === null) return aeCollectionRefusal("INVALID_CURSOR");
    try {
        return aeIndexResponse(request, session, aeIndexReadRows(session, cursor, aeIndexPageSize(request)));
    } catch (error) { return aeCollectionRefusal("INDEX_READ_FAILED", aeCollectionErrorDetail(error)); }
}
/**
 * One page of the project item index. Takes the request JSON; returns JSON
 * {ok:true,requestId,sessionId,stamp,project,runtime,totalItems,rows,nextCursor,observedAt,consistency,deepComplete},
 * or {ok:false,error:{code[,detail]}}. An AE error outside the page read (the session checks, the item count) still
 * comes back as a refusal.
 */
function aeCollectIndexPage(raw) {
    try { return aeIndexPage(raw); } catch (error) { return aeCollectionRefusal("INDEX_READ_FAILED", aeCollectionErrorDetail(error)); }
}
