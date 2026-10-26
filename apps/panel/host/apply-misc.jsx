/* Apply set_text_path, open_composition, start_analysis, resize_solid, switch_project and save_layer_preset. It sits
 * under apply-flow.jsx, which dispatches those operations here.
 */
/* global AE_APPLY_LAYER_STEPS, AE_APPLY_PROJECT_STEPS, AE_APPLY_VAL_CHECKS, AE_APPLY_VAL_RULES_COMPOSITION, AE_APPLY_VAL_RULES_LAYER,
   AE_APPLY_VAL_RULES_PROJECT, FileSource, aeApplyForgetRun, aeApplyViewerSettled, aeApplyCreatedComps aeApplyFindComp, aeApplyFindProperty,
   aeApplyIsAbsolutePath, aeApplyIsolateLayerInViewer aeApplyValSpecRule aeErrorText, aeOwnValue, aeSafe, aeSafeGet, aeSafeLayer, aeSafeProperty */

var AE_TEXT_PATH_GROUP = "ADBE Text Properties/ADBE Text Path Options";
var AE_TEXT_PATH_FIELDS = { maskIndex: { matchNames: ["ADBE Text Path"], names: ["Path"] }, firstMargin: { matchNames: ["ADBE Text First Margin"],
  names: ["First Margin"] }, lastMargin: { matchNames: ["ADBE Text Last Margin", "ADBE Text Margin"], names: ["Last Margin"] } };
function aeMiscOptional(check, value, min, max) { return value === undefined || AE_APPLY_VAL_CHECKS[check](value, min, max); }
AE_APPLY_VAL_CHECKS.textPath = function (operation) {
    if (operation.maskIndex === undefined && operation.firstMargin === undefined && operation.lastMargin === undefined) return false;
    return aeMiscOptional("integer", operation.maskIndex, 0, 1024) && aeMiscOptional("num", operation.firstMargin, -1000000, 1000000)
      && aeMiscOptional("num", operation.lastMargin, -1000000, 1000000);
};
AE_APPLY_VAL_RULES_LAYER.set_text_path = aeApplyValSpecRule([[null, "textPath"]]);
function aeTextPathChild(group, field) {
    var count = aeSafeGet(group, "numProperties", 0), spec = AE_TEXT_PATH_FIELDS[field];
    for (var i = 1; i <= count; i += 1) {
        var child = aeSafeProperty(group, i);
        if (!child) continue;
        var matchName = String(aeSafeGet(child, "matchName", "")), name = String(aeSafeGet(child, "name", ""));
        for (var m = 0; m < spec.matchNames.length; m += 1) if (matchName === spec.matchNames[m]) return child;
        for (var n = 0; n < spec.names.length; n += 1) if (name === spec.names[n]) return child;
    }
    return null;
}
function aeTextPathWrite(group, field, operation, scope) {
    var property = aeTextPathChild(group, field);
    if (!property) throw new Error("PROPERTY_NOT_FOUND: Path Options has no " + field + " property on this After Effects build.");
    if (field === "maskIndex" && operation.maskIndex > aeSafe(function () { return scope.layer.property("ADBE Mask Parade").numProperties; },
      0)) throw new Error("INVALID_VALUE: the layer has fewer than " + operation.maskIndex + " mask(s) for the text to follow.");
    try { property.setValue(operation[field]); } catch (writeError) { throw new Error("PROPERTY_WRITE_FAILED: " + field); }
    var read = aeSafeGet(property, "value", null);
    if (read === null
      || Math.abs(Number(read) - operation[field]) > 0.001) throw new Error("PROPERTY_WRITE_FAILED: " + field + " reads back as " + String(read) + ", expected " + operation[field]);
    return read;
}
function aeApplyStepSetTextPath(run, operation, scope) {
    var group = aeApplyFindProperty(scope.layer, AE_TEXT_PATH_GROUP);
    if (!group) throw new Error("PROPERTY_NOT_FOUND: " + AE_TEXT_PATH_GROUP + " is not on this layer (set_text_path applies to text layers).");
    var written = {}, field;
    for (field in AE_TEXT_PATH_FIELDS) {
        if (!AE_TEXT_PATH_FIELDS.hasOwnProperty(field) || operation[field] === undefined) continue;
        written[field] = aeTextPathWrite(group, field, operation, scope);
    }
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, written: written,
      verification: "text-path-written" };
}
AE_APPLY_LAYER_STEPS.set_text_path = aeApplyStepSetTextPath;

