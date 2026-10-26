/* Entry file for the runtime effect-catalogue probe, loaded by probe.jsx: it runs the one page of effects the sidecar
 * hands it in a scratch composition, and refuses unless the open project is untitled and holds only the probe's own
 * scratch folder. Every reply is JSON, a structured refusal included even when catalogue-controls.jsx failed to load;
 * only an entry that is not defined at all answers the literal "EvalScript error.".
 */
/* global aeHostDirectory, aeHostLoadFailed, aeCatalogueBoundedText, aeCatalogueHasMenuLike, aeCatalogueHostInfo, aeCatalogueInvalid, aeIsArray,
   aeCatalogueIsComp, aeCatalogueItemId, aeCatalogueParseEnvelope, aeCatalogueReadControls, aeSafe */
/* exported AE_CATALOGUE_SCHEMA, aeCatalogueGuarded, aeCatalogueProbePage, aeCatalogueRefuse */
/** The catalogue page schema version every reply carries. */
var AE_CATALOGUE_SCHEMA = "0.1";
var AE_CATALOGUE_SCRATCH_FOLDER = "extynt Catalogue (temporary)";
var AE_CATALOGUE_COMP_NAME = "extynt Catalogue probe comp";
var AE_CATALOGUE_SOLID_NAME = "extynt Catalogue probe solid";
var AE_CATALOGUE_MAX_MATCH_NAMES = 16;
var AE_CATALOGUE_MAX_BUDGET_MS = 400;
var AE_CATALOGUE_DEFAULT_BUDGET_MS = 200;
var AE_CATALOGUE_MAX_ITEMS = 64;
var AE_CATALOGUE_MAX_DETAIL = 300;

