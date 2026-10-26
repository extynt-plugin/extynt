/* Apply: composition, folder, precompose, export and project-level operations. It sits under apply-flow.jsx, which
 * dispatches the project operations here.
 */
/* global aeApplyCreatedLayers, aeApplyEssentialState, aeApplyFindItem, aeApplyFindLayer, aeApplyFindProperty, aeApplyIsFolder,
  aeApplyOutsideUndoGroup, aeErrorText, aeOutputApplySettings, aeOutputAssertAccepted, aeOutputSendToMediaEncoder, aeOwnValue, aeSafe, aeSafeGet,
  aeSafeLayer */
/* exported aeApplyAddEssentialProperty, aeApplyCreateComposition, aeApplyCreateFolder, aeApplyExportFrame, aeApplyExportMogrt, aeApplyFolderContains,
  aeApplyImportFile, aeApplyPrecomposeLayers, aeApplyRenderComposition, aeApplyRenderStatusName, aeApplySaveProject, aeApplySetCompositionGuides,
  aeApplySetProjectSettings */
/* global aeOutputAssertMediaEncoder */
function aeApplyPrecomposeMember(comp, operation, layerId) {
    var member = aeApplyCreatedLayers[operation.compositionId + ":" + layerId] || aeApplyFindLayer(comp, layerId);
    if (!member) throw new Error("TARGET_NOT_FOUND");
    if (member.locked) throw new Error("TARGET_LOCKED");
    return aeSafeGet(member, "index", 0);
}
function aeApplyPrecomposeIndices(comp, operation) {
    var indices = [];
    for (var p = 0; p < operation.layerIds.length; p += 1) indices.push(aeApplyPrecomposeMember(comp, operation, operation.layerIds[p]));
    indices.sort(function (left, right) { return left - right; });
    return indices;
}
function aeApplyPrecompositionLayer(comp, precomp) {
    var precompId = String(aeSafeGet(precomp, "id", "")), count = aeSafeGet(comp, "numLayers", 0), precompLayer = null;
    for (var l = 1; l <= count && !precompLayer; l += 1) {
        var candidate = aeSafeLayer(comp, l);
        if (candidate && String(aeSafe(function () { return candidate.source.id; }, "")) === precompId) precompLayer = candidate;
    }
    return precompLayer;
}
/** Precomposes the operation's layers. Returns {comp,layer}, the new composition and its layer; throws PRECOMPOSE_FAILED. */
function aeApplyPrecomposeLayers(comp, operation) {
    if (!comp || !comp.layers || typeof comp.layers.precompose !== "function") throw new Error("PRECOMPOSE_UNSUPPORTED");
    var indices = aeApplyPrecomposeIndices(comp, operation);
    var precomp; try { precomp = comp.layers.precompose(indices, operation.name, operation.moveAllAttributes); } catch (precomposeError) { throw new Error("PRECOMPOSE_FAILED: " + aeErrorText(precomposeError)); }
    if (!precomp) throw new Error("PRECOMPOSE_FAILED: no composition was returned.");
    var precompLayer = aeApplyPrecompositionLayer(comp, precomp);
    if (!precompLayer) throw new Error("PRECOMPOSE_FAILED: the precomp layer was not found in the parent composition.");
    return { comp: precomp, layer: precompLayer };
}
function aeApplyEssentialAdd(comp, property, operation) {
    if (operation.name && typeof property.addToMotionGraphicsTemplateAs === "function") return property.addToMotionGraphicsTemplateAs(comp, operation.name);
    if (typeof property.addToMotionGraphicsTemplate === "function") return property.addToMotionGraphicsTemplate(comp);
    throw new Error("ESSENTIAL_GRAPHICS_UNSUPPORTED: this After Effects version has no addToMotionGraphicsTemplate.");
}
function aeApplyEssentialFailure(essentialError) {
    return new Error(String(essentialError && essentialError.message).indexOf("ESSENTIAL_GRAPHICS_UNSUPPORTED") === 0 ? essentialError.message : "ESSENTIAL_GRAPHICS_UNSUPPORTED: " + aeErrorText(essentialError));
}
function aeApplyAssertEssentialAddable(comp, property) {
    if (typeof property.canAddToMotionGraphicsTemplate === "function" && aeSafe(function () { return property.canAddToMotionGraphicsTemplate(comp); }, true) === false) throw new Error("ESSENTIAL_GRAPHICS_UNSUPPORTED: this property cannot be added to Essential Graphics.");
}
/** Adds a property to the Essential Graphics panel. Returns {named,readback:{before,after,names}|null}. */
function aeApplyAddEssentialProperty(comp, layer, operation) {
    var property = aeApplyFindProperty(layer, operation.propertyPath); if (!property) throw new Error("PROPERTY_NOT_FOUND");
    aeApplyAssertEssentialAddable(comp, property);
    var added, before = aeApplyEssentialState(comp);
    try { added = aeApplyEssentialAdd(comp, property, operation); } catch (essentialError) { throw aeApplyEssentialFailure(essentialError); }
    if (added === false) throw new Error("ESSENTIAL_GRAPHICS_UNSUPPORTED: After Effects refused the property.");
    var after = before ? aeApplyEssentialState(comp) : null;
    return { named: !!operation.name && typeof property.addToMotionGraphicsTemplateAs === "function", readback: after ? { before: before.count, after: after.count, names: after.names } : null };
}
function aeApplyFileState(file) {
    var exists = aeSafe(function () { return file.exists === true; }, false);
    if (!exists) return { exists: false, length: 0, modified: null };
    var modified = aeSafe(function () { return file.modified.getTime(); }, null);
    return { exists: true, length: aeSafeGet(file, "length", 0), modified: typeof modified === "number" ? modified : null };
}
function aeApplyFileWritten(before, after) {
    if (!after.exists || !(after.length > 0)) return false;
    if (!before.exists) return true;
    if (before.modified !== null && after.modified !== null) return before.modified !== after.modified;
    return before.length !== after.length;
}
function aeApplyMogrtGeneratedFile(operation, destination) { return new File(destination.fsName + "/" + operation.templateName + ".mogrt"); }
function aeApplyMogrtFileWritten(operation, destination, before) {
    var generated = aeApplyMogrtGeneratedFile(operation, destination), requested = new File(operation.outputPath), moved = false;
    if (aeApplyFileWritten(before.generated, aeApplyFileState(generated))
      && String(generated.fsName).toLowerCase() !== String(requested.fsName).toLowerCase()) {
        if (requested.exists && operation.overwrite) aeSafe(function () { return requested.remove(); }, false);
        moved = !requested.exists && aeSafe(function () { return generated.rename(requested.name); }, false) === true;
    }
    if (moved || aeApplyFileWritten(before.requested, aeApplyFileState(new File(operation.outputPath)))) return new File(operation.outputPath);
    return null;
}
function aeApplyMogrtBeforeState(operation, destination) {
    if (!destination || destination.exists === false) throw new Error("MOGRT_EXPORT_FAILED: destination directory does not exist.");
    var before = { requested: aeApplyFileState(new File(operation.outputPath)),
      generated: aeApplyFileState(aeApplyMogrtGeneratedFile(operation, destination)) };
    if (before.requested.exists && !operation.overwrite) throw new Error("MOGRT_EXPORT_FAILED: " + operation.outputPath + " already exists; set overwrite to replace it.");
    return before;
}
/** Exports the composition as a Motion Graphics template. Returns {file,requestedFile,bytes,hostReportedComplete}. */
function aeApplyExportMogrt(comp, operation) {
    if (!comp || typeof comp.exportAsMotionGraphicsTemplate !== "function") throw new Error("ESSENTIAL_GRAPHICS_UNSUPPORTED: this After Effects version cannot export MOGRTs from script.");
    try { comp.motionGraphicsTemplateName = operation.templateName; } catch (templateNameError) { throw new Error("PROPERTY_WRITE_FAILED: motionGraphicsTemplateName"); }
    var destination = new File(operation.outputPath).parent, before = aeApplyMogrtBeforeState(operation, destination);
    var exported; try { exported = comp.exportAsMotionGraphicsTemplate(operation.overwrite, destination.fsName); } catch (exportError) { throw new Error("MOGRT_EXPORT_FAILED: " + aeErrorText(exportError)); }
    var writtenFile = aeApplyMogrtFileWritten(operation, destination, before);
    if (!writtenFile) throw new Error("MOGRT_EXPORT_FAILED: After Effects reported the export " + (exported === false ? "did not complete" : "complete") + " but wrote no new file (no Essential Properties, or the export was refused).");
    return { file: operation.outputPath, requestedFile: operation.outputPath, bytes: aeSafeGet(writtenFile, "length", null), hostReportedComplete: exported !== false };
}
var AE_FRAME_EXPORT_WAIT_MS = 30000;
function aeApplyFrameFileSettled(path, lastBytes) {
    var file = new File(path), bytes = file.exists ? aeSafeGet(file, "length", 0) : 0;
    return { bytes: bytes, settled: bytes > 0 && bytes === lastBytes };
}
function aeApplyAwaitFrameFile(path) {
    var waited = 0, seen = 0, state;
    while (waited <= AE_FRAME_EXPORT_WAIT_MS) {
        state = aeApplyFrameFileSettled(path, seen);
        if (state.settled) return state.bytes;
        seen = state.bytes; if (typeof $ !== "undefined" && typeof $.sleep === "function") $.sleep(250); waited += 250;
    }
    return 0;
}
function aeApplyEnsureFolder(folder, code) {
    if (!folder) throw new Error(code + ": destination directory does not exist.");
    if (folder.exists) return;
    var home = aeSafe(function () { return Folder("~").fsName; }, ""), path = String(folder.fsName).replace(/\\/g, "/"), root = String(home).replace(/\\/g, "/");
    if (!root || path.indexOf(root + "/") !== 0) throw new Error(code + ": destination directory does not exist, and only folders under the home folder are created (" + path + ").");
    if (folder.parent) aeApplyEnsureFolder(folder.parent, code);
    if (!folder.create()) throw new Error(code + ": the destination folder could not be created.");
}
function aeApplyExportFile(comp, operation) {
    if (!comp || typeof comp.saveFrameToPng !== "function") throw new Error("FRAME_EXPORT_UNSUPPORTED: this After Effects version has no CompItem.saveFrameToPng (it arrived in 24.x); export the frame through a render instead.");
    if (operation.time > comp.duration) throw new Error("INVALID_VALUE: time " + operation.time + "s is past the end of the composition (" + comp.duration + "s).");
    var file = new File(operation.outputPath), destination = file.parent;
    aeApplyEnsureFolder(destination, "FRAME_EXPORT_FAILED");
    if (file.exists && !operation.overwrite) throw new Error("FRAME_EXPORT_FAILED: " + operation.outputPath + " already exists; set overwrite to replace it.");
    if (file.exists && !file.remove()) throw new Error("FRAME_EXPORT_FAILED: the existing file could not be replaced.");
    return file;
}
function aeApplyExportRender(comp, operation, file) {
    var factorBefore = aeSafeGet(comp, "resolutionFactor", null), divisor = typeof operation.resolution === "number" ? operation.resolution : 1;
    try {
        if (factorBefore) comp.resolutionFactor = [divisor, divisor];
        comp.saveFrameToPng(operation.time, file);
    } catch (saveError) { if (factorBefore) aeSafe(function () { comp.resolutionFactor = factorBefore; return true; }, false); throw new Error("FRAME_EXPORT_FAILED: " + aeErrorText(saveError)); }
    return factorBefore;
}
/**
 * Saves one frame as an image. Returns {file,requestedFile,bytes}. The destination is one exact file; a missing
 * folder is created only beneath the user's home folder. The frame is taken at full size, waited for until it exists
 * and its size stops changing, and never rendered inside the plan's open undo group.
 */