AE_APPLY_VAL_RULES_COMPOSITION.open_composition = aeApplyValSpecRule([]);
function aeApplyStepOpenComposition(run, operation) {
    var comp = aeOwnValue(aeApplyCreatedComps, operation.compositionId) || aeApplyFindComp(operation.compositionId);
    if (!comp) throw new Error("TARGET_NOT_FOUND");
    try { comp.openInViewer(); } catch (viewerError) { throw new Error("VIEWER_UNAVAILABLE"); }
    var active = aeSafe(function () { return app.project.activeItem; }, null);
    if (!active || String(aeSafeGet(active, "id", "")) !== String(comp.id)) throw new Error("VIEWER_UNAVAILABLE");
    aeApplyViewerSettled();
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, name: String(aeSafeGet(comp, "name", "")),
      activeCompositionId: String(active.id), verification: "viewer-opened" };
}
AE_APPLY_PROJECT_STEPS.open_composition = aeApplyStepOpenComposition;

var AE_ANALYSIS_KINDS = {
    "warp-stabilizer": { matchNames: ["ADBE SubspaceStabilizer"], menu: "Warp Stabilizer" },
    "camera-tracker-3d": { matchNames: ["ADBE 3D Tracker", "ADBE Camera Tracker"], menu: "3D Camera Tracker" }
};
AE_APPLY_VAL_RULES_LAYER.start_analysis = aeApplyValSpecRule([["kind", "enumOf", ["warp-stabilizer", "camera-tracker-3d"]]]);
function aeAnalysisFind(parade, kind) {
    var count = aeSafeGet(parade, "numProperties", 0), names = AE_ANALYSIS_KINDS[kind].matchNames;
    for (var i = 1; i <= count; i += 1) {
        var effect = aeSafeProperty(parade, i), matchName = effect ? String(aeSafeGet(effect, "matchName", "")) : "";
        for (var n = 0; n < names.length; n += 1) if (matchName === names[n]) return effect;
    }
    return null;
}
function aeAnalysisAdd(parade, kind) {
    var names = AE_ANALYSIS_KINDS[kind].matchNames;
    for (var i = 0; i < names.length; i += 1) {
        if (!aeSafe(function () { return parade.canAddProperty(names[i]); }, false)) continue;
        var added = aeSafe(function () { return parade.addProperty(names[i]); }, null);
        if (added) return added;
    }
    return null;
}
function aeAnalysisStatus(effect) {
    var names = [], text = "", solved = false, count = aeSafeGet(effect, "numProperties", 0);
    for (var i = 1; i <= count && names.length < 60; i += 1) {
        var property = aeSafeProperty(effect, i), name = property ? String(aeSafeGet(property, "name", "")) : "",
          matchName = property ? String(aeSafeGet(property, "matchName", "")) : "";
        names.push(name);
        if (/-0011$/.test(matchName)) text = name;
        if (/Average Error: [0-9]/.test(name)) solved = true;
    }
    return { analyzing: text !== "" && !solved, statusText: text, solved: solved, propertyNames: names };
}
function aeAnalysisLayerProblem(layer, kind) {
    if (kind !== "camera-tracker-3d") return null;
    var parade = aeApplyFindProperty(layer, "ADBE Effect Parade"), masks = aeApplyFindProperty(layer, "ADBE Mask Parade");
    var effects = parade ? aeSafeGet(parade, "numProperties", 0) : 0, maskCount = masks ? aeSafeGet(masks, "numProperties", 0) : 0;
    if (effects > 0
      || maskCount > 0) return "TRACKER_IGNORES_EFFECTS: the 3D Camera Tracker analyses the layer without its masks and effects (" + effects + " effect(s), " + maskCount + " mask(s) here). Precompose the layer first (precompose_layers with moveAllAttributes true) and track the precomp layer.";
    return null;
}
function aeAnalysisStartByMenu(scope, kind) {
    var id = aeSafe(function () { return app.findMenuCommandId(AE_ANALYSIS_KINDS[kind].menu); }, 0);
    if (!id) return false;
    aeApplyIsolateLayerInViewer(scope.comp, scope.layer);
    try { app.executeCommand(id); } catch (commandError) { return false; }
    return true;
}
function aeApplyStepStartAnalysis(run, operation, scope) {
    var parade = aeApplyFindProperty(scope.layer, "ADBE Effect Parade");
    if (!parade) throw new Error("EFFECT_NOT_AVAILABLE: this layer has no effect stack.");
    var existing = aeAnalysisFind(parade, operation.kind), preexisting = !!existing, started = false, addedByMenu = false;
    if (!existing) {
        var problem = aeAnalysisLayerProblem(scope.layer, operation.kind); if (problem) throw new Error(problem);
        addedByMenu = aeAnalysisStartByMenu(scope, operation.kind);
        started = addedByMenu;
        existing = aeAnalysisFind(parade, operation.kind) || (addedByMenu ? null : aeAnalysisAdd(parade, operation.kind));
    }
    var effect = existing;
    if (!effect) throw new Error("EFFECT_NOT_AVAILABLE: " + AE_ANALYSIS_KINDS[operation.kind].menu + " could not be added to this layer; this build has no scriptable menu command or match name for it.");
    var status = aeAnalysisStatus(effect);
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      kind: operation.kind, effectAdded: !preexisting, analysisStarted: started, analyzing: status.analyzing, statusText: status.statusText,
      solved: status.solved, propertyNames: status.propertyNames, verification: preexisting ? "analysis-status-read" : "analysis-effect-added" };
}
AE_APPLY_LAYER_STEPS.start_analysis = aeApplyStepStartAnalysis;

