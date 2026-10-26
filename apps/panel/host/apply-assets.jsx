/* Apply: managed SVG import, vector artwork and footage operations. It sits under apply-flow.jsx, which dispatches the
 * asset operations here.
 */
/* global AE_VECTOR_ARTWORK_DEFAULT_DURATION_SECONDS, AE_VECTOR_ARTWORK_DEFAULT_FRAME_RATE, aeApplyAssertFolder, aeHasOwn, aeSafe, aeSafeGet,
   aeSvgImportVectorArtwork, aeTruncatedErrorText */
/* exported aeApplyClearFootageProxy, aeApplyCreateVectorArtwork, aeApplyImportVectorComp, aeApplyReplaceFootage, aeApplySetFootageProxy,
   aeApplySvgDiscardAdded */
var AE_SVG_REJECT_PATTERNS = [
    /<!DOCTYPE|<!ENTITY/i,
    /<\s*(script|foreignObject|iframe|object|embed|image|audio|video|canvas|style|use)\b/i,
    /\son[a-z]+\s*=/i,
    /\s(?:style|xml:base)\s*=/i,
    /(?:href|xlink:href|src)\s*=\s*["'](?!\s*#)/i,
    /url\(\s*["']?\s*(?!#)/i,
    /(?:NaN|[+-]?Infinity)/i
];
function aeApplySvgWithinBounds(svg) {
    var tags = svg.match(/<[^>]+>/g) || [], stops = svg.match(/<\s*stop\b/gi) || [], commands = svg.match(/[AaCcHhLlMmQqSsTtVvZz]/g) || [];
    return tags.length <= 4096 && stops.length <= 256 && commands.length <= 50000 && /^\s*(?:<\?xml\s[^?]*\?>\s*)?<svg\b/i.test(svg);
}
function aeApplyManagedSvgHostSafe(svg) {
    if (typeof svg !== "string" || svg.length < 1 || svg.length > 262144) return false;
    for (var p = 0; p < AE_SVG_REJECT_PATTERNS.length; p += 1) if (AE_SVG_REJECT_PATTERNS[p].test(svg)) return false;
    return aeApplySvgWithinBounds(svg);
}
function aeApplyReadUtf8File(file) {
    if (!file || !file.exists) return null;
    file.encoding = "UTF-8";
    if (!file.open("r")) return null;
    var value = null; try { value = file.read(); } finally { try { file.close(); } catch (ignoredClose) {} }
    return value;
}
function aeApplyManagedSvgRoot() {
    var root = new Folder(Folder.userData.fsName + "/extynt/Managed SVG");
    if (aeSafe(function () { return root.alias === true; }, false)) throw new Error("MANAGED_SVG_PATH_UNSAFE");
    if (!root.exists && !root.create()) throw new Error("MANAGED_SVG_WRITE_FAILED");
    return root;
}
function aeApplyManagedSvgBase(operation, planId) {
    var safePlan = String(planId || "plan").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64);
    return "svg-" + operation.sourceHash.slice(0, 32) + "-" + safePlan;
}
function aeApplyDropTemporaryFile(temporary) { try { if (temporary.exists) temporary.remove(); } catch (ignoredRemove) {} }
function aeApplyWriteTemporarySvg(root, base, svg) {
    var temporary = new File(root.fsName + "/." + base + ".part-" + String(new Date().getTime()));
    if (temporary.exists || aeSafe(function () { return temporary.alias === true; }, false)) throw new Error("MANAGED_SVG_PATH_UNSAFE");
    temporary.encoding = "UTF-8"; temporary.lineFeed = "Unix";
    if (!temporary.open("w")) throw new Error("MANAGED_SVG_WRITE_FAILED");
    var wrote = false; try { wrote = temporary.write(svg) !== false; } finally { try { temporary.close(); } catch (ignoredClose) {} }
    if (!wrote || !temporary.exists || aeSafeGet(temporary, "length", 0) <= 0) { aeApplyDropTemporaryFile(temporary);
      throw new Error("MANAGED_SVG_WRITE_FAILED"); }
    return temporary;
}
function aeApplyManagedSvgFile(operation, planId) {
    var root = aeApplyManagedSvgRoot(), base = aeApplyManagedSvgBase(operation, planId);
    var output = new File(root.fsName + "/" + base + ".svg");
    if (aeSafe(function () { return output.alias === true; }, false)) throw new Error("MANAGED_SVG_PATH_UNSAFE");
    if (output.exists) { if (aeApplyReadUtf8File(output) !== operation.svg) throw new Error("MANAGED_SVG_COLLISION"); return { file: output, reused: true }; }
    var temporary = aeApplyWriteTemporarySvg(root, base, operation.svg);
    if (!temporary.rename(output.name)) { aeApplyDropTemporaryFile(temporary); throw new Error("MANAGED_SVG_WRITE_FAILED"); }
    output = new File(root.fsName + "/" + base + ".svg");
    if (!output.exists) throw new Error("MANAGED_SVG_WRITE_FAILED");
    return { file: output, reused: false };
}
function aeApplySvgText(error) { return aeTruncatedErrorText(error, 120); }
function aeApplySvgError(code, evidence) {
    var error = new Error(code + ": " + JSON.stringify(evidence).slice(0, 700));
    error.evidence = evidence;
    return error;
}
function aeApplySvgEvidence(file) {
    var name = String(aeSafeGet(file, "name", "")), dot = name.lastIndexOf(".");
    return { importOptions: typeof ImportOptions, importAsType: typeof ImportAsType, extension: dot >= 0 ? name.slice(dot) : "",
      length: aeSafeGet(file, "length", null), canImportAs: {} };
}
function aeApplySvgAnswer(options, member) {
    var type = ImportAsType[member];
    if (type === undefined || type === null) return "missing";
    try { return String(options.canImportAs(type)); } catch (probeError) { return "threw: " + aeApplySvgText(probeError); }
}
function aeApplyChooseSvgType(options, evidence) {
    var members = ["COMP_CROPPED_LAYERS", "COMP"];
    for (var i = 0; i < members.length; i += 1) {
        evidence.canImportAs[members[i]] = aeApplySvgAnswer(options, members[i]);
        if (evidence.canImportAs[members[i]] === "true") return ImportAsType[members[i]];
    }
    return null;
}
function aeApplySvgItemAt(index) { return aeSafe(function () { return app.project.item(index); }, null); }
function aeApplySvgItemIds() {
    var ids = {}, count = aeSafe(function () { return app.project.numItems; }, 0);
    for (var i = 1; i <= count; i += 1) {
        var item = aeApplySvgItemAt(i), id = item ? aeSafe((function (candidate) { return function () { return candidate.id; }; })(item), null) : null;
        if (id !== null && id !== undefined) ids[String(id)] = true;
        else ids.unreadable = true;
    }
    return ids;
}
function aeApplySvgAddedItems(before) {
    var added = [], count = aeSafe(function () { return app.project.numItems; }, 0);
    for (var i = 1; i <= count; i += 1) {
        var item = aeApplySvgItemAt(i), id = item ? aeSafe((function (candidate) { return function () { return candidate.id; }; })(item), null) : null;
        if (id !== null && id !== undefined && !aeHasOwn(before, String(id))) added.push(item);
    }
    return added;
}
function aeApplySvgRemoveAdded(added) {
    var removed = 0;
    for (var i = added.length - 1; i >= 0; i -= 1) {
        if (aeSafe(function () { added[i].remove(); return true; }, false)) removed += 1;
    }
    return removed;
}
function aeApplySvgIsComp(item) { return !!item && typeof CompItem !== "undefined" && item instanceof CompItem; }
function aeApplySvgDiscardNote(added) {
    var plural = added.length === 1 ? "" : "s", kind = (added.length === 1 && aeApplySvgIsComp(added[0])) ? " (a composition)" : "";
    return "; AE added " + added.length + " item" + plural + kind + ", removed " + aeApplySvgRemoveAdded(added);
}
function aeApplySvgResolveImport(before, evidence, returned, mayAdopt) {
    if (aeHasOwn(before, "unreadable")) { evidence.importFile = returned + "; project left as it is (an item id was unreadable)"; return null; }
    var added = aeApplySvgAddedItems(before);
    if (mayAdopt && added.length === 1 && aeApplySvgIsComp(added[0])) {
        evidence.importFile = returned + "; adopted the one new composition AE added";
        return added[0];
    }
    evidence.importFile = added.length > 0 ? returned + aeApplySvgDiscardNote(added) : returned;
    return null;
}
var aeApplySvgImportAdded = [];
/**
 * Removes the items the last SVG import added and forgets them. Returns nothing. Finds what an import added by
 * comparing project item ids before and after, since importFile can return null with the composition added; a list
 * holding an unreadable id is never used to remove or adopt anything, and a failed import leaks no item.
 */
function aeApplySvgDiscardAdded() { aeApplySvgRemoveAdded(aeApplySvgImportAdded); aeApplySvgImportAdded = []; }
function aeApplySvgSiblings(before, imported) {
    if (aeHasOwn(before, "unreadable")) return [];
    var added = aeApplySvgAddedItems(before), siblings = [], importedId = String(aeSafeGet(imported, "id", ""));
    for (var i = 0; i < added.length; i += 1) if (String(aeSafe(function () { return added[i].id; }, "")) !== importedId) siblings.push(added[i]);
    return siblings;
}
function aeApplySvgImportFile(options, evidence) {
    var before = aeApplySvgItemIds(), imported = null;
    aeApplySvgImportAdded = [];
    try { imported = app.project.importFile(options); } catch (importError) { return aeApplySvgResolveImport(before, evidence,
      "threw: " + aeApplySvgText(importError), false); }
    if (imported && (typeof CompItem === "undefined" || imported instanceof CompItem)) { aeApplySvgImportAdded = aeApplySvgSiblings(before, imported);
      return imported; }
    return aeApplySvgResolveImport(before, evidence, imported ? "returned an item that is not a composition" : "returned " + String(imported), true);
}
/**
 * Imports an SVG file as a composition item. Returns the imported item; throws SVG_IMPORT_UNSUPPORTED or
 * SVG_IMPORT_FAILED. Imports as the first of COMP_CROPPED_LAYERS or COMP that canImportAs accepts, never FOOTAGE,
 * which would give a flat image instead of shape layers.
 */
function aeApplyImportVectorComp(file, evidence) {
    evidence = evidence || aeApplySvgEvidence(file);
    var options = null;
    if (typeof ImportOptions === "undefined" || typeof ImportAsType === "undefined") throw aeApplySvgError("SVG_IMPORT_UNSUPPORTED", evidence);
    try { options = new ImportOptions(file); } catch (optionsError) { evidence.importOptionsError = aeApplySvgText(optionsError);
      throw aeApplySvgError("SVG_IMPORT_UNSUPPORTED", evidence); }
    var chosen = aeApplyChooseSvgType(options, evidence);
    if (chosen === null) throw aeApplySvgError("SVG_IMPORT_UNSUPPORTED", evidence);
    options.importAs = chosen;
    var imported = aeApplySvgImportFile(options, evidence);
    if (!imported) throw aeApplySvgError("SVG_IMPORT_FAILED", evidence);
    return imported;
}
/** Imports vector artwork as a composition. Returns {item,shapeLayers,layerCount,durationSeconds,frameRate,source,importer,nativeFailure,...}; throws an
 * SVG error. */
function aeApplyCreateVectorArtwork(operation, createdFolders, planId, sourceEvidence) {
    if (!aeApplyManagedSvgHostSafe(operation.svg)) throw new Error("SVG_UNSAFE");
    var managed = aeApplyManagedSvgFile(operation, planId), file = managed.file;
    sourceEvidence.push({ sourceHash: operation.sourceHash, bytes: aeSafeGet(file, "length", null), policy: "retain", reused: managed.reused,
      persistsAfterUndo: true });
    var attempt = aeSvgImportVectorArtwork(operation, file), imported = attempt.item;
    var timing = aeApplyVectorArtworkTiming(operation), layerCount = aeApplyExtendVectorArtworkComposition(imported, timing.durationSeconds,
      timing.frameRate), shapeLayers = aeApplyCountVectorShapeLayers(imported, layerCount);
    if (shapeLayers < 1) throw new Error("SVG_NATIVE_SHAPES_NOT_CREATED");
    var destination = aeApplyAssertFolder(operation.destinationFolderId, createdFolders);
    try { imported.name = operation.name; imported.parentFolder = destination; } catch (svgItemError) { throw new Error("PROPERTY_WRITE_FAILED"); }
    return { item: imported, shapeLayers: shapeLayers, layerCount: layerCount, durationSeconds: timing.durationSeconds, frameRate: timing.frameRate,
      source: sourceEvidence[sourceEvidence.length - 1], importer: attempt.importer, nativeFailure: attempt.nativeFailure, routeNote: attempt.routeNote };
}
function aeApplyVectorArtworkTiming(operation) { return {
  durationSeconds: typeof operation.durationSeconds === "number" ? operation.durationSeconds : AE_VECTOR_ARTWORK_DEFAULT_DURATION_SECONDS,
  frameRate: typeof operation.frameRate === "number" ? operation.frameRate : AE_VECTOR_ARTWORK_DEFAULT_FRAME_RATE }; }
function aeApplyExtendVectorArtworkComposition(comp, durationSeconds, frameRate) {
    try { comp.duration = durationSeconds; comp.frameRate = frameRate; } catch (compositionTimingError) { throw new Error("PROPERTY_WRITE_FAILED"); }
    var layerCount = aeSafeGet(comp, "numLayers", 0);
    for (var layerIndex = 1; layerIndex <= layerCount; layerIndex += 1) {
        var layer = aeSafe((function (index) { return function () { return comp.layer(index); }; })(layerIndex), null);
        if (!layer) throw new Error("PROPERTY_WRITE_FAILED");
        try { layer.inPoint = 0; layer.outPoint = durationSeconds; } catch (layerTimingError) { throw new Error("PROPERTY_WRITE_FAILED"); }
    }
    return layerCount;
}
function aeApplyCountVectorShapeLayers(comp, layerCount) {
    var shapeLayers = 0;
    for (var layerIndex = 1; layerIndex <= layerCount; layerIndex += 1) {
        var layer = aeSafe((function (index) { return function () { return comp.layer(index); }; })(layerIndex), null);
        if (layer && aeSafe((function (candidate) { return function () { return !!candidate.property("ADBE Root Vectors Group"); }; })(layer),
          false)) shapeLayers += 1;
    }
    return shapeLayers;
}
function aeApplyRequireFootage(item) { if (!item || (typeof FootageItem !== "undefined"
  && !(item instanceof FootageItem))) throw new Error("FOOTAGE_TARGET_REQUIRED"); return item; }
function aeApplyFootageFile(path) { var file = new File(path); if (!aeSafe(function () { return file.exists === true; },
  false)) throw new Error("FOOTAGE_FILE_NOT_FOUND"); return file; }
/** Replaces a footage item's file. Returns nothing; throws Error(FOOTAGE_UNSUPPORTED or FOOTAGE_REPLACE_FAILED). */
function aeApplyReplaceFootage(item, path) { item = aeApplyRequireFootage(item);
  if (typeof item.replace !== "function") throw new Error("FOOTAGE_UNSUPPORTED"); try { item.replace(aeApplyFootageFile(path));
  } catch (replaceError) { throw new Error("FOOTAGE_REPLACE_FAILED"); } }
/** Sets a footage item's proxy file. Returns nothing; throws Error(FOOTAGE_UNSUPPORTED or FOOTAGE_PROXY_FAILED). */
function aeApplySetFootageProxy(item, path) { item = aeApplyRequireFootage(item);
  if (typeof item.setProxy !== "function") throw new Error("FOOTAGE_UNSUPPORTED"); try { item.setProxy(aeApplyFootageFile(path));
  } catch (proxyError) { throw new Error("FOOTAGE_PROXY_FAILED"); } }
/** Removes the proxy from a footage item. Returns nothing; throws Error(FOOTAGE_UNSUPPORTED or FOOTAGE_PROXY_FAILED). */
function aeApplyClearFootageProxy(item) { item = aeApplyRequireFootage(item);
  if (typeof item.setProxyToNone !== "function") throw new Error("FOOTAGE_UNSUPPORTED"); try { item.setProxyToNone(); } catch (clearError) {
  throw new Error("FOOTAGE_PROXY_FAILED"); } }