function aeApplyExportFrame(comp, operation) {
    var file = aeApplyExportFile(comp, operation), factorBefore = aeApplyExportRender(comp, operation, file);
    var bytes = aeApplyAwaitFrameFile(operation.outputPath);
    if (factorBefore) aeSafe(function () { comp.resolutionFactor = factorBefore; return true; }, false);
    if (bytes < 1) throw new Error("FRAME_EXPORT_FAILED: After Effects wrote no PNG within " + (AE_FRAME_EXPORT_WAIT_MS / 1000) + " seconds.");
    return { file: operation.outputPath, requestedFile: operation.outputPath, bytes: bytes };
}
function aeApplyRemoveGuides(comp) {
    if (typeof comp.removeGuide !== "function") throw new Error("GUIDES_UNSUPPORTED");
    for (var g = aeSafe(function () { return comp.guides.length; }, 0) - 1; g >= 0; g -= 1) comp.removeGuide(g);
}
function aeApplyAddGuide(comp, guide) {
    try { comp.addGuide(guide.orientation === "vertical" ? 1 : 0, guide.position); } catch (guideError) { throw new Error("GUIDES_UNSUPPORTED: " + aeErrorText(guideError)); }
}
/** Adds the guides (optionally replacing the existing ones). Returns the guide count, or null when unreadable. */
function aeApplySetCompositionGuides(comp, operation) {
    if (!comp || typeof comp.addGuide !== "function") throw new Error("GUIDES_UNSUPPORTED");
    if (operation.replace) aeApplyRemoveGuides(comp);
    for (var i = 0; i < operation.guides.length; i += 1) aeApplyAddGuide(comp, operation.guides[i]);
    return aeSafe(function () { return comp.guides.length; }, null);
}
function aeApplyIncrementedProjectFile(current) {
    var base = String(current.name).replace(/\.aepx?$/i, ""), extension = (/\.aepx$/i.test(String(current.name))) ? ".aepx" : ".aep", match = /^(.*?)[_ ]?([0-9]{2,4})$/.exec(base), stem = match ? match[1] : base, number = match ? Number(match[2]) + 1 : 2;
    for (var tries = 0; tries < 999; tries += 1, number += 1) {
        var digits = String(number); while (digits.length < 3) digits = "0" + digits;
        var candidate = new File(current.parent.fsName + "/" + stem + "_" + digits + extension);
        if (!candidate.exists) return candidate;
    }
    throw new Error("PROJECT_SAVE_FAILED: no free incremental name beside " + current.fsName);
}
function aeApplySaveTarget(operation, current) {
    if (operation.mode === "save_as") {
        var target = new File(operation.path);
        aeApplyEnsureFolder(target.parent, "PROJECT_SAVE_FAILED");
        if (target.exists && operation.overwrite !== true) throw new Error("PROJECT_SAVE_EXISTS: " + operation.path + " already exists; set overwrite to replace it.");
        return target;
    }
    if (!current) throw new Error("PROJECT_UNSAVED: the project has never been saved, so there is no file to " + (operation.mode === "increment" ? "number from" : "save into") + ". Use mode save_as with a path.");
    return operation.mode === "increment" ? aeApplyIncrementedProjectFile(current) : null;
}
/**
 * Saves the project. Returns {file,bytes,previousFile}. Increment and Save writes name_003.aep after name_002.aep, the
 * first number not taken, and a name without a number gets _002.
 */
