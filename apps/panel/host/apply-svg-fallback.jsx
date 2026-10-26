/* Apply: extynt's own SVG conversion, used when After Effects' native SVG importer refuses the managed file or the
 * sidecar routes around it.
 */
/* global aeApplyCountVectorShapeLayers, aeApplyDrawVectorShapes, aeApplyFindProperty, aeApplyImportVectorComp, aeIsArray, aeApplyIsRecordValue,
   aeApplySvgDiscardAdded, aeApplyVectorArtworkTiming, aeApplyVectorShapesValid, aeErrorText, aeHasOwn, aeSafe, aeSafeGet */
/* exported aeSvgDescribeImport, aeSvgFallbackLayersValid, aeSvgFallbackNotesValid, aeSvgImportVectorArtwork */
var AE_SVG_FALLBACK_CODES = { SVG_IMPORT_UNSUPPORTED: true, SVG_IMPORT_FAILED: true, SVG_NATIVE_SHAPES_NOT_CREATED: true };
var AE_SVG_IMPORT_TYPES = ["COMP_CROPPED_LAYERS", "COMP", "FOOTAGE"];
function aeSvgLayerValid(layer) {
    return aeApplyIsRecordValue(layer) && typeof layer.name === "string" && layer.name.length >= 1 && layer.name.length <= 256
      && aeApplyVectorShapesValid(layer.shapes);
}
function aeSvgLayerPoints(layer) {
    var points = 0;
    for (var s = 0; s < layer.shapes.length; s += 1) {
        for (var p = 0; p < layer.shapes[s].paths.length; p += 1) points += layer.shapes[s].paths[p].vertices.length;
    }
    return points;
}
/**
 * True when the fallback has 1 to 256 valid layers within the shape and point limits. The layers the sidecar derived
 * are validated again here, so the host never draws unvalidated shapes.
 */
function aeSvgFallbackLayersValid(layers) {
    if (!aeIsArray(layers) || layers.length < 1 || layers.length > 256) return false;
    var shapes = 0, points = 0;
    for (var i = 0; i < layers.length; i += 1) {
        if (!aeSvgLayerValid(layers[i])) return false;
        shapes += layers[i].shapes.length; points += aeSvgLayerPoints(layers[i]);
    }
    return shapes <= 256 && points <= 12000;
}
function aeSvgNameListValid(list) {
    if (!aeIsArray(list) || list.length > 64) return false;
    for (var i = 0; i < list.length; i += 1) if (typeof list[i] !== "string" || list[i].length < 1 || list[i].length > 120) return false;
    return true;
}
/** True when the notes are an object whose approximated and skipped lists are valid name lists. */
function aeSvgFallbackNotesValid(notes) { return aeApplyIsRecordValue(notes) && aeSvgNameListValid(notes.approximated) && aeSvgNameListValid(notes.skipped); }
function aeSvgCanImport(options, typeName) {
    if (typeof ImportAsType === "undefined" || ImportAsType[typeName] === undefined) return "no-enum";
    try { return options.canImportAs(ImportAsType[typeName]) === true ? "true" : "false"; } catch (canError) { return "threw: " + aeErrorText(canError); }
}
function aeSvgNativeEvidence(file) {
    var evidence = { importOptions: typeof ImportOptions, importAsType: typeof ImportAsType, canImportAs: {} };
    var options = null;
    try { options = new ImportOptions(file); } catch (optionsError) { evidence.constructed = "threw: " + aeErrorText(optionsError); return evidence; }
    for (var i = 0; i < AE_SVG_IMPORT_TYPES.length; i += 1) evidence.canImportAs[AE_SVG_IMPORT_TYPES[i]] = aeSvgCanImport(options, AE_SVG_IMPORT_TYPES[i]);
    return evidence;
}
function aeSvgNativeAttempt(file) {
    try { return { item: aeApplyImportVectorComp(file) }; } catch (nativeError) { return { error: nativeError, evidence: (nativeError
      && nativeError.evidence) ? nativeError.evidence : aeSvgNativeEvidence(file) }; }
}
function aeSvgFailureCode(error) {
    var match = /^[A-Z][A-Z0-9_]{2,63}/.exec(String((error && error.message) ? error.message : error));
    return match ? match[0] : "SVG_IMPORT_FAILED";
}
function aeSvgNativeFailure(attempt) { return { code: aeSvgFailureCode(attempt.error), evidence: attempt.evidence }; }
function aeSvgDropItem(item) { try { item.remove(); } catch (ignoredRemove) {} }
function aeSvgDropImport(item) { aeApplySvgDiscardAdded(); aeSvgDropItem(item); }
function aeSvgPlaceAtOrigin(layer) {
    var paths = ["ADBE Transform Group/ADBE Anchor Point", "ADBE Transform Group/ADBE Position"];
    for (var i = 0; i < paths.length; i += 1) {
        var property = aeApplyFindProperty(layer, paths[i]);
        if (property) try { property.setValue([0, 0]); } catch (originError) { throw new Error("PROPERTY_WRITE_FAILED"); }
    }
}
function aeSvgDrawLayers(comp, layers) {
    for (var i = 0; i < layers.length; i += 1) {
        var layer = comp.layers.addShape();
        try { layer.name = layers[i].name; } catch (nameError) { throw new Error("PROPERTY_WRITE_FAILED"); }
        aeSvgPlaceAtOrigin(layer);
        aeApplyDrawVectorShapes(layer, { shapes: layers[i].shapes });
    }
}
function aeSvgBuildConvertedComp(operation) {
    var timing = aeApplyVectorArtworkTiming(operation), size = operation.fallbackSize;
    var comp = aeSafe(function () { return app.project.items.addComp(operation.name, size[0], size[1], 1, timing.durationSeconds, timing.frameRate); }, null);
    if (!comp) throw new Error("CREATE_COMPOSITION_UNSUPPORTED");
    try { aeSvgDrawLayers(comp, operation.fallbackLayers); } catch (drawError) { aeSvgDropItem(comp); throw drawError; }
    return comp;
}
function aeSvgNativeResult(attempt, operation, file) {
    var layerCount = aeSafe(function () { return attempt.item.numLayers; }, 0);
    if (aeApplyCountVectorShapeLayers(attempt.item, layerCount) > 0 || !aeHasOwn(operation, "fallbackLayers")) {return { item: attempt.item,
      importer: "native" };}
    aeSvgDropImport(attempt.item);
    return { error: new Error("SVG_NATIVE_SHAPES_NOT_CREATED"), evidence: aeSvgNativeEvidence(file) };
}
function aeSvgRouteVersioned(operation) { return aeHasOwn(operation, "importerAeVersion"); }
function aeSvgRouteWhy(operation) {
  return aeSvgRouteVersioned(operation) ? "After Effects " + operation.importerAeVersion + " has no SVG importer" : "forced by the development switch"; }
