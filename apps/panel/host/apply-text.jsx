/* Apply: text document validation and writes. It sits under apply-flow.jsx, which dispatches the text operations here. */
/* global AE_TEXT_FIELDS, aeApplyAcceptsWrites, aeApplyChildSegment, aeApplyFindProperty, aeApplyTextWriteFallbacks, aeApplyVisibleWritableProperty,
  aeApplyWritableProperty, aeErrorText, aeListHas, aeOwnValue, aeSafe, aeSafeGet, aeSafeProperty, aeTextEnumMember, aeTextEnumName, aeTextEnumNumber,
  aeTruncatedErrorText */
/* exported aeApplyEnsureTextAnimator, aeApplyReadBackTextRanges, aeApplySetTextDocument, aeApplyValidTextDocumentOperation */
var TEXT_ANIMATOR_PROPERTY_MATCH_NAMES = { "text.opacity": "ADBE Text Opacity" };
function aeApplyTextTupleValid(value, count, min, max) {
    if (!(value instanceof Array) || value.length !== count) return false;
    for (var i = 0; i < count; i += 1) if (typeof value[i] !== "number" || !isFinite(value[i]) || value[i] < min || value[i] > max) return false;
    return true;
}
function aeApplyTextEnumValid(value, spec) { for (var i = 0; i < spec.values.length; i += 1) if (spec.values[i] === value) return true; return false; }
var AE_APPLY_TEXT_KIND_CHECKS = {
    "string": function (value, spec, field) { return typeof value === "string" && value.length <= spec.maxLength && (field === "text" || value.length > 0); },
    "number": function (value, spec) { return typeof value === "number" && isFinite(value) && value >= spec.min && value <= spec.max; },
    "boolean": function (value) { return typeof value === "boolean"; },
    "color": function (value) { return aeApplyTextTupleValid(value, 3, 0, 1); },
    "vec2": function (value, spec) { return aeApplyTextTupleValid(value, 2, spec.min, spec.max); },
    "enum": function (value, spec) { return aeApplyTextEnumValid(value, spec); }
};
function aeApplyTextFieldScopeOk(spec, characterOnly) { return !(characterOnly && spec.scope !== "character") && !(spec.rangeOnly && !characterOnly); }
function aeApplyTextFieldValid(field, value, characterOnly) {
    var spec = AE_TEXT_FIELDS.hasOwnProperty(field) ? AE_TEXT_FIELDS[field] : null;
    if (!spec || !aeApplyTextFieldScopeOk(spec, characterOnly)) return false;
    if (!AE_APPLY_TEXT_KIND_CHECKS.hasOwnProperty(spec.kind)) return false;
    return AE_APPLY_TEXT_KIND_CHECKS[spec.kind](value, spec, field);
}
var AE_APPLY_TEXT_META_KEYS = ["operation", "compositionId", "layerId", "characterRanges"];
function aeApplyTextDocumentFieldCount(operation) {
    var count = 0;
    for (var key in operation) {
        if (!operation.hasOwnProperty(key) || aeListHas(AE_APPLY_TEXT_META_KEYS, key) || operation[key] === undefined) continue;
        if (!aeApplyTextFieldValid(key, operation[key], false)) return -1;
        count += 1;
    }
    return count;
}
function aeApplyTextRangeShapeValid(range) { return !!range && typeof range === "object" && typeof range.start === "number" && typeof range.end === "number"; }
function aeApplyTextRangeBoundsValid(range) { return range.start % 1 === 0 && range.end % 1 === 0 && range.start >= 0 && range.end > range.start
  && range.end <= 4096; }
