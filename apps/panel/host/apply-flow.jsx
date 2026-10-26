/* Apply: the aeApplyPlan entry point, selection restore and the operation run. It sits under the bridge, which
 * delivers the typed plan command.
 */
/* global AE_APPLY_EFFECT_STEPS, AE_APPLY_LAYER_STEPS, AE_APPLY_PROJECT_STEPS, AE_MAX_PLAN_OPERATIONS, aeApplyAnimatedInPlan, aeApplyCreatedComps,
   aeApplyCreatedItems, aeApplyCreatedLayers, aeApplyFailure, aeApplyFindComp, aeApplyFindLayer, aeApplyFrameChecks, aeApplyIsCompositionMarker,
   aeApplyIsLockOperation, aeApplyMetadataGuard, aeApplyOtherSelections, aeApplyPreflight, aeApplyRequest, aeApplySavedSelection, aeApplySelectionComp,
   aeApplySuccessJson, aeApplyTextWriteFallbacks, aeApplyViewerMoved, aeCheckMetadataReadSet, aeClearApplyBreadcrumb, aeCollectionSameStamp,
   aeCollectionStamp, aeEntryFailure, aeHasOwn, aeMetadataReadback, aeOwnValue, aeSafe, aeSafeGet, aeSafeLayer, aeSafeProperty, aeSuppressDialogs,
   aeWriteApplyBreadcrumb */
/* exported aeApplyAnimatedInPlan, aeApplyCreatedItems, aeApplyOutsideUndoGroup, aeApplyPlan, aeApplyRememberSelection, aeApplyRestoreSelectionGrouped,
   aeApplyRollBack, aeApplyTextWriteFallbacks */
/**
 * Saves which layers of the composition are selected, once per composition, so the plan can restore them. Returns
 * nothing. The user's selection is put back on success and on failure.
 */
function aeApplyRememberSelection(comp) {
    var compId = String(aeSafeGet(comp, "id", ""));
    if (aeApplySelectionComp && String(aeSafeGet(aeApplySelectionComp, "id", "")) === compId) return;
    for (var r = 0; r < aeApplyOtherSelections.length; r += 1) if (aeApplyOtherSelections[r].id === compId) return;
    var saved = {}, chosen = aeSafeGet(comp, "selectedLayers", []) || [];
    for (var c = 0; c < chosen.length; c += 1) saved[String(aeSafe(function () { return chosen[c].id; }, ""))] = true;
    aeApplyOtherSelections.push({ id: compId, comp: comp, ids: saved });
}
function aeApplyRestoreCompSelection(comp, ids) { var count = aeSafeGet(comp, "numLayers", 0);
  for (var layerIndex = 1; layerIndex <= count; layerIndex += 1) { var candidate = aeSafeLayer(comp, layerIndex); if (!candidate) continue;
  var want = ids[String(aeSafeGet(candidate, "id", ""))] === true; if (aeSafeGet(candidate, "selected", want) !== want) {try {
  candidate.selected = want; } catch (ignoredSelection) {}} } }
function aeApplyRestoreSelection() {
    for (var o = 0; o < aeApplyOtherSelections.length; o += 1) aeApplyRestoreCompSelection(aeApplyOtherSelections[o].comp, aeApplyOtherSelections[o].ids);
    if (aeApplyViewerMoved && aeApplySelectionComp) { try { aeApplySelectionComp.openInViewer(); } catch (ignoredViewer) {} }
    aeApplyRestoreOriginalSelection();
}
function aeApplyRestoreOriginalSelection() { if (!aeApplySelectionComp) return; var count = aeSafeGet(aeApplySelectionComp, "numLayers", 0);
  for (var layerIndex = 1; layerIndex <= count; layerIndex += 1) { var candidate = aeSafeLayer(aeApplySelectionComp, layerIndex);
  if (!candidate) continue; var want = aeApplySavedSelection[String(aeSafeGet(candidate, "id", ""))] === true; if (aeSafeGet(candidate, "selected",
  want) !== want) try { candidate.selected = want; } catch (ignoredSelection) {} } }
