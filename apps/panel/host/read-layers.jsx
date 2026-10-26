/* Probe read: layer records, track matte and switch names, and a composition's page of layers. It sits under the probe
 * in probe.jsx.
 */
/* global AE_GLOBAL, aeProbeElapsedAtLeast, aeProbeJsonValue, aeProbeMarkerList, aeProbePropertyPaths, aeProbeReadBudget, aeProbeReadProgress,
  aeProbeReadStartedAt, aeSafe, aeSafeGet */
/* exported aeProbeCompData, aeProbeReadStartedAt */
function aeProbeLayerType(layer) {
    if (aeSafe(function () { return layer instanceof TextLayer; }, false)) return "text";
    if (aeSafe(function () { return layer instanceof ShapeLayer; }, false)) return "shape";
    if (aeSafe(function () { return layer instanceof CameraLayer; }, false)) return "camera";
    if (aeSafe(function () { return layer instanceof LightLayer; }, false)) return "light";
    if (aeSafeGet(layer, "nullLayer", false)) return "null";
    if (aeSafeGet(layer, "adjustmentLayer", false)) return "adjustment";
    return "av";
}
var AE_TRACK_MATTE_MEMBERS = ["NO_TRACK_MATTE", "ALPHA", "ALPHA_INVERTED", "LUMA", "LUMA_INVERTED"];
var aeProbeTrackMatteNames = null;
function aeProbeNumericMember(member) {
    return member !== null && member !== undefined && typeof member.valueOf() === "number" && isFinite(Number(member));
}
function aeProbeTrackMatteHolder() {
    var holder = aeSafeGet(AE_GLOBAL, "TrackMatteType", null);
    if (!holder) holder = aeSafe(function () { return $.global.TrackMatteType; }, null);
    return holder;
}
function aeProbeTrackMatteReflect(holder, names) {
    var reflected = holder ? aeSafe(function () { return holder.reflect.properties; }, []) : [], index, name, member;
    for (index = 0; index < reflected.length; index += 1) {
        name = String(reflected[index].name);
        member = holder ? aeSafe(function () { return holder[name]; }, null) : null;
        if (name !== "__proto__" && aeProbeNumericMember(member)) names[String(Number(member))] = name;
    }
}
function aeProbeTrackMatteFallback(holder, names) {
    var index, name, member;
    for (index = 0; index < AE_TRACK_MATTE_MEMBERS.length; index += 1) {
        name = AE_TRACK_MATTE_MEMBERS[index];
        member = holder ? aeSafe(function () { return holder[name]; }, null) : null;
        if (aeProbeNumericMember(member) && typeof names[String(Number(member))] !== "string") names[String(Number(member))] = name;
    }
}
function aeProbeTrackMatteEnumName(value) {
    if (typeof value === "string") return value;
    if (aeProbeTrackMatteNames === null) {
        var names = {}, holder = aeProbeTrackMatteHolder();
        aeProbeTrackMatteReflect(holder, names);
        aeProbeTrackMatteFallback(holder, names);
        aeProbeTrackMatteNames = names;
    }
    if (value !== null && value !== undefined && typeof value.valueOf() === "number") {
        var number = Number(value), known = aeProbeTrackMatteNames[String(number)];
        if (isFinite(number) && typeof known === "string") return known;
    }
    return null;
}
function aeProbeMatteType(layer) {
    if (!aeSafeGet(layer, "trackMatteLayer", null)) return "none";
    var name = aeSafe(function () { return String(aeProbeTrackMatteEnumName(layer.trackMatteType)); }, "").toLowerCase();
    if (name.indexOf("alpha") >= 0) return name.indexOf("inverted") >= 0 ? "alpha-inverted" : "alpha";
    if (name.indexOf("luma") >= 0) return name.indexOf("inverted") >= 0 ? "luma-inverted" : "luma";
    return "none";
}
function aeProbeEnumMemberIs(holder, name, value) {
    var member = aeSafe(function () { return holder[name]; }, null);
    return name !== "__proto__" && member !== null && member !== undefined && Number(member) === Number(value);
}
function aeProbeLayerEnumName(holderName, value) {
    if (typeof value === "string") return value;
    var holder = aeSafe(function () { return AE_GLOBAL[holderName]; }, null) || aeSafe(function () { return $.global[holderName]; }, null);
    if (!holder) return null;
    var reflected = aeSafe(function () { return holder.reflect.properties; }, []);
    for (var index = 0; index < reflected.length; index += 1) {
        var name = String(reflected[index].name);
        if (aeProbeEnumMemberIs(holder, name, value)) return name;
    }
    return null;
}
function aeProbeLayerSwitches(layer) {
    return {
        "blend-mode": aeSafe(function () { return aeProbeLayerEnumName("BlendingMode", layer.blendingMode); }, null),
        "motion-blur": aeSafe(function () { return !!layer.motionBlur; }, null),
        "collapse-transformation": aeSafe(function () { return !!layer.collapseTransformation; }, null),
        "guide-layer": aeSafe(function () { return !!layer.guideLayer; }, null),
        "per-character-3d": aeSafe(function () { return !!layer.threeDPerChar; }, null),
        "adjustment": aeSafe(function () { return !!layer.adjustmentLayer; }, null),
        "effects-active": aeSafe(function () { return !!layer.effectsActive; }, null),
        "quality": aeSafe(function () { return aeProbeLayerEnumName("LayerQuality", layer.quality); }, null),
        "sampling": aeSafe(function () { return aeProbeLayerEnumName("LayerSamplingQuality", layer.samplingQuality); }, null),
        "frame-blending": aeSafe(function () { return aeProbeLayerEnumName("FrameBlendingType", layer.frameBlendingType); }, null),
        "light-type": aeSafe(function () { return aeProbeLayerEnumName("LightType", layer.lightType); }, null),
        "preserve-transparency": aeSafe(function () { return typeof layer.preserveTransparency === "boolean" ? layer.preserveTransparency : null; }, null),
        "auto-orient": aeSafe(function () { return aeProbeLayerEnumName("AutoOrientType", layer.autoOrient); }, null)
    };
}
function aeProbeLayerData(layer, config, warnings, walk) {
    var parent = aeSafeGet(layer, "parent", null);
    var source = aeSafeGet(layer, "source", null);
    var matte = aeSafeGet(layer, "trackMatteLayer", null);
    var sourceId = source ? String(aeSafeGet(source, "id", "")) : null;
    var warningStart = warnings.length, paths = aeProbePropertyPaths(layer, config, warnings, walk), pathsTruncated = false;
    for (var warningIndex = warningStart; warningIndex < warnings.length; warningIndex += 1) {
        if (warnings[warningIndex] === "property-count-limit:" + String(layer.name)) pathsTruncated = true;
    }
    return {
        id: String(aeSafeGet(layer, "id", "")),
        index: aeSafeGet(layer, "index", 0),
        name: aeSafe(function () { return String(layer.name); }, ""),
        selected: !!aeSafeGet(layer, "selected", false),
        label: aeSafeGet(layer, "label", 0),
        type: aeProbeLayerType(layer), enabled: !!aeSafeGet(layer, "enabled", false), shy: !!aeSafeGet(layer, "shy", false), solo: !!aeSafeGet(layer, "solo", false), locked: !!aeSafeGet(layer, "locked", false), threeD: !!aeSafeGet(layer, "threeDLayer", false), audioEnabled: aeSafe(function () { return !!layer.audioEnabled; }, null),
        startTime: aeSafeGet(layer, "startTime", 0), inPoint: aeSafeGet(layer, "inPoint", 0), outPoint: aeSafeGet(layer, "outPoint", 0), stretch: aeSafeGet(layer, "stretch", 100),
        parentId: parent ? String(aeSafeGet(parent, "id", "")) : null,
        matteLayerId: matte ? String(aeSafeGet(matte, "id", "")) : null, matteType: aeProbeMatteType(layer), sourceId: sourceId,
        compositionSourceId: (source && aeSafe(function () { return source instanceof CompItem; }, false)) ? sourceId : null,
        propertyPaths: paths, propertyPathsTruncated: pathsTruncated, switches: aeProbeLayerSwitches(layer)
    };
}
function aeProbeCompTimeline(comp) {
    var record = {}, names = ["motionBlur", "shutterAngle", "shutterPhase", "motionBlurSamplesPerFrame", "motionBlurAdaptiveSampleLimit", "frameBlending", "draft3d", "resolutionFactor", "renderer"], index;
    for (index = 0; index < names.length; index += 1) record[names[index]] = aeSafe(function () { return comp[names[index]]; }, null);
    record.renderers = aeSafe(function () { var listed = [], renderers = comp.renderers, at;
      for (at = 0; at < renderers.length; at += 1) listed.push(String(renderers[at])); return listed; }, null);
    var markerProperty = aeSafeGet(comp, "markerProperty", null);
    record.markers = markerProperty ? aeSafe(function () { return aeProbeMarkerList(markerProperty); }, null) : null;
    return record;
}
function aeProbeCompRecord(comp, name, layers, truncated) {
    var record = {
        id: String(aeSafeGet(comp, "id", "")),
        name: name,
        backgroundColor: aeSafe(function () { return aeProbeJsonValue(comp.bgColor); }, null),
        width: aeSafeGet(comp, "width", 0), height: aeSafeGet(comp, "height", 0),
        pixelAspect: aeSafeGet(comp, "pixelAspect", 1), duration: aeSafeGet(comp, "duration", 0), frameRate: aeSafeGet(comp, "frameRate", 0), workAreaStart: aeSafeGet(comp, "workAreaStart", 0), workAreaDuration: aeSafeGet(comp, "workAreaDuration", 0), currentTime: aeSafeGet(comp, "time", 0),
        layers: layers, truncated: truncated
    };
    var timeline = aeProbeCompTimeline(comp), key;
    for (key in timeline) if (timeline[key] !== null && timeline[key] !== undefined) record[key] = timeline[key];
    return record;
}
function aeProbeRethrowUnlessBudget(budget) {
    if (!budget || !budget.readBudgetExceeded || aeProbeReadProgress === 0) throw budget;
}
function aeProbeSoftPassed(softMs) { return aeProbeReadProgress > 0 && softMs > 0 && aeProbeElapsedAtLeast(softMs); }
function aeProbeReadLayerAt(comp, options, i, layers) {
    var meta = options.meta, config = options.config, softMs = options.softMs;
    if (aeProbeSoftPassed(softMs)) { meta.next = i; return false; }
    if (aeProbeReadProgress === 0 && aeProbeElapsedAtLeast(config.maxReadMs)) aeProbeReadStartedAt = (new Date()).getTime();
    var layer = comp.layer(i), own = [], walk = { skip: i === options.start.layer ? options.start.property : 0, index: 0, stopped: false }, row;
    try { if (aeProbeReadProgress > 0) aeProbeReadBudget(config); row = aeProbeLayerData(layer, config, own, walk); }
    catch (budget) {
        aeProbeRethrowUnlessBudget(budget);
        meta.next = i;
        return false;
    }
    layers.push(row); options.warnings.push.apply(options.warnings, own); aeProbeReadProgress += 1;
    if (walk.stopped) { meta.next = i; meta.nextProperty = walk.index; return false; }
    return true;
}
/**
 * Layers from start.layer on (its first start.property properties are left to an earlier page), until the composition
 * ends, the soft budget passes, or the hard one stops the call. Every call reads at least one property, so paging a
 * big composition always advances. meta.next is the layer a later call resumes at (0 when whole) and meta.nextProperty
 * the property of it; a layer the budget cut is returned with the paths read so far, and the later page adds the rest.
 * options: { config, warnings, start: { layer, property }, softMs, meta }. The matte layer relation decides whether a
 * track matte exists, and the TrackMatteType holder decides its mode, because AE leaves trackMatteType at its last
 * mode after a matte is cleared. Motion blur, shutter, the 3D renderer and the composition markers are each read
 * guarded, so an older AE reports less, not an error.
 */
function aeProbeCompData(comp, options) {
    var layers = [], total = aeSafeGet(comp, "numLayers", 0), name = aeSafe(function () { return String(comp.name); }, "");
    var limit = Math.min(total, options.config.maxLayersPerComposition), meta = options.meta;
    meta.next = 0; meta.nextProperty = 0; meta.total = limit;
    for (var i = options.start.layer; i <= limit; i += 1) {
        if (!aeProbeReadLayerAt(comp, options, i, layers)) break;
    }
    if (total > limit && meta.next === 0) options.warnings.push("layer-count-limit:" + name);
    return aeProbeCompRecord(comp, name, layers, total > limit);
}
