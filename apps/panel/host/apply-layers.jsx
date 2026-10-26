/* Apply: native layer properties, camera/light/material options, layer creation and ordering, track mattes and
 * switches. It sits under apply-flow.jsx, which dispatches the layer operations here.
 */
/* global AE_GLOBAL, aeApplyCreatedComps, aeApplyCreatedItems, aeApplyFindComp, aeApplyFindItem, aeApplyFindLayer, aeApplyFindProperty, aeApplyIsFolder,
   aeApplyReadState, aeApplyVisibleWritableProperty, aeApplyWritableProperty, aeErrorText, aeErrorTextShort, aeHasOwn, aeListHas, aeOwnValue, aeSafe,
   aeSafeGet, aeTextEnumNumber */
/* exported aeApplyCompositionReadBack, aeApplyCreateLayer, aeApplyDuplicateLayer, aeApplyLayerSwitchValid, aeApplyRendererListed, aeApplyRendererNames,
   aeApplyReorderLayer, aeApplySetCameraOptions, aeApplySetCompositionSettings, aeApplySetLayerSwitch, aeApplySetLightOptions, aeApplySetMaterialOptions,
   aeApplySetTimeRemap, aeApplySetTrackMatte, aeApplyWriteNativeLayerProperty */
function aeApplyNativeLayerProperty(operation) { var allowed = { "transform.opacity": "ADBE Transform Group/ADBE Opacity",
  "transform.scale": "ADBE Transform Group/ADBE Scale", "transform.rotation": "ADBE Transform Group/ADBE Rotate Z",
  "transform.position": "ADBE Transform Group/ADBE Position", "transform.anchor": "ADBE Transform Group/ADBE Anchor Point" };
  return typeof operation.role === "string" && allowed[operation.role] === operation.propertyPath; }
function aeApplyCheckSeparatedValue(value) {
    if (!(value instanceof Array) || (value.length !== 2 && value.length !== 3)) throw new Error("SEPARATED_POSITION_VALUE_INVALID");
    for (var valueIndex = 0; valueIndex < value.length; valueIndex += 1) {if (typeof value[valueIndex] !== "number"
      || !isFinite(value[valueIndex])) throw new Error("SEPARATED_POSITION_VALUE_INVALID");}
}
function aeApplyPositionFollowers(transform) {
    var followers = [], third;
    followers.push(aeApplyFindProperty(transform, "ADBE Position_0"));
    followers.push(aeApplyFindProperty(transform, "ADBE Position_1"));
    third = aeApplyFindProperty(transform, "ADBE Position_2");
    if (third) followers.push(third);
    return followers;
}
function aeApplySeparatedPositionFollowers(layer, position, value) {
    if (!aeSafe(function () { return position.dimensionsSeparated === true; }, false)) return null;
    aeApplyCheckSeparatedValue(value);
    var transform = aeApplyFindProperty(layer, "ADBE Transform Group");
    if (!transform) throw new Error("SEPARATED_POSITION_FOLLOWER_MISSING");
    var followers = aeApplyPositionFollowers(transform);
    if (value.length !== followers.length) throw new Error("SEPARATED_POSITION_VALUE_INVALID");
    for (var followerIndex = 0; followerIndex < followers.length; followerIndex += 1) {if (!aeApplyVisibleWritableProperty(followers[followerIndex],
      "setValue")) throw new Error("SEPARATED_POSITION_FOLLOWER_MISSING");}
    return followers;
}
function aeApplyValidateNativeLayerPropertyWrite(layer, operation, property) {
    if (!aeApplyNativeLayerProperty(operation) || !aeApplyWritableProperty(property, "setValue")) throw new Error("PROPERTY_NOT_SETTABLE");
    if (operation.role === "transform.position") return aeApplySeparatedPositionFollowers(layer, property, operation.value);
    return null;
}
/**
 * Writes a native layer property. Returns {before,after,separatedDimensions}. Separated dimensions are handled for
 * Position only: the separation leader is never written, only its documented followers, and a split Anchor Point fails
 * loudly with PROPERTY_WRITE_FAILED.
 */
