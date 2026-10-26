/* Apply: mask creation, binding and value writes. */
/* global aeApplyBoundedPath, aeApplyFindProperty, aeApplyMaskCount, aeApplyNativeShape, aeApplyValSpecsPass, aeApplyShapePathValid,
  aeApplyWritableProperty, aeNumberInRange, aeOwnValue, aeSafe, aeSafeGet, aeSafeProperty */
/* exported aeApplyAddMask, aeApplyMaskAt, aeApplyMaskIsNewPlaceholder, aeApplyMaskLayerKeyOf, aeApplyMaskLedger, aeApplyMaskNameOf,
  aeApplyMaskOrdinalId, aeApplyMaskOrdinalOf, aeApplyMaskPosition, aeApplyMaskReadback, aeApplyMaskValuesValid, aeApplyResolveMask */
function aeApplyMaskKeyAllowed(key) { return key === "path" || key === "opacity" || key === "feather" || key === "expansion" || key === "mode" || key === "inverted" || key === "rotoBezier"; }
var AE_APPLY_MASK_MODES = ["NONE", "ADD", "SUBTRACT", "INTERSECT", "LIGHTEN", "DARKEN", "DIFFERENCE"];
function aeApplyMaskModeValid(mode) { for (var i = 0; i < AE_APPLY_MASK_MODES.length; i += 1) if (AE_APPLY_MASK_MODES[i] === mode) return true; return false; }
function aeApplyMaskSettingsValid(values) { if (values.mode !== undefined && !aeApplyMaskModeValid(values.mode)) return false; return (values.inverted === undefined || typeof values.inverted === "boolean") && (values.rotoBezier === undefined || typeof values.rotoBezier === "boolean"); }
function aeApplyMaskKeyCount(values) {
    var count = 0;
    for (var key in values) { if (!values.hasOwnProperty(key) || !aeApplyMaskKeyAllowed(key)) return -1; count += 1; }
    return count;
}
var AE_APPLY_MASK_SPREAD_SPECS = [["feather", "pairRange", 0, 10000, 1], ["expansion", "num", -10000, 10000, 1]];
function aeApplyMaskSpreadValid(values) { return aeApplyValSpecsPass(values, AE_APPLY_MASK_SPREAD_SPECS); }
function aeApplyMaskOptionalValid(values) {
    if (values.path !== undefined && !aeApplyShapePathValid(values.path)) return false;
    if (!aeApplyMaskSettingsValid(values)) return false;
    if (values.opacity !== undefined && !aeNumberInRange(values.opacity, 0, 100)) return false;
    return aeApplyMaskSpreadValid(values);
}
/** True when the mask values object has at least the required keys and every given value is valid. */
function aeApplyMaskValuesValid(values, requireOne) {
    if (!values || typeof values !== "object" || values instanceof Array) return false;
    var count = aeApplyMaskKeyCount(values);
    if (count < 0 || (requireOne && count === 0)) return false;
    return aeApplyMaskOptionalValid(values);
}
function aeApplyMaskGroup(layer) { return aeApplyFindProperty(layer, "ADBE Mask Parade"); }
function aeApplyMaskByOrdinal(layer, ordinal) { var group = aeApplyMaskGroup(layer); if (!group) return null; var count = aeSafeGet(group, "numProperties", 0); if (ordinal < 1 || ordinal > count) return null; var mask = aeSafeProperty(group, ordinal); return (mask && String(aeSafeGet(mask, "matchName", "")) === "ADBE Mask Atom") ? mask : null; }
/** The mask for an id: a mask created in this plan, or a "mask:<n>" ordinal on the layer; otherwise null. */
function aeApplyResolveMask(layer, maskId, createdMasks) { var created = aeOwnValue(createdMasks, maskId); if (created) return created;
  var match = /^mask:([1-9][0-9]{0,2})$/.exec(String(maskId)); return match ? aeApplyMaskByOrdinal(layer, Number(match[1])) : null; }