function aeApplyRefusal(code, message) { return JSON.stringify({ ok: false, error: { code: code, message: message } }); }
function aeApplyBoundedString(value) { return typeof value === "string" && value.length >= 1 && value.length <= 256; }
function aeApplyRequestAccepted(request) {
    if (!request || request.operation !== "apply_plan") return false;
    if (!aeApplyBoundedString(request.planId) || !aeApplyBoundedString(request.undoGroup)) return false;
    return request.operations instanceof Array && request.operations.length >= 1 && request.operations.length <= AE_MAX_PLAN_OPERATIONS;
}
function aeApplyStampKept(stamp) {
    try { return typeof aeCollectionSameStamp === "function" && !!stamp && typeof stamp.epoch === "number" && typeof stamp.revision === "number"
      && aeCollectionSameStamp(stamp); } catch (ignoredStamp) { return false; }
}
function aeApplyReadSetRefusal() {
    if (typeof aeCheckMetadataReadSet !== "function") return JSON.stringify({ ok: false, mayHaveMutated: false, error: { code: "READ_SET_UNAVAILABLE" } });
    aeApplyMetadataGuard = aeCheckMetadataReadSet(aeApplyRequest);
    if (!aeApplyMetadataGuard.ok) return JSON.stringify({ ok: false, mayHaveMutated: false, error: { code: aeApplyMetadataGuard.code } });
    return null;
}
function aeApplyRefuseRequest(raw) {
    try { aeApplyRequest = JSON.parse(raw); } catch (ignored) { return aeApplyRefusal("INVALID_COMMAND", "Command was not valid JSON."); }
    if (!aeApplyRequestAccepted(aeApplyRequest)) {return aeApplyRefusal("INVALID_COMMAND",
      "Only a bounded apply_plan command is accepted (1-" + AE_MAX_PLAN_OPERATIONS + " operations).");}
    if (!app.project) return aeApplyRefusal("NO_PROJECT", "No project is open.");
    if (aeApplyRequest.expectedStamp !== undefined && !aeApplyStampKept(aeApplyRequest.expectedStamp)) {return JSON.stringify({ ok: false,
      mayHaveMutated: false, mutationState: "not-applied", error: { code: "STALE_STAMP",
      message: "The project changed in After Effects after the sidecar last read it, so nothing was applied. The sidecar will read it again; propose the plan again." } });}
    aeApplyMetadataGuard = null;
    return aeApplyRequest.readSet !== undefined ? aeApplyReadSetRefusal() : null;
}
function aeApplySaveSelection() {
    var selectedBefore = aeSafeGet(aeApplySelectionComp, "selectedLayers", []) || [];
    for (var selectedIndex = 0; selectedIndex < selectedBefore.length; selectedIndex += 1) {aeApplySavedSelection[String(aeSafe(function () {
      return selectedBefore[selectedIndex].id; }, ""))] = true;}
}
function aeApplyNewRun() {
    return { phase: "preflight", currentIndex: -1, touched: [], activeUndo: false, undoStarted: false, dialogsSuppressed: false, steps: [],
      managedSources: [], externalOutputs: [], createdFolders: {}, createdMasks: {}, createdShapeGroups: {}, createdShapeItems: {},
      createdAnimators: {}, maskBindings: [], plannedMaskAdds: {}, removedMaskBindingKeys: [], batchSize: undefined, undoGroups: undefined,
      undoGroupIndex: undefined, startShape: undefined, changedGroups: 0, groupRevision: null, openedUndoGroups: undefined,
      closedUndoGroups: undefined, breadcrumbStartedAt: undefined, startStamp: null };
}
var aeApplyRun;
function aeApplyBeginCall() {
    aeApplyTextWriteFallbacks = [];
    aeApplySelectionComp = aeApplyMetadataGuard ? null : aeSafe(function () {
      return app.project.activeItem instanceof CompItem ? app.project.activeItem : null; }, null);
    aeApplySavedSelection = {};
    if (aeApplySelectionComp) aeApplySaveSelection();
    aeApplyViewerMoved = false; aeApplyOtherSelections = [];
    aeApplyRun = aeApplyNewRun();
    aeApplyCreatedLayers = {}; aeApplyCreatedComps = {}; aeApplyCreatedItems = {}; aeApplyAnimatedInPlan = {};
}
function aeApplyUndoGroupName(run, index) {
  return run.undoGroups > 1 ? aeApplyRequest.undoGroup + " (" + (index + 1) + "/" + run.undoGroups + ")" : aeApplyRequest.undoGroup; }