function aeApplyWriteNativeLayerProperty(layer, operation, property) {
    var followers = aeApplyValidateNativeLayerPropertyWrite(layer, operation, property), before = aeApplyReadState(property), after;
    if (before.numKeys > 0) throw new Error("CONFLICTING_KEYS: " + operation.propertyPath + " has " + before.numKeys + " keyframe(s); a static value would be refused.");
    if (followers) {
        try {
          for (var followerIndex = 0; followerIndex < followers.length; followerIndex += 1) followers[followerIndex].setValue(operation.value[followerIndex]);
          } catch (separatedWriteError) { throw new Error("PROPERTY_WRITE_FAILED: " + aeErrorTextShort(separatedWriteError)); }
        after = { value: operation.value, numKeys: before.numKeys, separatedDimensions: true };
    } else {
        try { property.setValue(operation.value); } catch (layerPropertyError) { throw new Error("PROPERTY_WRITE_FAILED"); }
        after = aeApplyReadState(property);
    }
    return { before: before, after: after, separatedDimensions: !!followers };
}
function aeApplyResolveExactOption(group, groupPath, bindings, key) {
    var matchName = bindings[key], property = matchName ? aeApplyFindProperty(group, matchName) : null;
    if (!property || !aeApplyWritableProperty(property, "setValue") || aeSafe(function () { return property.isHidden === true; },
      false)) throw new Error("THREED_OPTIONS_UNSUPPORTED: " + groupPath + "/" + String(matchName || key) + " is not available on this layer.");
    return { key: key, matchName: matchName, property: property };
}
function aeApplyWriteExactOption(groupPath, resolved, value) {
    try { resolved.property.setValue(value); } catch (threeDWriteError) {
        var threeDMessage = String((threeDWriteError && threeDWriteError.message) ? threeDWriteError.message : threeDWriteError);
        if (threeDMessage.indexOf("hidden") >= 0) throw new Error("THREED_OPTIONS_UNSUPPORTED: " + groupPath + "/" + resolved.matchName + " is hidden on this layer (it needs a different layer type or 3D enabled).");
        throw new Error("PROPERTY_WRITE_FAILED: " + groupPath + "/" + resolved.matchName + ": " + aeErrorTextShort(threeDWriteError));
    }
}
function aeApplyWriteExactOptions(layer, groupPath, bindings, options) {
    var group = aeApplyFindProperty(layer, groupPath), resolved = [], key;
    if (!group) throw new Error("THREED_OPTIONS_UNSUPPORTED: " + groupPath + " was not available on this layer.");
    for (key in options) resolved.push(aeApplyResolveExactOption(group, groupPath, bindings, key));
    for (var r = 0; r < resolved.length; r += 1) aeApplyWriteExactOption(groupPath, resolved[r], options[resolved[r].key]);
}
/** Writes the camera options group fields the operation names. Returns nothing; throws on a failed write. */
function aeApplySetCameraOptions(layer, operation) { aeApplyWriteExactOptions(layer, "ADBE Camera Options Group", { zoom: "ADBE Camera Zoom",
  depthOfField: "ADBE Camera Depth of Field", focusDistance: "ADBE Camera Focus Distance", aperture: "ADBE Camera Aperture",
  blurLevel: "ADBE Camera Blur Level" }, operation.options); }
/** Writes the light options group fields the operation names. Returns nothing; throws on a failed write. */
function aeApplySetLightOptions(layer, operation) { aeApplyWriteExactOptions(layer, "ADBE Light Options Group", { intensity: "ADBE Light Intensity",
  color: "ADBE Light Color", coneAngle: "ADBE Light Cone Angle", coneFeather: "ADBE Light Cone Feather 2", falloffType: "ADBE Light Falloff Type",
  falloffStart: "ADBE Light Falloff Start", falloffDistance: "ADBE Light Falloff Distance", castsShadows: "ADBE Casts Shadows",
  shadowDarkness: "ADBE Light Shadow Darkness", shadowDiffusion: "ADBE Light Shadow Diffusion" }, operation.options); }
