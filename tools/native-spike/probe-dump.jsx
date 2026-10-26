// probe-dump.jsx
//
// TEST-ONLY, READ-ONLY. Run it with File > Scripts > Run Script File in After Effects.
//
// It loads the host scripts (HOST_DIR, default apps/panel/host of this checkout), asks the ExtendScript probe
// (aeEyesOpenProbe) for the whole project, pages in every composition it left unread or cut mid-way (each page has its own
// budget), merges the pages the way the panel does and writes the JSON envelope to OUTPUT_FILE (default
// extynt-probe-dump.json in the system temporary folder; the alert names it). Then:
//   node tools/native-spike/spike.ts compare --probe <that file>
// It never modifies the project and writes one text file. Plain ExtendScript (ES3): no let/const/arrows/indexOf/forEach.

/* global aeEyesOpenProbe */

var HOST_DIR = "";

var OUTPUT_FILE = "";

var DUMP_MAX_READ_MS = 120000;
var DUMP_SOFT_READ_MS = 5000;
var DUMP_MAX_CALLS = 2000;
var DUMP_NOTE = "merged by tools/native-spike/probe-dump.jsx";

function dumpLimits() {
    return {
        maxReadMs: DUMP_MAX_READ_MS,
        maxTotalProperties: 100000,
        maxCompositions: 256,
        maxProjectItems: 50000,
        maxLayersPerComposition: 4096,
        maxPropertiesPerLayer: 10000,
        maxPropertyDepth: 32,
        maxPayloadBytes: 10000000
    };
}

function dumpWholeRequest() {
    return { schemaVersion: "0.1", requestId: "probe-dump-1", includeItems: true, includeEffects: true, softReadMs: DUMP_SOFT_READ_MS, limits: dumpLimits() };
}

function dumpPageRequest(pages, callNumber) {
    var ids = [], starts = {}, i;
    for (i = 0; i < pages.partial.length; i += 1) {
        ids.push(String(pages.partial[i].id));
        starts[String(pages.partial[i].id)] = { layer: pages.partial[i].nextLayer, property: pages.partial[i].nextProperty || 0 };
    }
    for (i = 0; i < pages.unread.length && ids.length < 256; i += 1) if (!dumpContains(ids, pages.unread[i])) ids.push(String(pages.unread[i]));
    return {
        schemaVersion: "0.1", requestId: "probe-dump-" + callNumber, compositionIds: ids, layerStarts: starts,
        includeItems: false, includeEffects: false, softReadMs: DUMP_SOFT_READ_MS, limits: dumpLimits()
    };
}

function dumpContains(list, value) {
    for (var i = 0; i < list.length; i += 1) if (String(list[i]) === String(value)) return true;
    return false;
}

function dumpKeepOnly(list, wanted) {
    var kept = [];
    if (!list || !list.length) return kept;
    for (var i = 0; i < list.length; i += 1) if (dumpContains(wanted, list[i])) kept.push(list[i]);
    return kept;
}

function dumpCopy(object, changes) {
    var copy = {}, key;
    for (key in object) if (object.hasOwnProperty(key)) copy[key] = object[key];
    for (key in changes) if (changes.hasOwnProperty(key)) copy[key] = changes[key];
    return copy;
}

function dumpIndexOfId(rows, id) {
    for (var i = 0; i < rows.length; i += 1) if (String(rows[i].id) === String(id)) return i;
    return -1;
}

function dumpPagesOf(result) {
    var pages = result.compositionPages || {};
    return { unread: pages.unread || [], partial: pages.partial || [], oversized: pages.oversized || [], capped: pages.capped === true };
}

function dumpMissingCompositionIds(result) {
    var items = result.items || [], read = result.compositions || [], missing = [];
    for (var i = 0; i < items.length; i += 1) {
        if (items[i].type === "composition" && dumpIndexOfId(read, items[i].id) < 0) missing.push(String(items[i].id));
    }
    return missing;
}

