/* Apply: table-driven per-kind shape rules used by aeApplyOperationShape, as field specs walked by one loop plus small
 * custom rules.
 */
/* global aeIsArray, aeNumberInRange, AE_OUTPUT_CLEANUP_MODES, AE_OUTPUT_MODULE_ROWS, AE_OUTPUT_RENDER_ROWS, AE_TEXT_FIELDS, HOST_LAYER_SWITCHES,
   aeApplyEffectPathPrefix, aeApplyEffectPathValid, aeApplyIsAbsolutePath, aeApplyIsJsonValue, aeApplyIsNewItemId, aeApplyIsRecordValue,
   aeApplyLayerSwitchValid, aeApplyManagedSvgHostSafe, aeApplyMaskValuesValid, aeApplyMetadataGuard, aeApplyNativeLayerProperty, aeApplyPathHasPrefix,
   aeApplyShapeGroupIdValid, aeApplyShapePathValid, aeApplyShapeValuesValidColor, aeApplyValidFrames, aeApplyValidLayerStyleOperation,
   aeApplyValidPresetOperation, aeApplyValidShapeItemOperation, aeApplyValidStaticControlValue, aeApplyValidTextAnimatorOperation,
   aeApplyValidTextDocumentOperation, aeApplyVectorShapesValid, aeHasOwn, aeListHas, aeOutputCleanupIdsValid, aeOutputSettingsValid,
   aeSvgFallbackLayersValid, aeSvgFallbackNotesValid */
/* exported AE_APPLY_VAL_RULES_COMPOSITION, AE_APPLY_VAL_RULES_LAYER, AE_APPLY_VAL_RULES_PROJECT */
var AE_APPLY_VAL_NEW_ID = /^__new__:[A-Za-z0-9._-]{1,128}$/;
var AE_APPLY_VAL_MASK_ID = /^mask:[1-9][0-9]{0,2}$/;
var AE_APPLY_VAL_ANY = Infinity;
function aeApplyValSolidSize(size) { return size instanceof Array && size.length === 2 && size[0] >= 1 && size[1] >= 1 && size[0] <= 30000
  && size[1] <= 30000 && Math.floor(size[0]) === size[0] && Math.floor(size[1]) === size[1]; }
function aeApplyValTextBox(box) { return box instanceof Array && box.length === 2 && typeof box[0] === "number" && typeof box[1] === "number"
  && box[0] >= 1 && box[1] >= 1 && box[0] <= 30000 && box[1] <= 30000; }
function aeApplyValBlendMode(value) { return typeof value === "string" && typeof BlendingMode !== "undefined" && !(value in Object.prototype)
  && BlendingMode[value] !== undefined; }