function aeApplySaveProject(operation) {
    var current = aeSafe(function () { return app.project.file; }, null), target = aeApplySaveTarget(operation, current);
    try { if (target) app.project.save(target); else app.project.save(); } catch (saveError) { throw new Error("PROJECT_SAVE_FAILED: " + aeErrorText(saveError)); }
    var saved = aeSafe(function () { return app.project.file; }, null);
    if (!saved || (target && String(saved.fsName).replace(/\\/g, "/") !== String(target.fsName).replace(/\\/g, "/"))) throw new Error("PROJECT_SAVE_FAILED: After Effects does not report the project at the saved path.");
    var bytes = aeSafe(function () { return new File(saved.fsName).length; }, 0);
    if (!(bytes > 0)) throw new Error("PROJECT_SAVE_FAILED: the saved file is empty or missing.");
    return { file: String(saved.fsName), bytes: bytes, previousFile: current ? String(current.fsName) : null };
}
/** Writes project settings. Returns the observed values as {<setting>: value|null}. */
function aeApplySetProjectSettings(settings) {
    var names = ["bitsPerChannel", "linearBlending", "workingSpace", "linearizeWorkingSpace"], observed = {};
    for (var s = 0; s < names.length; s += 1) {
        var name = names[s]; if (settings[name] === undefined) continue;
        try { app.project[name] = settings[name]; } catch (settingError) { throw new Error("PROJECT_SETTINGS_UNSUPPORTED: " + name + ": " + aeErrorText(settingError)); }
        observed[name] = aeSafe(function () { return app.project[name]; }, null);
        if (observed[name] !== settings[name]) throw new Error("PROJECT_SETTINGS_UNSUPPORTED: " + name + " did not take the requested value.");
    }
    return observed;
}
/** Adds a composition. Returns it; throws Error(CREATE_COMPOSITION_UNSUPPORTED). */
function aeApplyCreateComposition(operation) {
    if (!app.project.items || typeof app.project.items.addComp !== "function") throw new Error("CREATE_COMPOSITION_UNSUPPORTED");
    var comp = aeSafe(function () { return app.project.items.addComp(
      operation.name, operation.width, operation.height, 1, operation.durationSeconds, operation.frameRate); }, null);
    if (!comp) throw new Error("CREATE_COMPOSITION_UNSUPPORTED");
    return comp;
}
function aeApplyRenderQueueUsable(comp) {
    return !!comp && !!app.project && !!app.project.renderQueue && !!app.project.renderQueue.items && typeof app.project.renderQueue.items.add === "function";
}
function aeApplyRenderSnapshot(queue) {
    var flags = [], count = aeSafe(function () { return queue.items.length; }, 0);
    for (var index = 1; index <= count; index += 1) {
        var item = aeSafe((function (at) { return function () { return queue.items.item(at); }; })(index), null);
        if (item) flags.push({ item: item, render: aeSafe((function (held) { return function () { return held.render; }; })(item), false) });
    }
    return flags;
}
function aeApplyRenderApplyTemplate(target, template) {
    if (template === undefined) return;
    if (typeof target.applyTemplate !== "function") throw new Error("RENDER_TEMPLATE_UNSUPPORTED");
    target.applyTemplate(template);
}
function aeApplyRenderConfigure(queueItem, operation) {
    try {
        aeApplyRenderApplyTemplate(queueItem, operation.renderSettingsTemplate);
        var outputModule = aeSafe(function () { return queueItem.outputModule(1); }, null); if (!outputModule) throw new Error("RENDER_OUTPUT_UNSUPPORTED");
        aeApplyRenderApplyTemplate(outputModule, operation.outputModuleTemplate);
        outputModule.file = new File(operation.outputPath);
    } catch (renderSetupError) { throw renderSetupError instanceof Error ? renderSetupError : new Error("RENDER_CONFIG_FAILED"); }
}
function aeApplyRenderRestoreFlags(flags) {
    for (var index = 0; index < flags.length; index += 1) {aeSafe(
      (function (entry) { return function () { entry.item.render = entry.render; return true; }; })(flags[index]), false);}
}
function aeApplyRenderExecute(queue, queueItem, flags) {
    if (typeof app.project.renderQueue.render !== "function") throw new Error("RENDER_QUEUE_UNSUPPORTED");
    try {
        for (var index = 0; index < flags.length; index += 1) flags[index].item.render = false;
        queueItem.render = true;
        aeApplyOutsideUndoGroup(function () { queue.render(); });
    } catch (renderError) { throw new Error("RENDER_EXECUTION_FAILED: " + aeErrorText(renderError)); }
    finally { aeApplyRenderRestoreFlags(flags); }
}
var AE_RENDER_NO_FILE = { exists: false, length: 0, modified: null };
// RQItemStatus members are numeric in After Effects; the receipt and error text name the member, and an unreadable status stays "unknown".
function aeApplyRenderStatusName(raw) {
    if (raw === undefined) return "unknown";
    var names = typeof RQItemStatus === "undefined" ? null : RQItemStatus;
    if (names) { for (var key in names) { if (Object.prototype.hasOwnProperty.call(names, key) && names[key] === raw) return key; } }
    return String(raw);
}
function aeApplyRenderStatusDone(raw) { return typeof RQItemStatus !== "undefined" && !!RQItemStatus && raw === RQItemStatus.DONE; }
function aeApplyRenderBefore(queueItem, operation) {
    var before = {}, requested = new File(operation.outputPath), actual = aeSafe(function () { return queueItem.outputModule(1).file; }, null);
    before[String(requested.fsName).toLowerCase()] = aeApplyFileState(requested);
    if (actual) { var actualPath = String(aeSafeGet(actual, "fsName", "")).toLowerCase(); if (actualPath && !before[actualPath]) before[actualPath] = aeApplyFileState(actual); }
    return before;
}
function aeApplyRenderWrittenFile(queueItem, before) {
    var renderedFile = aeSafe(function () { return queueItem.outputModule(1).file; }, null);
    if (!renderedFile) return null;
    var renderedPath = String(aeSafeGet(renderedFile, "fsName", ""));
    var previous = Object.prototype.hasOwnProperty.call(before, renderedPath.toLowerCase()) ? before[renderedPath.toLowerCase()] : AE_RENDER_NO_FILE;
    return aeApplyFileWritten(previous, aeApplyFileState(renderedFile)) ? renderedPath : null;
}
function aeApplyRenderOutcome(queueItem, operation, before) {
    var rawStatus = aeSafeGet(queueItem, "status", undefined), queueStatus = aeApplyRenderStatusName(rawStatus);
    var finished = aeApplyRenderStatusDone(rawStatus) || rawStatus === undefined;
    var writtenPath = aeApplyRenderWrittenFile(queueItem, before);
    var renderedFile = aeSafe(function () { return queueItem.outputModule(1).file; }, null);
    if (!finished || !writtenPath) {
        var failure = new Error("RENDER_EXECUTION_FAILED: After Effects finished the queue with status " + queueStatus + " and wrote no new file.");
        if (writtenPath) { failure.message = "RENDER_EXECUTION_FAILED: After Effects left the queue with status " + queueStatus + " after writing " + writtenPath + "."; failure.writtenFile = writtenPath; }
        throw failure;
    }
    return { queueItem: queueItem, status: "rendered", queueStatus: queueStatus, file: writtenPath, requestedFile: operation.outputPath, bytes: aeSafeGet(renderedFile, "length", null) };
}
function aeApplyRenderDiscard(queueItem) { aeSafe(function () { queueItem.remove(); return true; }, false); }
/**
 * Queues the composition in the render queue and renders or sends it. Returns the render result
 * {status,file,requestedFile,bytes,queueStatus,...}; throws on a refusal. A render counts only when its queue item
 * finished (or its status cannot be read) and its file is new or rewritten; the queue item this call added is removed,
 * so a failed render leaves nothing to render later.
 */
