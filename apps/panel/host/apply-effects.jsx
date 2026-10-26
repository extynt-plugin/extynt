/* Apply: presets, layer styles, effect creation and effect control writes. It sits under apply-flow.jsx, which
 * dispatches the effect operations here.
 */
/* global aeAllFinite, aeApplyEffectPathValid, aeApplyFindLayer, aeApplyFindProperty, aeApplyIsAbsolutePath, aeApplyIsRecordValue,
   aeApplyRememberSelection, aeApplyResolvedControlPath, aeApplyResolvedEffectPath, aeApplyViewerMoved, aeEncodePathSegment, aeErrorTextShort, aeHasOwn,
   aeHostDirectory, aeIsArray, aeIsFiniteNumber, aeSafe, aeSafeGet, aeSafeLayer, aeSafeProperty */
/* exported AE_LAYER_STYLES_INERT, aeApplyEnsureEffect, aeApplyEnsureLayerStyle, aeApplyLayerStyleCommandsLive, aeApplyLayerStyleNeedsCommand,
   aeApplyPresetFilePath, aeApplyPresetToLayer, aeApplyValidLayerStyleOperation, aeApplyValidPresetOperation, aeApplyViewerMoved */
var HOST_LAYER_STYLES = { "drop-shadow": { matchName: "dropShadow/enabled", commandId: 9000 }, "inner-shadow": { matchName: "innerShadow/enabled",
  commandId: 9001 }, "outer-glow": { matchName: "outerGlow/enabled", commandId: 9002 }, "inner-glow": { matchName: "innerGlow/enabled",
  commandId: 9003 }, "bevel-emboss": { matchName: "bevelEmboss/enabled", commandId: 9004 }, "satin": { matchName: "chromeFX/enabled",
  commandId: 9005 }, "color-overlay": { matchName: "solidFill/enabled", commandId: 9006 }, "gradient-overlay": { matchName: "gradientFill/enabled",
  commandId: 9007 }, "stroke": { matchName: "frameFX/enabled", commandId: 9008 } };
function aeApplyPresetNameRefused(name) { return typeof name !== "string" || name.length > 200 || name.slice(-4).toLowerCase() !== ".ffx"
  || name.indexOf("..") >= 0 || name.charAt(0) === "/" || name.indexOf("\\") >= 0; }
function aeApplyPresetFileName(name) {
    if (aeApplyPresetNameRefused(name)) return false;
    var parts = name.split("/");
    if (parts.length > 3) return false;
    for (var i = 0; i < parts.length; i += 1) {if ((parts[i].length < 5
      && i === parts.length - 1) ? false : !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(parts[i])) return false;}
    return true;
}
/**
 * Absolute path of the operation's preset: the bundled presetFile under the host directory, else presetPath. A
 * presetFile is a short relative name inside the host library, never a path out of it.
 */
function aeApplyPresetFilePath(operation) {
  return typeof operation.presetFile === "string" ? aeHostDirectory + "/" + operation.presetFile : operation.presetPath; }
/** True when a preset operation names exactly one valid preset source. */
function aeApplyValidPresetOperation(operation) {
    if (operation.presetFile !== undefined) {return operation.presetId === undefined && operation.presetPath === undefined
      && aeApplyPresetFileName(operation.presetFile);}
    var path = operation.presetPath;
    return typeof operation.presetId === "string" && /^preset:(ae-presets|user-presets):[0-9a-f]{20}$/.test(operation.presetId)
      && aeApplyIsAbsolutePath(path) && path.length <= 4096 && String(path).slice(-4).toLowerCase() === ".ffx";
}
function aeApplyLayerStyleHeadValid(operation, spec) { return !!spec && operation.styleMatchName === spec.matchName
  && operation.commandId === spec.commandId && typeof operation.enabled === "boolean"; }
function aeApplyLayerStyleValueKeyValid(values, key, prefix, spec) { return key.indexOf(prefix) === 0 && key.length <= 96 && key !== spec.matchName
  && aeApplyValidStaticControlValue(values[key]); }