var AE_APPLY_VAL_CHECKS = {
    str: function (value, min, max) { return typeof value === "string" && value.length >= min && value.length <= max; },
    num: function (value, min, max) { return typeof value === "number" && isFinite(value) && value >= min && value <= max; },
    numAbove: function (value, above, max) { return typeof value === "number" && isFinite(value) && value > above && value <= max; },
    pairRange: function (value, min, max) { return aeIsArray(value) && value.length === 2 && aeNumberInRange(value[0], min, max)
      && aeNumberInRange(value[1], min, max); },
    integer: function (value, min, max) { return typeof value === "number" && Math.floor(value) === value && value >= min && value <= max; },
    bool: function (value) { return typeof value === "boolean"; },
    eq: function (value, expected) { return value === expected; },
    regex: function (value, pattern) { return pattern.test(value); },
    enumOf: function (value, list) { return aeListHas(list, value); },
    record: function (value) { return aeApplyIsRecordValue(value); },
    arr: function (value, min, max) { return value instanceof Array && value.length >= min && value.length <= max; },
    strArray: function (value, min, max) { return AE_APPLY_VAL_CHECKS.arr(value, min, max) && aeApplyValAllStrings(value); },
    newId: function (value) { return aeApplyIsNewItemId(value); },
    path: function (value) { return aeApplyIsAbsolutePath(value); },
    color: function (value) { return aeApplyShapeValuesValidColor(value); },
    groupId: function (value) { return aeApplyShapeGroupIdValid(value); },
    shapePath: function (value) { return aeApplyShapePathValid(value); },
    svg: function (value) { return aeApplyManagedSvgHostSafe(value); },
    vectorShapes: function (value) { return aeApplyVectorShapesValid(value); },
    maskAdd: function (value) { return aeApplyMaskValuesValid(value, false); },
    maskUpdate: function (value) { return aeApplyMaskValuesValid(value, true); },
    maskId: function (value) { return typeof value === "string" && (AE_APPLY_VAL_MASK_ID.test(value) || aeApplyIsNewItemId(value)); },
    jsonValue: function (value) { return aeApplyIsJsonValue(value); },
    staticValue: function (value) { return aeApplyValidStaticControlValue(value); },
    resolutionFactor: function (value) { return value instanceof Array && value.length === 2 && AE_APPLY_VAL_CHECKS.integer(value[0], 1, 16)
      && AE_APPLY_VAL_CHECKS.integer(value[1], 1, 16); },
    pngExt: function (value) { return value.slice(-4).toLowerCase() === ".png"; },
    mogrtExt: function (value) { return value.slice(-6).toLowerCase() === ".mogrt"; },
    notEffectPath: function (value) { return value.indexOf("ADBE Effect Parade/") !== 0; },
    textAnimator: function (operation) { return aeApplyValidTextAnimatorOperation(operation); },
    shapeItem: function (operation) { return aeApplyValidShapeItemOperation(operation); },
    preset: function (operation) { return aeApplyValidPresetOperation(operation); },
    layerStyle: function (operation) { return aeApplyValidLayerStyleOperation(operation); },
    textDocument: function (operation) { return aeApplyValidTextDocumentOperation(operation); },
    nativeLayerProperty: function (operation) { return aeApplyNativeLayerProperty(operation); },
    effectPath: function (operation) { return aeApplyEffectPathValid(operation); },
    effectControlPath: function (operation) { return aeApplyPathHasPrefix(operation.propertyPath, aeApplyEffectPathPrefix(operation)); },
    animateControlPath: function (operation) { return aeApplyPathHasPrefix(operation.propertyPath, aeApplyEffectPathPrefix(operation)); },
    fallbackLayers: function (value) { return aeSvgFallbackLayersValid(value); },
    fallbackNotes: function (value) { return aeSvgFallbackNotesValid(value); },
    solidSize: function (value) { return aeApplyValSolidSize(value); },
    fallbackConsistent: function (operation) { return (operation.fallbackLayers === undefined) === (operation.fallbackSize === undefined)
      && (operation.fallbackLayers === undefined || operation.fallbackUnavailable === undefined); },
    routeConsistent: function (operation) { return operation.importerAeVersion === undefined || operation.importer === "converter"; },
    vectorMeta: function (operation) { return operation.metadata && operation.metadata.sourceHash === operation.sourceHash
      && operation.metadata.bytes > 0 && operation.metadata.bytes <= 262144; },
    layerType: function (operation) { return aeListHas(AE_APPLY_VAL_PLAIN_LAYER_TYPES, operation.layerType) || (operation.layerType === "footage"
      && AE_APPLY_VAL_CHECKS.str(operation.sourceItemId, 1, AE_APPLY_VAL_ANY)); },
    layerSize: function (operation) { return operation.size === undefined || operation.size === null || (operation.layerType === "solid"
      && aeApplyValSolidSize(operation.size)); },
    layerBox: function (operation) { return operation.box === undefined || operation.box === null || (operation.layerType === "text"
      && aeApplyValTextBox(operation.box)); },
    layerJustification: function (operation) { return operation.justification === undefined || operation.justification === null
      || (operation.layerType === "text" && aeListHas(AE_TEXT_FIELDS.justification.values, operation.justification)); },
    markerFields: function (operation) { return typeof operation.comment === "string" || typeof operation.duration === "number"
      || typeof operation.chapter === "string" || typeof operation.url === "string" || typeof operation.cuePointName === "string"
      || typeof operation.label === "number"; },
    timingAny: function (operation) { return operation.inPoint !== undefined || operation.outPoint !== undefined || operation.startTime !== undefined
      || operation.stretch !== undefined; },
    audio: function (operation) { return typeof operation.enabled === "boolean" || (operation.levelDb !== undefined
      && AE_APPLY_VAL_CHECKS.num(operation.levelDb, -96, 12)); },
    precomposeCount: function (operation) { return operation.moveAllAttributes || operation.layerIds.length === 1; },
    guidesNotEmpty: function (operation) { return operation.guides.length !== 0 || operation.replace; },
    outputSettings: function (value) { return aeOutputSettingsValid(value, AE_OUTPUT_MODULE_ROWS); },
    renderSettings: function (value) { return aeOutputSettingsValid(value, AE_OUTPUT_RENDER_ROWS); },
    mediaEncoder: function (operation) { return operation.mediaEncoder === undefined || ((operation.mediaEncoder === "queue"
      || operation.mediaEncoder === "start") && operation.executeAuthorization === undefined); },
    cleanupIds: function (operation) { return aeOutputCleanupIdsValid(operation); },
    guideItems: function (guides) { for (var i = 0; i < guides.length; i += 1) {if (!guides[i] || !aeApplyValSpecsPass(guides[i],
      AE_APPLY_VAL_GUIDE_SPECS)) return false;} return true; }
};
function aeApplyValAllStrings(list) { for (var i = 0; i < list.length; i += 1) if (typeof list[i] !== "string") return false; return true; }
function aeApplyValSpecPasses(object, spec) {
    var value = spec[0] === null ? object : object[spec[0]], mode = spec[4] || 0;
    if (value === undefined && (mode & 1) !== 0) return true;
    if (value === null && (mode & 2) !== 0) return true;
    return !!AE_APPLY_VAL_CHECKS[spec[1]](value, spec[2], spec[3]);
}
function aeApplyValFirstFailed(object, specs) { for (var i = 0; i < specs.length; i += 1) if (!aeApplyValSpecPasses(object, specs[i])) return specs[i];
  return null; }