function aeApplyRenderComposition(comp, operation) {
    if (!aeApplyRenderQueueUsable(comp)) throw new Error("RENDER_QUEUE_UNSUPPORTED");
    if (operation.mediaEncoder !== undefined) aeOutputAssertMediaEncoder(app.project.renderQueue);
    var queue = app.project.renderQueue, flags = aeApplyRenderSnapshot(queue);
    var queueItem = aeSafe(function () { return queue.items.add(comp); }, null); if (!queueItem) throw new Error("RENDER_QUEUE_UNSUPPORTED");
    try { return aeApplyRenderItem(queue, queueItem, flags, operation); } catch (itemError) { aeApplyRenderDiscard(queueItem); throw itemError; }
}
function aeApplyRenderExecuteKeepingFile(queue, queueItem, flags, before) {
    try { aeApplyRenderExecute(queue, queueItem, flags); } catch (executeError) {
      var partial = aeApplyRenderWrittenFile(queueItem, before); if (partial) executeError.writtenFile = partial; throw executeError; }
}
function aeApplyRenderItem(queue, queueItem, flags, operation) {
    aeApplyRenderConfigure(queueItem, operation);
    var settings = (operation.outputSettings || operation.renderSettings) ? aeOutputApplySettings(queueItem, operation) : null;
    var before = aeApplyRenderBefore(queueItem, operation);
    if (operation.mediaEncoder !== undefined) { if (settings) aeOutputAssertAccepted(settings);
      return aeApplyWithSettings(aeOutputSendToMediaEncoder(queue, queueItem, flags, operation), settings); }
    if (operation.executeAuthorization !== "RENDER_NOW") return aeApplyWithSettings({ queueItem: queueItem, status: "queued" }, settings);
    if (settings) aeOutputAssertAccepted(settings);
    aeApplyRenderExecuteKeepingFile(queue, queueItem, flags, before);
    return aeApplyWithSettings(aeApplyRenderOutcome(queueItem, operation, before), settings);
}
function aeApplyWithSettings(result, settings) { if (settings) result.settings = settings; return result; }
function aeApplyResolveFolder(id, createdFolders) { if (id === undefined || id === null) return app.project.rootFolder;
  return aeOwnValue(createdFolders, id) || aeApplyFindItem(id); }