function aeApplyTextRangeFieldCount(range) {
    var count = 0;
    for (var rangeKey in range) {
        if (!range.hasOwnProperty(rangeKey) || rangeKey === "start" || rangeKey === "end") continue;
        if (!aeApplyTextFieldValid(rangeKey, range[rangeKey], true)) return -1;
        count += 1;
    }
    return count;
}
function aeApplyTextRangesValid(ranges) {
    if (!(ranges instanceof Array) || ranges.length < 1 || ranges.length > 64) return false;
    for (var r = 0; r < ranges.length; r += 1) {
        var range = ranges[r];
        if (!aeApplyTextRangeShapeValid(range) || !aeApplyTextRangeBoundsValid(range)) return false;
        if (aeApplyTextRangeFieldCount(range) < 1) return false;
    }
    return true;
}
/** True when the operation carries at least one valid text field, or valid character ranges. */
function aeApplyValidTextDocumentOperation(operation) {
    var fields = aeApplyTextDocumentFieldCount(operation);
    if (fields < 0) return false;
    if (operation.characterRanges === undefined) return fields > 0;
    return aeApplyTextRangesValid(operation.characterRanges);
}
function aeApplyTextEnumValue(field, name) { var number = aeTextEnumNumber(field, name); if (number === null) throw new Error("TEXT_DOCUMENT_UNSUPPORTED: " + AE_TEXT_FIELDS[field].enumObject + "." + name + " is unavailable on this host."); return number; }
function aeApplyAssignTextField(target, field, value) { var spec = AE_TEXT_FIELDS[field]; target[field] = spec.kind === "enum" ? aeApplyTextEnumValue(field, value) : ((spec.hostScale && typeof value === "number") ? value * spec.hostScale : value); }
function aeApplyAssignParagraphFieldFallback(document, field, name) {
    var number = aeTextEnumNumber(field, name), member = aeTextEnumMember(field, name), length = String(aeSafeGet(document, "text", "")).length;
    var attempts = [
        function () { if (member === undefined || member === null || member === number) throw new Error("same value"); document[field] = member; },
        function () { if (typeof document.characterRange !== "function" || length < 1) throw new Error("no range"); document.characterRange(0, length)[field] = number; },
        function () { if (typeof document.paragraphRange !== "function") throw new Error("no paragraph range"); var range = document.paragraphRange(0, -1); if (range && typeof range.characterRange === "function") range = range.characterRange(); range[field] = number; }
    ];
    for (var i = 0; i < attempts.length; i += 1) { try { attempts[i](); aeApplyTextWriteFallbacks.push(field + ":" + ["enum-member", "character-range", "paragraph-range"][i]); return true; } catch (ignoredAttempt) {} }
    return false;
}
function aeApplyRecoverTextField(document, key, value, fieldError) {
    if (String((fieldError && fieldError.message) ? fieldError.message : fieldError).indexOf("TEXT_DOCUMENT_UNSUPPORTED") === 0) throw fieldError;
    if (AE_TEXT_FIELDS[key].scope !== "paragraph" || !aeApplyAssignParagraphFieldFallback(document, key, value)) throw new Error("PROPERTY_WRITE_FAILED: " + key + ": " + aeErrorText(fieldError));
}
function aeApplyWriteTextDocumentField(document, key, value, isBox) {
    if (AE_TEXT_FIELDS[key].scope === "box" && !isBox) throw new Error("TEXT_BOX_ONLY: " + key + " applies only to box (paragraph) text.");
    try { aeApplyAssignTextField(document, key, value); } catch (fieldError) { aeApplyRecoverTextField(document, key, value, fieldError); }
}
function aeApplyWriteTextRange(document, range, r, textLength) {
    if (range.end > textLength) throw new Error("TEXT_RANGE_OUT_OF_BOUNDS: range " + range.start + "-" + range.end + " exceeds " + textLength + " characters.");
    var styled = document.characterRange(range.start, range.end);
    for (var rangeKey in range) { if (!range.hasOwnProperty(rangeKey) || rangeKey === "start" || rangeKey === "end") continue; try { aeApplyAssignTextField(styled, rangeKey, range[rangeKey]); } catch (rangeError) { throw new Error("PROPERTY_WRITE_FAILED: characterRanges[" + r + "]." + rangeKey + ": " + aeErrorText(rangeError)); } }
}
function aeApplyWriteTextRanges(document, operation) {
    var textLength = String(operation.text !== undefined ? operation.text : aeSafeGet(document, "text", "")).length;
    if (!operation.characterRanges) return;
    if (typeof document.characterRange !== "function") throw new Error("TEXT_DOCUMENT_UNSUPPORTED: characterRange is unavailable.");
    for (var r = 0; r < operation.characterRanges.length; r += 1) aeApplyWriteTextRange(document, operation.characterRanges[r], r, textLength);
}
function aeApplyWriteTextFields(document, operation) {
    var isBox = aeSafe(function () { return document.boxText === true; }, false);
    for (var key in operation) {
        if (!operation.hasOwnProperty(key) || !AE_TEXT_FIELDS.hasOwnProperty(key) || operation[key] === undefined) continue;
        aeApplyWriteTextDocumentField(document, key, operation[key], isBox);
    }
}
/**
 * Writes the text document fields. Returns the Source Text property. When a numeric paragraph enum is rejected on a
 * live layer it retries with the raw enum member, then the whole-text character range, before failing.
 */