function aeApplyBatchSize() {
    var size = aeApplyRequest.batchSize;
    return (typeof size === "number" && size >= 1 && size <= 1000 && Math.floor(size) === size) ? size : 0;
}
var AE_APPLY_READ_ONLY_KINDS = { read_keyframes: true };
function aeApplyReadOnlyPlan() {
    for (var i = 0; i < aeApplyRequest.operations.length; i += 1) {if (!aeHasOwn(AE_APPLY_READ_ONLY_KINDS,
      String(aeApplyRequest.operations[i].operation))) return false;}
    return aeApplyRequest.operations.length > 0;
}
function aeApplyStartUndo(run) {
    if (aeApplyReadOnlyPlan()) {
        run.readOnly = true; run.batchSize = 0; run.undoGroups = 0; run.undoGroupIndex = 0; run.openedUndoGroups = 0; run.closedUndoGroups = 0;
        run.breadcrumbStartedAt = String(new Date().getTime()); run.startStamp = null; run.startShape = null; run.changedGroups = 0;
          run.groupRevision = aeApplyRevision();
        aeSuppressDialogs(true); run.dialogsSuppressed = true;
        return;
    }
    run.batchSize = aeApplyBatchSize();
    run.undoGroups = run.batchSize ? Math.ceil(aeApplyRequest.operations.length / run.batchSize) : 1; run.undoGroupIndex = 0; run.openedUndoGroups = 0;
      run.closedUndoGroups = 0;
    run.breadcrumbStartedAt = String(new Date().getTime());
    run.startStamp = aeSafe(function () { return aeCollectionStamp(); }, null);
    run.startShape = aeSafe(aeApplyProjectShape, null); run.changedGroups = 0; run.groupRevision = aeApplyRevision();
    aeSuppressDialogs(true); run.dialogsSuppressed = true;
    app.beginUndoGroup(aeApplyUndoGroupName(run, 0)); run.openedUndoGroups += 1; run.activeUndo = true; run.undoStarted = true;
}
function aeApplyRevision() { var revision = aeSafe(function () { return app.project.revision; }, null); return typeof revision === "number" ? revision : null; }
function aeApplyNoteGroupEnd(run) {
    var revision = aeApplyRevision();
    if (revision === null || run.groupRevision === null || revision !== run.groupRevision) run.changedGroups += 1;
    run.groupRevision = revision;
}
var AE_APPLY_SHAPE_LIMIT = 3000;
function aeApplyLayerShape(layer) {
    var parts = [layer.index, layer.name, layer.parent ? layer.parent.index : 0, layer.enabled, layer.threeDLayer, layer.inPoint, layer.outPoint,
      layer.numProperties], names = ["ADBE Position", "ADBE Scale", "ADBE Rotate Z", "ADBE Opacity"], i, property;
    var transform = layer.property("ADBE Transform Group");
    for (i = 0; transform && i < names.length; i += 1) {
        property = aeSafeProperty(transform, names[i]);
        if (property) parts.push(String(property.value), property.numKeys, property.expressionEnabled ? property.expression : "");
    }
    return parts.join("|");
}
function aeApplyProjectShape() {
    var rows = [], budget = AE_APPLY_SHAPE_LIMIT, i, j, item;
    rows.push(app.project.numItems);
    for (i = 1; i <= app.project.numItems; i += 1) {
        item = app.project.item(i);
        rows.push(item.id + ":" + item.name);
        if (!(item instanceof CompItem)) continue;
        rows.push(item.numLayers + ":" + item.width + "x" + item.height + ":" + item.duration);
        for (j = 1; j <= item.numLayers; j += 1) {
            budget -= 1;
            if (budget < 0) return null;
            rows.push(aeApplyLayerShape(item.layer(j)));
        }
    }
    return rows.join("\n");
}
// Takes the failed batch back with Edit > Undo, once per undo group that holds a step, and proves it: true only when every press ran and the project
// reads as it did before the batch. A managed or external file written to disk or an unreadable start keeps the answer false.
function aeApplyRollBack(run) {
    if (!run.undoStarted || run.managedSources.length > 0 || run.externalOutputs.length > 0 || run.startShape === null
      || run.startShape === undefined) return false;
    for (var i = 0; i < run.changedGroups; i += 1) {
        try { app.executeCommand(16); } catch (ignoredUndo) { return false; }
    }
    return aeSafe(aeApplyProjectShape, null) === run.startShape;
}
// After a rollback the plan's groups are gone; a selection or viewer the presses left moved is put back in a group of its own, never as a loose step.
function aeApplyRestoreSelectionGrouped() {
    var opened = aeSafe(function () { app.beginUndoGroup(aeApplyRequest.undoGroup); return true; }, false);
    try { aeApplyRestoreSelection(); } catch (ignoredRestore) {}
    if (opened) aeSafe(function () { app.endUndoGroup(); return true; }, false);
}
function aeApplyRollUndoGroup(run) {
    aeApplyNoteGroupEnd(run);
    app.endUndoGroup(); run.closedUndoGroups += 1; run.activeUndo = false; run.undoGroupIndex += 1;
    app.beginUndoGroup(aeApplyUndoGroupName(run, run.undoGroupIndex)); run.openedUndoGroups += 1; run.activeUndo = true;
}
// Runs body with the plan's undo group closed, then opens the group again under the same name, so the writes after it are still grouped.
// renderQueue.render() called inside an open undo group leaves After Effects' undo stack out of step: the next Edit > Undo, on any
// later group, warns "Undo group mismatch, will attempt to fix" and takes back the wrong steps (B-02, AE 26 on Windows). The same render
// between two groups is clean. The group before the call and the one after it are counted like any other, so an Undo press per changed group still
// takes the plan back.
function aeApplyOutsideUndoGroup(body) {
    var run = aeApplyRun;
    if (!run || !run.activeUndo) return body();
    aeApplyNoteGroupEnd(run); app.endUndoGroup(); run.closedUndoGroups += 1; run.activeUndo = false;
    try { return body(); } finally {
        run.groupRevision = aeApplyRevision();
        app.beginUndoGroup(aeApplyUndoGroupName(run, run.undoGroupIndex)); run.openedUndoGroups += 1; run.activeUndo = true;
    }
}
function aeApplyWriteBreadcrumb(run, index, operation) {
    aeWriteApplyBreadcrumb({ planId: aeApplyRequest.planId, index: index, operationCount: aeApplyRequest.operations.length,
      operation: String(operation.operation), layerId: typeof operation.layerId === "string" ? operation.layerId : null, startedAt: run.breadcrumbStartedAt });
}
function aeApplyStepHandler(tables, kind) {
    if (typeof kind !== "string") return null;
    for (var t = 0; t < tables.length; t += 1) if (aeHasOwn(tables[t], kind)) return tables[t][kind];
    return null;
}
function aeApplyRunStep(run, handler, operation, scope) {
    if (!handler) return;
    var step = handler(run, operation, scope);
    if (step) run.steps.push(step);
}
function aeApplyAssertLayerEditable(layer, operation) {
    if (operation.operation === "create_layer" || aeApplyIsCompositionMarker(operation)) return;
    if (!layer) throw new Error("TARGET_NOT_FOUND");
    if (layer.locked && !aeApplyIsLockOperation(operation)) throw new Error("TARGET_LOCKED");
}
function aeApplyLayerStage(run, operation, index) {
    var comp = aeOwnValue(aeApplyCreatedComps, operation.compositionId) || aeApplyFindComp(operation.compositionId),
      layer = aeApplyCreatedLayers[operation.compositionId + ":" + operation.layerId] || aeApplyFindLayer(comp, operation.layerId);
    if (!comp) throw new Error("TARGET_NOT_FOUND");
    aeApplyAssertLayerEditable(layer, operation);
    aeApplyRunStep(run, aeApplyStepHandler([AE_APPLY_LAYER_STEPS, AE_APPLY_EFFECT_STEPS], operation.operation), operation, { index: index, comp: comp,
      layer: layer });
}
function aeApplyRunOperation(run, index) {
    if (run.batchSize && index > 0 && index % run.batchSize === 0) aeApplyRollUndoGroup(run);
    run.currentIndex = index;
    var operation = aeApplyRequest.operations[index];
    aeApplyWriteBreadcrumb(run, index, operation);
    var projectStep = aeApplyStepHandler([AE_APPLY_PROJECT_STEPS], operation.operation);
    if (projectStep) aeApplyRunStep(run, projectStep, operation, { index: index });
    else aeApplyLayerStage(run, operation, index);
}
function aeApplyCompIsTopLevel(comp) { return aeSafe(function () { return comp.usedIn.length; }, 1) === 0; }
function aeApplyOpenBuiltComp() {
    var built = null, key;
    for (key in aeApplyCreatedComps) {if (aeHasOwn(aeApplyCreatedComps, key)
      && aeApplyCompIsTopLevel(aeApplyCreatedComps[key])) built = aeApplyCreatedComps[key];}
    if (!built) return;
    try { built.openInViewer(); } catch (ignoredOpen) {}
}
function aeApplySuccess(run) {
    var frameChecks = aeSafe(function () { return aeApplyFrameChecks(run); }, []);
    aeApplyRestoreSelection();
    aeApplyOpenBuiltComp();
    aeApplyCloseRun(run);
    return aeApplySuccessJson(run, aeApplyMetadataGuard ? aeMetadataReadback(aeApplyRequest, aeApplyMetadataGuard) : null, frameChecks);
}
function aeApplyCloseRun(run) {
    if (run.activeUndo) { aeApplyNoteGroupEnd(run); app.endUndoGroup(); run.closedUndoGroups += 1; run.activeUndo = false; }
    aeClearApplyBreadcrumb(); aeSuppressDialogs(false); run.dialogsSuppressed = false;
}
function aeApplyExecute(run) {
    aeApplyPreflight(run);
    run.phase = "apply"; run.currentIndex = -1;
    aeApplyStartUndo(run);
    for (var i = 0; i < aeApplyRequest.operations.length; i += 1) aeApplyRunOperation(run, i);
    return aeApplySuccess(run);
}
function aeApplyAbort(run) {
    if (run.activeUndo) try { aeApplyRestoreSelection(); } catch (ignoredRestore) {}
    if (run.activeUndo) try { aeApplyNoteGroupEnd(run); app.endUndoGroup(); run.closedUndoGroups += 1; run.activeUndo = false; } catch (ignoredEnd) {}
    aeClearApplyBreadcrumb();
    if (run.dialogsSuppressed) { aeSuppressDialogs(false); run.dialogsSuppressed = false; }
}
function aeApplyPlanRun(raw) {
    var refusal = aeApplyRefuseRequest(raw);
    if (refusal !== null) return refusal;
    aeApplyBeginCall();
    var run = aeApplyRun;
    try { return aeApplyExecute(run); } catch (error) { aeApplyAbort(run); return aeApplyFailure(run, error); }
}
/**
 * Applies a plan. Takes the request JSON; returns the apply result JSON, or the aeEntryFailure JSON when an error
 * escapes. Every operation is preflighted before any is applied, then applied in one run with an undo group per
 * batchSize operations; a plan of only reads opens no undo group. The selection and viewer writes land inside the last
 * group, and an error outside the run's own try is a typed failure that applied nothing.
 */
function aeApplyPlan(raw) {
    try { return aeApplyPlanRun(raw); } catch (escaped) { return aeEntryFailure(escaped); }
}
