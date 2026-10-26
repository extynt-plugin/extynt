/*
 * extynt live verification runner, part 1 of 7 (ExtendScript, ES3): shared
 * primitives and the value normaliser.
 *
 * The runner is completed by `extynt-host-verification generate`, which inlines
 * the production host adapter (apps/panel/host/probe.jsx), the case pack and
 * these files in order: runner-values.jsx, runner-dump.jsx, runner-fixture.jsx,
 * runner-host.jsx, runner-report.jsx, runner-case.jsx and runner.jsx (the
 * modes). Each file is a module wrapped in an IIFE and shares the namespace
 * object EXTYNT_HV, so none of their helper names reach the global scope of the
 * generated script. Nothing here is loaded by the panel.
 */
/* exported EXTYNT_HV */
var EXTYNT_HV = {};
(function () {
    var MAX_CHARS = 64;

    function safe(call, fallback) { try { return call(); } catch (ignored) { return fallback; } }
    function now() { return new Date().getTime(); }
    function pad(n) { return n < 10 ? "0" + n : String(n); }
    function iso() {
        var d = new Date();
        return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds()) + "Z";
    }
    function stamp() { return iso().replace(/[-:]/g, "").replace("T", "-").replace("Z", ""); }
    function message(error) { return String((error && error.message) ? error.message : error).slice(0, 400); }
    function has(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

    var enumCache = {};
    function enumNumber(value) {
        if (value !== null && typeof value === "object" && typeof safe(function () { return value.valueOf(); },
          null) === "number") return Number(value.valueOf());
        return value;
    }
    function isNumberLike(member) { return typeof member === "number" || (member && typeof member.valueOf() === "number"); }
    function enumMap(holderName) {
        var map = enumCache[holderName];
        if (map) return map;
        map = {}; enumCache[holderName] = map;
        var holder = safe(function () { return $.global[holderName]; }, null);
        var props = holder ? safe(function () { return holder.reflect.properties; }, []) : [];
        for (var i = 0; i < props.length; i += 1) {
            var name = String(props[i].name), member = safe(function () { return holder[name]; }, null);
            if (isNumberLike(member)) map[String(Number(member))] = name;
        }
        return map;
    }
    function enumName(holderName, rawValue) {
        var value = enumNumber(rawValue);
        if (typeof value !== "number") return value === undefined ? null : value;
        var map = enumMap(holderName);
        return has(map, String(value)) ? map[String(value)] : value;
    }

    var TEXT_FIELDS = ["text", "font", "fontFamily", "fontStyle", "fontSize", "fillColor", "strokeColor", "applyFill", "applyStroke", "strokeWidth",
      "strokeOverFill", "justification", "tracking", "leading", "autoLeading", "baselineShift", "fauxBold", "fauxItalic", "allCaps", "smallCaps",
      "superscript", "subscript", "horizontalScale", "verticalScale", "tsume", "boxText", "pointText", "boxTextSize", "boxTextPos", "lineOrientation",
      "direction", "firstLineIndent", "startIndent", "endIndent", "spaceBefore", "spaceAfter", "kerningType", "composerEngine", "digitSet", "ligature",
      "noBreak", "baselineDirection"];
    var CHAR_FIELDS = ["font", "fontSize", "fillColor", "strokeColor", "applyFill", "applyStroke", "strokeWidth", "tracking", "leading",
      "baselineShift", "fauxBold", "fauxItalic", "allCaps", "smallCaps", "horizontalScale", "verticalScale", "kerning"];

    function readField(source, field) { return safe(function () { return source[field]; }, undefined); }
    function plainPrimitive(value, type) {
        if (type === "number") return isFinite(value) ? value : String(value);
        return value;
    }
    function plainArray(value, depth) {
        var out = [];
        for (var i = 0; i < value.length && i < 4096; i += 1) out.push(plain(value[i], depth + 1));
        return out;
    }
    function plainShape(value, depth) {
        return { shape: true, vertices: plain(value.vertices, depth + 1), inTangents: plain(value.inTangents, depth + 1),
          outTangents: plain(value.outTangents, depth + 1), closed: safe(function () { return value.closed; }, null) };
    }
    function characterRow(range, depth) {
        var row = {};
        if (!range) return row;
        for (var cf = 0; cf < CHAR_FIELDS.length; cf += 1) {
            var charValue = readField(range, CHAR_FIELDS[cf]);
            if (charValue !== undefined) row[CHAR_FIELDS[cf]] = plain(charValue, depth + 1);
        }
        return row;
    }
    function characterRows(value, length, depth) {
        var chars = [];
        for (var c = 0; c < length; c += 1) chars.push(characterRow(safe(function () { return value.characterRange(c, c + 1); }, null), depth));
        return chars;
    }
    function plainTextDocument(value, depth) {
        var doc = { textDocument: true };
        for (var f = 0; f < TEXT_FIELDS.length; f += 1) {
            var field = TEXT_FIELDS[f], fieldValue = readField(value, field);
            if (fieldValue !== undefined) {doc[field] = field === "justification" ? enumName("ParagraphJustification", fieldValue) : plain(fieldValue,
              depth + 1);}
        }
        var length = safe(function () { return String(value.text).length; }, 0);
        if (length > 0 && length <= MAX_CHARS && safe(function () { return typeof value.characterRange === "function"; },
          false)) doc.characters = characterRows(value, length, depth);
        return doc;
    }
    function plainMarker(value, depth) {
        var params = safe(function () { return value.getParameters(); }, null);
        return { marker: true, comment: safe(function () { return value.comment; }, null), duration: safe(function () { return value.duration; },
          null), chapter: safe(function () { return value.chapter; }, null), url: safe(function () { return value.url; }, null),
          frameTarget: safe(function () { return value.frameTarget; }, null), cuePointName: safe(function () { return value.cuePointName; }, null),
          eventCuePoint: safe(function () { return value.eventCuePoint; }, null), label: safe(function () { return value.label; }, null),
          protectedRegion: safe(function () { return value.protectedRegion; }, null), parameters: plain(params, depth + 1) };
    }
    function plainHostObject(value, depth) {
        if (typeof Shape !== "undefined" && value instanceof Shape) return plainShape(value, depth);
        if (typeof TextDocument !== "undefined" && value instanceof TextDocument) return plainTextDocument(value, depth);
        if (typeof MarkerValue !== "undefined" && value instanceof MarkerValue) return plainMarker(value, depth);
        return undefined;
    }
    function plainObject(value, depth) {
        var out = {};
        for (var key in value) {
            if (!has(value, key)) continue;
            var v = safe(function () { return value[key]; }, undefined);
            if (typeof v !== "function") out[key] = plain(v, depth + 1);
        }
        return out;
    }
    function plainStructured(value, depth) {
        if (value instanceof Array) return plainArray(value, depth);
        var host = plainHostObject(value, depth);
        if (host !== undefined) return host;
        if (typeof value === "object") return plainObject(value, depth);
        return String(value);
    }
    function plain(value, depth) {
        if (value === null || value === undefined) return null;
        var type = typeof value;
        if (type === "number" || type === "string" || type === "boolean") return plainPrimitive(value, type);
        if (depth > 4) return "[depth]";
        return plainStructured(value, depth);
    }
    function easeList(list) {
        var out = [];
        if (!(list instanceof Array)) return null;
        for (var i = 0; i < list.length; i += 1) {out.push([safe(function () { return list[i].speed; }, null), safe(function () {
          return list[i].influence; }, null)]);}
        return out;
    }

    EXTYNT_HV.safe = safe; EXTYNT_HV.now = now; EXTYNT_HV.iso = iso; EXTYNT_HV.stamp = stamp; EXTYNT_HV.message = message;
    EXTYNT_HV.has = has; EXTYNT_HV.enumName = enumName; EXTYNT_HV.plain = plain; EXTYNT_HV.easeList = easeList;
}());