function aeApplySetTextDocument(layer, operation) {
    aeApplyTextWriteFallbacks = [];
    var property = aeApplyFindProperty(layer, "ADBE Text Properties/ADBE Text Document");
    if (!aeApplyWritableProperty(property, "setValue")) throw new Error("PROPERTY_NOT_SETTABLE");
    var document = aeSafeGet(property, "value", null);
    if (!document || typeof document !== "object") throw new Error("TEXT_DOCUMENT_UNSUPPORTED");
    aeApplyWriteTextFields(document, operation);
    aeApplyWriteTextRanges(document, operation);
    try { property.setValue(document); } catch (writeError) { throw new Error("PROPERTY_WRITE_FAILED: " + aeErrorText(writeError)); }
    return property;
}
function aeApplyNormalizeObservedTextValue(key, value) {
    if (AE_TEXT_FIELDS[key].kind === "enum") return aeTextEnumName(key, value);
    if (AE_TEXT_FIELDS[key].hostScale && typeof value === "number") return value / AE_TEXT_FIELDS[key].hostScale;
    return value;
}
function aeApplyReadBackTextRange(document, range, r, mismatches) {
    var observed = aeSafe(function () { return document.characterRange(range.start, range.end); }, null);
    for (var key in range) {
        if (!range.hasOwnProperty(key) || key === "start" || key === "end") continue;
        var value = observed ? aeSafe(function () { return observed[key]; }, undefined) : undefined;
        if (!aeApplySameTextValue(aeApplyNormalizeObservedTextValue(key, value), range[key])) mismatches.push(r + "." + key);
    }
}
/**
 * Compares character ranges with the layer's text. Returns {ranges,matched,mismatches}, or null when the operation has
 * no ranges. Reads each styled range afresh after the write, since the snapshot carries only whole-document values.
 */