function aeApplyLayerStyleValuesValid(operation, spec) {
    if (!aeApplyIsRecordValue(operation.values) || operation.enabled !== true) return false;
    var prefix = spec.matchName.split("/")[0] + "/", count = 0;
    for (var key in operation.values) { if (!aeHasOwn(operation.values, key)) continue; count += 1;
      if (!aeApplyLayerStyleValueKeyValid(operation.values, key, prefix, spec)) return false; }
    return count > 0 && count <= 16;
}
/** True when a layer style operation has a known style and valid values. */
function aeApplyValidLayerStyleOperation(operation) {
    var spec = (typeof operation.style === "string" && aeHasOwn(HOST_LAYER_STYLES, operation.style)) ? HOST_LAYER_STYLES[operation.style] : null;
    if (!aeApplyLayerStyleHeadValid(operation, spec)) return false;
    if (operation.values === undefined) return true;
    return aeApplyLayerStyleValuesValid(operation, spec);
}
function aeApplyValidStaticControlValue(value) {
    if (typeof value === "boolean") return true;
    if (typeof value === "number") return isFinite(value);
    return aeIsArray(value) && value.length >= 2 && value.length <= 4 && aeAllFinite(value);
}
/** The refusal message for a Layer Style write on a host whose menu commands are unavailable. */
var AE_LAYER_STYLES_INERT = "LAYER_STYLES_UNSUPPORTED: Layer Style menu commands are not available in this After Effects session. Use ensure_effect instead: ADBE Glo2 for a glow, ADBE Drop Shadow for a drop shadow, ADBE Stroke or ADBE Fill for an outline or overlay.";
/**
 * True when the layer style menu commands resolve to the expected command ids. Layer Style menu commands act only once
 * the Layer menu has been built in the UI; before that executeCommand is a silent no-op.
 */
function aeApplyLayerStyleCommandsLive() { return aeSafe(function () { return app.findMenuCommandId("Outer Glow"); },
  0) === HOST_LAYER_STYLES["outer-glow"].commandId; }