AE_APPLY_VAL_CHECKS.resizeSolid = function (operation) {
    if (operation.width === undefined && operation.height === undefined && operation.pixelAspect === undefined) return false;
    return aeMiscOptional("integer", operation.width, 1, 30000) && aeMiscOptional("integer", operation.height, 1, 30000) && aeMiscOptional("num",
      operation.pixelAspect, 0.01, 100) && AE_APPLY_VAL_CHECKS.bool(operation.allUsers);
};
AE_APPLY_VAL_RULES_LAYER.resize_solid = aeApplyValSpecRule([[null, "resizeSolid"]]);
function aeSolidUsersIn(comp, item, own) {
    var users = [];
    for (var l = 1; l <= comp.numLayers; l += 1) {
        var layer = aeSafeLayer(comp, l);
        if (layer && aeSafe(function () { return layer.source === item; }, false) && !(comp === own.comp
          && String(layer.id) === String(own.layer.id))) users.push(String(comp.name) + " / " + String(layer.name));
    }
    return users;
}
function aeSolidUsers(item, ownComp, ownLayer) {
    var users = [], total = aeSafe(function () { return app.project.numItems; }, 0);
    for (var i = 1; i <= total && users.length < 40; i += 1) {
        var comp = aeSafe(function () { return app.project.item(i); }, null);
        if (!comp || !aeSafe(function () { return comp instanceof CompItem; }, false)) continue;
        users = users.concat(aeSolidUsersIn(comp, item, { comp: ownComp, layer: ownLayer }));
    }
    return users;
}
function aeSolidSize(item) { return { width: item.width, height: item.height, pixelAspect: item.pixelAspect }; }
function aeSolidWriteSize(item, operation) {
    try {
        if (operation.width !== undefined) item.width = operation.width;
        if (operation.height !== undefined) item.height = operation.height;
        if (operation.pixelAspect !== undefined) item.pixelAspect = operation.pixelAspect;
    } catch (resizeError) { throw new Error("PROPERTY_WRITE_FAILED: solid size or pixel aspect"); }
}
function aeSolidSizeMismatch(after, operation) { return (operation.width !== undefined && after.width !== operation.width)
  || (operation.height !== undefined && after.height !== operation.height) || (operation.pixelAspect !== undefined
  && Math.abs(after.pixelAspect - operation.pixelAspect) > 0.0001); }