function dumpContinuedLayer(old, layer) {
    var seen = {}, paths = (old.propertyPaths || []).slice(), more = layer.propertyPaths || [], i;
    for (i = 0; i < paths.length; i += 1) seen[paths[i].path] = true;
    for (i = 0; i < more.length; i += 1) if (!seen[more[i].path]) paths.push(more[i]);
    return dumpCopy(layer, { propertyPaths: paths });
}

function dumpAppendLayers(before, after, cut) {
    var kept = before.slice(), last = kept[kept.length - 1];
    for (var i = 0; i < after.length; i += 1) {
        var at = dumpIndexOfId(kept, after[i].id);
        if (at < 0) { kept.push(after[i]); continue; }
        var continued = cut && cut.nextProperty > 0 && kept[at] === last;
        kept[at] = continued ? dumpContinuedLayer(kept[at], after[i]) : after[i];
    }
    return kept;
}

function dumpMergedComposition(before, current, cut) {
    return (before !== undefined && cut) ? dumpCopy(current, { layers: dumpAppendLayers(before.layers || [], current.layers || [], cut) }) : current;
}

function dumpCompositionsById(baseResult, pageResult, cutById) {
    var all = (baseResult.compositions || []).concat(pageResult.compositions || []), byId = {}, arrived = [];
    for (var i = 0; i < all.length; i += 1) {
        var id = String(all[i].id), before = byId[id];
        if (before === undefined) arrived.push(id);
        byId[id] = dumpMergedComposition(before, all[i], cutById[id]);
    }
    return { byId: byId, arrived: arrived };
}

function dumpIsNextComposition(item, byId, used) {
    return item.type === "composition" && byId[String(item.id)] !== undefined && !dumpContains(used, item.id);
}

function dumpMergedCompositions(baseResult, pageResult, cutById) {
    var merged = dumpCompositionsById(baseResult, pageResult, cutById), byId = merged.byId, arrived = merged.arrived;
    var items = baseResult.items || [], ordered = [], used = [], i;
    for (i = 0; i < items.length; i += 1) {
        if (dumpIsNextComposition(items[i], byId, used)) {
            ordered.push(byId[String(items[i].id)]);
            used.push(String(items[i].id));
        }
    }
    for (i = 0; i < arrived.length; i += 1) if (!dumpContains(used, arrived[i])) ordered.push(byId[arrived[i]]);
    return ordered;
}

function dumpMergedPartial(basePages, page) {
    var read = [], partial = dumpPagesOf(page).partial.slice(), i;
    for (i = 0; i < (page.compositions || []).length; i += 1) read.push(String(page.compositions[i].id));
    for (i = 0; i < basePages.partial.length; i += 1) if (!dumpContains(read, basePages.partial[i].id)) partial.push(basePages.partial[i]);
    return partial;
}

function dumpPartialIds(partial) {
    var ids = [];
    for (var i = 0; i < partial.length; i += 1) ids.push(String(partial[i].id));
    return ids;
}

function dumpMergePagedCompositions(baseResult, pageResult) {
    var basePages = dumpPagesOf(baseResult), cutById = {}, i;
    for (i = 0; i < basePages.partial.length; i += 1) cutById[String(basePages.partial[i].id)] = basePages.partial[i];
    baseResult.compositions = dumpMergedCompositions(baseResult, pageResult, cutById);
    var partial = dumpMergedPartial(basePages, pageResult), held = dumpPartialIds(partial), unread = [], still = dumpMissingCompositionIds(baseResult);
    var pageUnread = dumpPagesOf(pageResult).unread;
    for (i = 0; i < pageUnread.length; i += 1) if (!dumpContains(held, pageUnread[i])) unread.push(pageUnread[i]);
    baseResult.compositionPages = {
        unread: dumpKeepOnly(unread, still), partial: partial,
        oversized: dumpKeepOnly(basePages.oversized.concat(dumpPagesOf(pageResult).oversized), still), capped: basePages.capped
    };
}