function aeApplyValSpecsPass(object, specs) { return aeApplyValFirstFailed(object, specs) === null; }
function aeApplyValCode(object, specs, code) { return aeApplyValSpecsPass(object, specs) ? null : (code || "INVALID_VALUE"); }
function aeApplyValSpecRule(specs, code) { return function (operation) { return aeApplyValCode(operation, specs, code); }; }
function aeApplyValValidateThenConfirm(specs) { return function (operation) { return aeApplyValSpecsPass(operation,
  specs) ? (operation.destructive === true ? null : "DESTRUCTIVE_CONFIRMATION_REQUIRED") : "INVALID_VALUE"; }; }
function aeApplyValConfirmThenValidate(specs) {
    return function (operation) {
        var valid = aeApplyValSpecsPass(operation, specs);
        if (operation.destructive === true) return valid ? null : "INVALID_VALUE";
        return "DESTRUCTIVE_CONFIRMATION_REQUIRED";
    };
}
function aeApplyValOptionsRule(specs) {
    var allowed = {}, i;
    for (i = 0; i < specs.length; i += 1) allowed[specs[i][0]] = true;
    return function (operation) {
        var options = operation.options, key;
        if (!options || typeof options !== "object" || options instanceof Array) return "INVALID_VALUE";
        for (key in options) if (allowed[key] !== true) return "INVALID_VALUE";
        return aeApplyValCode(options, specs, null);
    };
}
var AE_APPLY_VAL_INTERPRETATION_SPECS = [["conformFrameRate", "num", 0, 999, 1], ["alphaMode", "enumOf", ["ignore", "straight", "premultiplied"], 0,
  1], ["premulColor", "color", 0, 0, 1], ["loop", "integer", 1, 9999, 1], ["pixelAspect", "num", 0.01, 100, 1], ["fieldSeparationType", "enumOf",
  ["off", "upper-field-first", "lower-field-first"], 0, 1], ["invertAlpha", "bool", 0, 0, 1], ["guessAlpha", "eq", true, 0, 1],
  ["highQualityFieldSeparation", "bool", 0, 0, 1], ["removePulldown", "enumOf", ["off", "WSSWW", "SSWWW", "SWWWS", "WWWSS", "WWSSW"], 0, 1],
  ["guessPulldown", "enumOf", ["pulldown-3-2", "advance-24p"], 0, 1], ["resetFrameRate", "eq", true, 0, 1]];
