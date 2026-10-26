// svg-import-probe.jsx
//
// TEST-ONLY, standalone. Run it with File > Scripts > Run Script File in After Effects; it needs no extynt panel or library.
//
// It writes four tiny SVG variants (xmlns + viewBox + size, no xmlns, viewBox only, XML header) to a temp folder and records
// what After Effects' native SVG importer says about each one: typeof ImportOptions / ImportAsType, canImportAs for
// COMP_CROPPED_LAYERS, COMP and FOOTAGE (true, false or "threw: message"), then the result of importFile as
// COMP_CROPPED_LAYERS and as COMP (what it created: item type, layer count, shape layer count, size; how long it took).
// Everything the import added to the project is removed again. The result is JSON in a file next to the temp folder; the
// script alerts its path and echoes it to the ExtendScript console.
//
// Plain ExtendScript (ES3): no let/const/arrow functions, no Array.prototype.indexOf/forEach/map/filter, no JSON object.

var SUPPRESS_DIALOGS = true;
var IMPORT_TYPES = ["COMP_CROPPED_LAYERS", "COMP", "FOOTAGE"];
var IMPORT_ATTEMPTS = ["COMP_CROPPED_LAYERS", "COMP"];
var PROBE_LAYER_LIST_LIMIT = 30;

var PROBE_BODY = '<path d="M8 8 L56 8 L32 56 Z" fill="#e05020"/><circle cx="48" cy="48" r="8" fill="#2060e0"/>';
var PROBE_VARIANTS = [
    { id: "xmlns-viewbox-size", text: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' + PROBE_BODY + "</svg>" },
    { id: "no-xmlns", text: '<svg width="64" height="64" viewBox="0 0 64 64">' + PROBE_BODY + "</svg>" },
    { id: "viewbox-only", text: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' + PROBE_BODY + "</svg>" },
    { id: "xml-header",
      text: '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' + PROBE_BODY + "</svg>" }
];

function probeMessage(error) { return String((error && error.message) ? error.message : error); }

function probeQuote(text) { return '"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g,
  "\\t") + '"'; }

function probeJsonList(list) {
    var parts = [], index;
    for (index = 0; index < list.length; index += 1) parts.push(probeJson(list[index]));
    return "[" + parts.join(",") + "]";
}

function probeJsonObject(object) {
    var parts = [], key;
    for (key in object) if (object.hasOwnProperty(key)) parts.push(probeQuote(key) + ":" + probeJson(object[key]));
    return "{" + parts.join(",") + "}";
}

function probeJson(value) {
    if (value === null || value === undefined) return "null";
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return String(value);
    if (typeof value === "string") return probeQuote(value);
    return value instanceof Array ? probeJsonList(value) : probeJsonObject(value);
}

function probeCanImport(file, typeName) {
    if (typeof ImportOptions === "undefined" || typeof ImportAsType === "undefined") return "unavailable";
    if (ImportAsType[typeName] === undefined) return "no ImportAsType." + typeName;
    try { return new ImportOptions(file).canImportAs(ImportAsType[typeName]) === true ? "true" : "false"; } catch (canError) {
      return "threw: " + probeMessage(canError); }
}

function probeProjectIds() {
    var ids = {}, index;
    for (index = 1; index <= app.project.numItems; index += 1) ids[String(app.project.item(index).id)] = true;
    return ids;
}

function probeLayerSummary(comp) {
    var layers = [], shapeLayers = 0, index, layer, isShape;
    for (index = 1; index <= comp.numLayers; index += 1) {
        layer = comp.layer(index);
        isShape = false;
        try { isShape = !!layer.property("ADBE Root Vectors Group"); } catch (shapeError) { isShape = false; }
        if (isShape) shapeLayers += 1;
        if (layers.length < PROBE_LAYER_LIST_LIMIT) layers.push({ name: layer.name, shape: isShape });
    }
    return { layerCount: comp.numLayers, shapeLayers: shapeLayers, layers: layers };
}

function probeDescribeItem(item) {
    var described = { typeName: item.typeName, name: item.name };
    var summary;
    if (item instanceof CompItem) {
        summary = probeLayerSummary(item);
        described.width = item.width; described.height = item.height; described.duration = item.duration; described.frameRate = item.frameRate;
        described.layerCount = summary.layerCount; described.shapeLayers = summary.shapeLayers; described.layers = summary.layers;
    }
    return described;
}

function probeRemoveAdded(before) {
    var added = [], removed = 0, index, item;
    for (index = app.project.numItems; index >= 1; index -= 1) {
        item = app.project.item(index);
        if (!before[String(item.id)]) added.push(item);
    }
    for (index = 0; index < added.length; index += 1) { try { added[index].remove(); removed += 1; } catch (removeError) { removed += 0; } }
    return { addedItems: added.length, removedItems: removed, leftInProject: app.project.numItems };
}

function probeImportOnce(file, typeName) {
    var result = { importAs: typeName, ok: false }, before = probeProjectIds(), started = new Date().getTime(), imported = null;
    try {
        if (typeof ImportOptions === "undefined"
          || ImportAsType[typeName] === undefined) throw new Error("ImportOptions or ImportAsType." + typeName + " is not available");
        var options = new ImportOptions(file);
        options.importAs = ImportAsType[typeName];
        imported = app.project.importFile(options);
        result.ok = !!imported;
        result.created = imported ? probeDescribeItem(imported) : null;
    } catch (importError) { result.error = probeMessage(importError); }
    result.ms = new Date().getTime() - started;
    result.cleanup = probeRemoveAdded(before);
    return result;
}

function probeVariant(folder, variant) {
    var file = new File(folder.fsName + "/" + variant.id + ".svg"), entry = { id: variant.id, canImportAs: {}, imports: [] }, index;
    file.encoding = "UTF-8";
    if (!file.open("w")) { entry.writeError = "could not open " + file.fsName; return entry; }
    file.write(variant.text); file.close();
    entry.bytes = file.length;
    for (index = 0; index < IMPORT_TYPES.length; index += 1) entry.canImportAs[IMPORT_TYPES[index]] = probeCanImport(file, IMPORT_TYPES[index]);
    for (index = 0; index < IMPORT_ATTEMPTS.length; index += 1) entry.imports.push(probeImportOnce(file, IMPORT_ATTEMPTS[index]));
    return entry;
}

function probeEnvironment() {
    var types = {}, index;
    for (index = 0; index < IMPORT_TYPES.length; index += 1) types[IMPORT_TYPES[index]] = typeof ImportAsType === "undefined" ? "unavailable" : String(ImportAsType[IMPORT_TYPES[index]]);
    return { aeVersion: String(app.version), buildName: String(app.buildName), os: String($.os), typeofImportOptions: typeof ImportOptions,
      typeofImportAsType: typeof ImportAsType, importAsType: types, dialogsSuppressed: SUPPRESS_DIALOGS };
}

function probeRun() {
    var stamp = String(new Date().getTime()), folder = new Folder(Folder.temp.fsName + "/extynt-svg-probe-" + stamp);
    var report = { script: "svg-import-probe.jsx", environment: probeEnvironment(), variants: [] }, index;
    if (!folder.create()) throw new Error("could not create " + folder.fsName);
    if (SUPPRESS_DIALOGS && typeof app.beginSuppressDialogs === "function") app.beginSuppressDialogs();
    try {
        for (index = 0; index < PROBE_VARIANTS.length; index += 1) report.variants.push(probeVariant(folder, PROBE_VARIANTS[index]));
    } finally {
        if (SUPPRESS_DIALOGS && typeof app.endSuppressDialogs === "function") app.endSuppressDialogs(false);
    }
    var output = new File(Folder.temp.fsName + "/extynt-svg-probe-" + stamp + ".json");
    output.encoding = "UTF-8";
    if (!output.open("w")) throw new Error("could not write " + output.fsName);
    output.write(probeJson(report)); output.close();
    $.writeln(probeJson(report));
    return output.fsName;
}

try {
    alert("extynt SVG import probe finished.\nResults: " + probeRun());
} catch (probeError) {
    alert("extynt SVG import probe failed: " + probeMessage(probeError));
}
