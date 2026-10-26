/* Helpers and constants shared by the read, apply, preview and pulse adapters: key digests, text-document enum access,
 * plan limits.
 */
/* exported AE_MAX_PLAN_OPERATIONS, AE_VECTOR_ARTWORK_DEFAULT_DURATION_SECONDS, AE_VECTOR_ARTWORK_DEFAULT_FRAME_RATE, aeAllFinite,
  aeEncodePathSegment, aeEntryFailure, aeEntryGuard, aeErrorText, aeErrorTextShort, aeHasOwn, aeIsArray, aeIsFiniteNumber, aeKeyDigest,
  aeKeyShapeSummary, aeListHas, aeNumberInRange, aeOwnValue, aeSafe, aeSafeGet, aeSafeLayer, aeSafeProperty, aeTextEnumName, aeTruncatedErrorText */
var AE_TEXT_FIELDS = {"text":{"kind":"string","scope":"content","maxLength":4096},"font":{"kind":"string","scope":"character","maxLength":256},"fontSize":{"kind":"number","scope":"character","min":1,"max":1000},"applyFill":{"kind":"boolean","scope":"character"},"fillColor":{"kind":"color","scope":"character"},"applyStroke":{"kind":"boolean","scope":"character"},"strokeColor":{"kind":"color","scope":"character"},"strokeWidth":{"kind":"number","scope":"character","min":0,"max":1000},"strokeOverFill":{"kind":"boolean","scope":"character"},"lineJoinType":{"kind":"enum","scope":"character","enumObject":"LineJoinType","values":["LINE_JOIN_MITER","LINE_JOIN_ROUND","LINE_JOIN_BEVEL"]},"tracking":{"kind":"number","scope":"character","min":-1000,"max":10000},"kerning":{"kind":"number","scope":"character","min":-1000,"max":10000,"rangeOnly":true},"autoKernType":{"kind":"enum","scope":"character","enumObject":"AutoKernType","values":["NO_AUTO_KERN","METRIC_KERN","OPTICAL_KERN"]},"leading":{"kind":"number","scope":"character","min":0,"max":5000},"autoLeading":{"kind":"boolean","scope":"character"},"leadingType":{"kind":"enum","scope":"character","enumObject":"LeadingType","values":["ROMAN_LEADING_TYPE","JAPANESE_LEADING_TYPE"]},"baselineShift":{"kind":"number","scope":"character","min":-5000,"max":5000},"horizontalScale":{"kind":"number","scope":"character","min":1,"max":10000,"hostScale":0.01},"verticalScale":{"kind":"number","scope":"character","min":1,"max":10000,"hostScale":0.01},"tsume":{"kind":"number","scope":"character","min":0,"max":100,"hostScale":0.01},"fauxBold":{"kind":"boolean","scope":"character"},"fauxItalic":{"kind":"boolean","scope":"character"},"fontCapsOption":{"kind":"enum","scope":"character","enumObject":"FontCapsOption","values":["FONT_NORMAL_CAPS","FONT_SMALL_CAPS","FONT_ALL_CAPS","FONT_ALL_SMALL_CAPS"]},"fontBaselineOption":{"kind":"enum","scope":"character","enumObject":"FontBaselineOption","values":["FONT_NORMAL_BASELINE","FONT_FAUXED_SUPERSCRIPT","FONT_FAUXED_SUBSCRIPT"]},"ligature":{"kind":"boolean","scope":"character"},"noBreak":{"kind":"boolean","scope":"character"},"digitSet":{"kind":"enum","scope":"character","enumObject":"DigitSet","values":["DEFAULT_DIGITS","ARABIC_DIGITS","ARABIC_DIGITS_RTL","FARSI_DIGITS","HINDI_DIGITS"]},"baselineDirection":{"kind":"enum","scope":"character","enumObject":"BaselineDirection","values":["BASELINE_WITH_STREAM","BASELINE_VERTICAL_ROTATED","BASELINE_VERTICAL_CROSS_STREAM"]},"justification":{"kind":"enum","scope":"paragraph","enumObject":"ParagraphJustification","values":["LEFT_JUSTIFY","CENTER_JUSTIFY","RIGHT_JUSTIFY","FULL_JUSTIFY_LASTLINE_LEFT","FULL_JUSTIFY_LASTLINE_RIGHT","FULL_JUSTIFY_LASTLINE_CENTER","FULL_JUSTIFY_LASTLINE_FULL"]},"direction":{"kind":"enum","scope":"paragraph","enumObject":"ParagraphDirection","values":["DIRECTION_LEFT_TO_RIGHT","DIRECTION_RIGHT_TO_LEFT"]},"lineOrientation":{"kind":"enum","scope":"paragraph","enumObject":"LineOrientation","values":["HORIZONTAL","VERTICAL_LEFT_TO_RIGHT","VERTICAL_RIGHT_TO_LEFT"]},"firstLineIndent":{"kind":"number","scope":"paragraph","min":-10000,"max":10000},"startIndent":{"kind":"number","scope":"paragraph","min":-10000,"max":10000},"endIndent":{"kind":"number","scope":"paragraph","min":-10000,"max":10000},"spaceBefore":{"kind":"number","scope":"paragraph","min":-10000,"max":10000},"spaceAfter":{"kind":"number","scope":"paragraph","min":-10000,"max":10000},"autoHyphenate":{"kind":"boolean","scope":"paragraph"},"everyLineComposer":{"kind":"boolean","scope":"paragraph"},"hangingRoman":{"kind":"boolean","scope":"paragraph"},"boxTextSize":{"kind":"vec2","scope":"box","min":1,"max":30000},"boxTextPos":{"kind":"vec2","scope":"box","min":-30000,"max":30000},"boxAutoFitPolicy":{"kind":"enum","scope":"box","enumObject":"BoxAutoFitPolicy","values":["NONE","HEIGHT_CURSOR","HEIGHT_PRECISE_BOUNDS","HEIGHT_BASELINE"]},"boxFirstBaselineAlignment":{"kind":"enum","scope":"box","enumObject":"BoxFirstBaselineAlignment","values":["ASCENT","CAP_HEIGHT","EM_BOX","LEADING","LEGACY_METRIC","MINIMUM_VALUE_ASIAN","MINIMUM_VALUE_ROMAN","TYPO_ASCENT","X_HEIGHT"]},"boxFirstBaselineAlignmentMinimum":{"kind":"number","scope":"box","min":0,"max":10000},"boxInsetSpacing":{"kind":"number","scope":"box","min":0,"max":10000},"boxVerticalAlignment":{"kind":"enum","scope":"box","enumObject":"BoxVerticalAlignment","values":["TOP","CENTER","BOTTOM","JUSTIFY"]}};
var AE_GLOBAL = this;