function aeSvgImportByRoute(operation) {
    if (!aeHasOwn(operation, "fallbackLayers")) {
        var reason = aeHasOwn(operation, "fallbackUnavailable") ? operation.fallbackUnavailable : "no converted layers";
        throw new Error("SVG_IMPORT_UNSUPPORTED: " + (aeSvgRouteVersioned(operation) ? aeSvgRouteWhy(operation) : "extynt's converter is " + aeSvgRouteWhy(operation)) + " and this SVG exceeds extynt's converter limits: " + reason);
    }
    return { item: aeSvgBuildConvertedComp(operation), importer: "converted", routeNote: "Built with extynt's converter (" + aeSvgRouteWhy(operation) + ")" };
}
/**
 * Native first: it handles more SVG than the converter. Only a native refusal falls back, and only when the operation
 * carries converted layers. Makes one shape layer per top-level SVG element, in document order with the last on top,
 * in a composition of the SVG's size; with importer "converter" the native importer is never asked.
 */
function aeSvgImportVectorArtwork(operation, file) {
    if (operation.importer === "converter") return aeSvgImportByRoute(operation);
    var attempt = aeSvgNativeAttempt(file);
    if (attempt.item) { var nativeResult = aeSvgNativeResult(attempt, operation, file); if (nativeResult.item) return nativeResult; attempt = nativeResult; }
    var failure = aeSvgNativeFailure(attempt);
    if (!aeHasOwn(operation, "fallbackLayers") || !aeHasOwn(AE_SVG_FALLBACK_CODES, failure.code)) throw attempt.error;
    return { item: aeSvgBuildConvertedComp(operation), importer: "converted", nativeFailure: failure };
}
// The step fields every receipt reads; a converted import also carries the plain-words note, the native failure and what the converter left out.
function aeSvgDescribeImport(step, vectorResult, operation) {
    var item = vectorResult.item;
    step.importer = vectorResult.importer;
    step.width = aeSafeGet(item, "width", null);
    step.height = aeSafeGet(item, "height", null);
    if (vectorResult.importer !== "converted") return step;
    step.verification = "managed-svg-written-and-converted-shape-layers-built";
    if (vectorResult.routeNote) step.importNote = vectorResult.routeNote;
    else { step.nativeFailure = vectorResult.nativeFailure;
      step.importNote = "Imported with extynt's converter (AE's SVG importer refused: " + vectorResult.nativeFailure.code + ")"; }
    step.converterNotes = operation.fallbackNotes;
    return step;
}