/** Writes the material options group fields the operation names. Returns nothing; throws on a failed write. */
function aeApplySetMaterialOptions(layer, operation) { aeApplyWriteExactOptions(layer, "ADBE Material Options Group", {
  acceptsShadows: "ADBE Accepts Shadows", castsShadows: "ADBE Casts Shadows", lightTransmission: "ADBE Light Transmission",
  diffuse: "ADBE Diffuse Coefficient", specularIntensity: "ADBE Specular Coefficient", specularShininess: "ADBE Shininess Coefficient",
  metal: "ADBE Metal Coefficient" }, operation.options); }
var AE_APPLY_COMPOSITION_FIELDS = [
    { requestKey: "width", hostKey: "width" }, { requestKey: "height", hostKey: "height" },
    { requestKey: "pixelAspect", hostKey: "pixelAspect" }, { requestKey: "durationSeconds", hostKey: "duration" },
    { requestKey: "frameRate", hostKey: "frameRate" }, { requestKey: "backgroundColor", hostKey: "bgColor" }
];
var AE_APPLY_COMPOSITION_TIMELINE_FIELDS = [
    { requestKey: "motionBlur", hostKey: "motionBlur" }, { requestKey: "shutterAngle", hostKey: "shutterAngle" }, { requestKey: "shutterPhase",
      hostKey: "shutterPhase" },
    { requestKey: "motionBlurSamplesPerFrame", hostKey: "motionBlurSamplesPerFrame" }, { requestKey: "motionBlurAdaptiveSampleLimit",
      hostKey: "motionBlurAdaptiveSampleLimit" },
    { requestKey: "frameBlending", hostKey: "frameBlending" }, { requestKey: "draft3d", hostKey: "draft3d" }
];
// The renderer names this composition lists; the host never assumes a fixed set.
function aeApplyRendererNames(comp) {
    var listed = aeSafeGet(comp, "renderers", null), names = [], index;
    if (listed) for (index = 0; index < listed.length; index += 1) names.push(String(listed[index]));
    return names;
}
/** True when the composition's renderer list includes the name. */
function aeApplyRendererListed(comp, name) { return aeListHas(aeApplyRendererNames(comp), name); }
function aeApplyWriteCompositionField(comp, field, settings) {
    if (settings[field.requestKey] === undefined) return;
    try { comp[field.hostKey] = settings[field.requestKey]; }
    catch (compositionSettingsError) { throw new Error("COMPOSITION_WRITE_FAILED: " + field.requestKey + ": " + aeErrorTextShort(compositionSettingsError)); }
    if ((field.requestKey === "draft3d" || field.requestKey === "frameBlending") && aeSafe(function () { return comp[field.hostKey]; },
      undefined) !== settings[field.requestKey]) throw new Error("COMPOSITION_WRITE_FAILED: " + field.requestKey + " did not take " + String(settings[field.requestKey]) + (field.requestKey === "draft3d" ? "; After Effects ignores script writes to Draft 3D, so switch it in the Timeline panel." : "."));
}
function aeApplyWriteCompositionFields(comp, fields, settings) {
    for (var fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) aeApplyWriteCompositionField(comp, fields[fieldIndex], settings);
}
function aeApplySetWorkArea(comp, settings) {
    var startField = { requestKey: "workAreaStart", hostKey: "workAreaStart" }, lengthField = { requestKey: "workAreaDuration", hostKey: "workAreaDuration" };
    var movesRight = settings.workAreaStart !== undefined && settings.workAreaStart > aeSafeGet(comp, "workAreaStart", 0);
    var order = movesRight ? [lengthField, startField] : [startField, lengthField];
    aeApplyWriteCompositionFields(comp, order, settings);
}
function aeApplySetRenderer(comp, settings) {
    if (settings.renderer === undefined) return;
    if (!aeApplyRendererListed(comp,
      settings.renderer)) throw new Error("INVALID_VALUE: renderer " + String(settings.renderer) + " is not in this composition's renderers (" + aeApplyRendererNames(comp).join(", ") + ").");
    aeApplyWriteCompositionField(comp, { requestKey: "renderer", hostKey: "renderer" }, settings);
}
/**
 * Writes the composition settings fields. Returns nothing; throws on a refused or failed write. Every option is
 * resolved before anything is written, so an unsupported one refuses the operation untouched; duration is written
 * first, then the work area, then the timeline switches.
 */
