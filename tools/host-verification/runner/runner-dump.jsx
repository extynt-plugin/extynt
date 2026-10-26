/*
 * extynt live verification runner, part 2 of 7 (ExtendScript, ES3): the
 * read-back. Reads everything After Effects holds for the items in scope into
 * flat sections, and compares two such reads. It records raw host state only;
 * all judgement happens in the analyzer.
 */
/* global EXTYNT_HV */
(function () {
    var safe = EXTYNT_HV.safe, has = EXTYNT_HV.has, plain = EXTYNT_HV.plain, enumName = EXTYNT_HV.enumName, easeList = EXTYNT_HV.easeList;
    var MAX_PROPS_PER_LAYER = 4000, MAX_DEPTH = 14, MAX_KEYS = 128, MAX_ITEMS = 2000, MAX_LAYERS_PER_COMP = 400;

    var preexistingItems = {};
    function setPreexisting(ids) { preexistingItems = ids; }
    function snapshotItemIds() {
        var ids = {}, count = app.project.numItems;
        for (var i = 1; i <= count; i += 1) ids[String(app.project.item(i).id)] = true;
        return ids;
    }
    function isNewItem(id) { return !preexistingItems[id]; }

    function hasValue(entry) { return entry.vt !== "NO_VALUE" && entry.vt !== "CUSTOM_VALUE"; }
    function leafBase(property) {
        var entry = { mn: String(property.matchName), nm: safe(function () { return String(property.name); }, ""), pt: "P" };
        var valueType = safe(function () { return property.propertyValueType; }, null);
        entry.vt = enumName("PropertyValueType", valueType);
        entry.en = safe(function () { return property.enabled; }, undefined);
        entry.h = safe(function () { return property.isHidden === true; }, undefined);
        if (safe(function () { return property.canVaryOverTime === false; }, false)) entry.cv = false;
        if (safe(function () { return property.hasMin; }, false)) entry.min = safe(function () { return property.minValue; }, null);
        if (safe(function () { return property.hasMax; }, false)) entry.max = safe(function () { return property.maxValue; }, null);
        if (safe(function () { return property.isSeparationLeader && property.dimensionsSeparated; }, false)) entry.sep = true;
        return entry;
    }
    function keyEntry(property, k, spatial) {
        var key = { t: safe(function () { return property.keyTime(k); }, null), v: plain(safe(function () { return property.keyValue(k); }, null), 0),
          ii: enumName("KeyframeInterpolationType", safe(function () { return property.keyInInterpolationType(k); }, null)),
          oi: enumName("KeyframeInterpolationType", safe(function () { return property.keyOutInterpolationType(k); }, null)) };
        var inEase = safe(function () { return property.keyInTemporalEase(k); }, null), outEase = safe(function () {
          return property.keyOutTemporalEase(k); }, null);
        if (inEase) key.ie = easeList(inEase);
        if (outEase) key.oe = easeList(outEase);
        if (spatial) {
            key.si = plain(safe(function () { return property.keyInSpatialTangent(k); }, null), 0);
            key.so = plain(safe(function () { return property.keyOutSpatialTangent(k); }, null), 0);
            key.r = safe(function () { return property.keyRoving(k); }, null);
        }
        return key;
    }
    function addKeys(entry, property) {
        var keys = safe(function () { return property.numKeys; }, 0);
        if (!(keys > 0)) return;
        entry.n = keys; entry.k = [];
        var spatial = safe(function () { return property.isSpatial; }, false);
        for (var k = 1; k <= keys && k <= MAX_KEYS; k += 1) entry.k.push(keyEntry(property, k, spatial));
    }
    function addExpression(entry, property) {
        var expression = safe(function () { return property.canSetExpression ? String(property.expression) : ""; }, "");
        if (!expression) return;
        entry.x = expression; entry.xe = safe(function () { return property.expressionEnabled; }, null);
        safe(function () { return property.valueAtTime(0, false); }, null);
        entry.xr = safe(function () { return String(property.expressionError || ""); }, "");
        if (hasValue(entry)) entry.ve = plain(safe(function () { return property.valueAtTime(0, false); }, null), 0);
    }
    function leafEntry(property) {
        var entry = leafBase(property);
        if (hasValue(entry)) {entry.v = plain(safe(function () { return property.valueAtTime(0, true); }, safe(function () { return property.value; },
          null)), 0);}
        addKeys(entry, property);
        addExpression(entry, property);
        return entry;
    }
    function maskEntry(child) {
        return { mode: enumName("MaskMode", safe(function () { return child.maskMode; }, null)), inverted: safe(function () { return child.inverted; },
          null), rotoBezier: safe(function () { return child.rotoBezier; }, null), locked: safe(function () { return child.locked; }, null),
          featherFalloff: enumName("MaskFeatherFalloff", safe(function () { return child.maskFeatherFalloff; }, null)),
          motionBlur: enumName("MaskMotionBlur", safe(function () { return child.maskMotionBlur; }, null)) };
    }
    function groupEntry(child, matchName, kind, index) {
        var entry = { mn: matchName, nm: safe(function () { return String(child.name); }, ""),
          pt: kind === Number(PropertyType.INDEXED_GROUP) ? "I" : "G", en: safe(function () {
          return child.canSetEnabled ? child.enabled : undefined; }, undefined), c: safe(function () { return child.numProperties; }, 0) };
        if (index !== undefined) entry.ix = index;
        if (matchName === "ADBE Mask Atom") entry.mask = maskEntry(child);
        return entry;
    }
    function segmentFor(matchName, seen) {
        seen[matchName] = (seen[matchName] || 0) + 1;
        return matchName.split("/").join("%2F") + (seen[matchName] > 1 ? "#" + seen[matchName] : "");
    }
    function walkChild(child, at, depth, sink) {
        var kind = safe(function () { return Number(child.propertyType); }, null);
        sink.budget.left -= 1;
        if (kind === Number(PropertyType.PROPERTY)) { sink.out[sink.keyPrefix + at.path] = leafEntry(child); return; }
        sink.out[sink.keyPrefix + at.path] = groupEntry(child, at.matchName, kind, at.index);
        walk(child, at.path, depth + 1, sink);
    }
    function walk(group, prefix, depth, sink) {
        if (depth > MAX_DEPTH) return;
        var count = safe(function () { return group.numProperties; }, 0), seen = {}, ordered = prefix === "ADBE Effect Parade";
        for (var i = 1; i <= count; i += 1) {
            if (sink.budget.left <= 0) { sink.budget.truncated = true; return; }
            var child = safe(function () { return group.property(i); }, null);
            if (!child) continue;
            var matchName = safe(function () { return String(child.matchName); }, "?");
            var segment = segmentFor(matchName, seen);
            walkChild(child, { matchName: matchName, path: prefix ? prefix + "/" + segment : segment, index: ordered ? i : undefined }, depth, sink);
        }
    }

    function layerClasses() {
        return [["text", typeof TextLayer !== "undefined" ? TextLayer : null], ["shape", typeof ShapeLayer !== "undefined" ? ShapeLayer : null],
          ["camera", typeof CameraLayer !== "undefined" ? CameraLayer : null], ["light", typeof LightLayer !== "undefined" ? LightLayer : null]];
    }
    function classKind(layer) {
        var classes = layerClasses();
        for (var i = 0; i < classes.length; i += 1) if (classes[i][1] && layer instanceof classes[i][1]) return classes[i][0];
        return null;
    }
    function layerKind(layer) {
        var kind = classKind(layer);
        if (kind) return kind;
        if (safe(function () { return layer.nullLayer; }, false)) return "null";
        if (safe(function () { return layer.adjustmentLayer; }, false)) return "adjustment";
        return "av";
    }
    var LAYER_FIELDS = ["enabled", "shy", "solo", "locked", "label", "inPoint", "outPoint", "startTime", "stretch", "time", "threeDLayer",
      "threeDPerChar", "timeRemapEnabled", "audioEnabled", "hasAudio", "hasVideo", "motionBlur", "collapseTransformation", "guideLayer",
      "adjustmentLayer", "effectsActive", "isNameSet", "nullLayer", "hasTrackMatte", "isTrackMatte", "preserveTransparency", "environmentLayer",
      "canSetTimeRemapEnabled", "canSetCollapseTransformation", "width", "height", "comment"];
    var LAYER_ENUMS = { blendingMode: "BlendingMode", trackMatteType: "TrackMatteType", quality: "LayerQuality",
      samplingQuality: "LayerSamplingQuality", frameBlendingType: "FrameBlendingType", autoOrient: "AutoOrientType", lightType: "LightType" };
    var COMP_FIELDS = ["width", "height", "pixelAspect", "duration", "frameRate", "frameDuration", "bgColor", "workAreaStart", "workAreaDuration",
      "displayStartTime", "numLayers", "motionBlur", "shutterAngle", "shutterPhase", "draft3d", "hideShyLayers", "renderer",
      "motionGraphicsTemplateName", "motionGraphicsTemplateControllerCount", "time"];
    function copyFields(source, fields, out) {
        for (var i = 0; i < fields.length; i += 1) {
            var field = fields[i], value = safe(function () { return source[field]; }, undefined);
            if (value !== undefined && typeof value !== "function") out[field] = plain(value, 0);
        }
    }
    function copyEnums(layer, out) {
        for (var enumField in LAYER_ENUMS) {
            if (!has(LAYER_ENUMS, enumField)) continue;
            var enumValue = safe(function () { return layer[enumField]; }, undefined);
            if (enumValue !== undefined) out[enumField] = enumName(LAYER_ENUMS[enumField], enumValue);
        }
    }
    function layerAttributes(layer, comp) {
        var out = { comp: String(comp.id), index: safe(function () { return layer.index; }, null), name: safe(function () {
          return String(layer.name); }, ""), matchName: safe(function () { return String(layer.matchName); }, null), kind: layerKind(layer) };
        copyFields(layer, LAYER_FIELDS, out);
        copyEnums(layer, out);
        out.parent = safe(function () { return layer.parent ? String(layer.parent.id) : null; }, null);
        out.trackMatteLayer = safe(function () { return layer.trackMatteLayer ? String(layer.trackMatteLayer.id) : null; }, null);
        out.source = safe(function () { return layer.source ? String(layer.source.id) : null; }, null);
        return out;
    }
    function itemKind(item) {
        if (item instanceof CompItem) return "composition";
        if (item instanceof FolderItem) return "folder";
        if (item instanceof FootageItem) return "footage";
        return "unknown";
    }
    function footageAttributes(item, out) {
        out.file = safe(function () { return item.file ? String(item.file.name) : null; }, null);
        out.missing = safe(function () { return item.footageMissing; }, null);
        out.useProxy = safe(function () { return item.useProxy; }, null);
        out.proxyFile = safe(function () { return (item.proxySource && item.proxySource.file) ? String(item.proxySource.file.name) : null; }, null);
        out.hasAudio = safe(function () { return item.hasAudio; }, null); out.hasVideo = safe(function () { return item.hasVideo; }, null);
        out.width = safe(function () { return item.width; }, null); out.height = safe(function () { return item.height; }, null);
          out.duration = safe(function () { return item.duration; }, null);
        out.solid = safe(function () { return item.mainSource instanceof SolidSource; }, null);
    }
    function itemAttributes(item) {
        var out = { name: safe(function () { return String(item.name); }, ""), kind: itemKind(item), typeName: safe(function () {
          return String(item.typeName); }, null), parent: safe(function () { return (item.parentFolder
          && item.parentFolder !== app.project.rootFolder) ? String(item.parentFolder.id) : null; }, null), label: safe(function () {
          return item.label; }, null), comment: safe(function () { return item.comment; }, null) };
        if (out.kind === "footage") footageAttributes(item, out);
        if (out.kind === "folder") out.numItems = safe(function () { return item.numItems; }, null);
        return out;
    }
    function compAttributes(comp) {
        var out = itemAttributes(comp);
        copyFields(comp, COMP_FIELDS, out);
        out.guides = safe(function () { return plain(comp.guides, 0); }, "unreadable");
        var markers = safe(function () { return comp.markerProperty; }, null);
        if (markers) out.markers = leafEntry(markers);
        return out;
    }
    function fileAttributes(path) {
        var file = new File(path);
        return { exists: file.exists, bytes: file.exists ? safe(function () { return file.length; }, null) : null, name: String(file.name) };
    }

    function dumpLayers(comp, sections) {
        var layerCount = safe(function () { return comp.numLayers; }, 0);
        for (var l = 1; l <= layerCount && l <= MAX_LAYERS_PER_COMP; l += 1) {
            var layer = safe(function () { return comp.layer(l); }, null);
            if (!layer) continue;
            var layerId = String(layer.id);
            sections.layers[layerId] = layerAttributes(layer, comp);
            var budget = { left: MAX_PROPS_PER_LAYER, truncated: false };
            walk(layer, "", 0, { out: sections.props, budget: budget, keyPrefix: layerId + "|" });
            if (budget.truncated) sections.layers[layerId].propsTruncated = true;
        }
    }
    function outOfScope(scope, id) { return !!(scope.itemIds && !scope.itemIds[id] && !isNewItem(id)); }
    function dump(scope) {
        var sections = { items: {}, comps: {}, layers: {}, props: {}, files: {} }, count = safe(function () { return app.project.numItems; }, 0), itemsSeen = 0;
        for (var i = 1; i <= count; i += 1) {
            var item = safe(function () { return app.project.item(i); }, null);
            if (!item) continue;
            var id = String(item.id);
            if (outOfScope(scope, id)) continue;
            if (itemsSeen++ >= MAX_ITEMS) break;
            if (!(item instanceof CompItem)) { sections.items[id] = itemAttributes(item); continue; }
            sections.comps[id] = compAttributes(item);
            dumpLayers(item, sections);
        }
        var files = scope.files || [];
        for (var f = 0; f < files.length; f += 1) sections.files[files[f]] = fileAttributes(files[f]);
        return sections;
    }

    function delta(base, next) {
        var out = { items: {}, comps: {}, layers: {}, props: {}, files: {} }, sectionNames = ["items", "comps", "layers", "props", "files"];
        for (var s = 0; s < sectionNames.length; s += 1) sectionDelta(base[sectionNames[s]], next[sectionNames[s]], out[sectionNames[s]]);
        return out;
    }
    function sectionDelta(left, right, out) {
        var key;
        for (key in right) if (has(right, key) && (!has(left, key) || JSON.stringify(left[key]) !== JSON.stringify(right[key]))) out[key] = right[key];
        for (key in left) if (has(left, key) && !has(right, key)) out[key] = null;
    }
    function removesBaseline(baseline, changed) {
        var sections = ["items", "comps", "layers", "props"];
        for (var s = 0; s < sections.length; s += 1) {
            var section = changed[sections[s]] || {};
            for (var key in section) if (has(section, key) && section[key] === null && baseline[sections[s]] && has(baseline[sections[s]], key)) return true;
        }
        return false;
    }
    function listsFile(files, path) {
        for (var f = 0; f < files.length; f += 1) if (files[f] === path) return true;
        return false;
    }
    function trackReportedFiles(scope, parsed) {
        var steps = (parsed && parsed.steps) || [];
        for (var i = 0; i < steps.length; i += 1) {
            var reported = steps[i] && steps[i].file;
            if (typeof reported !== "string" || !reported) continue;
            if (!listsFile(scope.files, reported)) scope.files.push(reported);
        }
    }
    function isResidueKey(section, key) { return section === "props" && key.slice(-Math.min(key.length, 28)) === "/ADBE Vector Materials Group"; }
    function sectionRestored(section, entries) {
        for (var key in entries) if (has(entries, key) && !isResidueKey(section, key)) return false;
        return true;
    }
    function isRestored(value) {
        for (var section in value) if (has(value, section) && !sectionRestored(section, value[section])) return false;
        return true;
    }

    EXTYNT_HV.setPreexisting = setPreexisting; EXTYNT_HV.snapshotItemIds = snapshotItemIds; EXTYNT_HV.isNewItem = isNewItem;
    EXTYNT_HV.dump = dump; EXTYNT_HV.delta = delta; EXTYNT_HV.removesBaseline = removesBaseline;
    EXTYNT_HV.trackReportedFiles = trackReportedFiles; EXTYNT_HV.isRestored = isRestored;
}());
