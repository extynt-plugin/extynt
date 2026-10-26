/* Apply set_puppet_pins: places Puppet pins at exact positions on any layer, size-independent, with no user pin
 * placement. The layer is wrapped once in a square 1080 x 1080 "carrier" composition so a fixed mesh preset fits any
 * size, and each pin is detached from the mesh and given its position by script, so it sits where asked and its
 * keyframes move the layer exactly. A layer that is already a carrier is re-pinned in place.
 */
/* global AE_APPLY_LAYER_STEPS, AE_APPLY_VAL_CHECKS, AE_APPLY_VAL_RULES_LAYER, aeApplyValSpecRule, aeBridgeCall, aeHostDirectory, aeSafe, aeSafeGet,
   aeSafeProperty */
var AE_PUPPET_PIN_ATOM = "ADBE FreePin3 PosPin Atom";
var AE_PUPPET_MAX_PINS = 64;
var AE_PUPPET_SQUARE = 1080;
var AE_PUPPET_DETACHED = 4294967295;
var AE_PUPPET_CARRIER_MARK = "extynt-puppet-carrier";
var AE_PUPPET_FEW_PINS = 16;

function aePuppetCoordinatesValid(point) { return !!point && AE_APPLY_VAL_CHECKS.num(point.x, -1000000, 1000000) && AE_APPLY_VAL_CHECKS.num(point.y,
  -1000000, 1000000); }
function aePuppetKeyValid(key, previousTime) { return aePuppetCoordinatesValid(key) && AE_APPLY_VAL_CHECKS.num(key.time, 0, 86400) && key.time > previousTime; }
function aePuppetKeysValid(keys) {
    if (!(keys instanceof Array) || keys.length < 1 || keys.length > 256) return false;
    var previous = -1;
    for (var i = 0; i < keys.length; i += 1) {
        if (!aePuppetKeyValid(keys[i], previous)) return false;
        previous = keys[i].time;
    }
    return true;
}
AE_APPLY_VAL_CHECKS.puppetPins = function (pins) {
    if (!(pins instanceof Array) || pins.length < 1 || pins.length > AE_PUPPET_MAX_PINS) return false;
    for (var i = 0; i < pins.length; i += 1) {
        if (!aePuppetCoordinatesValid(pins[i])) return false;
        if (pins[i].keyframes !== undefined && !aePuppetKeysValid(pins[i].keyframes)) return false;
    }
    return true;
};
AE_APPLY_VAL_RULES_LAYER.set_puppet_pins = aeApplyValSpecRule([["pins", "puppetPins"], ["relative", "bool", 0, 0, 1]]);

function aePuppetCollectPins(group, depth, found) {
    var count = aeSafeGet(group, "numProperties", 0);
    for (var i = 1; i <= count && found.length < 256; i += 1) {
        var child = aeSafeProperty(group, i);
        if (!child) continue;
        if (aeSafe(function () { return child.matchName === AE_PUPPET_PIN_ATOM; }, false)) found.push(child);
        else if (depth < 7) aePuppetCollectPins(child, depth + 1, found);
    }
    return found;
}
function aePuppetEffectOf(layer) { return aeSafe(function () { return layer.property("ADBE Effect Parade").property("ADBE FreePin3"); }, null); }
function aePuppetPinsOf(layer) { var effect = aePuppetEffectOf(layer); return effect ? aePuppetCollectPins(effect, 0, []) : []; }
function aePuppetPositionOf(pin) { return aeSafeProperty(pin, "ADBE FreePin3 PosPin Position"); }
function aePuppetWritable(position) {
    try { if (position.numKeys) position.setValueAtTime(position.keyTime(1), position.keyValue(1)); else position.setValue(position.value);
      return true; } catch (writeError) { return false; }
}
function aePuppetIsCarrier(layer) {
    var source = aeSafeGet(layer, "source", null);
    return !!source && aeSafe(function () { return source instanceof CompItem && String(source.comment).indexOf(AE_PUPPET_CARRIER_MARK) >= 0; }, false);
}
function aePuppetRefuse(layer, why) { throw new Error("PUPPET_LAYER_UNSUPPORTED: " + why + " (layer \"" + aeSafeGet(layer, "name", "") + "\")."); }
function aePuppetNotPixels(layer) { return (typeof CameraLayer !== "undefined" && layer instanceof CameraLayer) || (typeof LightLayer !== "undefined"
  && layer instanceof LightLayer) || aeSafe(function () { return layer.nullLayer === true; }, false); }