var AE_KEY_DIGEST_LIMIT = 1024;
/** The most operations one plan may hold. */
var AE_MAX_PLAN_OPERATIONS = 256;
/** The duration, in seconds, given to a vector-artwork composition the plan does not size. */
var AE_VECTOR_ARTWORK_DEFAULT_DURATION_SECONDS = 1;
/** The frame rate given to a vector-artwork composition the plan does not set. */
var AE_VECTOR_ARTWORK_DEFAULT_FRAME_RATE = 30;
// A plain-object map lookup that never reaches Object.prototype: an id such as "constructor" is simply absent.
function aeOwnValue(map, key) { return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined; }
// Wraps a host entry point so an AE error that escapes it comes back as a typed failure, never as an uncaught script error
// (which could raise an AE dialog once quiet errors are lifted around AEGP_ExecuteScript).
function aeEntryFailure(escaped) {
    return JSON.stringify({ ok: false, error: { code: "HOST_SCRIPT_ERROR", message: aeErrorText(escaped) } });
}
/** Wraps a host entry so an escaped error returns aeEntryFailure JSON instead of reaching After Effects. */
function aeEntryGuard(entry) {
    return function (raw) {
        try { return entry(raw); } catch (escaped) { return aeEntryFailure(escaped); }
    };
}
/** True when `list` holds `value` (strict equality). */
function aeListHas(list, value) { for (var i = 0; i < list.length; i += 1) if (list[i] === value) return true; return false; }
/** True when `value` is truthy and has `key` as its own property. */
function aeHasOwn(value, key) { return !!value && Object.prototype.hasOwnProperty.call(value, key); }
/** True when `value` is an Array, whichever script realm built it. */
function aeIsArray(value) { return Object.prototype.toString.call(value) === "[object Array]"; }
/** True when `value` is a number that is neither NaN nor infinite. */
function aeIsFiniteNumber(value) { return typeof value === "number" && isFinite(value); }
/** True when `value` is a finite number within [min, max]. */
function aeNumberInRange(value, min, max) { return aeIsFiniteNumber(value) && value >= min && value <= max; }
/** `segment` with the characters that delimit property paths ("%", "/", "#") percent-escaped. */
function aeEncodePathSegment(segment) { return String(segment).replace(/%/g, "%25").replace(/\//g, "%2F").replace(/#/g, "%23"); }
/** The message of a thrown value as text, cut to `limit` characters. */
function aeTruncatedErrorText(error, limit) { return String((error && error.message) ? error.message : error).slice(0, limit); }
/** The message of a thrown value as text, cut to 200 characters. */
function aeErrorText(error) { return aeTruncatedErrorText(error, 200); }
/** The message of a thrown value as text, cut to 160 characters. */
function aeErrorTextShort(error) { return aeTruncatedErrorText(error, 160); }
/** True when every element of the array-like `values` is a finite number. */
function aeAllFinite(values) {
    for (var i = 0; i < values.length; i += 1) if (!aeIsFiniteNumber(values[i])) return false;
    return true;
}
/** `target[name]`, or `fallback` when reading it throws or gives undefined. The closure-free form of aeSafe for one property read. */
function aeSafeGet(target, name, fallback) { try { var value = target[name]; return value === undefined ? fallback : value; } catch (ignored) {
  return fallback; } }
/** `group.property(key)`, or null when the lookup throws or gives undefined. */
function aeSafeProperty(group, key) { try { var value = group.property(key); return value === undefined ? null : value; } catch (ignored) { return null; } }
/** `comp.layer(key)`, or null when the lookup throws or gives undefined. */
function aeSafeLayer(comp, key) { try { var value = comp.layer(key); return value === undefined ? null : value; } catch (ignored) { return null; } }
/** The value `call` returns, or `fallback` when it throws or returns undefined. Reads of After Effects state go through this. */
function aeSafe(call, fallback) { try { var value = call(); return value === undefined ? fallback : value; } catch (ignored) { return fallback; } }
function aeEaseText(eases) { if (!eases || typeof eases.length !== "number") return ""; var out = "", i; for (i = 0; i < eases.length; i += 1) out += String(eases[i].speed) + "/" + String(eases[i].influence) + " "; return out; }
function aeKeyObjectText(value) {
    var shape = aeSafe(function () { return value.vertices ? JSON.stringify([value.vertices, value.inTangents, value.outTangents, value.closed])
      : null; }, null);
    if (shape !== null) return shape;
    var document = aeSafe(function () { return typeof value.text === "string" ? JSON.stringify([value.text, value.font, value.fontSize]) : null; }, null);
    return document !== null ? document : aeSafe(function () { return String(value); }, "?");
}
function aeKeyValueText(value) {
    if (value === null || value === undefined) return "null";
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return String(value);
    if (typeof value.length === "number") { var out = [], i; for (i = 0; i < value.length; i += 1) out.push(aeKeyValueText(value[i])); return "[" + out.join(",") + "]"; }
    return aeKeyObjectText(value);
}
function aeKeyToken(fn, render) {
    var value;
    try { value = fn(); } catch (ignoredCall) { return "-"; }
    if (value === undefined || value === null) return "-";
    try { return render ? render(value) : String(value); } catch (ignoredRender) { return "-"; }
}
function aeKeySpatialText(property, key) {
    if (!aeSafe(function () { return property.isSpatial === true; }, false)) return "ns";
    return aeKeyToken(function () { return property.keyInSpatialTangent(key); }, aeKeyValueText) + "," + aeKeyToken(function () { return property.keyOutSpatialTangent(key); }, aeKeyValueText)
        + "|" + aeKeyToken(function () { return property.keyRoving(key); }) + "," + aeKeyToken(function () { return property.keySpatialContinuous(key); }) + "," + aeKeyToken(function () { return property.keySpatialAutoBezier(key); });
}
function aeKeyDigestText(property, key) {
    return aeKeyToken(function () { return property.keyTime(key); })
        + "=" + aeKeyToken(function () { return property.keyValue(key); }, aeKeyValueText)
        + ":" + aeKeyToken(function () { return property.keyInInterpolationType(key); }) + "," + aeKeyToken(function () { return property.keyOutInterpolationType(key); })
        + "~" + aeKeyToken(function () { return property.keyInTemporalEase(key); }, aeEaseText) + "," + aeKeyToken(function () { return property.keyOutTemporalEase(key); }, aeEaseText)
        + "^" + aeKeySpatialText(property, key)
        + "*" + aeKeyToken(function () { return property.keyTemporalContinuous(key); }) + "," + aeKeyToken(function () { return property.keyTemporalAutoBezier(key); })
        + ";";
}
var AE_KEY_DIGEST_VERSION = "kd2";
/**
 * Digest of the first AE_KEY_DIGEST_LIMIT keys of a property. Returns "<count>:<digested>:<hash>"; budget, when given,
 * is called before each key. Describes a curve the same way for the read-only probe and the apply loop, covering
 * times, values, interpolation and ease, and the key limit, so a changed curve never reads as unchanged. The text
 * starts with a format tag, and a failing or undefined host call yields the same token under DoScript and the native
 * plugin.
 */
function aeKeyDigest(property, count, budget) {
    var text = AE_KEY_DIGEST_VERSION + "|", limit = Math.min(count, AE_KEY_DIGEST_LIMIT), hash = 5381, k;
    for (k = 1; k <= limit; k += 1) {
        if (budget) budget();
        text += aeKeyDigestText(property, k);
    }
    for (k = 0; k < text.length; k += 1) hash = (hash * 33 + text.charCodeAt(k)) % 4294967296;
    return count + ":" + limit + ":" + hash.toString(16);
}
// Key times and vertex counts per key of a path property (mask path, shape-layer path), or null for any other property.
// Bounded by the digest limit; `truncated` marks a longer list.
function aeKeyShapeSummary(property, count) {
    var first = aeSafe(function () { return property.keyValue(1); }, null);
    if (!first || typeof first.vertices !== "object" || !first.vertices) return null;
    var limit = Math.min(count, AE_KEY_DIGEST_LIMIT), times = [], vertexCounts = [], k;
    for (k = 1; k <= limit; k += 1) {
        times.push(aeSafe(function () { return property.keyTime(k); }, -1));
        vertexCounts.push(aeSafe(function () { return property.keyValue(k).vertices.length; }, -1));
    }
    var summary = { times: times, vertexCounts: vertexCounts };
    if (count > limit) summary.truncated = true;
    return summary;
}
function aeTextEnumHolder(field) { var spec = AE_TEXT_FIELDS[field], holder = null; if (!spec || !spec.enumObject) return null; try {
  holder = AE_GLOBAL[spec.enumObject]; } catch (ignoredThis) {} if (!holder) {try {
    holder = $.global[spec.enumObject]; } catch (ignoredGlobal) {}} return holder || null; }
var AE_TEXT_ENUM_FALLBACK = { justification: { LEFT_JUSTIFY: 7413, RIGHT_JUSTIFY: 7414, CENTER_JUSTIFY: 7415, FULL_JUSTIFY_LASTLINE_LEFT: 7416,
  FULL_JUSTIFY_LASTLINE_RIGHT: 7417, FULL_JUSTIFY_LASTLINE_CENTER: 7418, FULL_JUSTIFY_LASTLINE_FULL: 7419 } };
function aeTextEnumMember(field, name) { var holder = aeTextEnumHolder(field); try { return holder ? holder[name] : undefined; } catch (ignored) {
  return undefined; } }
function aeTextEnumNumber(field, name) { var number = Number(aeTextEnumMember(field, name)); if (isFinite(number) && number >= 0 && Math.floor(number) === number) return number; var fallback = AE_TEXT_ENUM_FALLBACK[field]; return (fallback && typeof fallback[name] === "number") ? fallback[name] : null; }
/**
 * Name of the text enum member (justification, caps and so on) matching the value, or null. AE enum members can be
 * Enumerator objects or numbers, so callers compare and assign numeric values, never the raw member.
 */
function aeTextEnumName(field, value) {
    var spec = AE_TEXT_FIELDS[field], i, wanted = Number(value);
    for (i = 0; i < spec.values.length; i += 1) { var member = aeTextEnumMember(field, spec.values[i]);
      if (member !== undefined && member !== null && member === value) return spec.values[i]; }
    if (!isFinite(wanted)) return null;
    for (i = 0; i < spec.values.length; i += 1) if (aeTextEnumNumber(field, spec.values[i]) === wanted) return spec.values[i];
    return null;
}