function aeApplyAssertFolder(id, createdFolders) { var folder = aeApplyResolveFolder(id, createdFolders); if (!aeApplyIsFolder(folder)) throw new Error("TARGET_NOT_FOUND"); return folder; }
/** True when the item is the folder or sits anywhere below it. */
function aeApplyFolderContains(folder, item) { var current = folder; while (current) { if (String(aeSafeGet(current, "id", "")) === String(aeSafeGet(item, "id", ""))) return true; var next = aeSafeGet(current, "parentFolder", null); if (!next || next === current) break; current = next; } return false; }
/** Adds a project folder under its parent. Returns the folder; throws Error(CREATE_FOLDER_UNSUPPORTED or PROPERTY_WRITE_FAILED). */
function aeApplyCreateFolder(operation, createdFolders) { var parent = aeApplyAssertFolder(operation.parentFolderId, createdFolders); var folder = aeSafe(function () { return app.project.items.addFolder(operation.name); }, null); if (!folder) throw new Error("CREATE_FOLDER_UNSUPPORTED"); try { folder.parentFolder = parent; } catch (folderError) { throw new Error("PROPERTY_WRITE_FAILED"); } return folder; }
var AE_IMPORT_AS_MEMBERS = { footage: "FOOTAGE", composition: "COMP", "composition-cropped-layers": "COMP_CROPPED_LAYERS" };
function aeApplyImportAsType(requested) {
    if (typeof ImportAsType === "undefined") return null;
    return ImportAsType[Object.prototype.hasOwnProperty.call(AE_IMPORT_AS_MEMBERS, requested) ? AE_IMPORT_AS_MEMBERS[requested] : "PROJECT"];
}
function aeApplyImportOptions(file, requested, sequence) {
    var options = new ImportOptions(file);
    if (sequence) { options.sequence = true; options.forceAlphabetical = sequence.forceAlphabetical === true; }
    if (requested === "auto") return options;
    var importType = aeApplyImportAsType(requested);
    if (!importType || !aeSafe(function () { return options.canImportAs(importType); }, false)) throw new Error("INVALID_IMPORT_TYPE");
    options.importAs = importType;
    return options;
}
/** Imports a file into the project. Returns the imported item; throws Error(IMPORT_FILE_NOT_FOUND or IMPORT_FAILED). */
function aeApplyImportFile(operation, createdFolders) {
    var file = new File(operation.path); if (!aeSafe(function () { return file.exists === true; }, false)) throw new Error("IMPORT_FILE_NOT_FOUND");
    if (typeof ImportOptions === "undefined") throw new Error("IMPORT_UNSUPPORTED");
    var destination = aeApplyAssertFolder(operation.destinationFolderId, createdFolders);
    var options = aeApplyImportOptions(file, operation.importAs || "auto", operation.sequence === true ? { forceAlphabetical: operation.forceAlphabetical } : null);
    var imported = aeSafe(function () { return app.project.importFile(options); }, null); if (!imported) throw new Error("IMPORT_FAILED");
    try { imported.parentFolder = destination; } catch (moveError) { throw new Error("PROPERTY_WRITE_FAILED"); }
    return imported;
}