// Turning a style on that the layer does not have yet (or a layer this plan creates) takes the menu command.
function aeApplyLayerStyleNeedsCommand(layer, operation) {
    if (operation.enabled !== true) return false;
    var style = layer ? aeApplyLayerStyleProperty(layer, operation.styleMatchName) : null;
    return !(style && aeSafeGet(style, "canSetEnabled", false) === true);
}
function aeApplyLayerStyleProperty(layer, styleMatchName) {
    var group = aeApplyFindProperty(layer, "ADBE Layer Styles"), count = group ? aeSafeGet(group, "numProperties", 0) : 0;
    for (var i = 1; i <= count; i += 1) { var candidate = aeSafeProperty(group, i); if (candidate && String(aeSafeGet(candidate, "matchName",
      "")) === styleMatchName) return candidate; }
    return null;
}
function aeApplyViewerShows(compId) {
    var active = aeSafe(function () { return app.project.activeItem; }, null);
    return !!active && String(aeSafeGet(active, "id", "")) === compId;
}
function aeApplyOpenInViewer(comp) {
    var compId = String(aeSafeGet(comp, "id", ""));
    if (aeApplyViewerShows(compId)) return;
    try { comp.openInViewer(); } catch (viewerError) { throw new Error("VIEWER_UNAVAILABLE"); }
    aeApplyViewerMoved = true;
    if (!aeApplyViewerShows(compId)) throw new Error("VIEWER_UNAVAILABLE");
}
function aeApplySelectOnlyLayer(comp, layer) {
    var layerId = String(aeSafeGet(layer, "id", "")), count = aeSafeGet(comp, "numLayers", 0);
    for (var i = 1; i <= count; i += 1) {
        var candidate = aeSafeLayer(comp, i);
        if (!candidate) continue;
        var want = String(aeSafeGet(candidate, "id", "")) === layerId;
        if (aeSafeGet(candidate, "selected", !want) !== want) try { candidate.selected = want; } catch (ignoredSelect) {}
    }
}
function aeApplyIsolateLayerInViewer(comp, layer) {
    aeApplyOpenInViewer(comp);
    aeApplyRememberSelection(comp);
    aeApplySelectOnlyLayer(comp, layer);
}
function aeApplyIsLeafProperty(child) {
    if (typeof PropertyType === "undefined") return aeSafeGet(child, "numProperties", 0) === 0;
    return aeSafe(function () { return child.propertyType === PropertyType.PROPERTY; }, false);
}
function aeApplyLayerStructure(layer) {
    var result = { effects: [], animators: 0, keyed: 0, expressions: 0 }, visited = 0;
    var parade = aeApplyFindProperty(layer, "ADBE Effect Parade"), effectCount = parade ? aeSafeGet(parade, "numProperties", 0) : 0;
    for (var e = 1; e <= effectCount && result.effects.length < 64; e += 1) {result.effects.push(String(aeSafe(function () {
      return parade.property(e).matchName; }, "")));}
    var animators = aeApplyFindProperty(layer, "ADBE Text Properties/ADBE Text Animators"); result.animators = animators ? aeSafeGet(animators,
      "numProperties", 0) : 0;
    function walk(group, depth) {
        var count = aeSafeGet(group, "numProperties", 0);
        for (var i = 1; i <= count && visited < 4000; i += 1) {
            var child = aeSafeProperty(group, i); if (!child) continue; visited += 1;
            if (aeApplyIsLeafProperty(child)) { if (aeSafeGet(child, "numKeys", 0) > 0) result.keyed += 1; if (aeSafeGet(child, "expressionEnabled",
              false)) result.expressions += 1; }
            else if (depth < 8) walk(child, depth + 1);
        }
    }
    walk(layer, 0);
    return result;
}
function aeApplyStructureDelta(before, after) {
    var added = [], remaining = before.effects.slice(0);
    for (var i = 0; i < after.effects.length; i += 1) { var found = -1;
      for (var j = 0; j < remaining.length; j += 1) {if (remaining[j] === after.effects[i]) { found = j; break;
      }} if (found >= 0) remaining.splice(found, 1); else added.push(after.effects[i]); }
    return { effects: added, animators: after.animators - before.animators, keyed: after.keyed - before.keyed,
      expressions: after.expressions - before.expressions };
}
function aeApplyStructureChanged(before, after, added, layersAdded) { return added.effects.length > 0 || added.animators !== 0 || added.keyed !== 0
  || added.expressions !== 0 || layersAdded !== 0 || after.effects.length !== before.effects.length; }
/**
 * Applies an .ffx preset to the layer. Returns {after,added,changed}. Acts on the active viewer's selected layers, so
 * the target composition is opened and only the target layer selected.
 */
function aeApplyPresetToLayer(comp, layer, operation) {
    var file = new File(aeApplyPresetFilePath(operation));
      if (!file.exists) throw new Error("PRESET_NOT_FOUND: " + (typeof operation.presetFile === "string" ? operation.presetFile + " is not in the extynt host library." : "the preset file is gone."));
    var layerId = String(aeSafeGet(layer, "id", "")), layersBefore = aeSafeGet(comp, "numLayers", 0), before = aeApplyLayerStructure(layer);
    aeApplyIsolateLayerInViewer(comp, layer);
    try { layer.applyPreset(file); } catch (presetError) { throw new Error("PRESET_APPLY_FAILED: " + aeErrorTextShort(presetError)); }
    var current = aeApplyFindLayer(comp, layerId) || layer, after = aeApplyLayerStructure(current), added = aeApplyStructureDelta(before, after),
      layersAdded = aeSafeGet(comp, "numLayers", layersBefore) - layersBefore;
    var changed = aeApplyStructureChanged(before, after, added, layersAdded);
    if (layersAdded) added.layers = layersAdded;
    return { after: after, added: added, changed: changed };
}
function aeApplyToggleLayerStyle(style, operation) {
    if (aeSafeGet(style, "enabled", null) !== operation.enabled) { try { style.enabled = operation.enabled; } catch (styleError) {
      throw new Error("LAYER_STYLE_WRITE_FAILED"); } }
    return { created: false, enabled: aeSafeGet(style, "enabled", null), values: operation.enabled ? aeApplyWriteLayerStyleValues(style,
      operation) : undefined };
}
function aeApplyRunLayerStyleCommand(comp, layer, spec) {
    if (!aeApplyLayerStyleCommandsLive()) throw new Error(AE_LAYER_STYLES_INERT);
    aeApplyIsolateLayerInViewer(comp, layer);
    try { app.executeCommand(spec.commandId); } catch (commandError) { throw new Error("LAYER_STYLE_WRITE_FAILED"); }
}
/**
 * Enables or creates a layer style. Returns {created,enabled[,values]}, `values` holding each written control read back.
 * Each value key is addressed as a property-tree segment spelled by aeEncodePathSegment ("%", "/" and "#" escaped), the spelling aeApplyFindProperty
  * compares against, so a key containing "#" is never taken for an ordinal.
 */