function dumpLeftToRead(result) {
    var pages = dumpPagesOf(result);
    return pages.unread.length + pages.partial.length;
}

function dumpResumedFurther(now, old) {
    return now.nextLayer > old.nextLayer || (now.nextLayer === old.nextLayer && (now.nextProperty || 0) > (old.nextProperty || 0));
}

function dumpPageAdvanced(before, after) {
    if (after.unread.length < before.unread.length) return true;
    for (var i = 0; i < after.partial.length; i += 1) {
        var now = after.partial[i], at = dumpIndexOfId(before.partial, now.id);
        if (at < 0) return true;
        if (dumpResumedFurther(now, before.partial[at])) return true;
    }
    for (var j = 0; j < before.partial.length; j += 1) if (dumpIndexOfId(after.partial, before.partial[j].id) < 0) return true;
    return false;
}

function dumpStampOf(result) {
    var stamp = result && result.hostStamp;
    return (stamp && typeof stamp.epoch === "number" && typeof stamp.revision === "number") ? stamp.epoch + "." + stamp.revision : null;
}

function dumpParse(raw) {
    try { return JSON.parse(raw); } catch (ignored) { return null; }
}

function dumpErrorCode(answer) { return (answer && answer.error && answer.error.code) || "UNPARSEABLE"; }

function dumpStampChanged(first, answer) { return dumpStampOf(first.result) !== null && dumpStampOf(first.result) !== dumpStampOf(answer.result); }

function dumpPageStopReason(first, probe, callNumber) {
    var answer = dumpParse(probe(JSON.stringify(dumpPageRequest(dumpPagesOf(first.result), callNumber))));
    if (!answer || answer.ok !== true || !answer.result) return "page failed: " + dumpErrorCode(answer);
    if (dumpStampChanged(first, answer)) return "project changed during the read";
    var before = dumpPagesOf(first.result);
    dumpMergePagedCompositions(first.result, answer.result);
    if (!dumpPageAdvanced(before, dumpPagesOf(first.result))) return "a page read nothing new";
    return null;
}

function dumpPageUntilDone(first, probe) {
    var calls = 0, stopped = null;
    while (dumpLeftToRead(first.result) > 0 && stopped === null) {
        if (calls >= DUMP_MAX_CALLS) { stopped = "call limit"; break; }
        calls += 1;
        stopped = dumpPageStopReason(first, probe, calls + 1);
    }
    return { calls: calls, stopped: stopped };
}

function dumpWithoutCountLimit(warnings) {
    var kept = [];
    for (var i = 0; i < (warnings || []).length; i += 1) if (warnings[i] !== "composition-count-limit") kept.push(warnings[i]);
    return kept;
}

function dumpTidyWarnings(first) {
    var pages = dumpPagesOf(first.result);
    if (pages.unread.length || pages.partial.length || pages.oversized.length || pages.capped) return;
    var warnings = dumpWithoutCountLimit(first.warnings);
    first.warnings = warnings;
    if (first.result.truncation && typeof first.result.truncation.truncated === "boolean") first.result.truncation.truncated = warnings.length > 0;
}

function dumpBuildDump(first, probe, startedAt) {
    var before = dumpPagesOf(first.result), wanted = before.unread.slice(), i;
    for (i = 0; i < before.partial.length; i += 1) wanted.push(String(before.partial[i].id));
    var paging = dumpPageUntilDone(first, probe);
    dumpTidyWarnings(first);
    var pages = dumpPagesOf(first.result), still = dumpMissingCompositionIds(first.result), stillPartial = dumpPartialIds(pages.partial), paged = [];
    for (i = 0; i < wanted.length; i += 1) if (!dumpContains(still, wanted[i]) && !dumpContains(stillPartial, wanted[i])) paged.push(wanted[i]);
    first.dump = {
        calls: 1 + paging.calls, pagedCompositionIds: paged, stillMissingCompositionIds: still,
        elapsedMs: (new Date()).getTime() - startedAt, maxReadMsRequested: DUMP_MAX_READ_MS, note: DUMP_NOTE
    };
    if (stillPartial.length) first.dump.stillPartialCompositionIds = stillPartial;
    if (paging.stopped) first.dump.stoppedBecause = paging.stopped;
    return first;
}

