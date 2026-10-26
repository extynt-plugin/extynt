/* Startup-only host census: installed effects and fonts, with no project access. It is called before the host links to
 * the sidecar, either part alone or both.
 */
/* global aeApplyLayerStyleCommandsLive, aeSafe, aeSafeGet, CTFontTechnology */
/* exported aeHostCensus */

var AE_CENSUS_SCHEMA = "0.1", AE_CENSUS_SAFETY_CEILING = 10000;
var MAX_FONT_RECORDS = 8192, MAX_FONT_NAME_CHARS = 96;
function aeCensusInteger(value, fallback) { return (typeof value === "number" && isFinite(value) && Math.floor(value) === value) ? Math.min(AE_CENSUS_SAFETY_CEILING, Math.max(1, value)) : fallback; }
function aeCensusField(object, field) { var value = aeSafeGet(object, field, ""); return value === null ? "" : value; }
var AE_CENSUS_PLAIN_NAME = /^[^\s\u0000-\u001f\u007f]+( [^\s\u0000-\u001f\u007f]+)*$/;
function aeCensusFontName(value) {
    var text;
    try { text = String(value); } catch (ignored) { return ""; }
    if (text.length <= MAX_FONT_NAME_CHARS && AE_CENSUS_PLAIN_NAME.test(text)) return text;
    return text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").replace(/^\s+/, "").replace(/\s+$/, "").slice(0, MAX_FONT_NAME_CHARS);
}
function aeCensusFontKey(record) {
    var family = record.family, style = record.style, name = record.postScriptName;
    return [family.toLowerCase(), family, style.toLowerCase(), style, name.toLowerCase(), name];
}
function aeCensusKeyCompare(a, b) {
    for (var i = 0; i < 6; i += 1) {
        if (a.key[i] !== b.key[i]) return a.key[i] < b.key[i] ? -1 : 1;
    }
    return 0;
}
function aeCensusSortFonts(records) {
    var keyed = [], sorted = [], i;
    for (i = 0; i < records.length; i += 1) keyed.push({ key: aeCensusFontKey(records[i]), record: records[i] });
    keyed.sort(aeCensusKeyCompare);
    for (i = 0; i < keyed.length; i += 1) sorted.push(keyed[i].record);
    return sorted;
}
function aeCensusTechnology(value) {
    var bitmap = typeof CTFontTechnology === "undefined" ? undefined : aeSafeGet(CTFontTechnology, "CT_BITMAP", undefined);
    if (bitmap !== undefined && value === bitmap) return "bitmap";
    return aeCensusFontName(value);
}
function aeCensusFontRecord(font, postScriptName) {
    var record = { family: aeCensusFontName(aeCensusField(font, "familyName")), style: aeCensusFontName(aeCensusField(font, "styleName")), postScriptName: postScriptName };
    var technology = aeCensusTechnology(aeCensusField(font, "technology"));
    if (technology) record.technology = technology;
    return record;
}
function aeCensusScanStyles(styles, scan) {
    for (var s = 0; s < styles.length; s += 1) {
        var font = styles[s];
        if (!font) continue;
        var postScriptName = aeCensusFontName(aeCensusField(font, "postScriptName"));
        if (!postScriptName) continue;
        scan.reported += 1;
        scan.records.push(aeCensusFontRecord(font, postScriptName));
    }
}
function aeCensusScanFonts(collection, scan) {
    for (var g = 0; g < collection.length; g += 1) {
        var group = collection[g];
        if (!group) continue;
        scan.families += 1;
        aeCensusScanStyles((typeof group.length === "number") ? group : [group], scan);
    }
}
var AE_CENSUS_FONT_FINGERPRINT_TAG = "ff1";
function aeCensusFontFingerprint(collection) {
    var families = 0, styles = 0, hash = 5381, g, k, text;
    for (g = 0; g < collection.length; g += 1) {
        var group = collection[g];
        if (!group) continue;
        var members = (typeof group.length === "number") ? group : [group];
        families += 1;
        styles += members.length;
        text = String(aeCensusField(members[0], "familyName")) + "|" + members.length + ";";
        for (k = 0; k < text.length; k += 1) hash = (hash * 33 + text.charCodeAt(k)) % 4294967296;
    }
    return { families: families, styles: styles, text: AE_CENSUS_FONT_FINGERPRINT_TAG + "|" + families + "|" + styles + "|" + hash.toString(16) };
}
function aeCensusInstalledFonts(config, known, warnings) {
    var timing = { enumerateMs: 0, readMs: 0, sortMs: 0 }, at = new Date().getTime();
    var collection = aeSafe(function () { return app.fonts && app.fonts.allFonts; }, null);
    if (!collection || typeof collection.length !== "number") { warnings.push("fonts-unavailable"); return { items: [], totalReported: 0, familiesReported: 0, completeness: "failed", fingerprint: "", unchanged: false, timing: timing }; }
    var fingerprint = aeCensusFontFingerprint(collection);
    timing.enumerateMs = new Date().getTime() - at;
    if (known && known === fingerprint.text) return { items: [], totalReported: fingerprint.styles, familiesReported: fingerprint.families, completeness: "complete", fingerprint: fingerprint.text, unchanged: true, timing: timing };
    var scan = { records: [], families: 0, reported: 0 }, limit = Math.min(aeCensusInteger(config && config.maxFonts, MAX_FONT_RECORDS), MAX_FONT_RECORDS);
    at = new Date().getTime();
    aeCensusScanFonts(collection, scan);
    timing.readMs = new Date().getTime() - at;
    at = new Date().getTime();
    var kept = aeCensusSortFonts(scan.records).slice(0, limit);
    timing.sortMs = new Date().getTime() - at;
    var partial = scan.reported > kept.length;
    if (partial) warnings.push("font-inventory-limit");
    return { items: kept, totalReported: scan.reported, familiesReported: scan.families, completeness: partial ? "partial" : "complete", fingerprint: fingerprint.text, unchanged: false, timing: timing };
}
function aeCensusRuntime() {
    var version = aeSafe(function () { return String(app.version); }, "unknown");
    var build = aeSafe(function () { return app.buildNumber; }, null);
    return { application: "After Effects", appVersion: version, buildNumber: (build === null || build === undefined) ? null : String(build), buildName: aeSafe(function () { return String(app.buildName); }, null), platform: ($.os && $.os.indexOf("Mac") === 0) ? "macOS" : (($.os && $.os.indexOf("Windows") === 0) ? "Windows" : "unknown"), architecture: "unknown", compatible: parseInt(version, 10) >= 25 };
}
function aeCensusFailure(requestId, code, message) { return {
  schemaVersion: AE_CENSUS_SCHEMA, ok: false, requestId: requestId, error: { code: code, message: message }, warnings: [] }; }