function aeApplySetCompositionSettings(comp, settings) {
    if (!comp) throw new Error("TARGET_NOT_FOUND");
    aeApplyWriteCompositionFields(comp, AE_APPLY_COMPOSITION_FIELDS, settings);
    aeApplySetWorkArea(comp, settings);
    aeApplySetRenderer(comp, settings);
    aeApplyWriteCompositionFields(comp, AE_APPLY_COMPOSITION_TIMELINE_FIELDS, settings);
    aeApplySetResolutionFactor(comp, settings);
}
function aeApplyCompositionValueSame(wanted, observed) {
    if (wanted instanceof Array) {
        if (!(observed instanceof Array) || observed.length < wanted.length) return false;
        for (var i = 0; i < wanted.length; i += 1) if (Math.abs(observed[i] - wanted[i]) > 0.002) return false;
        return true;
    }
    return typeof wanted === "number" ? Math.abs(observed - wanted) <= 0.01 : observed === wanted;
}
/**
 * Compares composition settings with the live values. Returns {checked,different}, the count read and the list of
 * fields that differ. Numbers compare within 0.01, colours and the resolution factor per component, the rest exactly.
 */
function aeApplyCompositionReadBack(comp, settings) {
    var fields = AE_APPLY_COMPOSITION_FIELDS.concat(AE_APPLY_COMPOSITION_TIMELINE_FIELDS, [{ requestKey: "workAreaStart", hostKey: "workAreaStart" }, {
      requestKey: "workAreaDuration", hostKey: "workAreaDuration" }, { requestKey: "renderer", hostKey: "renderer" }, { requestKey: "resolutionFactor",
      hostKey: "resolutionFactor" }]);
    var checked = 0, different = [];
    for (var i = 0; i < fields.length; i += 1) {
        var field = fields[i], wanted = settings[field.requestKey];
        if (wanted === undefined) continue;
        checked += 1;
        var observed = aeSafe(function () { return comp[field.hostKey]; }, undefined);
        if (observed === undefined || !aeApplyCompositionValueSame(wanted, observed)) different.push(field.requestKey);
    }
    return { checked: checked, different: different };
}
function aeApplySetResolutionFactor(comp, settings) {
    if (settings.resolutionFactor === undefined) return;
    try { comp.resolutionFactor = [settings.resolutionFactor[0], settings.resolutionFactor[1]]; } catch (resolutionError) {
      throw new Error("COMPOSITION_WRITE_FAILED: resolutionFactor: " + aeErrorText(resolutionError)); }
    var observed = aeSafeGet(comp, "resolutionFactor", null);
    if (!observed || observed[0] !== settings.resolutionFactor[0]
      || observed[1] !== settings.resolutionFactor[1]) throw new Error("COMPOSITION_WRITE_FAILED: resolutionFactor did not take [" + settings.resolutionFactor.join(", ") + "].");
}
/** Enables or disables time remapping. Returns nothing; throws Error(TIME_REMAP_UNSUPPORTED) or a write failure. */
function aeApplySetTimeRemap(layer, enabled) { if (!layer || (typeof layer.canSetTimeRemapEnabled === "boolean"
  && layer.canSetTimeRemapEnabled === false)) throw new Error("TIME_REMAP_UNSUPPORTED"); try { layer.timeRemapEnabled = enabled;
  } catch (timeRemapError) { throw new Error("TIME_REMAP_UNSUPPORTED"); } }
