/* Apply steps for project-level operations: compositions, folders, imports, footage and project items. These need no
 * composition or layer, so the run dispatches them before it resolves any target. A render that failed after writing a
 * file records that file, so rollback is refused and the file reported.
 */
/* global aeApplyAssertFolder, aeApplyClearFootageProxy, aeApplyCompositionReadBack, aeApplyCreateComposition, aeApplyCreateFolder,
  aeApplyCreateVectorArtwork, aeApplyCreatedComps, aeApplyCreatedItems, aeApplyCreatedLayers, aeApplyExportFrame, aeApplyExportMogrt, aeApplyFindComp,
  aeApplyFindItem, aeApplyFolderContains, aeApplyImportFile, aeApplyIsFolder, aeApplyPrecomposeLayers, aeApplyRenderComposition, aeApplyRendererListed,
  aeApplyRendererNames, aeApplyReplaceFootage, aeApplyRequest, aeApplySaveProject, aeApplySetCompositionGuides, aeApplySetCompositionSettings,
  aeApplySetFootageInterpretation, aeApplySetFootageProxy, aeApplySetProjectSettings, aeOutputCleanup, aeOwnValue, aeSafe, aeSafeGet,
  aeSvgDescribeImport */
/* exported AE_APPLY_PROJECT_STEPS */
function aeApplyStepComp(operation) { return aeOwnValue(aeApplyCreatedComps, operation.compositionId) || aeApplyFindComp(operation.compositionId); }
function aeApplyStepItem(run, itemId) { return aeOwnValue(aeApplyCreatedItems, itemId) || aeOwnValue(run.createdFolders, itemId) || aeApplyFindItem(itemId); }
function aeApplyStepCreateComposition(run, operation) {
    var createdComp = aeApplyCreateComposition(operation);
    aeApplyCreatedComps[operation.newCompositionId] = createdComp; run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", requestedCompositionId: operation.newCompositionId, compositionId: String(aeSafeGet(createdComp, "id", "")), name: String(createdComp.name) };
}
function aeApplyKeepParentFolder(copy, sourceFolder) {
    if (sourceFolder && aeSafe(function () { return String(copy.parentFolder.id) !== String(sourceFolder.id); }, false)) {aeSafe(
      function () { copy.parentFolder = sourceFolder; return true; }, false);}
}
function aeApplyRenameOrRemove(copy, name) {
    if (aeSafe(function () { copy.name = name; return true; }, false)) return;
    var removed = aeSafe(function () { copy.remove(); return true; }, false);
    throw new Error(removed ? "PROPERTY_WRITE_FAILED" : "PROPERTY_WRITE_FAILED: the duplicate could not be renamed or removed");
}
function aeApplyStepDuplicateComposition(run, operation) {
    var sourceComp = aeApplyStepComp(operation);
    if (!sourceComp || typeof sourceComp.duplicate !== "function") throw new Error("DUPLICATE_COMPOSITION_UNSUPPORTED");
    var copy = aeSafe(function () { return sourceComp.duplicate(); }, null);
    if (!copy) throw new Error("DUPLICATE_COMPOSITION_FAILED");
    aeApplyKeepParentFolder(copy, aeSafeGet(sourceComp, "parentFolder", null));
    if (operation.name !== undefined) aeApplyRenameOrRemove(copy, operation.name);
    aeApplyCreatedComps[operation.newCompositionId] = copy; run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", sourceCompositionId: operation.compositionId, requestedCompositionId: operation.newCompositionId, compositionId: String(aeSafeGet(copy, "id", "")), name: String(aeSafeGet(copy, "name", "")), numLayers: aeSafeGet(copy, "numLayers", null) };
}
function aeApplyStepSaveProject(run, operation) {
    var saved = aeApplySaveProject(operation);
    run.touched.push(operation.operation); run.externalOutputs.push({ path: saved.file, operation: operation.operation });
    return { operation: operation.operation, status: "applied", mode: operation.mode, file: saved.file, bytes: saved.bytes, previousFile: saved.previousFile, verification: "project-file-saved" };
}
function aeApplyStepSetProjectSettings(run, operation) {
    var projectObserved = aeApplySetProjectSettings(operation.settings);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", observed: projectObserved, verification: "project-settings-read-back" };
}
function aeApplyStepPrecompose(run, operation) {
    var precomposeComp = aeApplyStepComp(operation), precomposed = aeApplyPrecomposeLayers(precomposeComp, operation);
    aeApplyCreatedComps[operation.newCompositionId] = precomposed.comp; aeApplyCreatedLayers[operation.compositionId + ":" + operation.newLayerId] = precomposed.layer;
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, requestedNewCompositionId: operation.newCompositionId, newCompositionId: String(aeSafe(function () { return precomposed.comp.id; }, "")), requestedLayerId: operation.newLayerId, layerId: String(aeSafe(function () { return precomposed.layer.id; }, "")), name: String(aeSafe(function () { return precomposed.comp.name; }, "")), movedLayers: aeSafe(function () { return precomposed.comp.numLayers; }, null) };
}
function aeApplyStepExportMogrt(run, operation) {
    var mogrt = aeApplyExportMogrt(aeApplyStepComp(operation), operation);
    run.touched.push(operation.operation); run.externalOutputs.push({ path: mogrt.file, operation: operation.operation });
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, file: mogrt.file, requestedFile: mogrt.requestedFile, bytes: mogrt.bytes, hostReportedComplete: mogrt.hostReportedComplete, verification: "mogrt-file-written" };
}
function aeApplyStepExportFrame(run, operation) {
    var frame = aeApplyExportFrame(aeApplyStepComp(operation), operation);
    run.touched.push(operation.operation); run.externalOutputs.push({ path: frame.file, operation: operation.operation });
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, time: operation.time, file: frame.file, requestedFile: frame.requestedFile, bytes: frame.bytes, verification: "frame-file-written" };
}
function aeApplyStepCompositionGuides(run, operation) {
    var guideCount = aeApplySetCompositionGuides(aeApplyStepComp(operation), operation);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, guideCount: guideCount, verification: "guides-written" };
}
function aeApplyStepCompositionSettings(run, operation) {
    var settingsComp = aeApplyStepComp(operation); if (!settingsComp) throw new Error("TARGET_NOT_FOUND");
    if (operation.settings.renderer !== undefined && !aeApplyRendererListed(settingsComp, operation.settings.renderer)) throw new Error("INVALID_VALUE: renderer " + String(operation.settings.renderer) + " is not in this composition's renderers (" + aeApplyRendererNames(settingsComp).join(", ") + ").");
    aeApplySetCompositionSettings(settingsComp, operation.settings);
    var readBack = aeApplyCompositionReadBack(settingsComp, operation.settings);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, checkedSettings: readBack.checked, differingSettings: readBack.different, verification: (readBack.checked > 0 && readBack.different.length === 0) ? "composition-settings-read-back" : "composition-settings-written" };
}
function aeApplyRenderRecordingFile(run, operation) {
    try { return aeApplyRenderComposition(aeApplyStepComp(operation), operation); } catch (renderError) {
      if (renderError && renderError.writtenFile) run.externalOutputs.push({ path: String(renderError.writtenFile), operation: operation.operation });
      throw renderError; }
}
function aeApplyStepRender(run, operation) {
    var renderResult = aeApplyRenderRecordingFile(run, operation);
    run.touched.push(operation.operation);
    if (renderResult.status !== "queued") run.externalOutputs.push({ path: renderResult.file || operation.outputPath, operation: operation.operation });
    var step = { operation: operation.operation, status: renderResult.status, compositionId: operation.compositionId, queueStatus: renderResult.queueStatus, file: renderResult.file, requestedFile: renderResult.requestedFile, bytes: renderResult.bytes, verification: (renderResult.status === "rendered" ? "render-file-written" : (renderResult.status === "sent-to-media-encoder" ? "render-sent-to-media-encoder" : "render-queued")) };
    if (renderResult.mediaEncoder !== undefined) step.mediaEncoder = renderResult.mediaEncoder;
    if (renderResult.settings) { step.settings = renderResult.settings.fields; step.refusedSettings = renderResult.settings.refused;
      step.adjustedSettings = renderResult.settings.adjusted; }
    return step;
}
function aeApplyStepCleanupProject(run, operation) {
    var cleanup = aeOutputCleanup(operation);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", mode: cleanup.mode, hostReportedCount: cleanup.hostReportedCount, removedCount: cleanup.removedCount, removed: cleanup.removed, removedTruncated: cleanup.removedTruncated, itemsBefore: cleanup.itemsBefore, verification: "project-cleanup-diffed" };
}
function aeApplyStepCreateFolder(run, operation) {
    var createdFolder = aeApplyCreateFolder(operation, run.createdFolders);
    run.createdFolders[operation.newFolderId] = createdFolder; run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", requestedFolderId: operation.newFolderId, folderId: String(aeSafeGet(createdFolder, "id", "")), name: String(aeSafeGet(createdFolder, "name", "")), parentFolderId: String(aeSafe(function () { return createdFolder.parentFolder.id; }, "")) };
}
function aeApplyStepImportFile(run, operation) {
    var importedItem = aeApplyImportFile(operation, run.createdFolders);
    aeApplyCreatedItems[operation.newItemId] = importedItem; run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", requestedItemId: operation.newItemId, itemId: String(aeSafeGet(importedItem, "id", "")), name: String(aeSafeGet(importedItem, "name", "")), parentFolderId: String(aeSafe(function () { return importedItem.parentFolder.id; }, "")), sequence: operation.sequence === true ? { duration: aeSafeGet(importedItem, "duration", 0), frameRate: aeSafeGet(importedItem, "frameRate", 0), isStill: aeSafe(function () { return importedItem.mainSource.isStill; }, false) } : undefined };
}
function aeApplyStepVectorArtwork(run, operation) {
    var vectorResult = aeApplyCreateVectorArtwork(operation, run.createdFolders, aeApplyRequest.planId, run.managedSources), vectorItem = vectorResult.item;
    aeApplyCreatedItems[operation.newItemId] = vectorItem; run.touched.push(operation.operation);
    var vectorStep = { operation: operation.operation, status: "applied", requestedItemId: operation.newItemId, itemId: String(aeSafeGet(vectorItem, "id", "")), name: String(aeSafeGet(vectorItem, "name", "")), parentFolderId: String(aeSafe(function () { return vectorItem.parentFolder.id; }, "")), sourceHash: operation.sourceHash, svgMetadata: operation.metadata, managedSourcePath: vectorResult.source.path, managedSourceBytes: vectorResult.source.bytes, managedSourcePolicy: "retain", persistsAfterUndo: true, importMode: "editable", layerCount: vectorResult.layerCount, nativeShapeLayers: vectorResult.shapeLayers, durationSeconds: vectorResult.durationSeconds, frameRate: vectorResult.frameRate, verification: "managed-svg-written-and-native-shape-composition-imported" };
    return aeSvgDescribeImport(vectorStep, vectorResult, operation);
}
function aeApplyFootageStep(run, operation, verification) {
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", itemId: operation.itemId, verification: verification };
}
function aeApplyStepReplaceFootage(run, operation) { aeApplyReplaceFootage(aeApplyFindItem(operation.itemId), operation.path); return aeApplyFootageStep(run, operation, "footage-replaced"); }
function aeApplyStepSetFootageProxy(run, operation) { aeApplySetFootageProxy(aeApplyFindItem(operation.itemId), operation.path); return aeApplyFootageStep(run, operation, "footage-proxy-set"); }
function aeApplyStepClearFootageProxy(run, operation) { aeApplyClearFootageProxy(aeApplyFindItem(operation.itemId)); return aeApplyFootageStep(run, operation, "footage-proxy-cleared"); }
function aeApplyStepSetFootageInterpretation(run, operation) {
    var result = aeApplySetFootageInterpretation(aeApplyFindItem(operation.itemId), operation.interpretation);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", itemId: operation.itemId, beforeValue: result.before, afterValue: result.after, verification: "footage-interpretation-read-back" };
}
function aeApplyStepSetItemName(run, operation) {
    var namedItem = aeApplyStepItem(run, operation.itemId);
    if (!namedItem) throw new Error("TARGET_NOT_FOUND");
    var beforeItemName = String(aeSafeGet(namedItem, "name", ""));
    try { namedItem.name = operation.name; } catch (itemNameError) { throw new Error("PROPERTY_WRITE_FAILED"); }
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", itemId: operation.itemId, beforeValue: beforeItemName, afterValue: String(aeSafeGet(namedItem, "name", "")) };
}
function aeApplyStepMoveItem(run, operation) {
    var movedItem = aeApplyStepItem(run, operation.itemId);
    if (!movedItem) throw new Error("TARGET_NOT_FOUND");
    var targetFolder = aeApplyAssertFolder(operation.folderId, run.createdFolders);
    if (aeApplyIsFolder(movedItem) && aeApplyFolderContains(targetFolder, movedItem)) throw new Error("FOLDER_CYCLE");
    try { movedItem.parentFolder = targetFolder; } catch (itemMoveError) { throw new Error("PROPERTY_WRITE_FAILED"); }
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", itemId: operation.itemId, parentFolderId: String(aeSafe(function () { return movedItem.parentFolder.id; }, "")) };
}
function aeApplyStepDeleteItem(run, operation) {
    var deletedItem = aeApplyStepItem(run, operation.itemId);
    if (!deletedItem) throw new Error("TARGET_NOT_FOUND");
    if (typeof deletedItem.remove !== "function") throw new Error("REMOVE_ITEM_UNSUPPORTED");
    var deletedName = String(aeSafeGet(deletedItem, "name", ""));
    try { deletedItem.remove(); } catch (itemRemoveError) { throw new Error("REMOVE_ITEM_FAILED"); }
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", itemId: operation.itemId, name: deletedName };
}
/** The project-scoped apply steps by operation name; each family file adds its entries. */
var AE_APPLY_PROJECT_STEPS = {
    create_composition: aeApplyStepCreateComposition, duplicate_composition: aeApplyStepDuplicateComposition,
      set_project_settings: aeApplyStepSetProjectSettings, save_project: aeApplyStepSaveProject, precompose_layers: aeApplyStepPrecompose,
    export_mogrt: aeApplyStepExportMogrt, export_frame: aeApplyStepExportFrame, set_composition_guides: aeApplyStepCompositionGuides,
      set_composition_settings: aeApplyStepCompositionSettings,
    render_composition: aeApplyStepRender, create_folder: aeApplyStepCreateFolder, import_file: aeApplyStepImportFile,
      create_vector_artwork: aeApplyStepVectorArtwork,
    replace_footage: aeApplyStepReplaceFootage, set_footage_proxy: aeApplyStepSetFootageProxy, clear_footage_proxy: aeApplyStepClearFootageProxy,
      set_footage_interpretation: aeApplyStepSetFootageInterpretation,
    set_item_name: aeApplyStepSetItemName, move_item_to_folder: aeApplyStepMoveItem, delete_project_item: aeApplyStepDeleteItem,
      cleanup_project: aeApplyStepCleanupProject
};