function aeApplyStepResizeSolid(run, operation, scope) {
    var item = aeSafe(function () { return scope.layer.source; }, null);
    if (!item || !aeSafe(function () { return item.mainSource instanceof SolidSource; },
      false)) throw new Error("INVALID_TARGET: resize_solid applies to a solid layer.");
    var others = aeSolidUsers(item, scope.comp, scope.layer);
    if (others.length > 0
      && operation.allUsers !== true) {throw new Error("SOLID_SHARED: this solid is also used by " + others.length + " other layer(s) (" + others.slice(0,
      5).join("; ") + "), and resizing it resizes them all. Set allUsers:true to resize every user, or make a separate solid for this layer.");}
    var before = aeSolidSize(item);
    aeSolidWriteSize(item, operation);
    var after = aeSolidSize(item);
    if (aeSolidSizeMismatch(after,
      operation)) throw new Error("PROPERTY_WRITE_FAILED: the solid reads back " + after.width + "x" + after.height + " at " + after.pixelAspect + ".");
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, before: before,
      after: after, otherUsers: others.length, verification: "solid-resized" };
}
AE_APPLY_LAYER_STEPS.resize_solid = aeApplyStepResizeSolid;

AE_APPLY_VAL_CHECKS.trackerToNulls = function (operation) {
    return (operation.trackerName === undefined || AE_APPLY_VAL_CHECKS.str(operation.trackerName, 1, 128)) && (operation.point === "attach-point"
      || operation.point === "feature-center");
};
AE_APPLY_VAL_RULES_LAYER.tracker_to_nulls = aeApplyValSpecRule([[null, "trackerToNulls"]]);
function aeMiscQuote(text) { return '"' + String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r|\n/g, " ") + '"'; }
function aeTrackerPoints(tracker) {
    var points = [], count = aeSafeGet(tracker, "numProperties", 0);
    for (var i = 1; i <= count; i += 1) { var point = aeSafeProperty(tracker, i); if (point && aeSafe(function () { return point.numProperties > 0; },
      false)) points.push(point); }
    return points;
}
function aeTrackerNull(scope, tracker, point, operation) {
    var layer = scope.layer, nul = scope.comp.layers.addNull(), property = operation.point === "feature-center" ? "featureCenter" : "attachPoint";
    nul.name = String(layer.name) + " - " + String(tracker.name) + " - " + String(point.name);
    aeSafe(function () { nul.moveBefore(layer); return true; }, false);
    var position = nul.property("ADBE Transform Group").property("ADBE Position");
    position.expression = "var L = thisComp.layer(" + aeMiscQuote(layer.name) + "); L.toComp(L.motionTracker(" + aeMiscQuote(tracker.name) + ")(" + aeMiscQuote(point.name) + ")." + property + ");";
    position.expressionEnabled = true;
    var evaluated = aeSafe(function () { position.value; return String(position.expressionError); }, "unreadable");
    if (evaluated !== "") { var message = "EXPRESSION_INVALID: the follow expression for " + String(point.name) + " failed: " + evaluated;
      nul.remove(); throw new Error(message); }
    return nul;
}
function aeTrackerNullsFor(scope, tracker, operation) {
    var points = aeTrackerPoints(tracker), created = [];
    for (var p = 0; p < points.length; p += 1) { var nul = aeTrackerNull(scope, tracker, points[p], operation); created.push({ layerId: String(nul.id),
      name: String(nul.name) }); }
    return created;
}
function aeApplyStepTrackerToNulls(run, operation, scope) {
    var group = aeApplyFindProperty(scope.layer, "ADBE MTrackers");
    if (!group || aeSafeGet(group, "numProperties",
      0) < 1) throw new Error("TRACKER_DATA_MISSING: this layer has no motion tracker data. Analysis cannot be started from a script: run Track Motion in the Tracker panel, then ask again.");
    var created = [], matched = false, count = group.numProperties;
    for (var t = 1; t <= count; t += 1) {
        var tracker = group.property(t);
        if (operation.trackerName !== undefined && String(tracker.name) !== operation.trackerName) continue;
        matched = true;
        created = created.concat(aeTrackerNullsFor(scope, tracker, operation));
    }
    if (!matched) throw new Error("TARGET_NOT_FOUND: no tracker named " + String(operation.trackerName) + " on this layer.");
    if (created.length < 1) throw new Error("TRACKER_DATA_MISSING: the tracker holds no track points.");
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId, nulls: created,
      verification: "tracker-nulls-created" };
}
AE_APPLY_LAYER_STEPS.tracker_to_nulls = aeApplyStepTrackerToNulls;

