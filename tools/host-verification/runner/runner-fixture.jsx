/*
 * extynt live verification runner, part 3 of 7 (ExtendScript, ES3): fixtures.
 * Builds the throwaway project content a case declares, resolves the tokens a
 * plan step refers to, and removes everything the case added.
 */
/* global EXTYNT_HV */
(function () {
    var safe = EXTYNT_HV.safe, has = EXTYNT_HV.has, isNewItem = EXTYNT_HV.isNewItem;

    function nthChild(parent, wanted, ordinal) {
        var count = safe(function () { return parent.numProperties; }, 0), seen = 0;
        for (var p = 1; p <= count; p += 1) {
            var candidate = safe(function () { return parent.property(p); }, null);
            if (!candidate || String(candidate.matchName) !== wanted) continue;
            seen += 1;
            if (seen === ordinal) return candidate;
        }
        return null;
    }
    function propertyAt(root, path) {
        var parts = path.split("/"), current = root;
        for (var i = 0; i < parts.length; i += 1) {
            var wanted = parts[i], ordinal = 1, hash = wanted.lastIndexOf("#");
            if (hash > 0) { ordinal = Number(wanted.slice(hash + 1)); wanted = wanted.slice(0, hash); }
            current = nthChild(current, wanted, ordinal);
            if (!current) return null;
        }
        return current;
    }
    function writeBinary(path, bytes) {
        var file = new File(path);
        file.encoding = "BINARY";
        if (!file.open("w")) throw new Error("Cannot write " + path);
        var chunk = [];
        for (var i = 0; i < bytes.length; i += 1) {
            chunk.push(String.fromCharCode(bytes[i]));
            if (chunk.length === 1024) { file.write(chunk.join("")); chunk = []; }
        }
        if (chunk.length) file.write(chunk.join(""));
        file.close();
        return file;
    }
    function rectangleShape(w, h) {
        var shape = new Shape();
        shape.vertices = [[w * 0.25, h * 0.25], [w * 0.75, h * 0.25], [w * 0.75, h * 0.75], [w * 0.25, h * 0.75]];
        shape.closed = true;
        return shape;
    }

    function addFolders(env) {
        var folders = env.fixture.folders || [];
        for (var i = 0; i < folders.length; i += 1) {
            var subfolder = app.project.items.addFolder(folders[i].name);
            subfolder.parentFolder = env.folder;
            env.tokens["@item:" + folders[i].key] = String(subfolder.id);
        }
    }
    function fixtureExtension(name) { return name.indexOf("wav") === 0 ? ".wav" : (name.indexOf("video-") === 0 ? "." + name.substring(6) : ".png"); }
    function isMovingVideo(item) { return safe(function () { return item.mainSource.isStill === false && item.hasVideo === true
      && item.duration > 0; }, false); }
    function importVideo(env) {
        var order = $.os.indexOf("Windows") >= 0 ? ["video-avi", "video-mov"] : ["video-mov", "video-avi"], tried = [];
        for (var i = 0; i < order.length; i += 1) {
            var item = safe(function () { return app.project.importFile(new ImportOptions(env.fixtureFiles[order[i]])); }, null);
            if (item && isMovingVideo(item)) return item;
            tried.push(order[i] + (item ? " imported as a still" : " refused"));
            if (item) safe(function () { item.remove(); return true; }, false);
        }
        throw new Error("No video fixture imported as a moving clip: " + tried.join("; "));
    }
    function addFootage(env) {
        var footage = env.fixture.footage || [];
        for (var i = 0; i < footage.length; i += 1) {
            var imported = footage[i].file === "video" ? importVideo(env) : app.project.importFile(new ImportOptions(env.fixtureFiles[footage[i].file]));
            imported.parentFolder = env.folder;
            env.items[footage[i].key] = imported;
            env.tokens["@item:" + footage[i].key] = String(imported.id);
        }
    }
    function addExtraComps(env) {
        var extraComps = env.fixture.extraComps || [];
        for (var i = 0; i < extraComps.length; i += 1) {
            var extra = extraComps[i], extraComp = app.project.items.addComp(extra.name, extra.width || 320, extra.height || 180, 1, extra.duration
              || 4, extra.frameRate || 24);
            extraComp.parentFolder = env.folder; env.extras[extra.key] = extraComp; env.tokens["@comp:" + extra.key] = String(extraComp.id);
            addInnerSolids(extraComp, extra);
        }
    }
    function addInnerSolids(extraComp, extra) {
        for (var e = 0; e < (extra.layers || 0); e += 1) {extraComp.layers.addSolid([0.2, 0.4 + e * 0.1, 0.8], "Inner " + (e + 1), extra.width || 320,
          extra.height || 180, 1, extra.duration || 4);}
    }

    function createContentLayer(comp, def) {
        if (def.type === "text") return comp.layers.addText(def.text || "extynt");
        if (def.type === "box-text") return comp.layers.addBoxText(def.box || [200, 100], def.text || "extynt paragraph text");
        if (def.type === "shape") return comp.layers.addShape();
        return null;
    }
    function createSolidLayer(comp, def, size) {
        if (def.type === "solid" || def.type === "adjustment") {
            var solid = comp.layers.addSolid([0.8, 0.2, 0.2], def.name || def.key, size.width, size.height, 1, size.duration);
            if (def.type === "adjustment") solid.adjustmentLayer = true;
            return solid;
        }
        if (def.type === "null") return comp.layers.addNull(size.duration);
        return null;
    }
    function createViewLayer(comp, def, size) {
        if (def.type === "camera" || def.type === "one-node-camera") {
            var camera = comp.layers.addCamera(def.name || def.key, [size.width / 2, size.height / 2]);
            if (def.type === "one-node-camera") camera.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
            return camera;
        }
        if (def.type === "light") {
            var light = comp.layers.addLight(def.name || def.key, [size.width / 2, size.height / 2]);
            if (def.lightType) light.lightType = LightType[def.lightType];
            return light;
        }
        return null;
    }
    function createSourceLayer(comp, def, env) {
        if (def.type === "precomp") return comp.layers.add(env.extras[def.source]);
        if (def.type === "footage" || def.type === "audio") return comp.layers.add(env.items[def.source]);
        return null;
    }
    function createLayer(comp, def, env) {
        var layer = createContentLayer(comp, def);
        if (!layer) layer = createSolidLayer(comp, def, env.size);
        if (!layer) layer = createViewLayer(comp, def, env.size);
        if (!layer) layer = createSourceLayer(comp, def, env);
        if (!layer) throw new Error("fixture layer type " + def.type);
        return layer;
    }
    function configureLayer(layer, def) {
        layer.name = def.name || def.key;
        if (def.threeD) layer.threeDLayer = true;
        if (def.startTime !== undefined) layer.startTime = def.startTime;
        if (def.inPoint !== undefined) layer.inPoint = def.inPoint;
        if (def.outPoint !== undefined) layer.outPoint = def.outPoint;
    }
    function addLayers(comp, env) {
        var created = {}, layers = env.fixture.layers;
        for (var i = layers.length - 1; i >= 0; i -= 1) {
            var def = layers[i], layer = createLayer(comp, def, env);
            configureLayer(layer, def);
            created[def.key] = layer; env.tokens["@layer:" + def.key] = String(layer.id);
        }
        return created;
    }

    function addEffects(target, effects) {
        for (var k = 0; k < (effects || []).length; k += 1) target.property("ADBE Effect Parade").addProperty(effects[k]);
    }
    function addShapeGroups(target, count) {
        for (var k = 0; k < (count || 0); k += 1) {
            var group = target.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
            group.name = "Group " + (k + 1);
            var groupPath = "ADBE Root Vectors Group/ADBE Vector Group" + (k > 0 ? "#" + (k + 1) : "") + "/ADBE Vectors Group";
            propertyAt(target, groupPath).addProperty("ADBE Vector Shape - Rect");
            propertyAt(target, groupPath).addProperty("ADBE Vector Graphic - Fill");
        }
    }
    function addMasks(target, count, size) {
        for (var k = 0; k < (count || 0); k += 1) {
            var mask = target.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
            mask.name = "Mask " + (k + 1);
            propertyAt(target,
              "ADBE Mask Parade/ADBE Mask Atom" + (k > 0 ? "#" + (k + 1) : "") + "/ADBE Mask Shape").setValue(rectangleShape(size.width, size.height));
        }
    }
    function addMotionTrackers(target, count) {
        for (var k = 0; k < (count || 0); k += 1) {
            var tracker = target.property("ADBE MTrackers").addProperty("ADBE MTracker");
            tracker.addProperty("ADBE MTracker Pt");
        }
    }
    function addMarkers(target, times) {
        for (var k = 0; k < (times || []).length; k += 1) target.property("ADBE Marker").setValueAtTime(times[k], new MarkerValue("fixture " + (k + 1)));
    }
    function addKeyframes(target, keyframes) {
        for (var k = 0; k < (keyframes || []).length; k += 1) {
            var keyed = propertyAt(target, keyframes[k].path);
            if (!keyed) throw new Error("fixture keyframe path " + keyframes[k].path);
            keyed.setValuesAtTimes(keyframes[k].times, keyframes[k].values);
        }
    }
    function addExpression(target, expression) {
        if (!expression) return;
        var expressive = propertyAt(target, expression.path);
        if (!expressive) throw new Error("fixture expression path " + expression.path);
        expressive.expression = expression.source;
    }
    function addTextAnimators(target, count) {
        for (var k = 0; k < (count || 0); k += 1) {
            target.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
            var animatorPath = "ADBE Text Properties/ADBE Text Animators/ADBE Text Animator" + (k > 0 ? "#" + (k + 1) : "");
            propertyAt(target, animatorPath + "/ADBE Text Selectors").addProperty("ADBE Text Selector");
            propertyAt(target, animatorPath + "/ADBE Text Animator Properties").addProperty("ADBE Text Opacity");
        }
    }
    function decorateLayers(fixture, created, size) {
        for (var i = 0; i < fixture.layers.length; i += 1) {
            var d = fixture.layers[i], target = created[d.key];
            addEffects(target, d.effects);
            addShapeGroups(target, d.shapeGroups);
            addMasks(target, d.masks, size);
            addMotionTrackers(target, d.motionTrackers);
            addMarkers(target, d.markers);
            addKeyframes(target, d.keyframes);
            addExpression(target, d.expression);
            addTextAnimators(target, d.textAnimators);
            if (d.parent) target.parent = created[d.parent];
        }
    }
    function lockLayers(fixture, created) {
        for (var i = 0; i < fixture.layers.length; i += 1) if (fixture.layers[i].locked) created[fixture.layers[i].key].locked = true;
    }

    function buildFixture(caseSpec, folder, fixtureFiles, tokens) {
        var fixture = caseSpec.fixture, spec = fixture.comp || {};
        var size = { width: spec.width || 320, height: spec.height || 180, duration: spec.duration || 4 };
        app.beginUndoGroup("extynt live fixture");
        try {
            var env = { fixture: fixture, folder: folder, fixtureFiles: fixtureFiles, tokens: tokens, extras: {}, items: {}, size: size };
            addFolders(env);
            addFootage(env);
            addExtraComps(env);
            var comp = app.project.items.addComp(spec.name || ("Case " + caseSpec.id).slice(0, 180), size.width, size.height, 1, size.duration,
              spec.frameRate || 24);
            comp.parentFolder = folder; tokens["@comp"] = String(comp.id);
            var created = addLayers(comp, env);
            decorateLayers(fixture, created, size);
            lockLayers(fixture, created);
            return comp;
        } finally { app.endUndoGroup(); }
    }

    var presetPathCache = null;
    function firstPresetFile(files) {
        for (var i = 0; i < files.length; i += 1) if (files[i] instanceof File && /\.ffx$/i.test(files[i].name)) return files[i];
        return null;
    }
    function findPreset(folder, depth) {
        if (!folder || !folder.exists || depth > 4) return null;
        var files = safe(function () { return folder.getFiles(); }, []) || [];
        var direct = firstPresetFile(files);
        if (direct) return direct;
        return nestedPreset(files, depth);
    }
    function nestedPreset(files, depth) {
        for (var j = 0; j < files.length; j += 1) {
            var found = files[j] instanceof Folder ? findPreset(files[j], depth + 1) : null;
            if (found) return found;
        }
        return null;
    }
    function presetPath() {
        if (presetPathCache !== null) return presetPathCache;
        var bases = [safe(function () { return Folder.appPackage.fsName; }, ""), safe(function () { return Folder.appPackage.parent.fsName; }, "")], roots = [];
        for (var b = 0; b < bases.length; b += 1) {if (bases[b]) { roots.push(new Folder(bases[b] + "/Presets/Text"));
          roots.push(new Folder(bases[b] + "/Presets")); }}
        for (var r = 0; r < roots.length; r += 1) {
            var preset = findPreset(roots[r], 0);
            if (preset) { presetPathCache = preset.fsName; return presetPathCache; }
        }
        presetPathCache = "";
        return presetPathCache;
    }
    function jsonEscape(value) { var quoted = JSON.stringify(String(value)); return quoted.substring(1, quoted.length - 1); }
    function substitute(command, tokens) {
        var text = JSON.stringify(command);
        if (text.indexOf("\"@presetPath\"") >= 0) { tokens["@presetPath"] = presetPath(); }
        for (var token in tokens) if (has(tokens, token)) text = text.split("\"" + token + "\"").join("\"" + jsonEscape(tokens[token]) + "\"");
        return text;
    }

    function removeNewItemsOfOtherKinds() {
        var removed = 0;
        for (var i = app.project.numItems; i >= 1; i -= 1) {
            var item = safe(function () { return app.project.item(i); }, null);
            if (item && isNewItem(String(item.id)) && !(item instanceof FolderItem)) { safe(function () { item.remove(); return true; }, false); removed += 1; }
        }
        return removed;
    }
    function removeNewEmptyFolders() {
        var removed = 0;
        for (var j = app.project.numItems; j >= 1; j -= 1) {
            var folder = safe(function () { return app.project.item(j); }, null);
            if (folder && folder instanceof FolderItem && isNewItem(String(folder.id)) && folder.numItems === 0) { safe(function () {
              folder.remove(); return true; }, false); removed += 1; }
        }
        return removed;
    }
    function removeNewItems() {
        var removed = 0;
        for (var pass = 0; pass < 4; pass += 1) {
            removed += removeNewItemsOfOtherKinds();
            removed += removeNewEmptyFolders();
        }
        return removed;
    }

    EXTYNT_HV.writeBinary = writeBinary; EXTYNT_HV.buildFixture = buildFixture; EXTYNT_HV.substitute = substitute; EXTYNT_HV.jsonEscape = jsonEscape;
      EXTYNT_HV.fixtureExtension = fixtureExtension;
    EXTYNT_HV.removeNewItems = removeNewItems;
}());