function aeCensusPartName(name) { return name === "effects" || name === "fonts" || name === "features"; }
function aeCensusParts(list) {
    var parts = { effects: false, fonts: false, features: false }, i;
    if (list === undefined) return { effects: true, fonts: true, features: false };
    if (!(list instanceof Array) || list.length < 1 || list.length > 3) return null;
    for (i = 0; i < list.length; i += 1) {
        if (!aeCensusPartName(list[i])) return null;
        parts[list[i]] = true;
    }
    return parts;
}
function aeCensusLayerStyleCommandsLive() { return aeSafe(function () { return typeof aeApplyLayerStyleCommandsLive === "function" ? aeApplyLayerStyleCommandsLive() === true : null; }, null); }
function aeCensusRequestId(request) { return (request && typeof request.requestId === "string") ? request.requestId : ""; }
function aeCensusKnownFingerprint(value) { return (typeof value === "string" && value.length <= 128) ? value : ""; }
function aeCensusParseRequest(raw) {
    var request, requestId;
    try { request = JSON.parse(raw); } catch (ignored) { return { failure: aeCensusFailure("", "INVALID_REQUEST", "Request was not valid JSON.") }; }
    requestId = aeCensusRequestId(request);
    if (!request || request.schemaVersion !== AE_CENSUS_SCHEMA || !requestId || requestId.length > 128) return { failure: aeCensusFailure(requestId, "INVALID_REQUEST", "Expected schemaVersion 0.1 and a bounded requestId.") };
    var parts = aeCensusParts(request.parts);
    if (!parts) return { failure: aeCensusFailure(requestId, "INVALID_REQUEST", "parts lists effects, fonts, features or any of them.") };
    return { request: request, requestId: requestId, parts: parts, known: aeCensusKnownFingerprint(request.fontFingerprint) };
}
function aeCensusEffectRecord(collection, index) {
    var effect = aeSafe(function () { return collection[index]; }, null);
    if (!effect) return null;
    var matchName = aeSafe(function () { return String(effect.matchName); }, "");
    if (!matchName) return null;
    return { matchName: matchName, displayName: aeSafe(function () { return String(effect.displayName || effect.name); }, matchName),
      category: aeSafe(function () { return String(effect.category); }, null), version: aeSafe(function () { return String(effect.version); }, null),
        available: aeSafe(function () { return effect.isInstalled !== false; }, true) };
}
function aeCensusReadEffects(collection, limit) {
    var items = [], record, total = aeSafe(function () { return Number(collection.length); }, 0);
    if (!isFinite(total) || total < 0) total = 0;
    var returnedLimit = Math.min(total, limit, AE_CENSUS_SAFETY_CEILING);
    for (var index = 0; index < returnedLimit; index += 1) {
        record = aeCensusEffectRecord(collection, index);
        if (record) items.push(record);
    }
    items.sort(function (a, b) { return a.matchName < b.matchName ? -1 : (a.matchName > b.matchName ? 1 : 0); });
    return { items: items, total: total, partial: total > returnedLimit || total > AE_CENSUS_SAFETY_CEILING };
}
function aeCensusInstalledEffects(request, warnings) {
    var limit = aeCensusInteger(request.limits && request.limits.maxEffects, AE_CENSUS_SAFETY_CEILING),
      collection = aeSafe(function () { return app.effects; }, null);
    if (!collection) { warnings.push("effects-unavailable"); return { items: [], total: 0, completeness: "failed" }; }
    var effects = aeCensusReadEffects(collection, limit);
    if (effects.partial) warnings.push("effect-inventory-limit");
    effects.completeness = effects.partial ? "partial" : "complete";
    return effects;
}
function aeCensusFontFields(result, fonts) {
    result.installedFonts = fonts.items;
    result.fontTotalReported = fonts.totalReported;
    result.fontFamiliesReported = fonts.familiesReported;
    result.fontCompleteness = fonts.completeness;
    result.fontFingerprint = fonts.fingerprint;
    result.fontsUnchanged = fonts.unchanged;
}
function aeCensusEnvelope(requestId, run, warnings) {
    var result = { runtime: aeCensusRuntime(), part: (run.parts.effects && run.parts.fonts) ? "all" : (run.parts.effects ? "effects" : (run.parts.fonts ? "fonts" : "features")), durationMs: { total: run.totalMs } };
    if (run.effects) {
        result.installedEffects = run.effects.items;
        result.totalReported = run.effects.total;
        result.returnedCount = run.effects.items.length;
        result.completeness = run.effects.completeness;
        result.durationMs.effects = run.effectsMs;
    }
    if (run.fonts) {
        aeCensusFontFields(result, run.fonts);
        result.durationMs.fonts = run.fontsMs;
        result.durationMs.fontsEnumerate = run.fonts.timing.enumerateMs;
        result.durationMs.fontsRead = run.fonts.timing.readMs;
        result.durationMs.fontsSort = run.fonts.timing.sortMs;
    }
    if (run.parts.features) result.layerStyleCommandsLive = aeCensusLayerStyleCommandsLive();
    return { schemaVersion: AE_CENSUS_SCHEMA, ok: true, requestId: requestId, result: result, warnings: warnings };
}
function aeCensusExecute(raw) {
    var parsed = aeCensusParseRequest(raw);
    if (parsed.failure) return parsed.failure;
    var warnings = [], run = { parts: parsed.parts, effects: null, fonts: null, effectsMs: 0, fontsMs: 0, totalMs: 0 };
    var startedAt = new Date().getTime(), at = startedAt;
    if (parsed.parts.effects) {
        run.effects = aeCensusInstalledEffects(parsed.request, warnings);
        run.effectsMs = new Date().getTime() - at;
        at = new Date().getTime();
    }
    if (parsed.parts.fonts) {
        run.fonts = aeCensusInstalledFonts(parsed.request.limits, parsed.known, warnings);
        run.fontsMs = new Date().getTime() - at;
    }
    run.totalMs = new Date().getTime() - startedAt;
    return aeCensusEnvelope(parsed.requestId, run, warnings);
}
/**
 * Installed effect and font census. Takes the request JSON; returns the census envelope JSON with schemaVersion and
 * ok, or {schemaVersion,ok:false,requestId,error:{code,message},warnings} on a refusal or CENSUS_FAILED. Never reads
 * app.project, so project-state failures cannot suppress capability discovery. The font list is cut at a cap equal to
 * MAX_FONT_RECORDS in packages/capability-catalogue/src/fonts.ts, sorted by that file's comparator, and says "partial"
 * past the cap; a font with no PostScript name is dropped. Layer Style availability is true/false, or null while the
 * apply scripts are not loaded.
 */
function aeHostCensus(raw) { try { return JSON.stringify(aeCensusExecute(raw)); } catch (unexpected) { return JSON.stringify({ schemaVersion: AE_CENSUS_SCHEMA, ok: false, requestId: "", error: { code: "CENSUS_FAILED", message: String(unexpected) }, warnings: [] }); } }