AE_APPLY_VAL_RULES_PROJECT.collect_project = aeApplyValSpecRule([["exportAuthorization", "eq", "EXPORT_NOW"], ["destinationFolder", "path"],
  ["projectName", "str", 1, 128]]);
function aeCollectFootageItems() {
    var items = [], total = aeSafe(function () { return app.project.numItems; }, 0);
    for (var i = 1; i <= total; i += 1) {
        var item = aeSafe(function () { return app.project.item(i); }, null);
        if (item && aeSafe(function () { return item instanceof FootageItem && item.mainSource instanceof FileSource; }, false)) items.push(item);
    }
    return items;
}
function aeCollectUniqueName(folder, name, taken) {
    var dot = name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "", candidate = name, n = 1;
    while (taken[candidate.toLowerCase()] || new File(folder.fsName + "/" + candidate).exists) { n += 1; candidate = stem + "_" + n + ext; }
    taken[candidate.toLowerCase()] = true;
    return candidate;
}
function aeCollectPlan(footageDir, report) {
    var items = aeCollectFootageItems(), bySource = {}, taken = {}, jobs = [];
    for (var i = 0; i < items.length; i += 1) {
        var item = items[i], file = item.mainSource.file;
        if (!file || !file.exists || aeSafe(function () { return item.footageMissing === true; }, false)) { report.skipped.push({
          name: String(item.name), reason: "file missing" }); continue; }
        if (/\[[0-9]+-[0-9]+\]/.test(String(item.name))) { report.skipped.push({ name: String(item.name),
          reason: "image sequence (only the first frame would be copied)" }); continue; }
        var key = String(file.fsName);
        if (!bySource[key]) { bySource[key] = { source: file, target: new File(footageDir.fsName + "/" + aeCollectUniqueName(footageDir,
          String(file.name), taken)), items: [] }; jobs.push(bySource[key]); }
        bySource[key].items.push(item);
    }
    return jobs;
}
function aeCollectCopy(jobs, report) {
    for (var j = 0; j < jobs.length; j += 1) {
        var job = jobs[j];
        var copied = job.source.copy(job.target.fsName), check = new File(job.target.fsName);
        if (!copied || !check.exists
          || check.length !== job.source.length) throw new Error("COLLECT_FAILED: copying " + String(job.source.name) + " did not produce an identical file; the project was not changed.");
        report.bytes += job.source.length; report.files += 1; report.written.push({ path: job.target.fsName, operation: "collect_project" });
    }
}
function aeCollectRelink(jobs) {
    for (var j = 0; j < jobs.length; j += 1) {
        for (var i = 0; i < jobs[j].items.length; i += 1) {
            try { jobs[j].items[i].replace(jobs[j].target); } catch (replaceError) {
              throw new Error("COLLECT_FAILED: relinking " + String(jobs[j].items[i].name) + " failed after the files were copied; the copies are in the collect folder.");
              }
            if (String(jobs[j].items[i].mainSource.file.fsName) !== String(jobs[j].target.fsName)) throw new Error("COLLECT_FAILED: " + String(jobs[j].items[i].name) + " still points at " + String(jobs[j].items[i].mainSource.file.fsName));
        }
    }
}
function aeApplyStepCollectProject(run, operation) {
    var dest = new Folder(operation.destinationFolder), report = { files: 0, bytes: 0, skipped: [], written: run.externalOutputs };
    if (!dest.exists && !dest.create()) throw new Error("COLLECT_FAILED: the destination folder could not be created.");
    var projectFile = new File(dest.fsName + "/" + operation.projectName + ".aep");
    if (projectFile.exists) throw new Error("COLLECT_FAILED: " + projectFile.fsName + " already exists; choose another projectName or folder.");
    var footageDir = new Folder(dest.fsName + "/(Footage)");
    if (!footageDir.exists && !footageDir.create()) throw new Error("COLLECT_FAILED: the (Footage) folder could not be created.");
    var jobs = aeCollectPlan(footageDir, report);
    aeCollectCopy(jobs, report);
    aeCollectRelink(jobs);
    try { app.project.save(projectFile); } catch (saveError) { throw new Error("PROJECT_SAVE_FAILED: " + aeErrorText(saveError)); }
    report.written.push({ path: projectFile.fsName, operation: operation.operation });
    var saved = aeSafe(function () { return new File(app.project.file.fsName).length; }, 0);
    if (!(saved > 0)) throw new Error("PROJECT_SAVE_FAILED: the collected project file is empty or missing.");
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", file: String(projectFile.fsName), bytes: saved, copiedFiles: report.files,
      copiedBytes: report.bytes, skipped: report.skipped,
      notCarried: "image sequences, proxies, fonts, plug-ins, and the layer choice of layered Photoshop or Illustrator imports",
      verification: "project-file-saved" };
}
AE_APPLY_PROJECT_STEPS.collect_project = aeApplyStepCollectProject;