function aeApplySetNewTextJustification(layer, operation) {
    var name = operation.justification || "CENTER_JUSTIFY", number = aeTextEnumNumber("justification", name);
    var property = aeApplyFindProperty(layer, "ADBE Text Properties/ADBE Text Document");
    if (!property || number === null) {
      if (operation.justification) throw new Error("TEXT_DOCUMENT_UNSUPPORTED: ParagraphJustification." + name + " is unavailable on this host."); return; }
    try { var document = property.value; document.justification = number; property.setValue(document); }
    catch (justificationError) { if (operation.justification) throw new Error("PROPERTY_WRITE_FAILED: justification: " + aeErrorText(justificationError)); }
}
function aeApplyAddTextLayer(comp, operation) {
    var textContent = operation.text || "";
    if (operation.box) {return operation.vertical ? comp.layers.addVerticalBoxText(operation.box, textContent) : comp.layers.addBoxText(operation.box,
      textContent);}
    return operation.vertical ? comp.layers.addVerticalText(textContent) : comp.layers.addText(textContent);
}
function aeApplyCreateTextLayer(comp, operation) {
    var layer = aeApplyAddTextLayer(comp, operation);
    if (layer) aeApplySetNewTextJustification(layer, operation);
    return layer;
}
function aeApplyCreateShapeLayer(comp) { return comp.layers.addShape(); }
function aeApplyCreateNullLayer(comp) { return comp.layers.addNull(); }
function aeApplyHasAxisValues(at, target) { return !!at && !!target && at.length >= 3 && target.length >= 2; }
function aeApplyCenterOnAxis(camera) {
    var position = aeApplyFindProperty(camera, "ADBE Transform Group/ADBE Position"), poi = aeApplyFindProperty(camera,
      "ADBE Transform Group/ADBE Anchor Point");
    if (!position || !poi) return;
    var at = aeSafeGet(position, "value", null), target = aeSafeGet(poi, "value", null);
    if (!aeApplyHasAxisValues(at, target) || (at[0] === target[0] && at[1] === target[1])) return;
    try { position.setValue([target[0], target[1], at[2]]); } catch (centerError) { throw new Error("PROPERTY_WRITE_FAILED: " + aeErrorText(centerError)); }
}
function aeApplyCreateCameraLayer(comp, operation, point) {
    if (typeof comp.layers.addCamera !== "function") return null;
    var camera = comp.layers.addCamera(operation.name, point);
    if (camera) aeApplyCenterOnAxis(camera);
    return camera;
}
function aeApplyCreateLightLayer(comp, operation, point) {
    if (typeof comp.layers.addLight !== "function") return null;
    var light = comp.layers.addLight(operation.name, point);
    if (light) aeApplyCenterOnAxis(light);
    return light;
}
function aeApplyCreateAdjustmentLayer(comp, operation) {
    if (typeof comp.layers.addSolid !== "function") return null;
    var adjustmentColor = operation.color !== undefined ? [operation.color[0], operation.color[1], operation.color[2]] : [1, 1, 1];
    var layer = comp.layers.addSolid(adjustmentColor, operation.name, aeSafeGet(comp, "width", 1920), aeSafeGet(comp, "height", 1080), aeSafeGet(comp,
      "pixelAspect", 1));
    if (layer) layer.adjustmentLayer = true;
    return layer;
}
function aeApplyCreateSolidLayer(comp, operation) {
    if (typeof comp.layers.addSolid !== "function") return null;
    var solidColor = operation.color ? [operation.color[0], operation.color[1], operation.color[2]] : [0.5, 0.5, 0.5];
    return comp.layers.addSolid(solidColor, operation.name, operation.size ? operation.size[0] : aeSafeGet(comp, "width", 1920),
      operation.size ? operation.size[1] : aeSafeGet(comp, "height", 1080), aeSafeGet(comp, "pixelAspect", 1));
}
function aeApplyFootageSource(comp, operation) {
    var sourceItem = aeOwnValue(aeApplyCreatedItems, operation.sourceItemId) || aeOwnValue(aeApplyCreatedComps, operation.sourceItemId)
      || aeApplyFindItem(operation.sourceItemId);
    if (!sourceItem || aeApplyIsFolder(sourceItem)) throw new Error("TARGET_NOT_FOUND");
    if (String(aeSafeGet(sourceItem, "id", "")) === String(aeSafeGet(comp, "id", "?"))) throw new Error("INVALID_VALUE");
    return sourceItem;
}
function aeApplyCreateFootageLayer(comp, operation) {
    if (typeof comp.layers.add !== "function") return null;
    var layer, sourceItem = aeApplyFootageSource(comp, operation);
    try { layer = comp.layers.add(sourceItem); } catch (addSourceError) { throw new Error("CREATE_LAYER_UNSUPPORTED: " + aeErrorText(addSourceError)); }
    if (typeof CompItem !== "undefined" && sourceItem instanceof CompItem) {
        try { layer.inPoint = 0; layer.outPoint = sourceItem.duration; } catch (sourceTimingError) { throw new Error("PROPERTY_WRITE_FAILED"); }
    }
    return layer;
}
var AE_APPLY_LAYER_CREATORS = { text: aeApplyCreateTextLayer, shape: aeApplyCreateShapeLayer, "null": aeApplyCreateNullLayer,
  camera: aeApplyCreateCameraLayer, light: aeApplyCreateLightLayer, adjustment: aeApplyCreateAdjustmentLayer, solid: aeApplyCreateSolidLayer,
  footage: aeApplyCreateFootageLayer };
