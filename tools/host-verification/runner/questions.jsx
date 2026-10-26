/*
 * extynt open-questions probe, part 4 of 4 (ExtendScript, ES3): the question catalogue and the entry
 * point `extyntOpenQuestions`, inlined by `extynt-host-verification generate` after questions-support.jsx,
 * questions-parent-keys.jsx and questions-shape-color.jsx, next to the production host adapter and the runner.
 * It runs eighteen bounded measurements and returns raw observed values per question; the analyzer
 * (tools/host-verification/src/questions.ts) derives the answers. Reads go through `safe`; writes go
 * through the production `aeApplyPlan`, except fixture preconditions and Q11's removal attempt.
 * Q8-Q12 press Undo once each, so run them in a disposable project; Q14-Q17 leave compositions behind.
 * ES3 only, with every ternary and mixed && / || grouped explicitly.
 */
/* global EXTYNT_OQ */
/* exported extyntOpenQuestions */
(function () {
    var message = EXTYNT_OQ.message;
    var EXPECTED = [
        {
            id: "q1-parent-compensation-scope",
            title: "What set_layer_parent compensates, and when it is a no-op",
            answers: [
                "When a layer's Position was written before it is parented, which transform properties does After Effects rewrite — Position only, or Scale, Rotation and Anchor Point as well?",
                "With the parent at [0,0], is the child's local Position left exactly as written?",
                "When a layer that already has a parent is re-parented, does the compensation apply again from its current local value?"
            ]
        },
        {
            id: "q2-value-outside-the-key-range",
            title: "What a keyframed property holds before its first keyframe",
            answers: [
                "For a property whose first keyframe is at t=1, what do value and valueAtTime read at t=0 and at a negative time — the first keyframe's value, or a value written statically before the keyframes?",
                "When the first keyframe is at t=0 instead, is a statically written value observable at any time at all?",
                "With no static write, what does t=0 hold for a property whose first key is later?"
            ]
        },
        {
            id: "q3-static-write-over-keyframes",
            title: "A static write to a property that already has keyframes",
            answers: [
                "When set_layer_property writes a value to a property that already has keyframes, are the keyframes kept, cleared, or is the write refused?",
                "What does numKeys read back as afterwards, and what does the property evaluate to at the keyed times?",
                "Does writing the value a key already holds disturb the keys?"
            ]
        },
        {
            id: "q4-shape-path-without-paint",
            title: "A shape path with no fill or stroke",
            answers: [
                "For a shape layer whose only group holds an ellipse and no fill or stroke, what does sourceRectAtTime report — an empty rect, or the path's bounds?",
                "Does adding a fill to that same group change the reported bounds, which is the observable difference between drawing nothing and drawing the path?"
            ]
        },
        {
            id: "q5-effect-control-colour-precision",
            title: "Is an effect-control colour quantised like a composition background?",
            answers: [
                "When [0.1,0.2,0.3] is written to a colour effect control, does it read back exactly or quantised to 1/255 (26/255, 51/255, 77/255)?",
                "What does the same triple read back as on the composition background colour, on this same build, so the two surfaces can be compared directly?"
            ]
        }
    ];
    var GROUPS = [
        { label: "Q1 parent compensation scope", question: "q1-parent-compensation-scope", measure: "parentCompensation" },
        { label: "Q2 value outside the key range", question: "q2-value-outside-the-key-range", measure: "keyRangeValue" },
        { label: "Q3 static write over keyframes", question: "q3-static-write-over-keyframes", measure: "staticOverKeyframes" },
        { label: "Q4 shape path without paint", question: "q4-shape-path-without-paint", measure: "shapeWithoutPaint" },
        { label: "Q5 effect colour precision", question: "q5-effect-control-colour-precision", measure: "effectColorPrecision" }
    ];

    function buildEntries(report, byId) {
        for (var i = 0; i < EXPECTED.length; i += 1) {
            var entry = { id: EXPECTED[i].id, title: EXPECTED[i].title, answers: EXPECTED[i].answers, state: "unanswered", error: null, data: null };
            report.questions.push(entry);
            byId[entry.id] = entry;
        }
    }
    function runGroup(report, label, entries, fn) {
        EXTYNT_OQ.status(label);
        try { fn(); }
        catch (error) {
            var detail = message(error);
            for (var i = 0; i < entries.length; i += 1) {if (entries[i].state === "unanswered" && entries[i].data === null) {
              entries[i].state = "error"; entries[i].error = detail; }}
            report.errors.push({ group: label, error: detail });
        }
    }
    function run(context) {
        EXTYNT_OQ.begin(context);
        var report = { schemaVersion: "0.1", startedAt: EXTYNT_OQ.iso(), finishedAt: null, questions: [], errors: [] };
        var byId = {};
        buildEntries(report, byId);
        for (var g = 0; g < GROUPS.length; g += 1) {
            var entry = byId[GROUPS[g].question], measure = EXTYNT_OQ.measures[GROUPS[g].measure];
            runGroup(report, GROUPS[g].label, [entry], function () { measure(entry); });
        }
        report.finishedAt = EXTYNT_OQ.iso();
        return report;
    }
    EXTYNT_OQ.run = run;
}());

function extyntOpenQuestions(context) { return EXTYNT_OQ.run(context); }
