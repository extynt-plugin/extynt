/* Edit helpers shared by the evidence adapter: failure JSON, command parsing and composition lookup. */
/* exported aeEditFailure, aeEditFindComp, aeEditParse */
/** Failure reply. Returns JSON {ok:false,error:{code,message}}. */
function aeEditFailure(code, message) { return JSON.stringify({ ok: false, error: { code: code, message: message } }); }
/** Returns {request} for valid JSON, or null when the text does not parse. */
function aeEditParse(raw) { try { return { request: JSON.parse(raw) }; } catch (ignored) { return null; } }
function aeEditDirectComp(compositionId) {
    if (typeof app.project.itemByID !== "function" || !/^[0-9]{1,15}$/.test(String(compositionId))) return null;
    var direct = null;
    try { direct = app.project.itemByID(Number(compositionId)); } catch (ignoredLookup) { direct = null; }
    return (direct instanceof CompItem && String(direct.id) === String(compositionId)) ? direct : null;
}
/** The composition with this id (itemByID first, then a scan), or null. */
function aeEditFindComp(compositionId) {
    var found = aeEditDirectComp(compositionId);
    if (found) return found;
    for (var i = 1; i <= app.project.numItems; i += 1) { var item = app.project.item(i);
      if (item instanceof CompItem && String(item.id) === compositionId) return item; }
    return null;
}