function aeApplyLayerTakesSourceColor(layer, operation) {
    if (operation.layerType === "adjustment" || operation.layerType === "solid" || operation.color === undefined) return false;
    return !!(layer.source && layer.source.mainSource && layer.source.mainSource.color);
}
/**
 * Creates the layer the operation names (solid, text, shape, null, camera, light and so on) at the composition's
 * centre. Returns the new layer. Text layers are given an explicit justification, and a camera or light takes a 2D
 * composition point.
 */
function aeApplyCreateLayer(comp, operation) {
    if (!comp || !comp.layers) throw new Error("CREATE_LAYER_UNSUPPORTED");
    var layer = null, point = [aeSafe(function () { return comp.width / 2; }, 0), aeSafe(function () { return comp.height / 2; }, 0)];
    if (aeHasOwn(AE_APPLY_LAYER_CREATORS, operation.layerType)) layer = AE_APPLY_LAYER_CREATORS[operation.layerType](comp, operation, point);
    if (!layer) throw new Error("CREATE_LAYER_UNSUPPORTED");
    layer.name = operation.name;
    if (aeApplyLayerTakesSourceColor(layer, operation)) layer.source.mainSource.color = operation.color;
    return layer;
}
/** Duplicates a layer. Returns the duplicate; throws Error(DUPLICATE_LAYER_UNSUPPORTED or DUPLICATE_LAYER_FAILED). */
function aeApplyDuplicateLayer(layer) {
    if (!layer || typeof layer.duplicate !== "function") throw new Error("DUPLICATE_LAYER_UNSUPPORTED");
    var duplicate = aeSafe(function () { return layer.duplicate(); }, null);
    if (!duplicate) throw new Error("DUPLICATE_LAYER_FAILED");
    return duplicate;
}
function aeApplySameLayer(left, right) { if (!left || !right) return false; if (left === right) return true; var leftIndex = aeSafeGet(left, "index",
  null), rightIndex = aeSafeGet(right, "index", null), leftComp = aeSafe(function () { return left.containingComp.id; }, null),
  rightComp = aeSafe(function () { return right.containingComp.id; }, null); return leftIndex !== null && leftIndex === rightIndex && leftComp === rightComp; }