function aeApplyValInterpretationKeyKnown(key) {
    for (var i = 0; i < AE_APPLY_VAL_INTERPRETATION_SPECS.length; i += 1) if (AE_APPLY_VAL_INTERPRETATION_SPECS[i][0] === key) return true;
    return false;
}
function aeApplyValInterpretationAlphaClash(values) { return (values.premulColor !== undefined && values.alphaMode !== "premultiplied")
  || (values.guessAlpha !== undefined && (values.alphaMode !== undefined || values.premulColor !== undefined)); }
function aeApplyValInterpretationRateClash(values) { return (values.guessPulldown !== undefined && values.removePulldown !== undefined)
  || (values.resetFrameRate !== undefined && values.conformFrameRate !== undefined); }
function aeApplyValInterpretationKeysKnown(values) {
    var count = 0, key;
    for (key in values) {
        if (!aeApplyValInterpretationKeyKnown(key)) return false;
        count += 1;
    }
    return count > 0 && !aeApplyValInterpretationAlphaClash(values) && !aeApplyValInterpretationRateClash(values);
}
function aeApplyValRuleFootageInterpretation(operation) {
    var values = operation.interpretation;
    if (!aeApplyValSpecsPass(operation, [AE_APPLY_VAL_ITEM_ID]) || !values || typeof values !== "object" || values instanceof Array) return "INVALID_VALUE";
    if (!aeApplyValInterpretationKeysKnown(values)) return "INVALID_VALUE";
    return aeApplyValCode(values, AE_APPLY_VAL_INTERPRETATION_SPECS, null);
}
function aeApplyValAnimateRule(targetSpecs) {
    return function (operation) {
        var target = aeApplyValCode(operation, targetSpecs, "INVALID_TARGET");
        if (target !== null) return target;
        return aeApplyValidFrames(operation) ? null : "INVALID_VALUE";
    };
}
function aeApplyValSettingKeysValid(settings) {
    var count = 0, key;
    for (key in settings) { if (aeHasOwn(settings, key)) { count += 1; if (AE_APPLY_VAL_COMPOSITION_SETTING_KEYS[key] !== true) return false; } }
    return count > 0;
}
function aeApplyValRuleCompositionSettings(operation) {
    if (!aeApplyValSpecsPass(operation, AE_APPLY_VAL_COMPOSITION_SETTINGS_HEAD)) return "INVALID_VALUE";
    if (!aeApplyValSettingKeysValid(operation.settings)) return "INVALID_VALUE";
    return aeApplyValCode(operation.settings, AE_APPLY_VAL_COMPOSITION_SETTINGS, null);
}
function aeApplyValRuleProjectSettings(operation) {
    var settings = operation.settings, count = 0, key;
    if (!aeApplyIsRecordValue(settings)) return "INVALID_VALUE";
    for (key in settings) {
        if (!aeHasOwn(settings, key)) continue;
        count += 1;
        if (!aeHasOwn(AE_APPLY_VAL_PROJECT_SETTINGS, key) || !aeApplyValSpecPasses(settings, AE_APPLY_VAL_PROJECT_SETTINGS[key])) return "INVALID_VALUE";
    }
    return count > 0 ? null : "INVALID_VALUE";
}
function aeApplyValRuleEnsureEffect(operation) {
    if (operation.initialization !== undefined && !(aeApplyMetadataGuard && aeApplyMetadataGuard.creation)) return "INVALID_READ_SET";
    return aeApplyValCode(operation, AE_APPLY_VAL_ENSURE_EFFECT_TARGET, "INVALID_TARGET");
}
function aeApplyValRuleReorder(operation) {
    var placement = operation.placement, reference = operation.referenceLayerId;
    if (placement === "before" || placement === "after") return (typeof reference === "string" && reference.length > 0) ? null : "INVALID_TARGET";
    return ((placement === "beginning" || placement === "end") && reference === undefined) ? null : "INVALID_VALUE";
}
function aeApplyValBooleanRole(role) { return role === "three-d" || role === "shy" || role === "solo" || role === "enabled" || role === "locked"; }
function aeApplyValRuleLayerAttribute(operation) {
    var role = operation.role;
    if (role === "blend-mode") return aeApplyValBlendMode(operation.value) ? null : "INVALID_VALUE";
    if (aeApplyValBooleanRole(role)) return typeof operation.value === "boolean" ? null : "INVALID_VALUE";
    if (aeHasOwn(HOST_LAYER_SWITCHES, role)) return aeApplyLayerSwitchValid(operation) ? null : "INVALID_VALUE";
    return "INVALID_OPERATION";
}
var AE_APPLY_VAL_PLAIN_LAYER_TYPES = ["text", "shape", "null", "camera", "light", "adjustment", "solid"];
var AE_APPLY_VAL_COMPOSITION_SETTING_KEYS = { width: true, height: true, pixelAspect: true, durationSeconds: true, frameRate: true,
  backgroundColor: true, workAreaStart: true, workAreaDuration: true, motionBlur: true, shutterAngle: true, shutterPhase: true,
  motionBlurSamplesPerFrame: true, motionBlurAdaptiveSampleLimit: true, frameBlending: true, draft3d: true, resolutionFactor: true, renderer: true };