/** `{ schemaVersion, ok: false, requestId, error: { code, message, reason? } }`; `reason` appears only when given. */
function aeCatalogueRefuse(requestId, code, message, reason) {
    var error = { code: code, message: message };
    if (reason) error.reason = reason;
    return { schemaVersion: AE_CATALOGUE_SCHEMA, ok: false, requestId: requestId, error: error };
}
/** The JSON text of `answer()`, or of a PROBE_FAILED refusal when it throws. */
function aeCatalogueGuarded(answer) {
    try { return JSON.stringify(answer()); }
    catch (unexpected) { return JSON.stringify(aeCatalogueRefuse("", "PROBE_FAILED", String(unexpected).slice(0, 160))); }
}
function aeCatalogueFailureDetail(error) {
    var text = String(error), line = aeSafe(function () { return error.line; }, null);
    if (typeof line === "number" && isFinite(line) && !/line/.test(text)) text += " (line " + line + ")";
    return text.replace(/[\r\n]+/g, " ").slice(0, AE_CATALOGUE_MAX_DETAIL);
}
function aeCatalogueNowMs() { return new Date().getTime(); }
function aeCatalogueItemAt(project, index) { return aeSafe(function () { return project.item(index); }, null); }
function aeCatalogueItemName(item) { return String(aeSafe(function () { return item.name; }, "")); }
function aeCatalogueRootFolder(project) { return aeSafe(function () { return project.rootFolder; }, null); }
function aeCatalogueProjectFile(project) { return aeSafe(function () { return project.file; }, undefined); }
function aeCatalogueItemCount(project) { return aeSafe(function () { return project.numItems; }, 0); }
function aeCatalogueIsFolder(item) { return aeSafe(function () { return typeof FolderItem !== "undefined" && item instanceof FolderItem; }, false); }
function aeCatalogueRemoveQuietly(target) { return aeSafe(function () { target.remove(); return true; }, false); }
function aeCatalogueIsScratchFolder(item, root) {
    if (!item || !aeCatalogueIsFolder(item)) return false;
    var parent = aeSafe(function () { return item.parentFolder; }, null);
    return aeCatalogueItemName(item) === AE_CATALOGUE_SCRATCH_FOLDER && !!parent && aeCatalogueItemId(parent) === aeCatalogueItemId(root);
}
function aeCatalogueFindScratchFolder(project) {
    var root = aeCatalogueRootFolder(project), count = aeCatalogueItemCount(project);
    if (!root) return null;
    for (var i = 1; i <= count && i <= AE_CATALOGUE_MAX_ITEMS; i += 1) {
        var item = aeCatalogueItemAt(project, i);
        if (aeCatalogueIsScratchFolder(item, root)) return item;
    }
    return null;
}
function aeCatalogueInsideFolder(item, folder, root) {
    var current = aeSafe(function () { return item.parentFolder; }, null), steps = 0;
    while (current && steps < 32) {
        if (aeCatalogueItemId(current) === aeCatalogueItemId(folder)) return true;
        if (aeCatalogueItemId(current) === aeCatalogueItemId(root)) return false;
        current = aeSafe(function () { return current.parentFolder; }, null); steps += 1;
    }
    return false;
}
function aeCatalogueOwnsItem(item, folder, root) {
    return !!item && (aeCatalogueItemId(item) === aeCatalogueItemId(folder) || aeCatalogueInsideFolder(item, folder, root));
}
function aeCatalogueItemsAreOwn(project, folder, root, count) {
    for (var i = 1; i <= count; i += 1) if (!aeCatalogueOwnsItem(aeCatalogueItemAt(project, i), folder, root)) return false;
    return true;
}
function aeCatalogueOwnsAll(project, count) {
    var folder = aeCatalogueFindScratchFolder(project), root = aeCatalogueRootFolder(project);
    return !!folder && !!root && aeCatalogueItemsAreOwn(project, folder, root, count);
}
function aeCatalogueScratchViolation(project) {
    if (!project) return "no-project";
    if (aeCatalogueProjectFile(project) !== null) return "project-saved";
    var count = aeSafe(function () { return project.numItems; }, -1);
    if (count < 0 || count > AE_CATALOGUE_MAX_ITEMS) return "foreign-items";
    return (count === 0 || aeCatalogueOwnsAll(project, count)) ? null : "foreign-items";
}
function aeCatalogueFindProbeComp(project, folder, root) {
    var count = aeCatalogueItemCount(project);
    for (var i = 1; i <= count; i += 1) {
        var item = aeCatalogueItemAt(project, i);
        if (!item || aeCatalogueItemId(item) === aeCatalogueItemId(folder) || !aeCatalogueInsideFolder(item, folder, root)) continue;
        if (aeCatalogueIsComp(item) && aeCatalogueItemName(item) === AE_CATALOGUE_COMP_NAME) return item;
    }
    return null;
}
function aeCatalogueIsDisposableFolder(candidate, root, scratch) {
    return !!candidate && aeCatalogueItemId(candidate) !== aeCatalogueItemId(root) && aeCatalogueItemId(candidate) !== aeCatalogueItemId(scratch)
      && aeSafe(function () { return candidate.numItems; }, 1) === 0;
}
function aeCatalogueAddProbeSolid(comp, scratch, root) {
    var layer = comp.layers.addSolid([0.5, 0.5, 0.5], AE_CATALOGUE_SOLID_NAME, 64, 64, 1, 1);
    var source = aeSafe(function () { return layer.source; }, null);
    var solidsFolder = source ? aeSafe(function () { return source.parentFolder; }, null) : null;
    if (source) source.parentFolder = scratch;
    if (aeCatalogueIsDisposableFolder(solidsFolder, root, scratch)) aeCatalogueRemoveQuietly(solidsFolder);
    return layer;
}
function aeCatalogueAddProbeComp(project, scratch) {
    var comp = project.items.addComp(AE_CATALOGUE_COMP_NAME, 64, 64, 1, 1, 24);
    comp.parentFolder = scratch;
    return comp;
}
function aeCatalogueEnsureScratch(project) {
    var root = project.rootFolder;
    var folder = aeCatalogueFindScratchFolder(project) || project.items.addFolder(AE_CATALOGUE_SCRATCH_FOLDER);
    var comp = aeCatalogueFindProbeComp(project, folder, root) || aeCatalogueAddProbeComp(project, folder);
    return aeSafe(function () { return comp.numLayers > 0 ? comp.layer(1) : null; }, null) || aeCatalogueAddProbeSolid(comp, folder, root);
}
function aeCatalogueScratchIsOwn(project, folder) {
    var root = aeCatalogueRootFolder(project), count = aeCatalogueItemCount(project);
    for (var i = 1; i <= count; i += 1) {
        var item = aeCatalogueItemAt(project, i);
        if (!item || aeCatalogueItemId(item) === aeCatalogueItemId(folder) || !aeCatalogueInsideFolder(item, folder, root)) continue;
        var name = aeCatalogueItemName(item);
        if (name !== AE_CATALOGUE_COMP_NAME && name !== AE_CATALOGUE_SOLID_NAME) return false;
    }
    return true;
}
function aeCatalogueRemoveLeftoverScratch(project) {
    if (!project || aeCatalogueProjectFile(project) !== null) return;
    var folder = aeCatalogueFindScratchFolder(project);
    if (folder && aeCatalogueScratchIsOwn(project, folder)) aeCatalogueRemoveQuietly(folder);
}
function aeCatalogueRemoveScratch(project) {
    var folder = aeCatalogueFindScratchFolder(project);
    if (!folder) return true;
    aeCatalogueRemoveQuietly(folder);
    return aeCatalogueFindScratchFolder(project) === null;
}
function aeCatalogueClearParade(parade) {
    var guard = 0;
    while (aeSafe(function () { return parade.numProperties; }, 0) > 0 && guard < 8) {
        if (!aeSafe(function () { parade.property(1).remove(); return true; }, false)) return false;
        guard += 1;
    }
    return aeSafe(function () { return parade.numProperties; }, 0) === 0;
}
function aeCatalogueParadeHolds(parade, keep) {
    return keep === 0 ? aeCatalogueClearParade(parade) : aeSafe(function () { return parade.numProperties; }, -1) === keep;
}
function aeCatalogueItemIds(project) {
    var ids = {}, count = aeCatalogueItemCount(project);
    for (var i = 1; i <= count && i <= AE_CATALOGUE_MAX_ITEMS * 4; i += 1) { var item = aeCatalogueItemAt(project, i);
      if (item) ids[aeCatalogueItemId(item)] = true; }
    return ids;
}
function aeCatalogueRemoveCreatedItems(project, before) {
    var created = [], count = aeCatalogueItemCount(project);
    for (var i = 1; i <= count && i <= AE_CATALOGUE_MAX_ITEMS * 4; i += 1) { var item = aeCatalogueItemAt(project, i); if (item
      && !before[aeCatalogueItemId(item)]) created.push(item); }
    for (var k = created.length - 1; k >= 0; k -= 1) aeCatalogueRemoveQuietly(created[k]);
    return created.length;
}
function aeCatalogueBreadcrumbWriter(path, ticket) {
    if (!path) return function () {};
    return function (phase, matchName) {
        aeSafe(function () {
            var file = new File(path);
            file.encoding = "UTF-8"; file.lineFeed = "Unix";
            if (!file.open("w")) return false;
            file.write(JSON.stringify({ ticket: ticket, phase: phase, matchName: matchName }));
            return file.close();
        }, false);
    };
}
function aeCatalogueAddEffect(session, matchName) {
    var parade = session.parade, project = session.project;
    if (!aeSafe(function () { return parade.canAddProperty(matchName); }, false)) return { failure: "CANNOT_ADD" };
    session.mark("apply", matchName);
    var before = aeCatalogueItemIds(project), addStarted = aeCatalogueNowMs();
    var effect = null, addDetail = "addProperty returned nothing";
    try { effect = parade.addProperty(matchName); } catch (addError) { effect = null; addDetail = aeCatalogueFailureDetail(addError); }
    var applyMs = aeCatalogueNowMs() - addStarted;
    if (effect) return { effect: effect, before: before, applyMs: applyMs };
    var settled = aeCatalogueParadeHolds(parade, session.hold.names.length);
    return { failure: "ADD_FAILED", detail: addDetail, applyMs: applyMs, createdItems: aeCatalogueRemoveCreatedItems(project, before), removed: settled
      || session.hold.names.length === 0 };
}
function aeCatalogueProbeOne(session, matchName) {
    var added = aeCatalogueAddEffect(session, matchName), hold = session.hold;
    if (!added.effect) return added;
    var effect = added.effect, read = aeSafe(function () { return aeCatalogueReadControls(effect); }, null);
    var displayName = aeSafe(function () { return String(effect.name).slice(0, 120); }, matchName);
    var keep = hold.on && read !== null && aeCatalogueHasMenuLike(read.controls);
    if (keep) hold.names.push(matchName);
    else session.mark("remove", matchName);
    var removed = keep || (aeCatalogueRemoveQuietly(effect) && aeCatalogueParadeHolds(session.parade, hold.names.length));
    var createdItems = aeCatalogueRemoveCreatedItems(session.project, added.before);
    if (!read) return { failure: "READ_FAILED", removed: removed, applyMs: added.applyMs, createdItems: createdItems };
    return { result: { matchName: matchName, displayName: displayName, controls: read.controls, truncated: read.truncated, applyMs: added.applyMs,
      createdItems: createdItems }, removed: removed };
}
function aeCatalogueFailureRow(matchName, outcome) {
    return { matchName: matchName, code: outcome.failure, detail: outcome.detail === undefined ? null : outcome.detail,
      applyMs: outcome.applyMs === undefined ? null : outcome.applyMs, createdItems: outcome.createdItems || 0 };
}
function aeCatalogueProbeAll(session) {
    var request = session.request, names = request.matchNames, tally = { results: [], failures: [], remaining: [] };
    for (var i = 0; i < names.length; i += 1) {
        if (i > 0 && aeCatalogueNowMs() - session.started >= request.budgetMs) { tally.remaining = names.slice(i); break; }
        var outcome = aeCatalogueProbeOne(session, names[i]);
        if (outcome.result) tally.results.push(outcome.result); else tally.failures.push(aeCatalogueFailureRow(names[i], outcome));
        if (outcome.removed === false) {
            tally.failures.push({ matchName: names[i], code: "REMOVE_FAILED" });
            tally.remaining = names.slice(i + 1);
            break;
        }
    }
    return tally;
}
function aeCatalogueHeldAt(layer, names) {
    return { compId: aeSafe(function () { return String(layer.containingComp.id); }, ""), layerId: aeSafe(function () { return String(layer.id); },
      ""), matchNames: names };
}
function aeCatalogueEffectParade(layer) {
    return aeSafe(function () { return layer.property("ADBE Effect Parade"); }, null) || aeSafe(function () { return layer.Effects; }, null);
}
function aeCatalogueRunPage(request, project) {
    var started = aeCatalogueNowMs(), mark = aeCatalogueBreadcrumbWriter(request.breadcrumb, request.requestId);
    var layer = aeCatalogueEnsureScratch(project), hold = { on: request.hold, names: [] }, parade = aeCatalogueEffectParade(layer);
    if (!parade) return aeCatalogueRefuse(request.requestId, "SETUP_FAILED", "The scratch layer exposes no effect collection.");
    if (!aeCatalogueClearParade(parade)) return aeCatalogueRefuse(request.requestId, "SETUP_FAILED", "The scratch layer could not be cleared.");
    var tally = aeCatalogueProbeAll({ request: request, project: project, parade: parade, mark: mark, hold: hold, started: started });
    mark("done", "");
    var page = { schemaVersion: AE_CATALOGUE_SCHEMA, ok: true, requestId: request.requestId, host: aeCatalogueHostInfo(), results: tally.results,
      failures: tally.failures, remaining: tally.remaining, elapsedMs: aeCatalogueNowMs() - started };
    if (hold.names.length > 0) page.held = aeCatalogueHeldAt(layer, hold.names);
    return page;
}
function aeCatalogueMatchNamesProblem(names) {
    if (!aeIsArray(names)
      || names.length > AE_CATALOGUE_MAX_MATCH_NAMES) return "matchNames must be an array of at most " + AE_CATALOGUE_MAX_MATCH_NAMES + " names.";
    for (var i = 0; i < names.length; i += 1) if (!aeCatalogueBoundedText(names[i])) return "Every match name must be a bounded non-empty string.";
    return "";
}
function aeCatalogueBreadcrumbInvalid(breadcrumb) { return typeof breadcrumb !== "string" || breadcrumb.length > 1024
  || !/[\/\\]catalogue-probe-current\.json$/.test(breadcrumb); }