function aeApplyRequireMove(layer, method) { if (typeof layer[method] !== "function") throw new Error("REORDER_LAYER_UNSUPPORTED"); }
function aeApplyReorderReference(operation, createdLayers) {
    var comp = aeApplyFindComp(operation.compositionId) || aeOwnValue(aeApplyCreatedComps, operation.compositionId);
    return createdLayers[operation.compositionId + ":" + operation.referenceLayerId] || aeApplyFindLayer(comp, operation.referenceLayerId);
}
/** Moves the layer to the beginning, end, before or after another layer. Returns nothing; throws on an unsupported or missing reference. */
function aeApplyReorderLayer(layer, operation, createdLayers) {
    if (!layer) throw new Error("TARGET_NOT_FOUND");
    if (operation.placement === "beginning") { aeApplyRequireMove(layer, "moveToBeginning"); layer.moveToBeginning(); return; }
    if (operation.placement === "end") { aeApplyRequireMove(layer, "moveToEnd"); layer.moveToEnd(); return; }
    var reference = aeApplyReorderReference(operation, createdLayers);
    if (!reference) throw new Error("TARGET_NOT_FOUND");
    if (aeApplySameLayer(reference, layer)) throw new Error("INVALID_VALUE");
    if (operation.placement === "before") { aeApplyRequireMove(layer, "moveBefore"); layer.moveBefore(reference); return; }
    aeApplyRequireMove(layer, "moveAfter"); layer.moveAfter(reference);
}
function aeApplyTrackMatteConstant(mode) {
    if (typeof TrackMatteType === "undefined") return null;
    if (mode === "alpha") return TrackMatteType.ALPHA;
    if (mode === "alpha-inverted") return TrackMatteType.ALPHA_INVERTED;
    if (mode === "luma") return TrackMatteType.LUMA;
    if (mode === "luma-inverted") return TrackMatteType.LUMA_INVERTED;
    return null;
}
function aeApplyClearTrackMatte(layer) {
    if (typeof layer.removeTrackMatte === "function") { layer.removeTrackMatte(); return; }
    if (typeof TrackMatteType !== "undefined" && TrackMatteType.NO_TRACK_MATTE !== undefined) { layer.trackMatteType = TrackMatteType.NO_TRACK_MATTE; return; }
    throw new Error("TRACK_MATTE_UNSUPPORTED");
}
function aeApplyLegacyTrackMatte(layer, matte, constant) {
    var layerIndex = aeSafeGet(layer, "index", 0), matteIndex = aeSafeGet(matte, "index", 0);
    if (matteIndex !== layerIndex - 1) throw new Error("TRACK_MATTE_UNSUPPORTED");
    try { layer.trackMatteType = constant; } catch (legacyError) { throw new Error("TRACK_MATTE_UNSUPPORTED"); }
}
function aeApplyShowMatteLayer(matte) {
    try { matte.enabled = true; } catch (showError) { throw new Error("PROPERTY_WRITE_FAILED: showMatteLayer"); }
}
/**
 * Sets or clears the layer's track matte. Returns nothing; throws Error(TARGET_NOT_FOUND, INVALID_VALUE or
 * TRACK_MATTE_UNSUPPORTED). Only the immediately preceding layer is supported as a matte, so no layer is silently
 * reordered; showMatteLayer keeps the matte layer rendering.
 */
