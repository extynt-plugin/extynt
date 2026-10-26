/*
 * extynt live verification runner, part 6 of 7 (ExtendScript, ES3): VERIFY.
 * For every case, builds a throwaway fixture, applies the compiled plan through
 * the real aeApplyPlan, reads back everything After Effects holds for the
 * touched compositions, applies the last step again, undoes every apply, reads
 * back again, and removes the fixture. The record keeps raw host state only.
 *
 * `run` is { report, resumed, outFolder, progressPath, allowExternal, status }
 * and is built by runner.jsx.
 */
/* global EXTYNT_HV, EXTYNT_LIVE_PACK, aeApplyPlan */
(function () {
    var H = EXTYNT_HV, safe = H.safe, now = H.now, has = H.has, message = H.message;
    var PACK = EXTYNT_LIVE_PACK;

    function withOutDir(text, run, inJson) { return text.split("/EXTYNT_OUT_DIR").join(inJson ? H.jsonEscape(run.outFolder.fsName) : run.outFolder.fsName); }
    function mutated(parsed) { return !!(parsed && (parsed.ok || parsed.mayHaveMutated)); }
    function parseReply(response) { return safe(function () { return JSON.parse(response); }, null); }
    function newRecord(spec) {
        return { id: spec.id, status: "ran", tokens: {}, caseCompId: null, baseline: null, afterApply: null, afterRerun: null, afterUndo: null,
          host: [], undo: null, cleanup: "not-run" };
    }
    function saveRecord(run, record) { H.appendLine(run.progressPath, JSON.stringify(record)); }
    function recordAndPush(run, record) { saveRecord(run, record); run.report.cases.push(record); }

    function alreadyRecorded(run, spec) { return !!(run.resumed && run.resumed.ids[spec.id]); }
    function crashedHere(run, spec) { return !!(run.resumed && run.resumed.crashed && run.resumed.crashed.id === spec.id); }
    function recordSkip(run, record, status, reason) {
        record.status = status; record.skipReason = reason;
        recordAndPush(run, record);
    }
    function recordCrash(run, record) {
        var crashed = run.resumed.crashed;
        record.status = "host-crashed"; record.error = "After Effects stopped during the " + crashed.phase + " phase of this case (" + crashed.at + ").";
        record.crashPhase = crashed.phase;
        recordAndPush(run, record);
    }
    function settledWithoutRunning(run, spec, record) {
        if (alreadyRecorded(run, spec)) return true;
        if (crashedHere(run, spec)) { recordCrash(run, record); return true; }
        H.breadcrumb(spec.id, "fixture");
        if (spec.plannerOnly) { recordSkip(run, record, "skipped", "planner-stage"); return true; }
        if (spec.external && !run.allowExternal) { recordSkip(run, record, "skipped", "external-writes-declined"); return true; }
        if (spec.fixture.project === "unsaved" && app.project.file !== null) { recordSkip(run, record, "skipped", "project-already-saved"); return true; }
        return false;
    }

    function buildCaseFixture(run, spec, folder, record) {
        try { return H.buildFixture(spec, folder, run.fixtureFiles, record.tokens); }
        catch (fixtureError) { record.status = "fixture-failed"; record.error = message(fixtureError); throw fixtureError; }
    }
    function saveCaseProject(run, spec) {
        if (spec.fixture.project !== "saved" || app.project.file !== null) return;
        app.project.save(new File(run.outFolder.fsName + "/extynt-live-project.aep"));
    }
    function caseScope(run, spec) {
        var scope = { itemIds: {}, files: (spec.files || []).slice(0) };
        for (var fi = 0; fi < scope.files.length; fi += 1) scope.files[fi] = withOutDir(scope.files[fi], run);
        return scope;
    }
    function stepText(run, record, step) { return withOutDir(H.substitute(step, record.tokens), run, true); }
    function applyRaw(record, at, raw) {
        var started = now(), response = aeApplyPlan(raw), parsed = parseReply(response);
        var entry = { phase: at.phase, stepIndex: at.index, ok: !!(parsed && parsed.ok), response: parsed, durationMs: now() - started };
        if (at.phase === "apply") entry.raw = parsed ? undefined : String(response).slice(0, 2000);
        record.host.push(entry);
        return parsed;
    }
    function applySteps(run, spec, record, scope) {
        var applied = 0;
        for (var s = 0; s < spec.steps.length; s += 1) {
            var raw = stepText(run, record, spec.steps[s]);
            H.breadcrumb(spec.id, "apply " + s);
            var parsed = applyRaw(record, { phase: "apply", index: s }, raw);
            if (mutated(parsed)) applied += 1;
            H.trackReportedFiles(scope, parsed);
            if (!parsed || !parsed.ok) break;
        }
        return applied;
    }
    function rerunLastStep(run, spec, record, scope) {
        H.breadcrumb(spec.id, "rerun");
        var last = spec.steps.length - 1;
        var parsed = applyRaw(record, { phase: "rerun", index: last }, stepText(run, record, spec.steps[last]));
        record.afterRerun = H.delta(record.baseline, H.dump(scope));
        return mutated(parsed) ? 1 : 0;
    }
    function pressUndo(record) {
        try { app.executeCommand(16); record.undo.attempted += 1; } catch (undoError) { record.undo.errors.push(message(undoError)); }
    }
    function undoCase(spec, record, scope, applied) {
        H.breadcrumb(spec.id, "undo");
        record.undo = { attempted: 0, allowed: applied, restoredAfter: null, overshot: false, errors: [] };
        var undoState = H.dump(scope);
        record.afterUndo = H.delta(record.baseline, undoState);
        for (var u = 0; u < applied && !H.isRestored(record.afterUndo); u += 1) {
            var beforeUndo = record.afterUndo;
            pressUndo(record);
            var nextState = H.dump(scope);
            if (H.removesBaseline(record.baseline, H.delta(undoState, nextState))) { record.afterUndo = beforeUndo; record.undo.attempted -= 1;
              record.undo.overshot = true; break; }
            undoState = nextState;
            record.afterUndo = H.delta(record.baseline, nextState);
        }
        if (H.isRestored(record.afterUndo)) record.undo.restoredAfter = record.undo.attempted;
    }
    function executeCase(run, spec, record) {
        var folder = app.project.items.addFolder(("extynt Live " + spec.id).slice(0, 200));
        var comp = buildCaseFixture(run, spec, folder, record);
        record.caseCompId = String(comp.id);
        saveCaseProject(run, spec);
        comp.openInViewer();
        var scope = caseScope(run, spec);
        record.baseline = H.dump(scope);
        var applied = applySteps(run, spec, record, scope);
        record.afterApply = H.delta(record.baseline, H.dump(scope));
        var lastOk = record.host.length === spec.steps.length && record.host[record.host.length - 1].ok;
        if (spec.rerun && lastOk) applied += rerunLastStep(run, spec, record, scope);
        record.status = "pending-undo";
        saveRecord(run, record);
        record.status = "ran";
        if (spec.undo) undoCase(spec, record, scope, applied);
    }
    function removeQueueItems(keep) {
        for (var q = app.project.renderQueue.numItems; q > keep; q -= 1) safe(function () { app.project.renderQueue.item(q).remove(); return true; }, false);
    }
    function cleanupCase(run, spec, record) {
        H.breadcrumb(spec.id, "cleanup");
        try { removeQueueItems(0); record.cleanup = "removed " + H.removeNewItems() + " item(s)"; } catch (cleanupError) {
          record.cleanup = "failed: " + message(cleanupError); }
        saveRecord(run, record);
        H.breadcrumb(spec.id, "recorded");
        run.report.cases.push(record);
    }
    function runCase(run, spec, record) {
        H.setPreexisting(H.snapshotItemIds());
        try { executeCase(run, spec, record); }
        catch (caseError) {
            if (record.status === "ran") record.status = "runner-error";
            if (!record.error) record.error = message(caseError);
        }
        cleanupCase(run, spec, record);
    }

    function writeFixtureFiles(run) {
        var files = {};
        for (var fileName in PACK.files) {if (has(PACK.files,
          fileName)) files[fileName] = H.writeBinary(run.outFolder.fsName + "/" + fileName + H.fixtureExtension(fileName), PACK.files[fileName]);}
        return files;
    }
    function runCases(run) {
        var report = run.report;
        run.fixtureFiles = writeFixtureFiles(run);
        H.appendLine(run.progressPath, JSON.stringify({ header: true, resumed: !!run.resumed, kit: report.kit, runtime: report.runtime,
          hostKey: report.hostKey, startedAt: report.startedAt, apiProbes: report.apiProbes }));
        for (var c = 0; c < PACK.cases.length; c += 1) {
            var spec = PACK.cases[c], record = newRecord(spec);
            run.status((c + 1) + "/" + PACK.cases.length + "  " + spec.id);
            if (settledWithoutRunning(run, spec, record)) continue;
            runCase(run, spec, record);
        }
    }

    H.runCases = runCases; H.removeQueueItems = removeQueueItems; H.withOutDir = withOutDir;
}());