AE_APPLY_VAL_RULES_PROJECT.switch_project = function (operation) {
    if (operation.mode !== "new" && operation.mode !== "open") return "INVALID_VALUE";
    if (typeof operation.discardUnsaved !== "boolean") return "INVALID_VALUE";
    if (operation.mode === "open") return (aeApplyIsAbsolutePath(operation.path) && /\.aepx?$/i.test(operation.path)) ? null : "INVALID_VALUE";
    return operation.path === undefined ? null : "INVALID_VALUE";
};
function aeSwitchGuardUnsaved(operation) {
    var dirty = aeSafe(function () { return app.project.dirty; }, true), untouched = aeSafe(function () { return app.project.numItems === 0
      && !app.project.file; }, false);
    if (dirty && !untouched
      && operation.discardUnsaved !== true) {throw new Error("PROJECT_UNSAVED_CHANGES: the open project has unsaved changes" + (aeSafe(function () {
      return app.project.file; },
      null) ? "" : " and has never been saved") + ". Save it first (save_project earlier in the plan), or set discardUnsaved:true after the user agreed to lose them.");}
}
function aeSwitchTarget(operation) {
    var target = operation.mode === "open" ? new File(operation.path) : null;
    if (target && !target.exists) throw new Error("PROJECT_OPEN_FAILED: " + operation.path + " does not exist.");
    return target;
}
function aeSwitchVerify(target, now, operation) {
    if (target && String(now).replace(/\\/g, "/") !== String(target.fsName).replace(/\\/g,
      "/")) throw new Error("PROJECT_OPEN_FAILED: After Effects reports " + String(now) + " after opening " + operation.path + ".");
    if (!target && now !== null) throw new Error("PROJECT_OPEN_FAILED: the new project is not untitled.");
}
function aeApplyStepSwitchProject(run, operation) {
    aeSwitchGuardUnsaved(operation);
    var target = aeSwitchTarget(operation);
    var previous = aeSafe(function () { return app.project.file ? String(app.project.file.fsName) : null; }, null);
    aeApplyForgetRun();
    try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (closeError) {
      throw new Error("PROJECT_OPEN_FAILED: After Effects would not close the open project: " + aeErrorText(closeError)); }
    try { if (target) app.open(target); else app.newProject(); } catch (openError) {
      throw new Error("PROJECT_OPEN_FAILED: the previous project is closed and the new one did not open: " + aeErrorText(openError)); }
    var now = aeSafe(function () { return app.project.file ? String(app.project.file.fsName) : null; }, null);
    aeSwitchVerify(target, now, operation);
    return { operation: operation.operation, status: "applied", mode: operation.mode, previousFile: previous, file: now, items: aeSafe(function () {
      return app.project.numItems; }, null), verification: operation.mode === "open" ? "project-opened" : "project-created" };
}
AE_APPLY_PROJECT_STEPS.switch_project = aeApplyStepSwitchProject;