function aeApplyMaskModeConstant(name) { if (typeof MaskMode === "undefined" || MaskMode[name] === undefined) throw new Error("MASK_UNSUPPORTED"); return MaskMode[name]; }
function aeApplyMaskSettings(mask, values) {
    try {
        if (values.mode !== undefined) mask.maskMode = aeApplyMaskModeConstant(values.mode);
        if (values.inverted !== undefined) mask.inverted = values.inverted;
        if (values.rotoBezier !== undefined) mask.rotoBezier = values.rotoBezier;
    } catch (maskSettingError) { throw new Error(String(maskSettingError.message) === "MASK_UNSUPPORTED" ? "MASK_UNSUPPORTED" : "PROPERTY_WRITE_FAILED"); }
}
function aeApplyMaskModeName(value) { if (typeof MaskMode === "undefined") return null; for (var i = 0; i < AE_APPLY_MASK_MODES.length; i += 1) if (MaskMode[AE_APPLY_MASK_MODES[i]] === value) return AE_APPLY_MASK_MODES[i]; return null; }
function aeApplyMaskValues(mask, values) { if (!values) return; aeApplyMaskSettings(mask, values); var bindings = { path: "ADBE Mask Shape", opacity: "ADBE Mask Opacity", feather: "ADBE Mask Feather", expansion: "ADBE Mask Offset" }; for (var key in bindings) if (values[key] !== undefined) { var property = aeApplyFindProperty(mask, bindings[key]), value = key === "path" ? aeApplyNativeShape(values[key]) : values[key]; if (!aeApplyWritableProperty(property, "setValue")) throw new Error("PROPERTY_NOT_SETTABLE"); try { property.setValue(value); } catch (maskWriteError) { throw new Error("PROPERTY_WRITE_FAILED"); } } }
/** Reads a mask back. Returns {name,path,opacity,feather,expansion,mode,...}, each null when unreadable. */
function aeApplyMaskReadback(mask) { var shapeProperty = aeApplyFindProperty(mask, "ADBE Mask Shape"), shape = shapeProperty ? aeSafeGet(shapeProperty, "value", null) : null; return { name: String(aeSafeGet(mask, "name", "")), path: shape ? aeApplyBoundedPath(shape, null) : null, opacity: aeSafe(function () { return aeApplyFindProperty(mask, "ADBE Mask Opacity").value; }, null), feather: aeSafe(function () { return aeApplyFindProperty(mask, "ADBE Mask Feather").value; }, null), expansion: aeSafe(function () { return aeApplyFindProperty(mask, "ADBE Mask Offset").value; }, null), mode: aeSafe(function () { return aeApplyMaskModeName(mask.maskMode); }, null), inverted: aeSafe(function () { return mask.inverted === true; }, null), rotoBezier: aeSafe(function () { return mask.rotoBezier === true; }, null) }; }
/** Adds a named mask and applies its values. Returns the new mask; throws Error(MASK_UNSUPPORTED or PROPERTY_WRITE_FAILED). */
function aeApplyAddMask(layer, operation, ledger) { var group = aeApplyMaskGroup(layer); if (!group || typeof group.addProperty !== "function") throw new Error("MASK_UNSUPPORTED"); var mask = aeSafe(function () { return group.addProperty("ADBE Mask Atom"); }, null); if (!mask || String(aeSafeGet(mask, "matchName", "")) !== "ADBE Mask Atom") throw new Error("MASK_UNSUPPORTED"); try { mask.name = operation.name; } catch (maskNameError) { throw new Error("PROPERTY_WRITE_FAILED"); } aeApplyMaskValues(mask, operation.values); ledger.push(String(operation.newMaskId)); return mask; }
// Live AE renumbers the mask parade on every add and remove, and that invalidates held Mask objects.
// Preflight binds each mask operation to a stable id; each step re-resolves its Mask from the live parade through the plan's ledger.
function aeApplyMaskOrdinalOf(maskId) { var match = /^mask:([1-9][0-9]{0,2})$/.exec(String(maskId)); return match ? Number(match[1]) : 0; }
/** True when the mask id is a "__new__:" placeholder. */
function aeApplyMaskIsNewPlaceholder(maskId) { return String(maskId).indexOf("__new__:") === 0; }
/** Ledger key "<compositionId>:<layerId>". */
function aeApplyMaskLayerKeyOf(compositionId, layerId) { return String(compositionId) + ":" + String(layerId); }
/** The mask's name as a string. */
function aeApplyMaskNameOf(mask) { return String(aeSafeGet(mask, "name", "")); }
/** Mask id "ordinal:<n>". */
function aeApplyMaskOrdinalId(ordinal) { return "ordinal:" + ordinal; }
// The plan's mask ids in parade order; seeded from the live parade before the plan's first mask write to the layer.
function aeApplyMaskLedger(run, operation, layer) { var key = aeApplyMaskLayerKeyOf(operation.compositionId, operation.layerId);
  if (!run.maskLedgers) run.maskLedgers = {}; if (!run.maskLedgers[key]) run.maskLedgers[key] = aeApplyMaskLedgerSeed(layer);
  return run.maskLedgers[key]; }
function aeApplyMaskLedgerSeed(layer) { var ids = [], count = aeApplyMaskCount(layer) || 0;
  for (var ordinal = 1; ordinal <= count; ordinal += 1) ids.push(aeApplyMaskOrdinalId(ordinal)); return ids; }
// The mask at a 0-based ledger position, read from the live parade; TARGET_NOT_FOUND when it is absent.
function aeApplyMaskAt(layer, position) { var mask = aeApplyMaskByOrdinal(layer, position + 1); if (!mask) throw new Error("TARGET_NOT_FOUND"); return mask; }
/** 0-based ledger position of the operation's bound mask; throws Error(TARGET_NOT_FOUND) when unbound. */
function aeApplyMaskPosition(run, operation, scope) { var ledger = aeApplyMaskLedger(run, operation, scope.layer), binding = run.maskBindings[scope.index]; for (var position = 0; position < ledger.length; position += 1) if (ledger[position] === binding) return position; throw new Error("TARGET_NOT_FOUND"); }