function dumpEnsureFolder(folder) {
    if (folder.exists) return true;
    if (folder.parent && !folder.parent.exists && !dumpEnsureFolder(folder.parent)) return false;
    return folder.create();
}

function dumpWriteText(path, text) {
    var file = File(path);
    if (!dumpEnsureFolder(file.parent)) return "could not create the folder " + file.parent.fsName;
    file.encoding = "UTF-8";
    file.lineFeed = "Unix";
    if (!file.open("w")) return "could not open " + file.fsName + " for writing (enable Preferences > Scripting & Expressions > Allow Scripts to Write Files and Access Network)";
    try { file.write(text); } finally { file.close(); }
    return null;
}

function dumpHostDir() {
    return HOST_DIR !== "" ? HOST_DIR : File($.fileName).parent.parent.parent.fsName + "/apps/panel/host";
}

function dumpOutputPath() {
    return OUTPUT_FILE !== "" ? OUTPUT_FILE : Folder.temp.fsName + "/extynt-probe-dump.json";
}

function dumpHostFileList() {
    var names = ["probe.jsx", "collection.jsx"], files = [];
    for (var i = 0; i < names.length; i += 1) files.push(File(dumpHostDir() + "/" + names[i]));
    return files;
}

function dumpMissingMessage(file) {
    return "missing " + file.fsName + ". Set HOST_DIR at the top of this script to the host library folder.";
}

function dumpSummary(output, written) {
    var dump = output.dump;
    if (!dump) return "The probe answered an error; its raw envelope was written to " + written + ".";
    var text = "Wrote " + written + "\nprobe calls: " + dump.calls + "\ncompositions paged in and merged: " + dump.pagedCompositionIds.length +
        "\ncompositions still missing: " + dump.stillMissingCompositionIds.length + "\nelapsed: " + dump.elapsedMs + " ms";
    if (dump.stillPartialCompositionIds) text += "\ncompositions still partial: " + dump.stillPartialCompositionIds.length;
    if (dump.stoppedBecause) text += "\npaging stopped: " + dump.stoppedBecause;
    return text;
}

function dumpRunProbeDump() {
    if (dumpLoadFailure) { alert("probe-dump: " + dumpLoadFailure); return; }
    var startedAt = (new Date()).getTime();
    var raw = aeEyesOpenProbe(JSON.stringify(dumpWholeRequest()));
    var first = dumpParse(raw), text = raw;
    if (first && first.ok === true && first.result) text = JSON.stringify(dumpBuildDump(first, aeEyesOpenProbe, startedAt));
    var writeFailure = dumpWriteText(dumpOutputPath(), text);
    if (writeFailure) { alert("probe-dump: " + writeFailure); return; }
    alert("probe-dump: " + dumpSummary(((first && first.dump) ? first : {}), File(dumpOutputPath()).fsName));
}

var dumpLoadFailure = null;
var dumpHostFiles = dumpHostFileList();
for (var dumpLoadIndex = 0; dumpLoadIndex < dumpHostFiles.length && dumpLoadFailure === null; dumpLoadIndex += 1) {
    if (!dumpHostFiles[dumpLoadIndex].exists) {
        dumpLoadFailure = dumpMissingMessage(dumpHostFiles[dumpLoadIndex]);
    } else {
        try { $.evalFile(dumpHostFiles[dumpLoadIndex]); } catch (dumpLoadError) {
          dumpLoadFailure = "could not load " + dumpHostFiles[dumpLoadIndex].fsName + ": " + dumpLoadError; }
    }
}
if (dumpLoadFailure === null && typeof aeEyesOpenProbe !== "function") {
    dumpLoadFailure = "aeEyesOpenProbe is not defined after loading probe.jsx; is HOST_DIR the host library folder?";
}

dumpRunProbeDump();