function aeApplyEnsureLayerStyle(comp, layer, operation) {
    var spec = HOST_LAYER_STYLES[operation.style], style = aeApplyLayerStyleProperty(layer, spec.matchName);
    if (!style) throw new Error("LAYER_STYLES_UNSUPPORTED");
    if (aeSafeGet(style, "canSetEnabled", false) === true) return aeApplyToggleLayerStyle(style, operation);
    if (!operation.enabled) return { created: false, enabled: false };
    var layerId = String(aeSafeGet(layer, "id", ""));
    aeApplyRunLayerStyleCommand(comp, layer, spec);
    var added = aeApplyLayerStyleProperty(aeApplyFindLayer(comp, layerId) || layer, spec.matchName);
    if (!added || aeSafeGet(added, "enabled", false) !== true) throw new Error("LAYER_STYLE_NOT_ADDED");
    return { created: true, enabled: true, values: aeApplyWriteLayerStyleValues(added, operation) };
}
function aeApplyWriteLayerStyleValues(style, operation) {
    if (!operation.values) return undefined;
    var written = {};
    for (var key in operation.values) {
        if (!aeHasOwn(operation.values, key)) continue;
        var setting = aeApplyFindProperty(style, aeEncodePathSegment(key));
        if (!setting) throw new Error("PROPERTY_NOT_FOUND: " + key);
        written[key] = aeApplySetEffectControl(style, { propertyPath: aeEncodePathSegment(key), value: operation.values[key] });
    }
    return written;
}
function aeApplyAssertControlSettable(property) {
    if (typeof PropertyType !== "undefined" && aeSafe(function () { return property.propertyType !== PropertyType.PROPERTY; },
      false)) throw new Error("PROPERTY_NOT_SETTABLE");
    if (typeof PropertyValueType !== "undefined" && aeSafe(function () { return property.propertyValueType === PropertyValueType.NO_VALUE; },
      false)) throw new Error("PROPERTY_NOT_SETTABLE");
}
function aeApplyControlWriteValue(value, current) {
    if (typeof value === "boolean") value = value ? 1 : 0;
    if (aeIsArray(value) && value.length === 3 && aeIsArray(current) && current.length === 4) value = [value[0], value[1], value[2], 1];
    return value;
}
function aeApplyControlReadBack(property) {
    var written = aeSafeGet(property, "value", null);
    if (typeof written === "number" || typeof written === "boolean") return written;
    if (aeIsArray(written)) { var copy = []; for (var w = 0; w < written.length
      && w < 4; w += 1) copy.push(typeof written[w] === "number" ? written[w] : null); return copy; }
    return null;
}
function aeApplySetEffectControl(layer, operation) {
    var property = aeApplyFindProperty(layer, aeApplyResolvedControlPath(operation)); if (!property) throw new Error("PROPERTY_NOT_FOUND");
    var keys = aeSafeGet(property, "numKeys", 0);
      if (keys > 0) throw new Error("CONFLICTING_KEYS: " + operation.propertyPath + " has " + keys + " keyframe(s); use animate_control.");
    aeApplyAssertControlSettable(property);
    var current = aeSafeGet(property, "value", null), value = aeApplyControlWriteValue(operation.value, current);
    try { property.setValue(value); } catch (writeError) { throw new Error("PROPERTY_WRITE_FAILED: " + aeErrorTextShort(writeError)); }
    return aeApplyControlReadBack(property);
}
var EFFECT_DEFAULT_CONTROLS = { "ADBE Gaussian Blur 2": [{ matchName: "ADBE Gaussian Blur 2-0003", value: false }] };
function aeApplyHoldsValue(now, value) {
    if (now === value) return true;
    if (typeof now === "number" && typeof value === "boolean") return now === (value ? 1 : 0);
    return typeof now === "boolean" && typeof value === "number" && now === (value !== 0);
}
function aeApplyDefaultWritten(control, value) {
    if (aeSafe(function () { control.setValue(value); return true; }, false) !== true) return false;
    return aeApplyHoldsValue(aeSafeGet(control, "value", null), value);
}
function aeApplyNumericDefault(value) { return value === true ? 1 : (value === false ? 0 : value); }
function aeApplyApplyEffectDefault(effect, wanted) {
    var control = aeApplyFindProperty(effect, wanted.matchName);
    if (!control) return { matchName: wanted.matchName, state: "control-not-found" };
    if (aeSafe(function () { return control.canSetValue === false; }, false) === true) return { matchName: wanted.matchName, state: "cannot-set" };
    var wrote = aeApplyDefaultWritten(control, wanted.value) || aeApplyDefaultWritten(control, aeApplyNumericDefault(wanted.value));
    var now = aeSafeGet(control, "value", null);
    return { matchName: wanted.matchName, state: wrote ? "written" : "write-failed", value: (now === true || now === false
      || typeof now === "number") ? now : null };
}
function aeApplyEffectDefaults(effect, effectMatchName) {
    var defaults = EFFECT_DEFAULT_CONTROLS.hasOwnProperty(effectMatchName) ? EFFECT_DEFAULT_CONTROLS[effectMatchName] : null, applied = [];
    if (!defaults) return applied;
    for (var i = 0; i < defaults.length; i += 1) applied.push(aeApplyApplyEffectDefault(effect, defaults[i]));
    return applied;
}
function aeApplyFindExistingEffect(layer, operation) {
    var effect = aeApplyFindProperty(layer, aeApplyResolvedEffectPath(operation));
    return (effect && String(aeSafeGet(effect, "matchName", "")) !== operation.effectMatchName) ? null : effect;
}
var EFFECT_DIALOG_MATCH_NAMES = { "ADBE Apply Color LUT": true, "ADBE Apply Color LUT2": true, "ADBE Basic Text2": true, "ADBE Numbers2": true,
  "ADBE Path Text": true };