var AE_APPLY_VAL_COMPOSITION_SETTINGS_HEAD = [["compositionId", "str", 1, AE_APPLY_VAL_ANY], ["settings", "record"]];
var AE_APPLY_VAL_COMPOSITION_SETTINGS = [["width", "num", 4, 8192, 1], ["height", "num", 4, 8192, 1], ["pixelAspect", "num", 0.01, 100, 1],
  ["durationSeconds", "num", 0.01, 10800, 1], ["frameRate", "num", 1, 120, 1], ["backgroundColor", "color", 0, 0, 1],
    ["workAreaStart", "num", 0, 10800, 1], ["workAreaDuration", "numAbove", 0, 10800, 1], ["motionBlur", "bool", 0, 0, 1], ["shutterAngle", "num", 0,
      720, 1], ["shutterPhase", "num", -360, 360, 1],
    ["motionBlurSamplesPerFrame", "integer", 2, 64, 1], ["motionBlurAdaptiveSampleLimit", "integer", 2, 256, 1], ["frameBlending", "bool", 0, 0, 1],
      ["draft3d", "bool", 0, 0, 1], ["resolutionFactor", "resolutionFactor", 0, 0, 1], ["renderer", "str", 1, 64, 1]];
var AE_APPLY_VAL_PROJECT_SETTINGS = {
    bitsPerChannel: ["bitsPerChannel", "enumOf", [8, 16, 32]], workingSpace: ["workingSpace", "str", 0, 256],
    linearBlending: ["linearBlending", "bool"], linearizeWorkingSpace: ["linearizeWorkingSpace", "bool"]
};
var AE_APPLY_VAL_ENSURE_EFFECT_TARGET = [["effectMatchName", "str", 0, AE_APPLY_VAL_ANY], [null, "effectPath"]];
var AE_APPLY_VAL_GUIDE_SPECS = [["orientation", "enumOf", ["horizontal", "vertical"]], ["position", "num", -100000, 100000]];
var AE_APPLY_VAL_FILL_SPECS = [
    ["groupId", "groupId", 0, 0, 0, "groupId must be root, shape:<n>, or a prior create_shape_group placeholder"],
    ["color", "color", 0, 0, 0, "color must be three finite numbers from 0 through 1"],
    ["opacity", "num", 0, 100, 1, "opacity must be a finite number from 0 through 100"]
];
var AE_APPLY_VAL_STROKE_SPECS = [
    AE_APPLY_VAL_FILL_SPECS[0], AE_APPLY_VAL_FILL_SPECS[1],
    ["width", "numAbove", 0, 10000, 0, "width must be a finite number greater than 0 and at most 10000"], AE_APPLY_VAL_FILL_SPECS[2]
];
var AE_APPLY_VAL_FOLDER_SPECS = [["newFolderId", "newId"], ["name", "str", 1, 256], ["parentFolderId", "str", 0, AE_APPLY_VAL_ANY, 3]];
var AE_APPLY_VAL_ITEM_ID = ["itemId", "str", 1, AE_APPLY_VAL_ANY];
var AE_APPLY_VAL_DURATION = ["durationSeconds", "numAbove", 0, 10800, 1];
var AE_APPLY_VAL_FRAME_RATE = ["frameRate", "num", 1, 120, 1];
var AE_APPLY_VAL_MARKER_SPECS = [
    ["time", "num", 0, 86400], [null, "markerFields"], ["comment", "str", 0, 1024, 1], ["duration", "num", 0, 86400, 1], ["chapter", "str", 0, 256, 1],
    ["url", "str", 0, 2048, 1], ["cuePointName", "str", 0, 256, 1], ["label", "integer", 0, 16, 1]
];
var AE_APPLY_VAL_NAME = ["name", "str", 1, 256];
function aeApplySaveAsValid(operation) { return aeApplyIsAbsolutePath(operation.path) && /\.aepx?$/i.test(operation.path)
  && typeof operation.overwrite === "boolean"; }