function aeApplyReadBackTextRanges(property, operation) {
    if (!operation.characterRanges) return null;
    var document = aeSafeGet(property, "value", null), mismatches = [], r;
    for (r = 0; document && r < operation.characterRanges.length; r += 1) aeApplyReadBackTextRange(document, operation.characterRanges[r], r, mismatches);
    return { ranges: operation.characterRanges.length, matched: !!document && mismatches.length === 0, mismatches: mismatches.slice(0, 16) };
}
function aeApplySameNumberList(observed, expected) {
    if (!(observed instanceof Array) || observed.length !== expected.length) return false;
    for (var i = 0; i < expected.length; i += 1) if (typeof observed[i] !== "number" || Math.abs(observed[i] - expected[i]) > 0.0001) return false;
    return true;
}
function aeApplySameTextValue(observed, expected) {
    if (expected instanceof Array) return aeApplySameNumberList(observed, expected);
    if (typeof expected === "number") return typeof observed === "number" && Math.abs(observed - expected) < 0.01;
    return observed === expected;
}
var AE_APPLY_ANIMATORS_PATH = "ADBE Text Properties/ADBE Text Animators";
var AE_APPLY_ANIMATOR_PATH = AE_APPLY_ANIMATORS_PATH + "/ADBE Text Animator";
function aeApplyTextAnimatorBase(layer) {
    var animatorsGroup = aeApplyFindProperty(layer, AE_APPLY_ANIMATORS_PATH); if (!animatorsGroup) return null;
    var animator = aeApplyFindProperty(layer, AE_APPLY_ANIMATOR_PATH), created = false;
    if (!animator) {
        animator = aeSafe(function () { return animatorsGroup.addProperty("ADBE Text Animator"); }, null); created = !!animator;
        if (!animator) return null;
        animator = aeApplyFindProperty(layer, AE_APPLY_ANIMATOR_PATH); if (!animator) return null;
    }
    return { created: created };
}
function aeApplyTryAnimatorWrite(state, candidate) {
    if (!candidate || !aeApplyVisibleWritableProperty(candidate, "setValue")) return false;
    try { candidate.setValue(state.operation.value); } catch (candidateError) { state.lastWriteError = candidateError; return false; }
    var observed = aeSafeGet(candidate, "value", null);
    return typeof observed !== "number" || Math.abs(observed - state.operation.value) < 0.0001;
}
function aeApplyAnimatorLeafCandidates(state) {
    var group = aeApplyFindProperty(state.layer, state.propertiesPath), result = [], count = aeSafeGet(group, "numProperties", 0);
    for (var index = count; index >= 1; index -= 1) { var leaf = aeSafeProperty(group, index); if (leaf && String(aeSafeGet(leaf, "matchName", "")) === state.matchName) result.push(leaf); }
    return result;
}
function aeApplyWriteFirstAnimatorLeaf(state) {
    var candidates = aeApplyAnimatorLeafCandidates(state);
    for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {if (
      aeApplyTryAnimatorWrite(state, candidates[candidateIndex])) return candidates[candidateIndex];}
    return null;
}
function aeApplyAnimatorWriteFailure(state) {
    if (!state.lastWriteError) return new Error("TEXT_ANIMATOR_PROPERTY_HIDDEN");
    return new Error("PROPERTY_WRITE_FAILED: " + aeTruncatedErrorText(state.lastWriteError, 240));
}
function aeApplyWriteAnimatorProperty(state, created) {
    var written = created ? null : aeApplyWriteFirstAnimatorLeaf(state);
    if (!written) {
        var animatorProps = aeApplyFindProperty(state.layer, state.propertiesPath); if (!animatorProps) return null;
        var added = aeSafe(function () { return animatorProps.addProperty(state.matchName); }, null);
        written = aeApplyTryAnimatorWrite(state, added) ? added : aeApplyWriteFirstAnimatorLeaf(state);
    }
    if (!written) throw aeApplyAnimatorWriteFailure(state);
    return written;
}
function aeApplyEnsureAnimatorSelector(layer, selectorsPath, selectorPath) {
    var selectors = aeApplyFindProperty(layer, selectorsPath); if (!selectors) return false;
    if (!aeApplyFindProperty(layer, selectorPath)) {
        if (!aeSafe(function () { return selectors.addProperty("ADBE Text Selector"); }, null)) return false;
        if (!aeApplyFindProperty(layer, selectorPath)) return false;
    }
    return true;
}
function aeApplyConfirmedLeafValue(leaf, matchName, expected) {
    if (!leaf || String(aeSafeGet(leaf, "matchName", "")) !== matchName) return null;
    var observedLeaf = aeSafeGet(leaf, "value", null);
    return (typeof observedLeaf === "number" && Math.abs(observedLeaf - expected) < 0.0001 && aeApplyAcceptsWrites(leaf)) ? observedLeaf : null;
}
function aeApplyConfirmAnimatorLeaf(state) {
    var group = aeApplyFindProperty(state.layer, state.propertiesPath), index = 0, value = null;
    var count = group ? aeSafeGet(group, "numProperties", 0) : 0;
    for (var ci = count; ci >= 1 && !index; ci -= 1) {
        var observed = aeApplyConfirmedLeafValue(aeSafeProperty(group, ci), state.matchName, state.operation.value);
        if (observed !== null) { index = ci; value = observed; }
    }
    return { group: group, index: index, value: value };
}
/**
 * The layer's text animator, created when missing. Returns
 * {property,created,observedValue,propertyPath,animatorCount}, or null when it cannot be created. Reuses the first
 * animator found rather than creating a second; only "text.opacity" is supported, and only a write After Effects
 * accepts and reads back counts as the property being added.
 */
function aeApplyEnsureTextAnimator(layer, operation) {
    var animatorMatchName = aeOwnValue(TEXT_ANIMATOR_PROPERTY_MATCH_NAMES, operation.role);
    if (!animatorMatchName) throw new Error("INVALID_OPERATION");
    var selectorsPath = AE_APPLY_ANIMATOR_PATH + "/ADBE Text Selectors", selectorPath = selectorsPath + "/ADBE Text Selector";
    var base = aeApplyTextAnimatorBase(layer); if (!base) return null;
    var state = { layer: layer, operation: operation, matchName: animatorMatchName, propertiesPath: AE_APPLY_ANIMATOR_PATH + "/ADBE Text Animator Properties", lastWriteError: null };
    var animatorProperty = aeApplyWriteAnimatorProperty(state, base.created); if (!animatorProperty) return null;
    if (!aeApplyEnsureAnimatorSelector(layer, selectorsPath, selectorPath)) return null;
    var confirmed = aeApplyConfirmAnimatorLeaf(state);
    if (!confirmed.index || !aeApplyFindProperty(layer, selectorPath)) throw new Error("TEXT_ANIMATOR_NOT_CONFIRMED: " + animatorMatchName + " = " + operation.value + " could not be read back from the layer after the write.");
    var animatorCount = aeSafe(function () { return aeApplyFindProperty(layer, AE_APPLY_ANIMATORS_PATH).numProperties; }, 0);
    return { property: animatorProperty, created: base.created, observedValue: confirmed.value, propertyPath: state.propertiesPath + "/" + aeApplyChildSegment(confirmed.group, confirmed.index), animatorCount: animatorCount };
}