AE_APPLY_VAL_CHECKS.savePresetFields = function (operation) {
    if (!aeApplyIsAbsolutePath(operation.outputPath) || !/\.ffx$/i.test(operation.outputPath) || typeof operation.overwrite !== "boolean") return false;
    return operation.effectPaths === undefined || AE_APPLY_VAL_CHECKS.copyEffectPaths(operation.effectPaths);
};
AE_APPLY_VAL_RULES_LAYER.save_layer_preset = aeApplyValSpecRule([["exportAuthorization", "eq", "EXPORT_NOW"], [null, "savePresetFields"]]);
function aePresetClearSelection(comp) {
    var selected = aeSafeGet(comp, "selectedProperties", []);
    for (var i = 0; i < selected.length; i += 1) {aeSafe((function (property) { return function () {
      property.selected = false; return true; }; })(selected[i]), false);}
}
function aePresetSelectEffects(layer, paths) {
    var parade = aeApplyFindProperty(layer, "ADBE Effect Parade"), chosen = [], i;
    if (!parade || aeSafeGet(parade, "numProperties", 0) < 1) throw new Error("EFFECT_NOT_FOUND: the layer has no effects to save.");
    if (paths === undefined) { for (i = 1; i <= parade.numProperties; i += 1) chosen.push(parade.property(i)); }
    else {for (i = 0; i < paths.length; i += 1) { var found = aeApplyFindProperty(layer, paths[i]);
      if (!found) throw new Error("EFFECT_NOT_FOUND: " + paths[i] + " is not on this layer."); chosen.push(found); }}
    for (i = 0; i < chosen.length; i += 1) chosen[i].selected = true;
    return chosen.length;
}
function aePresetOpenFile(operation) {
    var file = new File(operation.outputPath), parent = file.parent;
    if (!parent || parent.exists === false) throw new Error("PRESET_SAVE_FAILED: destination directory does not exist.");
    if (file.exists
      && operation.overwrite !== true) throw new Error("PRESET_SAVE_FAILED: " + operation.outputPath + " already exists; set overwrite to replace it.");
    if (file.exists && !file.remove()) throw new Error("PRESET_SAVE_FAILED: the existing file could not be replaced.");
    return file;
}
function aeApplyStepSaveLayerPreset(run, operation, scope) {
    if (typeof scope.layer.savePreset !== "function") throw new Error("PRESET_SAVE_UNSUPPORTED: this After Effects version has no Layer.savePreset.");
    var file = aePresetOpenFile(operation);
    aePresetClearSelection(scope.comp);
    scope.layer.selected = true;
    var count = aePresetSelectEffects(scope.layer, operation.effectPaths), saved;
    try { saved = scope.layer.savePreset(file); } catch (saveError) { throw new Error("PRESET_SAVE_FAILED: " + aeErrorText(saveError)); }
    var bytes = aeSafe(function () { return new File(operation.outputPath).length; }, 0);
    if (saved === false || !(bytes > 0)) throw new Error("PRESET_SAVE_FAILED: After Effects wrote no preset file.");
    run.touched.push(operation.operation); run.externalOutputs.push({ path: operation.outputPath, operation: operation.operation });
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, layerId: operation.layerId,
      file: operation.outputPath, bytes: bytes, effects: count, verification: "preset-file-saved" };
}
AE_APPLY_LAYER_STEPS.save_layer_preset = aeApplyStepSaveLayerPreset;
