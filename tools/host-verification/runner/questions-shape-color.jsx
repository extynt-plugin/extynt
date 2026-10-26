/*
 * extynt open-questions probe, part 3 of 4 (ExtendScript, ES3): Q4-Q5, the
 * shape-bounds and effect-colour measurements. Helpers come from
 * questions-support.jsx through the shared EXTYNT_OQ namespace; each
 * measurement registers itself in EXTYNT_OQ.measures for questions.jsx to run.
 */
/* global EXTYNT_OQ */
(function () {
    var safe = EXTYNT_OQ.safe, plain = EXTYNT_OQ.plain, num = EXTYNT_OQ.num, finish = EXTYNT_OQ.finish, propertyAt = EXTYNT_OQ.propertyAt;
    var readValue = EXTYNT_OQ.readValue, newComp = EXTYNT_OQ.newComp, addSolid = EXTYNT_OQ.addSolid;
    var layerIdOf = EXTYNT_OQ.layerIdOf, itemIdOf = EXTYNT_OQ.itemIdOf, applyOps = EXTYNT_OQ.applyOps;
    var hostReplySummary = EXTYNT_OQ.hostReplySummary, sourceRect = EXTYNT_OQ.sourceRect, contentsOf = EXTYNT_OQ.contentsOf;

    function ellipseOperations(compId, layerId, tag, label) {
        var groupId = "__new__:q4" + tag + "group";
        return [
            { operation: "create_shape_group", compositionId: compId, layerId: layerId, newGroupId: groupId, name: label + " group" },
            {
                operation: "add_shape_item", compositionId: compId, layerId: layerId, groupId: groupId,
                itemMatchName: "ADBE Vector Shape - Ellipse", newItemId: "__new__:q4" + tag + "item", name: label + " ellipse",
                writes: [{ path: "ADBE Vector Ellipse Size", value: [40, 40] }], animations: []
            }
        ];
    }
    function measureShapeWithoutPaint(entry) {
        var comp = newComp("extynt probe - shape without paint", 2), compId = itemIdOf(comp);
        var bare = safe(function () { return comp.layers.addShape(); }, null);
        var painted = safe(function () { return comp.layers.addShape(); }, null);
        if (!bare || !painted) throw new Error("SHAPE_LAYER_UNSUPPORTED");
        var bareId = layerIdOf(bare), paintedId = layerIdOf(painted);
        var data = { compId: compId, bareLayerId: bareId, paintedLayerId: paintedId, cases: [], unanswered: [] };

        var bareReply = applyOps("Q4 an ellipse with no paint", ellipseOperations(compId, bareId, "bare", "Bare"));
        data.cases.push({ label: "one ellipse, no fill or stroke", host: hostReplySummary(bareReply), rect: sourceRect(bare, 0), contents: contentsOf(bare) });

        var paintedOperations = ellipseOperations(compId, paintedId, "fill", "Painted");
        paintedOperations.push({ operation: "ensure_shape_fill", compositionId: compId, layerId: paintedId, groupId: "__new__:q4fillgroup", color: [1, 0, 0] });
        var paintedReply = applyOps("Q4 the same ellipse plus a fill", paintedOperations);
        data.cases.push({ label: "one ellipse plus ensure_shape_fill", host: hostReplySummary(paintedReply), rect: sourceRect(painted, 0),
          contents: contentsOf(painted) });

        return finish(entry, data);
    }

    function measureEffectColorPrecision(entry) {
        var comp = newComp("extynt probe - effect colour precision", 2), compId = itemIdOf(comp);
        var layer = addSolid(comp, "Q5 colour host"), layerId = layerIdOf(layer);
        var sent = [0.1, 0.2, 0.3];
        var rampColor = "ADBE Effect Parade/ADBE Ramp/ADBE Ramp-0002";
        var data = { compId: compId, layerId: layerId, sent: sent, rampColorPath: rampColor, cases: [], unanswered: [] };

        data.composition = {
            write: hostReplySummary(applyOps("Q5 composition background", [{ operation: "set_composition_settings", compositionId: compId, settings: {
              backgroundColor: sent } }])),
            readBack: plain(safe(function () { return comp.bgColor; }, null), 3)
        };

        var ensured = applyOps("Q5 ensure Ramp", [{ operation: "ensure_effect", compositionId: compId, layerId: layerId,
          capabilityId: "adobe.gradient-ramp", effectMatchName: "ADBE Ramp", effectPath: "ADBE Effect Parade/ADBE Ramp" }]);
        data.cases.push({ label: "ensure_effect Ramp", host: hostReplySummary(ensured) });

        var written = applyOps("Q5 set Start Color", [{ operation: "set_effect_control", compositionId: compId, layerId: layerId,
          effectMatchName: "ADBE Ramp", effectPath: "ADBE Effect Parade/ADBE Ramp", propertyPath: rampColor, value: sent }]);
        var control = propertyAt(layer, rampColor);
        var readBack = control ? readValue(control) : null;
        data.cases.push({
            label: "set_effect_control Start Color to [0.1,0.2,0.3]",
            host: hostReplySummary(written),
            readBack: readBack,
            eightBitPrediction: [26 / 255, 51 / 255, 77 / 255],
            dimensions: num(safe(function () { return control ? control.value.length : null; }, null))
        });

        return finish(entry, data);
    }

    EXTYNT_OQ.measures.shapeWithoutPaint = measureShapeWithoutPaint;
    EXTYNT_OQ.measures.effectColorPrecision = measureEffectColorPrecision;
}());
