/* Apply frame check: where each layer a plan placed lands in its composition's frame, measured once the last operation
 * has run.
 */
/* global aeApplyCreatedComps, aeApplyCreatedLayers, aeApplyFindComp, aeApplyFindLayer, aeIsArray, aeApplyLayerKey, aeApplyMetadataGuard,
   aeApplyRequest, aeHasOwn, aeOwnValue, aeSafe, aeSafeGet, aeSafeLayer, aeSafeProperty */
/* exported aeApplyFrameChecks */
var AE_FRAME_LAYER_LIMIT = 24, AE_FRAME_PROBE_NAME = "extynt frame probe";
var AE_FRAME_PLACING = { create_layer: "layerId", duplicate_layer: "newLayerId", derive_layer: "newLayerId", set_layer_parent: "layerId",
  set_text_document: "layerId", set_layer_attribute: "layerId", set_layer_property: "layerId", animate_property: "layerId", set_expression: "layerId" };
var AE_FRAME_PATH_OPERATIONS = { set_layer_property: true, animate_property: true, set_expression: true };
var AE_FRAME_CORNERS = ["[r.left, r.top]", "[r.left + r.width, r.top]", "[r.left + r.width, r.top + r.height]", "[r.left, r.top + r.height]"];
var AE_FRAME_LAYER_REF = "thisComp.layer(Math.round(effect(\"i\")(1)))";
function aeFrameMovesLayer(operation) {
    if (!aeHasOwn(AE_FRAME_PATH_OPERATIONS, operation.operation)) return true;
    return String(operation.propertyPath).indexOf("ADBE Transform Group") === 0 || String(operation.role).indexOf("transform") === 0;
}
function aeFrameOperationLayer(operation) {
    var comp = aeOwnValue(aeApplyCreatedComps, operation.compositionId) || aeApplyFindComp(operation.compositionId),
      field = AE_FRAME_PLACING[operation.operation], id = operation[field];
    if (!comp || typeof id !== "string") return null;
    return { comp: comp, layer: aeApplyCreatedLayers[aeApplyLayerKey(operation, id)] || aeApplyFindLayer(comp, id) };
}
function aeFrameSameLayer(a, b) { return String(aeSafeGet(a, "id", "a")) === String(aeSafeGet(b, "id", "b")); }
function aeFrameHasAncestor(layer, ancestor) {
    var current = aeSafeGet(layer, "parent", null);
    for (var depth = 0; current && depth < 16; depth += 1) {
        if (aeFrameSameLayer(current, ancestor)) return true;
        current = aeSafeGet(current, "parent", null);
    }
    return false;
}
function aeFrameListed(found, comp, layer) {
    for (var f = 0; f < found.length; f += 1) if (aeFrameSameLayer(found[f].layer, layer) && String(found[f].comp.id) === String(comp.id)) return true;
    return false;
}
function aeFrameDirectTargets() {
    var found = [], operations = aeApplyRequest.operations, index, target;
    for (index = 0; index < operations.length; index += 1) {
        var operation = operations[index];
        if (!aeHasOwn(AE_FRAME_PLACING, operation.operation) || !aeFrameMovesLayer(operation)) continue;
        target = aeFrameOperationLayer(operation);
        if (target && target.layer && !aeFrameListed(found, target.comp, target.layer)) found.push(target);
    }
    return found;
}
function aeFrameAddChildren(found, parent) {
    var comp = parent.comp, count = aeSafeGet(comp, "numLayers", 0);
    for (var layerIndex = 1; layerIndex <= count && found.length < AE_FRAME_LAYER_LIMIT; layerIndex += 1) {
        var candidate = aeSafeLayer(comp, layerIndex);
        if (candidate && aeFrameHasAncestor(candidate, parent.layer) && !aeFrameListed(found, comp, candidate)) found.push({ comp: comp, layer: candidate });
    }
}
function aeFrameTargets(run) {
    var found = aeFrameDirectTargets(), placed = found.length;
    for (var index = 0; index < placed; index += 1) aeFrameAddChildren(found, found[index]);
    return found.slice(0, AE_FRAME_LAYER_LIMIT);
}
function aeFrameOpacityZero(layer) {
    var opacity = aeSafe(function () { return layer.property("ADBE Transform Group").property("ADBE Opacity"); }, null);
    if (!opacity) return false;
    var keys = aeSafeGet(opacity, "numKeys", 0);
    if (keys === 0) return aeSafeGet(opacity, "value", 100) === 0;
    for (var key = 1; key <= keys; key += 1) if (aeSafe(function () { return opacity.keyValue(key); }, 100) !== 0) return false;
    return true;
}
function aeFrameMatteBounded(layer) {
    var type = aeSafeGet(layer, "trackMatteType", null);
    if (type === null || type === undefined) return false;
    return type === TrackMatteType.ALPHA || type === TrackMatteType.LUMA;
}
function aeFrameIsNonRendering(layer) {
    if (aeSafeGet(layer, "nullLayer", false) === true || aeSafeGet(layer, "adjustmentLayer", false) === true || aeSafeGet(layer, "guideLayer",
      false) === true) return true;
    return aeSafeGet(layer, "enabled", true) === false || aeSafeGet(layer, "hasVideo", true) === false;
}
function aeFrameDrawsPixels(layer) {
    var matchName = String(aeSafeGet(layer, "matchName", ""));
    if (matchName === "ADBE Camera Layer" || matchName === "ADBE Light Layer") return false;
    if (aeFrameIsNonRendering(layer) || aeFrameMatteBounded(layer)) return false;
    return !aeFrameOpacityZero(layer);
}
function aeFrameLastTransformKey(layer) {
    var last = -1, current = layer;
    for (var depth = 0; current && depth < 16; depth += 1) {
        var group = aeSafeProperty(current, "ADBE Transform Group"), count = group ? aeSafeGet(group, "numProperties", 0) : 0;
        for (var child = 1; child <= count; child += 1) {
            var property = aeSafeProperty(group, child), keys = property ? aeSafeGet(property, "numKeys", 0) : 0;
            if (keys > 0) last = Math.max(last, aeSafe(function () { return property.keyTime(keys); }, -1));
        }
        current = aeSafeGet(current, "parent", null);
    }
    return last;
}
function aeFrameClampTime(time, low, high) { return Math.max(low, Math.min(high, time)); }
function aeFrameSampleTimes(comp, layer) {
    var duration = aeSafeGet(comp, "duration", 0), frame = aeSafeGet(comp, "frameDuration", 1 / 30), end = Math.max(0, duration - frame),
      key = aeFrameLastTransformKey(layer);
    var settled = aeFrameClampTime(key >= 0 ? key : duration / 2, 0, end), times = [{ kind: "settled", time: settled }, { kind: "middle",
      time: aeFrameClampTime(duration / 2, 0, end) }, { kind: "end", time: end }], samples = [];
    for (var t = 0; t < times.length; t += 1) {
        var duplicate = false;
        for (var s = 0; s < samples.length; s += 1) if (Math.abs(samples[s].time - times[t].time) < 0.0005) duplicate = true;
        if (!duplicate) samples.push(times[t]);
    }
    return samples;
}
function aeFrameProbeNew(comp) {
    var probe = comp.layers.addShape();
    try { probe.name = AE_FRAME_PROBE_NAME; probe.moveToEnd(); probe.enabled = false; } catch (ignoredPlacement) {}
    var parade = probe.property("ADBE Effect Parade"), names = ["i", "c0", "c1", "c2", "c3", "w", "b", "m", "p"];
    if (!parade) return { layer: probe, parade: null };
    for (var n = 0; n < names.length; n += 1) {
        var control = parade.addProperty(n === 0 ? "ADBE Slider Control" : "ADBE Point Control");
        if (!control) return { layer: probe, parade: null };
        control.name = names[n];
    }
    for (var corner = 0; corner < AE_FRAME_CORNERS.length; corner += 1) parade.property("c" + corner).property(1).expression = "var r = " + AE_FRAME_LAYER_REF + ".sourceRectAtTime(time, false); var c = " + AE_FRAME_CORNERS[corner] + "; var p = " + AE_FRAME_LAYER_REF + ".toComp([c[0], c[1], 0], time); [p[0], p[1]];";
    parade.property("w").property(1).expression = "var P = " + AE_FRAME_LAYER_REF + ".parent; var p = P.toComp(P.anchorPoint, time); [p[0], p[1]];";
    parade.property("p").property(1).expression = "var v = " + AE_FRAME_LAYER_REF + ".transform.position; [v[0], v[1]];";
    return { layer: probe, parade: parade };
}
function aeFramePoint(probe, name, time) {
    var value = aeSafe(function () { return probe.parade.property(name).property(1).valueAtTime(time, false); }, null);
    return (aeIsArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number" && isFinite(value[0])
      && isFinite(value[1])) ? [Math.round(value[0] * 10) / 10, Math.round(value[1] * 10) / 10] : null;
}
function aeFrameBox(probe, time) {
    var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (var corner = 0; corner < 4; corner += 1) {
        var point = aeFramePoint(probe, "c" + corner, time);
        if (!point) return null;
        left = Math.min(left, point[0]); right = Math.max(right, point[0]); top = Math.min(top, point[1]); bottom = Math.max(bottom, point[1]);
    }
    return [left, top, right, bottom];
}
function aeFrameInsideFully(box, comp) { return box !== null && box[0] >= 0 && box[1] >= 0 && box[2] <= comp.width && box[3] <= comp.height; }
function aeFrameParentShift(probe, comp, box, time) {
    var parade = probe.parade, prefix = "var P = " + AE_FRAME_LAYER_REF + ".parent; var a = P.anchorPoint; var q = P.fromComp([";
    var suffix = ", 0], time); [q[0] - a[0], q[1] - a[1]];";
    parade.property("b").property(1).expression = prefix + ((box[0] + box[2]) / 2) + ", " + ((box[1] + box[3]) / 2) + suffix;
    parade.property("m").property(1).expression = prefix + (comp.width / 2) + ", " + (comp.height / 2) + suffix;
    var boxCentre = aeFramePoint(probe, "b", time), compCentre = aeFramePoint(probe, "m", time);
    return (boxCentre && compCentre) ? [compCentre[0] - boxCentre[0], compCentre[1] - boxCentre[1]] : null;
}
function aeFrameVisibleAt(layer, time) {
    var value = aeSafe(function () { return layer.property("ADBE Transform Group").property("ADBE Opacity").valueAtTime(time, false); }, null);
    return typeof value !== "number" || value > 0;
}
function aeFrameSamples(probe, comp, layer) {
    var samples = aeFrameSampleTimes(comp, layer), rows = [];
    probe.parade.property("i").property(1).setValue(layer.index);
    for (var s = 0; s < samples.length; s += 1) {
        var time = samples[s].time;
        rows.push({ kind: samples[s].kind, time: Math.round(time * 1000) / 1000, active: layer.inPoint <= time + 0.0005 && time < layer.outPoint
          && aeFrameVisibleAt(layer, time), box: aeFrameBox(probe, time) });
    }
    return rows;
}
function aeFrameSuspectSample(samples, comp) {
    for (var s = 0; s < samples.length; s += 1) if (samples[s].active && samples[s].box && !aeFrameInsideFully(samples[s].box, comp)) return samples[s];
    return null;
}
function aeFrameCorrection(probe, comp, layer, sample) {
    var parent = aeSafeGet(layer, "parent", null), correction = { position: aeFramePoint(probe, "p", sample.time), shift: null, parent: null };
    if (!parent) {
        correction.shift = [comp.width / 2 - (sample.box[0] + sample.box[2]) / 2, comp.height / 2 - (sample.box[1] + sample.box[3]) / 2];
        return correction;
    }
    var world = aeFramePoint(probe, "w", sample.time);
    correction.parent = { name: String(aeSafeGet(parent, "name", "")), world: world };
    correction.shift = aeFrameParentShift(probe, comp, sample.box, sample.time);
    return correction;
}
function aeFrameLayerRow(probe, comp, layer) {
    var samples = aeFrameSamples(probe, comp, layer), row = { compositionId: String(comp.id), layerId: String(layer.id), name: String(layer.name),
      width: comp.width, height: comp.height, samples: samples };
    if (aeSafeGet(layer, "matchName", "") === "ADBE Text Layer") row.text = true;
    var suspect = aeFrameSuspectSample(samples, comp);
    if (suspect) {
        var correction = aeFrameCorrection(probe, comp, layer, suspect);
        row.position = correction.position; row.shift = correction.shift; row.parent = correction.parent;
    } else if (aeSafeGet(layer, "parent", null)) {
        row.parent = { name: String(aeSafe(function () { return layer.parent.name; }, "")), world: null };
    }
    return row;
}
function aeFrameMeasureComp(comp, layers) {
    var probe = null, rows = [];
    try {
        probe = aeFrameProbeNew(comp);
        if (!probe.parade) return rows;
        for (var l = 0; l < layers.length; l += 1) {
            var row = aeSafe(function () { return aeFrameLayerRow(probe, comp, layers[l]); }, null);
            if (row) rows.push(row);
        }
    } catch (ignoredProbe) {
    } finally {
        if (probe && probe.layer) try { probe.layer.remove(); } catch (ignoredRemove) {}
    }
    return rows;
}
/**
 * One row per drawn layer the plan placed (or parented under one it placed), grouped by composition; empty when there
 * is nothing to measure or After Effects would not answer. Measures through a throwaway shape layer whose expressions
 * read toComp, added and removed inside the plan's undo group so undo stays one step. The host only measures; the
 * sidecar judges. A layer under a non-inverted alpha or luma matte is not bounded by its own box.
 */
function aeApplyFrameChecks(run) {
    if (aeApplyMetadataGuard) return [];
    var targets = aeSafe(function () { return aeFrameTargets(run); }, []), byComp = [], rows = [];
    for (var t = 0; t < targets.length; t += 1) {
        if (!aeSafe(function () { return aeFrameDrawsPixels(targets[t].layer); }, false)) continue;
        var group = null;
        for (var g = 0; g < byComp.length; g += 1) if (String(byComp[g].comp.id) === String(targets[t].comp.id)) group = byComp[g];
        if (!group) { group = { comp: targets[t].comp, layers: [] }; byComp.push(group); }
        group.layers.push(targets[t].layer);
    }
    for (var c = 0; c < byComp.length; c += 1) rows = rows.concat(aeFrameMeasureComp(byComp[c].comp, byComp[c].layers));
    return rows;
}