function aeCatalogueBudgetInvalid(budgetMs) { return typeof budgetMs !== "number" || !isFinite(budgetMs) || budgetMs < 1; }
function aeCatalogueFlagsProblem(request) {
    var flags = ["cleanup", "hold", "engine"];
    for (var i = 0; i < flags.length; i += 1) {if (request[flags[i]] !== undefined
      && typeof request[flags[i]] !== "boolean") return flags[i] + " must be a boolean.";}
    return "";
}
function aeCatalogueOptionsProblem(request, names) {
    var flags = aeCatalogueFlagsProblem(request);
    if (flags) return flags;
    if (names.length === 0 && request.cleanup !== true) return "Nothing to probe.";
    if (request.budgetMs !== undefined && aeCatalogueBudgetInvalid(request.budgetMs)) return "budgetMs must be a positive number.";
    if (request.breadcrumb !== undefined
      && aeCatalogueBreadcrumbInvalid(request.breadcrumb)) return "breadcrumb must be the sidecar's catalogue-probe-current.json.";
    return "";
}
function aeCatalogueBudget(request, engine) {
    if (engine) return Infinity;
    return request.budgetMs === undefined ? AE_CATALOGUE_DEFAULT_BUDGET_MS : Math.min(AE_CATALOGUE_MAX_BUDGET_MS, request.budgetMs);
}
function aeCatalogueParseRequest(raw) {
    var parsed = aeCatalogueParseEnvelope(raw);
    if (parsed.error) return parsed;
    var request = parsed.request, names = request.matchNames === undefined ? [] : request.matchNames;
    var problem = aeCatalogueMatchNamesProblem(names) || aeCatalogueOptionsProblem(request, names);
    if (problem) return aeCatalogueInvalid(parsed.requestId, problem);
    var engine = request.engine === true && $.global.__extyntEngineProcess === true;
    return { request: { requestId: parsed.requestId, matchNames: names, budgetMs: aeCatalogueBudget(request, engine),
      cleanup: request.cleanup === true, hold: request.hold === true, engine: engine, breadcrumb: request.breadcrumb || null } };
}
function aeCatalogueFreshEngineProject(project) {
    if (!project || aeCatalogueProjectFile(project) !== null) return project;
    aeSafe(function () { project.close(CloseOptions.DO_NOT_SAVE_CHANGES); return true; }, false);
    return aeSafe(function () { return app.newProject(); }, null) || aeSafe(function () { return app.project; }, null);
}
function aeCatalogueScratchProject(request) {
    var project = aeSafe(function () { return app.project; }, null), violation = aeCatalogueScratchViolation(project);
    if (violation === "foreign-items" && request.engine) { project = aeCatalogueFreshEngineProject(project); violation = aeCatalogueScratchViolation(project); }
    return { project: project, violation: violation };
}
function aeCatalogueCleanupPage(request, project) {
    var cleaned = aeCatalogueRemoveScratch(project);
    return { schemaVersion: AE_CATALOGUE_SCHEMA, ok: cleaned, requestId: request.requestId, host: aeCatalogueHostInfo(), results: [], failures: [],
      remaining: [], elapsedMs: 0, cleanedUp: cleaned };
}
function aeCatalogueGroupedPage(request, project) {
    var suppressed = aeSafe(function () { app.beginSuppressDialogs(); return true; }, false);
    var grouped = aeSafe(function () { app.beginUndoGroup("extynt catalogue probe"); return true; }, false);
    try { var page = aeCatalogueRunPage(request, project); if (!page.held) aeCatalogueRemoveScratch(project); return page; }
    catch (unexpected) { aeSafe(function () { return aeCatalogueRemoveScratch(project); }, false); return aeCatalogueRefuse(request.requestId,
      "PROBE_FAILED", String(unexpected).slice(0, 160)); }
    finally {
        if (grouped) aeSafe(function () { app.endUndoGroup(); return true; }, false);
        if (suppressed) aeSafe(function () { app.endSuppressDialogs(false); return true; }, false);
    }
}
function aeCatalogueExecute(raw) {
    var parsed = aeCatalogueParseRequest(raw);
    if (parsed.error) return parsed.error;
    var request = parsed.request, scratch = aeCatalogueScratchProject(request), project = scratch.project;
    if (scratch.violation) {
        aeCatalogueRemoveLeftoverScratch(project);
        return aeCatalogueRefuse(request.requestId, "NOT_SCRATCH_PROJECT",
          "The open project is not an empty untitled scratch project, so the catalogue probe did not touch it.", scratch.violation);
    }
    return request.cleanup ? aeCatalogueCleanupPage(request, project) : aeCatalogueGroupedPage(request, project);
}
/**
 * JSON text of one probe page: `{ schemaVersion, ok: true, requestId, host, results, failures, remaining, elapsedMs,
 * held? }`, a cleanup page `{ ..., ok, cleanedUp }`, or `{ ok: false, error: { code, message, reason? } }`. Scratch
 * items never outlive a page except a held page, whose effects stay until the sidecar sends a cleanup page. Before
 * each add and removal it writes the effect it touches to the sidecar's breadcrumb file only, and only the catalogue
 * engine process may run pages unbudgeted.
 */
function aeCatalogueProbePage(raw) { return aeCatalogueGuarded(function () { return aeCatalogueExecute(raw); }); }

if (typeof aeHostDirectory === "string") {
    try { $.evalFile(new File(aeHostDirectory + "/catalogue-controls.jsx")); } catch (loadError) {
      if (typeof aeHostLoadFailed === "function") aeHostLoadFailed("catalogue-controls.jsx", loadError); }
}