var EFFECT_DIALOG_WAIT_MS = 1500;
function aeApplyAddWasCancelled(effectMatchName, startedAt) {
    return EFFECT_DIALOG_MATCH_NAMES.hasOwnProperty(effectMatchName) || (new Date().getTime() - startedAt) >= EFFECT_DIALOG_WAIT_MS;
}
function aeApplyAddEffect(parade, effectMatchName) {
    if (!aeSafe(function () { return parade.canAddProperty(effectMatchName); }, false)) return null;
    var startedAt = new Date().getTime();
    var effect = aeSafe(function () { return parade.addProperty(effectMatchName); }, null);
    if (!effect && aeApplyAddWasCancelled(effectMatchName,
      startedAt)) throw new Error("EFFECT_DIALOG_CANCELLED: After Effects asked for input when this effect was added and the dialog was cancelled, so the effect was not added.");
    return (!effect || String(aeSafeGet(effect, "matchName", "")) !== effectMatchName) ? null : effect;
}
var AE_EFFECT_CONTROL_LIMIT = 40, AE_EFFECT_ROW_LIMIT = 80, AE_EFFECT_GROUP_DEPTH = 3;
function aeApplyValueTypeName(property) {
    if (typeof PropertyValueType === "undefined") return null;
    var type = aeSafeGet(property, "propertyValueType", null);
    for (var key in PropertyValueType) if (PropertyValueType.hasOwnProperty(key) && PropertyValueType[key] === type) return key;
    return null;
}
function aeApplyFiniteVector(value) {
    if (!(value instanceof Array) || value.length < 1 || value.length > 4 || !aeAllFinite(value)) return null;
    return value.slice(0);
}
function aeApplyEffectControlValue(property) {
    var value = aeSafeGet(property, "value", null);
    if (aeIsFiniteNumber(value)) return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    return aeApplyFiniteVector(value);
}
function aeApplyEffectBound(property, flag, limit) {
    if (!aeSafe(function () { return property[flag] === true; }, false)) return null;
    var bound = aeSafe(function () { return property[limit]; }, null);
    return aeIsFiniteNumber(bound) ? bound : null;
}
function aeApplyEffectMenu(property) {
    if (!aeSafe(function () { return property.isDropdownEffect === true; }, false)) return null;
    var items = aeSafeGet(property, "propertyParameters", null), list = [];
    if (!items || typeof items.length !== "number") return null;
    for (var k = 0; k < items.length && k < AE_EFFECT_CONTROL_LIMIT; k += 1) list.push(String(items[k]).slice(0, 80));
    return list;
}
function aeApplyEffectControlRow(property, matchName, name) {
    var row = { m: matchName, n: name, t: aeApplyValueTypeName(property), v: aeApplyEffectControlValue(property) };
    var min = aeApplyEffectBound(property, "hasMin", "minValue"), max = aeApplyEffectBound(property, "hasMax", "maxValue"), menu = aeApplyEffectMenu(property);
    if (min !== null) row.min = min;
    if (max !== null) row.max = max;
    if (menu) { row.dd = true; row.items = menu; }
    return row;
}
function aeApplyIsGroupProperty(child, childCount) {
    if (typeof PropertyType === "undefined") return childCount > 0;
    return aeSafe(function () { return child.propertyType !== PropertyType.PROPERTY; }, childCount > 0);
}
function aeApplyWalkEffectControls(group, depth, state) {
    var count = aeSafeGet(group, "numProperties", 0);
    for (var i = 1; i <= count && state.leaves < AE_EFFECT_CONTROL_LIMIT && state.rows.length < AE_EFFECT_ROW_LIMIT; i += 1) {
        var child = aeSafeProperty(group, i); if (!child) continue;
        var matchName = String(aeSafeGet(child, "matchName", "")), name = String(aeSafeGet(child, "name", matchName)).slice(0, 80);
        var children = aeSafeGet(child, "numProperties", 0), isGroup = aeApplyIsGroupProperty(child, children);
        if (!isGroup) { state.rows.push(aeApplyEffectControlRow(child, matchName, name)); state.leaves += 1; continue; }
        var open = depth < AE_EFFECT_GROUP_DEPTH;
        state.rows.push({ m: matchName, n: name, g: open ? children : 0 });
        if (open) aeApplyWalkEffectControls(child, depth + 1, state);
    }
}
function aeApplyReadEffectControls(effect) {
    var state = { rows: [], leaves: 0 };
    aeSafe(function () { aeApplyWalkEffectControls(effect, 0, state); return true; }, false);
    return state.rows;
}
function aeApplyWriteEffectEnabled(effect, enabled) {
    if (enabled === undefined) return;
    try { effect.enabled = enabled; } catch (enabledError) { throw new Error("EFFECT_STATE_WRITE_FAILED"); }
}
/**
 * The effect on the layer, added when missing. Returns {property,created,defaults,controls}, or null when the effect
 * cannot be added. Controls it sets on creation only (Repeat Edge Pixels off on a blur) never rewrite a control on an
 * effect that already exists, and a later set_effect_control in the same plan wins; each write counts only if the
 * control then holds the value.
 */
function aeApplyEnsureEffect(layer, operation) {
    if (typeof operation.effectMatchName !== "string" || !aeApplyEffectPathValid(operation)) throw new Error("INVALID_TARGET");
    var parade = aeApplyFindProperty(layer, "ADBE Effect Parade"); if (!parade) return null;
    var effect = aeApplyFindExistingEffect(layer, operation), created = false;
    if (!effect) { effect = aeApplyAddEffect(parade, operation.effectMatchName); if (!effect) return null; created = true; }
    aeApplyWriteEffectEnabled(effect, operation.enabled);
    var defaults = created ? aeApplyEffectDefaults(effect, operation.effectMatchName) : [];
    return { property: effect, created: created, defaults: defaults, controls: created ? aeApplyReadEffectControls(effect) : [] };
}
