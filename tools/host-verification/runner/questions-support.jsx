/*
 * extynt open-questions probe, part 1 of 4 (ExtendScript, ES3): the shared helpers every measurement uses.
 * `extynt-host-verification generate` inlines this file, questions-parent-keys.jsx and
 * questions-shape-color.jsx, then questions.jsx. They share the namespace object EXTYNT_OQ, so no helper
 * leaks into the global scope. Reads go through `safe`, so a property this build does not expose leaves
 * one `unanswered` marker; writes go through the production `aeApplyPlan` except fixture preconditions.
 * ES3 only, with every ternary and mixed && / || grouped explicitly.
 */
/* exported EXTYNT_OQ */
var EXTYNT_OQ = {};
(function () {
    var context = null, stepCounter = 0;

    function safe(call, fallback) { return context.safe(call, fallback); }
    function plain(value, depth) { return context.plain(value, depth); }
    function has(object, key) { return context.has(object, key); }
    function message(error) { return context.message(error); }
    function text(value) { return (value === null || value === undefined) ? null : String(value); }
    function num(value) { return (typeof value === "number" && isFinite(value)) ? value : null; }
    function begin(runContext) { context = runContext; stepCounter = 0; }
    function iso() { return context.iso(); }
    function status(label) { context.status(label); }

    function finish(entry, data) {
        entry.data = data;
        var missing = (data && data.unanswered) ? data.unanswered.length : 0;
        entry.state = missing > 0 ? "partial" : "answered";
        if (missing > 0) entry.error = "unanswered: " + data.unanswered.join("; ");
        return entry;
    }

    function lastHash(value) {
        var body = String(value);
        for (var i = body.length - 1; i >= 0; i -= 1) if (body.charAt(i) === "#") return i;
        return -1;
    }
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
        var parts = String(path).split("/"), current = root;
        for (var i = 0; i < parts.length; i += 1) {
            var wanted = parts[i], ordinal = 1, hash = lastHash(wanted);
            if (hash > 0) { ordinal = Number(wanted.slice(hash + 1)); wanted = wanted.slice(0, hash); }
            current = nthChild(current, wanted, ordinal);
            if (!current) return null;
        }
        return current;
    }
    function readValue(property) { return plain(safe(function () { return property.value; }, null), 0); }
    function keyRows(property) {
        var count = safe(function () { return property.numKeys; }, 0), rows = [];
        for (var i = 1; i <= count && i <= 16; i += 1) {
            rows.push({
                t: num(safe(function () { return property.keyTime(i); }, null)),
                v: plain(safe(function () { return property.keyValue(i); }, null), 0)
            });
        }
        return rows;
    }
    function sampleRow(property, comp, t) {
        var row = {
            t: t,
            preExpression: plain(safe(function () { return property.valueAtTime(t, true); }, null), 0),
            postExpression: plain(safe(function () { return property.valueAtTime(t, false); }, null), 0),
            errorAfterPost: text(safe(function () { return String(property.expressionError || ""); }, null)) || ""
        };
        safe(function () { comp.time = t; return true; }, false);
        row.propertyValue = readValue(property);
        return row;
    }
    function sampleProperty(property, comp, times) {
        var rows = [], restore = safe(function () { return comp.time; }, 0);
        for (var i = 0; i < times.length; i += 1) rows.push(sampleRow(property, comp, times[i]));
        safe(function () { comp.time = restore; return true; }, false);
        return {
            numKeys: num(safe(function () { return property.numKeys; }, null)),
            expressionEnabled: safe(function () { return property.expressionEnabled === true; }, null),
            expression: text(safe(function () { return String(property.expression); }, null)),
            expressionError: text(safe(function () { return String(property.expressionError || ""); }, null)) || "",
            canVaryOverTime: safe(function () { return property.canVaryOverTime === true; }, null),
            isTimeVarying: safe(function () { return property.isTimeVarying === true; }, null),
            keys: keyRows(property),
            rows: rows
        };
    }

    function newComp(name, duration) {
        var comp = safe(function () { return app.project.items.addComp(name, 320, 180, 1, duration, 24); }, null);
        if (!comp) throw new Error("Cannot create the probe composition " + name);
        safe(function () { comp.parentFolder = context.folder; return true; }, false);
        return comp;
    }
    function addSolid(comp, name) {
        var layer = safe(function () { return comp.layers.addSolid([0.25, 0.35, 0.75], name, 320, 180, 1, safe(function () { return comp.duration; },
          4)); }, null);
        if (!layer) throw new Error("Cannot create the probe layer " + name);
        return layer;
    }
    function layerIdOf(layer) { return text(safe(function () { return String(layer.id); }, null)); }
    function itemIdOf(item) { return text(safe(function () { return String(item.id); }, null)); }
    function layerById(comp, id) {
        var count = safe(function () { return comp.numLayers; }, 0);
        for (var i = 1; i <= count; i += 1) {
            var layer = safe(function () { return comp.layer(i); }, null);
            if (layer && String(safe(function () { return layer.id; }, "")) === String(id)) return layer;
        }
        return null;
    }

    function errorSummary(parsed) {
        if (!parsed || !parsed.error) return null;
        return { code: text(parsed.error.code), message: text(parsed.error.message), operation: text(parsed.error.operation),
          operationIndex: num(parsed.error.operationIndex) };
    }
    function applyOps(label, operations) {
        stepCounter += 1;
        var envelope = { operation: "apply_plan", planId: "extynt-open-questions-" + stepCounter, undoGroup: "extynt open questions probe",
          operations: operations };
        var raw = safe(function () { return context.applyPlan(JSON.stringify(envelope)); }, null);
        var parsed = safe(function () { return JSON.parse(String(raw)); }, null);
        return {
            label: label,
            requestedOperations: operations,
            ok: (parsed && parsed.ok === true),
            mutationState: parsed ? text(parsed.mutationState) : null,
            completedOperations: parsed ? parsed.completedOperations : null,
            steps: parsed ? parsed.steps : null,
            undoGroups: parsed ? num(parsed.undoGroups) : null,
            batchSize: parsed ? num(parsed.batchSize) : null,
            error: errorSummary(parsed),
            raw: parsed ? null : text(raw)
        };
    }
    function hostReplySummary(reply) {
        return { ok: reply.ok, errorCode: reply.error ? reply.error.code : null, errorMessage: reply.error ? reply.error.message : null,
          mutationState: reply.mutationState, undoGroups: reply.undoGroups, raw: reply.raw };
    }

    var TRANSFORM_PATHS = {
        position: "ADBE Transform Group/ADBE Position",
        scale: "ADBE Transform Group/ADBE Scale",
        rotation: "ADBE Transform Group/ADBE Rotate Z",
        anchor: "ADBE Transform Group/ADBE Anchor Point",
        opacity: "ADBE Transform Group/ADBE Opacity"
    };
    function transformOf(layer) {
        var out = {};
        for (var key in TRANSFORM_PATHS) {
            if (!has(TRANSFORM_PATHS, key)) continue;
            var property = layer ? propertyAt(layer, TRANSFORM_PATHS[key]) : null;
            out[key] = property ? readValue(property) : null;
        }
        return out;
    }
    function setPosition(label, compId, layerId, value) {
        return applyOps(label, [{ operation: "set_layer_property", compositionId: compId, layerId: layerId, role: "transform.position",
          propertyPath: TRANSFORM_PATHS.position, value: value }]);
    }
    function setParent(label, compId, layerId, parentLayerId) {
        return applyOps(label, [{ operation: "set_layer_parent", compositionId: compId, layerId: layerId, parentLayerId: parentLayerId }]);
    }

    var VECTOR_GROUP_PREFIX = "ADBE Vector Group";
    function isVectorGroup(child) {
        return safe(function () { return child.numProperties > 0 && String(child.matchName).substring(0,
          VECTOR_GROUP_PREFIX.length) === VECTOR_GROUP_PREFIX; }, false) === true;
    }
    function shapeTree(root, depth) {
        var rows = [], count = safe(function () { return root.numProperties; }, 0);
        for (var i = 1; i <= count; i += 1) {
            var child = safe(function () { return root.property(i); }, null);
            if (!child) continue;
            var matchName = text(safe(function () { return String(child.matchName); }, null));
            var isGroup = isVectorGroup(child);
            var row = { ordinal: i, matchName: matchName, name: text(safe(function () { return String(child.name); }, null)), group: isGroup };
            if (isGroup && depth > 0) row.children = shapeTree(child, depth - 1);
            rows.push(row);
        }
        return rows;
    }
    function sourceRect(layer, t) {
        var rect = safe(function () { return layer.sourceRectAtTime(t, false); }, null);
        if (!rect) return null;
        return {
            top: num(safe(function () { return rect.top; }, null)),
            left: num(safe(function () { return rect.left; }, null)),
            width: num(safe(function () { return rect.width; }, null)),
            height: num(safe(function () { return rect.height; }, null))
        };
    }
    function contentsOf(layer) {
        var contents = safe(function () { return layer.property("ADBE Root Vectors Group"); }, null);
        return contents ? shapeTree(contents, 2) : null;
    }

    EXTYNT_OQ.safe = safe; EXTYNT_OQ.plain = plain; EXTYNT_OQ.has = has; EXTYNT_OQ.message = message;
    EXTYNT_OQ.text = text; EXTYNT_OQ.num = num; EXTYNT_OQ.begin = begin; EXTYNT_OQ.iso = iso; EXTYNT_OQ.status = status;
    EXTYNT_OQ.finish = finish; EXTYNT_OQ.propertyAt = propertyAt; EXTYNT_OQ.readValue = readValue; EXTYNT_OQ.keyRows = keyRows;
    EXTYNT_OQ.sampleProperty = sampleProperty; EXTYNT_OQ.newComp = newComp; EXTYNT_OQ.addSolid = addSolid;
    EXTYNT_OQ.layerIdOf = layerIdOf; EXTYNT_OQ.itemIdOf = itemIdOf; EXTYNT_OQ.layerById = layerById;
    EXTYNT_OQ.applyOps = applyOps; EXTYNT_OQ.hostReplySummary = hostReplySummary; EXTYNT_OQ.TRANSFORM_PATHS = TRANSFORM_PATHS;
    EXTYNT_OQ.transformOf = transformOf; EXTYNT_OQ.setPosition = setPosition; EXTYNT_OQ.setParent = setParent;
    EXTYNT_OQ.sourceRect = sourceRect; EXTYNT_OQ.contentsOf = contentsOf;
    EXTYNT_OQ.measures = {};
}());