function aePuppetCheckOpacity(layer) {
    var opacity = layer.property("ADBE Transform Group").property("ADBE Opacity");
    if (opacity.numKeys > 0 || opacity.expressionEnabled) {aePuppetRefuse(layer,
      "its opacity is animated or has an expression; the carrier copies a static opacity");}
}
function aePuppetCheckEligible(comp, layer) {
    if (aePuppetNotPixels(layer)) aePuppetRefuse(layer, "only footage, solid, shape, text and precomp layers can carry Puppet pins");
    if (layer.threeDLayer) aePuppetRefuse(layer, "a 3D layer cannot be wrapped for Puppet pins; turn 3D off first");
    if (layer.parent) aePuppetRefuse(layer, "the layer has a parent; unparent it (or parent its children to the new layer afterwards) before pinning");
    if (layer.adjustmentLayer) aePuppetRefuse(layer, "an adjustment layer has no pixels to pin");
    if (aeSafe(function () { return layer.hasTrackMatte || layer.isTrackMatte; }, false)) aePuppetRefuse(layer, "the layer uses or is a track matte");
    for (var i = 1; i <= comp.numLayers; i += 1) if (comp.layer(i).parent === layer) aePuppetRefuse(layer, "other layers are parented to it");
    aePuppetCheckOpacity(layer);
}
function aePuppetBuildCarrier(comp, layer) {
    var width = comp.width, depth = comp.height, side = AE_PUPPET_SQUARE, name = String(layer.name), index = layer.index;
    var blend = layer.blendingMode, opacity = layer.property("ADBE Transform Group").property("ADBE Opacity").value, inPoint = layer.inPoint,
      outPoint = layer.outPoint, label = layer.label;
    var asset = comp.layers.precompose([index], name + " puppet source", true), placeholder = comp.layer(index);
    asset.duration = comp.duration;
    var inner = asset.layer(1);
    inner.blendingMode = BlendingMode.NORMAL;
    inner.property("ADBE Transform Group").property("ADBE Opacity").setValue(100);
    var carrier = app.project.items.addComp(name + " puppet", side, side, 1, comp.duration, comp.frameRate);
    carrier.comment = JSON.stringify({ mark: AE_PUPPET_CARRIER_MARK, version: 1, width: width, height: depth, side: side });
    var placed = carrier.layers.add(asset), placedTransform = placed.property("ADBE Transform Group");
    placedTransform.property("ADBE Scale").setValue([side / width * 100, side / depth * 100]);
    placedTransform.property("ADBE Position").setValue([side / 2, side / 2]);
    placed.collapseTransformation = true;
    var outer = comp.layers.add(carrier), outerTransform = outer.property("ADBE Transform Group");
    outerTransform.property("ADBE Position").setValue([width / 2, depth / 2]);
    outerTransform.property("ADBE Scale").setValue([width / side * 100, depth / side * 100]);
    outer.collapseTransformation = false;
    outer.blendingMode = blend;
    outerTransform.property("ADBE Opacity").setValue(opacity);
    outer.label = label;
    outer.name = name + " puppet";
    outer.startTime = 0; outer.inPoint = inPoint; outer.outPoint = outPoint;
    outer.moveBefore(placeholder);
    placeholder.remove();
    return outer;
}
function aePuppetPresetName(count, major) {
    return "puppet-grid-" + (count <= AE_PUPPET_FEW_PINS ? "4x4" : "12x12") + (major < 26 ? "-ae25" : "") + "-1080.ffx";
}
function aePuppetPresetFile(count) {
    var file = new File(aeHostDirectory + "/puppet/" + aePuppetPresetName(count, parseInt(app.version, 10)));
    if (!file.exists) throw new Error("PUPPET_PRESET_MISSING: the Puppet grid preset " + file.fsName + " is not installed (install the host library again).");
    return file;
}
function aePuppetNudgeMesh(layer) {
    var expansion = aeSafe(function () {
      return aePuppetEffectOf(layer).property("ADBE FreePin3 ARAP Group").property("ADBE FreePin3 Mesh Group").property(1).property("ADBE FreePin3 Mesh Expansion"); },
      null);
    if (!expansion) return;
    var value = expansion.value;
    expansion.setValue(value + 1); expansion.setValue(value);
}
function aePuppetApplyFresh(comp, layer, file) {
    var old = aePuppetEffectOf(layer);
    while (old) { old.remove(); old = aePuppetEffectOf(layer); }
    var selected = comp.selectedLayers, s;
    for (s = 0; s < selected.length; s += 1) selected[s].selected = false;
    layer.selected = true;
    layer.applyPreset(file);
    if (!aePuppetEffectOf(layer)) throw new Error("PUPPET_PRESET_FAILED: applying " + file.name + " added no Puppet effect.");
    aePuppetNudgeMesh(layer);
}
function aePuppetWritablePinName(layer) {
    var pins = aePuppetPinsOf(layer);
    for (var i = pins.length - 1; i >= 0; i -= 1) {
        var position = aePuppetPositionOf(pins[i]);
        if (position && aePuppetWritable(position)) return String(pins[i].name);
    }
    return null;
}
function aePuppetPruneOthers(layer, keepName) {
    for (var guard = 0; guard < 400; guard += 1) {
        var current = aePuppetPinsOf(layer), victim = null;
        for (var i = 0; i < current.length; i += 1) if (String(current[i].name) !== keepName) { victim = current[i]; break; }
        if (!victim) break;
        victim.remove();
    }
}
function aePuppetGrowTo(layer, count) {
    var made = aePuppetPinsOf(layer);
    while (made.length < count) { made[made.length - 1].duplicate(); made = aePuppetPinsOf(layer); if (made.length > 400) break; }
    return made;
}
function aePuppetCountWritable(pins) {
    var writable = 0;
    for (var i = 0; i < pins.length; i += 1) { var copy = aePuppetPositionOf(pins[i]); if (copy && aePuppetWritable(copy)) writable += 1; }
    return writable;
}
function aePuppetPrepareAttempt(comp, layer, file, count) {
    aePuppetApplyFresh(comp, layer, file);
    var keepName = aePuppetWritablePinName(layer);
    if (keepName === null) return null;
    aePuppetPruneOthers(layer, keepName);
    var made = aePuppetGrowTo(layer, count);
    return (made.length === count && aePuppetCountWritable(made) === count) ? made : null;
}
function aePuppetPrepareLayer(comp, layer, count) {
    var file = aePuppetPresetFile(count);
    for (var attempt = 0; attempt < 4; attempt += 1) {
        var made = aePuppetPrepareAttempt(comp, layer, file, count);
        if (made) return made;
    }
    throw new Error("PUPPET_PINS_UNWRITABLE: After Effects would not let a script move " + count + " pin(s) on this layer after 4 tries; try fewer pins.");
}
function aePuppetPinPath(effectIndex, pinIndex, leaf) {
    return [{ match: "ADBE Effect Parade" }, { index: effectIndex }, { match: "ADBE FreePin3 ARAP Group" }, { match: "ADBE FreePin3 Mesh Group" }, {
      index: 0 }, { match: "ADBE FreePin3 PosPins" }, { index: pinIndex }, { match: leaf }];
}
function aePuppetNear(a, b) { return !!a && !!b && Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01; }
function aePuppetReadBack(layer, sx, sy) {
    var pins = aePuppetPinsOf(layer), read = [];
    for (var i = 0; i < pins.length; i += 1) {
        var position = aePuppetPositionOf(pins[i]), at = position ? aeSafe(function () { return position.valueAtTime(0, false); }, null) : null;
        if (!at) return { effectPresent: !!aePuppetEffectOf(layer), carrierLayerId: String(layer.id), pins: [] };
        read.push({ x: at[0] / sx, y: at[1] / sy });
    }
    return { effectPresent: !!aePuppetEffectOf(layer), carrierLayerId: String(layer.id), pins: read };
}
function aePuppetExpectedKeys(position, spec, rest, scale) {
    var expectedAt = [], keys = spec.keyframes;
    if (keys !== undefined) {
        for (var k = 0; k < keys.length; k += 1) {
            var value = [(scale.relative ? spec.x + keys[k].x : keys[k].x) * scale.sx, (scale.relative ? spec.y + keys[k].y : keys[k].y) * scale.sy];
            position.setValueAtTime(keys[k].time, value);
            expectedAt.push({ time: keys[k].time, value: value });
        }
    }
    if (!expectedAt.length || expectedAt[0].time > 0) expectedAt.unshift({ time: 0, value: rest });
    return expectedAt;
}
function aePuppetCheckPlaced(position, expectedAt, number) {
    for (var e = 0; e < expectedAt.length; e += 1) {
        var read = position.valueAtTime(expectedAt[e].time, false);
        if (!aePuppetNear(read,
          expectedAt[e].value)) throw new Error("PUPPET_PIN_NOT_PLACED: pin " + number + " reads " + String(read) + " at time " + expectedAt[e].time + ", wanted " + String(expectedAt[e].value) + ".");
    }
}
function aePuppetWritePin(layer, i, spec, target) {
    var rest = target.rest, scale = target.scale;
    var pin = aePuppetPinsOf(layer)[i], position = aePuppetPositionOf(pin);
    try { position.setValueAtTime(position.keyTime(1), rest); } catch (placeError) {
      throw new Error("PUPPET_PIN_NOT_PLACED: pin " + (i + 1) + " would not take its position (" + placeError + ")."); }
    aePuppetCheckPlaced(position, aePuppetExpectedKeys(position, spec, rest, scale), i + 1);
    return { pin: i + 1, x: spec.x, y: spec.y, carrier: [rest[0], rest[1]], keys: aeSafeGet(position, "numKeys", 0) };
}
function aeApplyStepSetPuppetPins(run, operation, scope) {
    var comp = scope.comp, layer = scope.layer, specs = operation.pins, relative = operation.relative === true;
    var created = false, side = AE_PUPPET_SQUARE;
    if (!aePuppetIsCarrier(layer)) { aePuppetCheckEligible(comp, layer); layer = aePuppetBuildCarrier(comp, layer); created = true; }
    var meta = JSON.parse(String(layer.source.comment)), sx = side / meta.width, sy = side / meta.height;
    var originalTime = comp.time;
    comp.time = 0;
    var pins = aePuppetPrepareLayer(comp, layer, specs.length),
      effectIndex = layer.property("ADBE Effect Parade").property("ADBE FreePin3").propertyIndex - 1, ops = [], targets = [], i;
    for (i = 0; i < specs.length; i += 1) {
        var target = [specs[i].x * sx, specs[i].y * sy];
        targets.push(target);
        var pinIndex = pins[i].propertyIndex - 1;
        ops.push({ op: "set", path: aePuppetPinPath(effectIndex, pinIndex, "ADBE FreePin3 PosPin Vtx Index"), value: AE_PUPPET_DETACHED });
        ops.push({ op: "set", path: aePuppetPinPath(effectIndex, pinIndex, "ADBE FreePin3 PosPin Vtx Offset"), value: target });
    }
    aeBridgeCall(comp, layer, ops);
    var written = [], deformedPins = 0, scale = { sx: sx, sy: sy, relative: relative };
    for (i = 0; i < specs.length; i += 1) {
        if (specs[i].keyframes !== undefined) deformedPins += 1;
        written.push(aePuppetWritePin(layer, i, specs[i], { rest: targets[i], scale: scale }));
    }
    comp.time = originalTime;
    run.touched.push(operation.operation);
    return { operation: operation.operation, status: "applied", compositionId: operation.compositionId, requestedLayerId: operation.layerId,
      layerId: String(layer.id), carrierLayerId: String(layer.id), carrierCompositionId: String(layer.source.id), created: created,
      preset: specs.length <= AE_PUPPET_FEW_PINS ? "4x4" : "12x12", pinCount: specs.length, relative: relative, deformedPins: deformedPins,
      pins: written, pinReadback: aePuppetReadBack(layer, sx, sy), verification: "puppet-pins-placed" };
}
AE_APPLY_LAYER_STEPS.set_puppet_pins = aeApplyStepSetPuppetPins;