function aeApplySetTrackMatte(layer, matte, operation) {
    if (!layer) throw new Error("TARGET_NOT_FOUND");
    if (aeApplySameLayer(matte, layer)) throw new Error("INVALID_VALUE");
    if (operation.matteLayerId === null) { aeApplyClearTrackMatte(layer); return; }
    if (!matte) throw new Error("TARGET_NOT_FOUND");
    var constant = aeApplyTrackMatteConstant(operation.mode); if (constant === null) throw new Error("TRACK_MATTE_UNSUPPORTED");
    if (typeof layer.setTrackMatte === "function") layer.setTrackMatte(matte, constant); else aeApplyLegacyTrackMatte(layer, matte, constant);
    if (operation.showMatteLayer === true) aeApplyShowMatteLayer(matte);
}
var HOST_LAYER_SWITCHES = {"motion-blur":{"host":"motionBlur","kind":"boolean"},"collapse-transformation":{"host":"collapseTransformation","kind":"boolean"},"guide-layer":{"host":"guideLayer","kind":"boolean"},"per-character-3d":{"host":"threeDPerChar","kind":"boolean"},"adjustment":{"host":"adjustmentLayer","kind":"boolean"},"effects-active":{"host":"effectsActive","kind":"boolean"},"quality":{"host":"quality","kind":"enum","enumObject":"LayerQuality","values":["BEST","DRAFT","WIREFRAME"]},"sampling":{"host":"samplingQuality","kind":"enum","enumObject":"LayerSamplingQuality","values":["BILINEAR","BICUBIC"]},"frame-blending":{"host":"frameBlendingType","kind":"enum","enumObject":"FrameBlendingType","values":["NO_FRAME_BLEND","FRAME_MIX","PIXEL_MOTION"]},"label":{"host":"label","kind":"integer","min":0,"max":16},"light-type":{"host":"lightType","kind":"enum","enumObject":"LightType","values":["PARALLEL","SPOT","POINT","AMBIENT"]},"preserve-transparency":{"host":"preserveTransparency","kind":"boolean"},"auto-orient":{"host":"autoOrient","kind":"enum","enumObject":"AutoOrientType","values":["NO_AUTO_ORIENT","ALONG_PATH","CAMERA_OR_POINT_OF_INTEREST","CHARACTERS_TOWARD_CAMERA"]}};
var AE_APPLY_SWITCH_KIND_CHECKS = {
    "boolean": function (value) { return typeof value === "boolean"; },
    "integer": function (value, spec) { return typeof value === "number" && Math.floor(value) === value && value >= spec.min && value <= spec.max; },
    "enum": function (value, spec) { return typeof value === "string" && aeListHas(spec.values, value); }
};
function aeApplySwitchValueValid(spec, value) { return aeHasOwn(AE_APPLY_SWITCH_KIND_CHECKS, spec.kind)
  && AE_APPLY_SWITCH_KIND_CHECKS[spec.kind](value, spec); }
/** True when the operation names a known layer switch role, its host property and a valid value. */
function aeApplyLayerSwitchValid(operation) {
    var spec = aeHasOwn(HOST_LAYER_SWITCHES, operation.role) ? HOST_LAYER_SWITCHES[operation.role] : null; if (!spec
      || operation.hostProperty !== spec.host) return false;
    return aeApplySwitchValueValid(spec, operation.value);
}
/** Sets a layer switch. Returns the value now on the layer, or the prior value when it already matched. */
function aeApplySetLayerSwitch(layer, operation) {
    var spec = HOST_LAYER_SWITCHES[operation.role], value = operation.value;
    if (spec.kind === "enum") { var holder = aeSafe(function () { return AE_GLOBAL[spec.enumObject]; }, null); if (!holder
      || holder[value] === undefined) throw new Error("LAYER_SWITCH_UNSUPPORTED: " + spec.enumObject + "." + value + " is unavailable.");
      value = holder[value]; }
    if (aeSafe(function () { return layer[spec.host] === value; }, false)) return value;
    try { layer[spec.host] = value; } catch (switchError) { throw new Error("LAYER_SWITCH_UNSUPPORTED: " + operation.role + ": " + aeErrorText(switchError)); }
    return aeSafe(function () { return layer[spec.host]; }, null);
}
