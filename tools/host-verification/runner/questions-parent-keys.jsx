/*
 * extynt open-questions probe, part 2 of 4 (ExtendScript, ES3): Q1-Q3, the
 * parenting and keyframe measurements. Helpers come from questions-support.jsx
 * through the shared EXTYNT_OQ namespace; each measurement registers itself in
 * EXTYNT_OQ.measures for questions.jsx to run.
 */
/* global EXTYNT_OQ */
(function () {
    var safe = EXTYNT_OQ.safe, num = EXTYNT_OQ.num, finish = EXTYNT_OQ.finish, propertyAt = EXTYNT_OQ.propertyAt;
    var readValue = EXTYNT_OQ.readValue, keyRows = EXTYNT_OQ.keyRows, sampleProperty = EXTYNT_OQ.sampleProperty;
    var newComp = EXTYNT_OQ.newComp, addSolid = EXTYNT_OQ.addSolid, layerIdOf = EXTYNT_OQ.layerIdOf, itemIdOf = EXTYNT_OQ.itemIdOf;
    var layerById = EXTYNT_OQ.layerById, applyOps = EXTYNT_OQ.applyOps, hostReplySummary = EXTYNT_OQ.hostReplySummary;
    var TRANSFORM_PATHS = EXTYNT_OQ.TRANSFORM_PATHS, transformOf = EXTYNT_OQ.transformOf;
    var setPosition = EXTYNT_OQ.setPosition, setParent = EXTYNT_OQ.setParent;

    function buildParentCase(comp, compId, spec) {
        var child = addSolid(comp, "Q1 " + spec.label + " child");
        var parent = addSolid(comp, "Q1 " + spec.label + " parent");
        var childId = layerIdOf(child), parentId = layerIdOf(parent);
        setPosition("Q1 " + spec.label + " child position", compId, childId, spec.ownPosition);
        setPosition("Q1 " + spec.label + " parent position", compId, parentId, spec.parentPosition);
        return { childId: childId, parentId: parentId, before: transformOf(layerById(comp, childId)) };
    }
    function measureParentCompensation(entry) {
        var comp = newComp("extynt probe - parent compensation", 3), compId = itemIdOf(comp);
        var data = { compId: compId, cases: [], unanswered: [] };

        var away = buildParentCase(comp, compId, { label: "away", ownPosition: [160, 90], parentPosition: [100, 50] });
        var awayReply = setParent("Q1 parent to a layer away from the origin", compId, away.childId, away.parentId);
        data.cases.push({ label: "child [160,90] under a parent at [100,50]", host: hostReplySummary(awayReply), before: away.before,
          after: transformOf(layerById(comp, away.childId)) });

        var origin = buildParentCase(comp, compId, { label: "origin", ownPosition: [160, 90], parentPosition: [0, 0] });
        var originReply = setParent("Q1 parent to a layer at the origin", compId, origin.childId, origin.parentId);
        data.cases.push({ label: "child [160,90] under a parent at [0,0]", host: hostReplySummary(originReply), before: origin.before,
          after: transformOf(layerById(comp, origin.childId)) });

        var twice = buildParentCase(comp, compId, { label: "twice", ownPosition: [160, 90], parentPosition: [100, 50] });
        setParent("Q1 first parent", compId, twice.childId, twice.parentId);
        var afterFirst = transformOf(layerById(comp, twice.childId));
        var secondParent = addSolid(comp, "Q1 twice second parent");
        var secondParentId = layerIdOf(secondParent);
        setPosition("Q1 second parent position", compId, secondParentId, [40, 20]);
        var reparentReply = setParent("Q1 re-parent to a layer at [40,20]", compId, twice.childId, secondParentId);
        data.cases.push({ label: "re-parent a child already at [220,130] to a parent at [40,20]", host: hostReplySummary(reparentReply),
          before: afterFirst, after: transformOf(layerById(comp, twice.childId)) });

        return finish(entry, data);
    }

    function trackKeyRange(comp, data, spec) {
        var layer = addSolid(comp, "Q2 " + spec.label);
        var layerId = layerIdOf(layer);
        var row = { label: spec.label, layerId: layerId, staticValue: spec.staticValue, keyframes: spec.keyframes };
        if (spec.staticValue) {
            row.staticWrite = hostReplySummary(setPosition("Q2 " + spec.label + " static", data.compId, layerId, spec.staticValue));
            var written = propertyAt(layer, TRANSFORM_PATHS.position);
            row.afterStatic = written ? { value: readValue(written), numKeys: num(safe(function () { return written.numKeys; }, null)) } : null;
        }
        row.keyWrite = hostReplySummary(applyOps("Q2 " + spec.label + " keyframes", [{ operation: "animate_property", compositionId: data.compId,
          layerId: layerId, propertyPath: TRANSFORM_PATHS.position, keyframes: spec.keyframes }]));
        var keyed = propertyAt(layer, TRANSFORM_PATHS.position);
        row.sampled = keyed ? sampleProperty(keyed, comp, [-1, 0, 0.5, 1, 1.5, 2]) : null;
        data.cases.push(row);
    }
    function measureKeyRangeValue(entry) {
        var comp = newComp("extynt probe - value outside key range", 4), compId = itemIdOf(comp);
        var data = { compId: compId, propertyPath: TRANSFORM_PATHS.position, cases: [], unanswered: [] };

        trackKeyRange(comp, data, { label: "static [10,10] then keys from t=1", staticValue: [10, 10], keyframes: [{ time: 1, value: [100, 100] }, {
          time: 2, value: [200, 200] }] });
        trackKeyRange(comp, data, { label: "static [10,10] then keys from t=0", staticValue: [10, 10], keyframes: [{ time: 0, value: [100, 100] }, {
          time: 1, value: [200, 200] }] });
        trackKeyRange(comp, data, { label: "keys from t=1, no static write", staticValue: null, keyframes: [{ time: 1, value: [100, 100] }, { time: 2,
          value: [200, 200] }] });

        return finish(entry, data);
    }

    function keyState(property) {
        return {
            numKeysAfter: property ? num(safe(function () { return property.numKeys; }, null)) : null,
            keysAfter: property ? keyRows(property) : null
        };
    }
    function measureStaticOverKeyframes(entry) {
        var comp = newComp("extynt probe - static over keys", 4), compId = itemIdOf(comp);
        var layer = addSolid(comp, "Q3 keys"), layerId = layerIdOf(layer);
        var data = { compId: compId, layerId: layerId, propertyPath: TRANSFORM_PATHS.position, cases: [], unanswered: [] };

        data.keyWrite = hostReplySummary(applyOps("Q3 keyframes first", [{ operation: "animate_property", compositionId: compId, layerId: layerId,
          propertyPath: TRANSFORM_PATHS.position, keyframes: [{ time: 1, value: [100, 100] }, { time: 2, value: [200, 200] }] }]));
        var keyed = propertyAt(layer, TRANSFORM_PATHS.position);
        data.keysBefore = keyed ? { numKeys: num(safe(function () { return keyed.numKeys; }, null)), keys: keyRows(keyed) } : null;

        var overWrite = setPosition("Q3 static write over the keyframes", compId, layerId, [500, 500]);
        var after = propertyAt(layer, TRANSFORM_PATHS.position);
        var overState = keyState(after);
        data.cases.push({
            label: "set_layer_property [500,500] on a property with keys at t=1 and t=2",
            host: hostReplySummary(overWrite),
            numKeysAfter: overState.numKeysAfter,
            keysAfter: overState.keysAfter,
            sampled: after ? sampleProperty(after, comp, [0, 1, 1.5, 2]) : null
        });

        var again = setPosition("Q3 static write of the value a key already holds", compId, layerId, [100, 100]);
        var againState = keyState(propertyAt(layer, TRANSFORM_PATHS.position));
        data.cases.push({
            label: "then set_layer_property [100,100], the value the t=1 key holds",
            host: hostReplySummary(again),
            numKeysAfter: againState.numKeysAfter,
            keysAfter: againState.keysAfter
        });

        return finish(entry, data);
    }

    EXTYNT_OQ.measures.parentCompensation = measureParentCompensation;
    EXTYNT_OQ.measures.keyRangeValue = measureKeyRangeValue;
    EXTYNT_OQ.measures.staticOverKeyframes = measureStaticOverKeyframes;
}());