function aeApplyValRuleSaveProject(operation) {
    var mode = operation.mode;
    if (mode === "save_as") return aeApplySaveAsValid(operation) ? null : "INVALID_VALUE";
    return ((mode === "save" || mode === "increment") && operation.path === undefined && operation.overwrite === false) ? null : "INVALID_VALUE";
}
/** The shape rule of each project-scoped operation, by operation name. */
var AE_APPLY_VAL_RULES_PROJECT = {
    create_composition: aeApplyValSpecRule([["newCompositionId", "regex", AE_APPLY_VAL_NEW_ID], AE_APPLY_VAL_NAME, ["width", "num", 4, 8192],
      ["height", "num", 4, 8192], ["durationSeconds", "numAbove", 0, 10800], ["frameRate", "num", 1, 120]]),
    set_composition_settings: aeApplyValRuleCompositionSettings,
    render_composition: aeApplyValSpecRule([["compositionId", "str", 1, AE_APPLY_VAL_ANY], ["outputPath", "path"], ["destinationPolicy", "eq",
      "explicit-local-path"], ["renderSettingsTemplate", "str", 1, 128, 1], ["outputModuleTemplate", "str", 1, 128, 1], ["executeAuthorization", "eq",
      "RENDER_NOW", 0, 1], ["outputSettings", "outputSettings", 0, 0, 1], ["renderSettings", "renderSettings", 0, 0, 1], [null, "mediaEncoder"]]),
    create_folder: aeApplyValSpecRule(AE_APPLY_VAL_FOLDER_SPECS),
    set_item_name: aeApplyValSpecRule([AE_APPLY_VAL_ITEM_ID, AE_APPLY_VAL_NAME]),
    move_item_to_folder: aeApplyValSpecRule([AE_APPLY_VAL_ITEM_ID, ["folderId", "str", 0, AE_APPLY_VAL_ANY, 2]]),
    delete_project_item: aeApplyValValidateThenConfirm([AE_APPLY_VAL_ITEM_ID]),
    import_file: aeApplyValSpecRule([["newItemId", "newId"], ["path", "path"], ["importAs", "enumOf", ["auto", "footage", "composition",
      "composition-cropped-layers", "project"], 0, 1], ["destinationFolderId", "str", 0, AE_APPLY_VAL_ANY, 3], ["sequence", "bool", 0, 0, 1],
      ["forceAlphabetical", "bool", 0, 0, 1]]),
    create_vector_artwork: aeApplyValSpecRule([["newItemId", "newId"], AE_APPLY_VAL_NAME, ["importMode", "eq", "editable"], ["managedSourcePolicy",
      "eq", "retain"], ["sourceHash", "regex", /^[a-f0-9]{64}$/], [null, "vectorMeta"], ["svg", "svg"], ["destinationFolderId", "str", 0,
      AE_APPLY_VAL_ANY, 3], AE_APPLY_VAL_DURATION, AE_APPLY_VAL_FRAME_RATE, ["fallbackLayers", "fallbackLayers", 0, 0, 1], ["fallbackSize",
      "solidSize", 0, 0, 1], ["fallbackNotes", "fallbackNotes", 0, 0, 1], ["fallbackUnavailable", "str", 1, 400, 1], [null, "fallbackConsistent"],
      ["importer", "eq", "converter", 0, 1], ["importerAeVersion", "regex", /^\d{1,3}(?:\.\d{1,3}){0,3}$/, 0, 1], [null, "routeConsistent"]]),
    replace_footage: aeApplyValSpecRule([AE_APPLY_VAL_ITEM_ID, ["path", "path"]]),
    set_footage_proxy: aeApplyValSpecRule([AE_APPLY_VAL_ITEM_ID, ["path", "path"]]),
    clear_footage_proxy: aeApplyValSpecRule([AE_APPLY_VAL_ITEM_ID]),
    set_footage_interpretation: aeApplyValRuleFootageInterpretation,
    save_project: aeApplyValRuleSaveProject,
    set_project_settings: aeApplyValRuleProjectSettings,
    cleanup_project: aeApplyValValidateThenConfirm([["mode", "enumOf", AE_OUTPUT_CLEANUP_MODES], [null, "cleanupIds"]])
};
/** The shape rule of each composition-scoped operation, by operation name. */
var AE_APPLY_VAL_RULES_COMPOSITION = {
    duplicate_composition: aeApplyValSpecRule([["newCompositionId", "newId"], ["name", "str", 1, 256, 1]]),
    precompose_layers: aeApplyValSpecRule([["layerIds", "arr", 1, 256], AE_APPLY_VAL_NAME, ["newCompositionId", "newId"], ["newLayerId", "newId"],
      ["moveAllAttributes", "bool"], [null, "precomposeCount"], ["layerIds", "strArray", 1, 256]]),
    export_frame: aeApplyValSpecRule([["exportAuthorization", "eq", "EXPORT_NOW"], ["time", "num", 0, 86400], ["outputPath", "path"], ["outputPath",
      "pngExt"], ["overwrite", "bool"], ["resolution", "num", 1, 16, 1]]),
    export_mogrt: aeApplyValSpecRule([["exportAuthorization", "eq", "EXPORT_NOW"], ["templateName", "str", 1, 256], ["outputPath", "path"],
      ["outputPath", "mogrtExt"], ["overwrite", "bool"]]),
    set_composition_guides: aeApplyValSpecRule([["guides", "arr", 0, 64], ["replace", "bool"], [null, "guidesNotEmpty"], ["guides", "guideItems"]])
};
/** The shape rule of each layer-scoped operation, by operation name. */
var AE_APPLY_VAL_RULES_LAYER = {
    add_text_animator: aeApplyValSpecRule([[null, "textAnimator"]]),
    update_text_animator: aeApplyValSpecRule([[null, "textAnimator"]]),
    add_shape_item: aeApplyValSpecRule([[null, "shapeItem"]]),
    update_shape_item: aeApplyValSpecRule([[null, "shapeItem"]]),
    add_essential_property: aeApplyValSpecRule([["propertyPath", "str", 1, 1024], ["name", "str", 1, 256, 1]]),
    ensure_effect: aeApplyValRuleEnsureEffect,
    apply_preset: aeApplyValSpecRule([[null, "preset"]]),
    ensure_layer_style: aeApplyValSpecRule([[null, "layerStyle"]]),
    set_effect_control: aeApplyValSpecRule([["effectMatchName", "str", 0, AE_APPLY_VAL_ANY], [null, "effectControlPath"], ["value", "staticValue"]]),
    ensure_text_animator: aeApplyValSpecRule([["role", "eq", "text.opacity"], ["value", "num", 0, 100]]),
    set_text_document: aeApplyValSpecRule([[null, "textDocument"]]),
    set_expression: aeApplyValSpecRule([["propertyPath", "str", 1, 1024], ["source", "str", 0, 65536], ["enabled", "bool"]]),
    add_marker: aeApplyValSpecRule(AE_APPLY_VAL_MARKER_SPECS),
    update_marker: aeApplyValSpecRule(AE_APPLY_VAL_MARKER_SPECS),
    remove_marker: aeApplyValConfirmThenValidate([["time", "num", 0, 86400]]),
    animate_control: aeApplyValAnimateRule([["effectMatchName", "str", 0, AE_APPLY_VAL_ANY], ["propertyPath", "str", 0, AE_APPLY_VAL_ANY], [null,
      "animateControlPath"]]),
    animate_property: aeApplyValAnimateRule([["propertyPath", "str", 0, AE_APPLY_VAL_ANY], ["propertyPath", "notEffectPath"]]),
    set_layer_property: aeApplyValSpecRule([["role", "str", 0, AE_APPLY_VAL_ANY], [null, "nativeLayerProperty"], ["value", "jsonValue"]], "INVALID_TARGET"),
    set_layer_name: aeApplyValSpecRule([AE_APPLY_VAL_NAME]),
    create_layer: aeApplyValSpecRule([["layerId", "regex", AE_APPLY_VAL_NEW_ID], [null, "layerType"], [null, "layerSize"], AE_APPLY_VAL_NAME, [null,
      "layerBox"], ["vertical", "bool", 0, 0, 3], [null, "layerJustification"]]),
    duplicate_layer: aeApplyValSpecRule([["newLayerId", "newId"]]),
    remove_layer: aeApplyValConfirmThenValidate([]),
    reorder_layer: aeApplyValRuleReorder,
    set_track_matte: aeApplyValSpecRule([["matteLayerId", "str", 0, AE_APPLY_VAL_ANY, 2], ["mode", "enumOf", ["alpha", "alpha-inverted", "luma",
      "luma-inverted"]], ["showMatteLayer", "bool", 0, 0, 1]]),
    add_mask: aeApplyValSpecRule([["newMaskId", "newId"], AE_APPLY_VAL_NAME, ["values", "maskAdd", 0, 0, 1]]),
    update_mask: aeApplyValSpecRule([["maskId", "maskId"], ["values", "maskUpdate"]]),
    remove_mask: aeApplyValConfirmThenValidate([["maskId", "maskId"]]),
    create_shape_group: aeApplyValSpecRule([["newGroupId", "newId"], AE_APPLY_VAL_NAME]),
    set_shape_path: aeApplyValSpecRule([["groupId", "groupId"], ["path", "shapePath"]]),
    ensure_shape_fill: aeApplyValSpecRule(AE_APPLY_VAL_FILL_SPECS),
    ensure_shape_stroke: aeApplyValSpecRule(AE_APPLY_VAL_STROKE_SPECS),
    draw_vector_shapes: aeApplyValSpecRule([["shapes", "vectorShapes"]]),
    set_camera_options: aeApplyValOptionsRule([["zoom", "num", 1, 100000, 1], ["depthOfField", "bool", 0, 0, 1], ["focusDistance", "num", 0, 1000000,
      1], ["aperture", "num", 0.01, 10000, 1], ["blurLevel", "num", 0, 100, 1]]),
    set_light_options: aeApplyValOptionsRule([["intensity", "num", 0, 10000, 1], ["color", "color", 0, 0, 1], ["coneAngle", "num", 0, 180, 1],
      ["coneFeather", "num", 0, 100, 1], ["falloffType", "integer", 1, 3, 1], ["falloffStart", "num", 0, 1000000, 1], ["falloffDistance", "num", 0,
      1000000, 1], ["castsShadows", "bool", 0, 0, 1], ["shadowDarkness", "num", 0, 100, 1], ["shadowDiffusion", "num", 0, 500, 1]]),
    set_material_options: aeApplyValOptionsRule([["acceptsShadows", "bool", 0, 0, 1], ["castsShadows", "bool", 0, 0, 1], ["lightTransmission", "num",
      0, 100, 1], ["diffuse", "num", 0, 100, 1], ["specularIntensity", "num", 0, 100, 1], ["specularShininess", "num", 0, 100, 1], ["metal", "num", 0,
      100, 1]]),
    set_layer_timing: aeApplyValSpecRule([["stretch", "num", 1, 10000, 1], [null, "timingAny"]]),
    set_time_remap: aeApplyValSpecRule([["enabled", "bool"]]),
    detect_scene_edits: aeApplyValSpecRule([["mode", "enumOf", ["markers", "split", "split-precomp"]]]),
    set_audio: aeApplyValSpecRule([[null, "audio"]]),
    set_layer_parent: aeApplyValSpecRule([["parentLayerId", "str", 0, AE_APPLY_VAL_ANY, 2]]),
    set_layer_attribute: aeApplyValRuleLayerAttribute
};
