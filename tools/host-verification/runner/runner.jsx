/*
 * extynt live verification runner, part 7 of 7 (ExtendScript, ES3): the modes. `extynt-host-verification
 * generate` inlines the production host adapter, the compiled case pack and the runner-*.jsx parts before
 * this file; run the result from File > Scripts > Run Script File. The panel never loads it.
 * VERIFY: per case, build a throwaway fixture, apply the compiled plan through the real aeApplyPlan, read
 * back, apply again, undo every apply, read back again and remove the fixture; the report records raw host
 * state only and the analyzer judges it.
 * DUMP: write a read-only dump of the open project in the same format.
 * PROBE: answer the open host questions (open-questions.json).
 */
/* global EXTYNT_HV, EXTYNT_LIVE_PACK, aeApplyPlan, extyntOpenQuestions */
(function () {
    var H = EXTYNT_HV, safe = H.safe, iso = H.iso, message = H.message;
    var PACK = EXTYNT_LIVE_PACK;

    function askMode() {
        return prompt("extynt live verification " + PACK.kit.extyntVersion + " (pack " + String(PACK.kit.packDigest).slice(0,
          8) + ", " + PACK.cases.length + " cases)\n\nType VERIFY to run every case in a new, unsaved project (After Effects will ask to save the open one), DUMP to write a read-only dump of the open project, or PROBE to answer the open host questions (writes open-questions.json; creates and removes its own items, and presses Undo once per undo question, so use a disposable project).",
          "VERIFY");
    }

    function openStatusWindow(title) {
        var handle = { window: null, label: null };
        safe(function () { handle.window = new Window("palette", title); handle.label = handle.window.add("statictext", undefined,
          "Starting..."); handle.label.characters = 60; handle.window.show(); return true; }, false);
        return handle;
    }
    function setStatus(handle, text) { if (handle.label) safe(function () { handle.label.text = String(text); handle.window.update(); return true; }, false); }
    function closeStatusWindow(handle) { if (handle.window) safe(function () { handle.window.close(); return true; }, false); }

    function findResume(mode) {
        if (mode !== "VERIFY") return null;
        var runtime = H.probeRuntime(), current = { packDigest: PACK.kit.packDigest, extyntVersion: PACK.kit.extyntVersion, hostKey: H.hostKey(runtime) };
        var found = H.unfinishedRun(current), folder = found.folder;
        if (found.refused.length > 0) {
            var left = [];
            for (var r = 0; r < found.refused.length; r += 1) left.push(found.refused[r].folder.fsName + " (" + found.refused[r].reason + ")");
            alert("Unfinished runs of this kit that will not be resumed here:\n" + left.join("\n"));
        }
        if (!folder
          || !confirm("An unfinished run of this exact kit on this host was found:\n" + folder.fsName + "\n\nResume it? Cases already recorded are kept; the case that was running when After Effects stopped is recorded as a host crash and not retried.\n\nChoose No to start a fresh run.")) return null;
        var previous = H.readText(folder.fsName + "/progress.jsonl") || "", lastCrumb = safe(function () {
          return JSON.parse(H.readText(folder.fsName + "/current-case.json")); }, null);
        return { folder: folder, resumed: { ids: H.recordedIds(previous), crashed: lastCrumb } };
    }
    function startSession(mode) {
        var found = findResume(mode);
        var outFolder = found ? found.folder : new Folder(Folder.myDocuments.fsName + "/extynt Live Verification/" + H.stamp() + "-" + mode.toLowerCase());
        if (!outFolder.exists && !outFolder.create()) { alert("Could not create " + outFolder.fsName); return null; }
        var report = { schemaVersion: "0.1", kit: PACK.kit, mode: mode, runtime: null, hostKey: null, startedAt: iso(), finishedAt: null, cases: [],
          apiProbes: {}, runnerErrors: [] };
        return { mode: mode, outFolder: outFolder, report: report, resumed: found ? found.resumed : null };
    }

    function runDumpMode(session) {
        var report = session.report;
        if (!app.project) { alert("Open a project to dump."); return; }
        H.setPreexisting({});
        report.runtime = safe(function () { return { appVersion: String(app.version), buildNumber: String(app.buildNumber), platform: String($.os),
          architecture: "unknown", os: String($.os), locale: String($.locale) }; }, null);
        report.projectName = safe(function () { return String(app.project.file ? app.project.file.name : "Untitled"); }, "Untitled");
        report.dump = H.dump({ itemIds: null, files: [] });
        report.apiProbes = H.apiProbes(); report.finishedAt = iso();
        var dumpFile = H.writeText(session.outFolder.fsName + "/project-dump.json", JSON.stringify(report));
        alert("extynt project dump written:\n" + dumpFile.fsName);
    }

    var UNDO_WARNING = "The open-questions probe now measures undo behaviour: it applies one operation at a time and presses Undo once after each (Q8-Q12).\n\nRun it only in a disposable project. If a measured operation does not join its undo group, that Undo reaches back into earlier work in this project.\n\nContinue?";
    function newProbeReport(session) {
        return { schemaVersion: "0.1", kind: "extynt-open-questions", kit: PACK.kit, mode: "PROBE", runtime: null, hostKey: null, startedAt: iso(),
          finishedAt: null, outFolder: session.outFolder.fsName, cleanup: "not-run", questions: [], probeErrors: [], errors: [] };
    }
    function measureQuestions(probeReport, outFolder, win) {
        probeReport.runtime = H.probeRuntime();
        probeReport.hostKey = H.hostKey(probeReport.runtime);
        var probeFolder = app.project.items.addFolder(("extynt Open Questions " + H.stamp()).slice(0, 200));
        var measured = extyntOpenQuestions({
            safe: safe, plain: H.plain, enumName: H.enumName, has: H.has, message: message, iso: iso,
            folder: probeFolder, applyPlan: aeApplyPlan, reflectNames: H.reflectNames, outFolder: outFolder.fsName,
            undo: function () { app.executeCommand(16); },
            status: function (label) { setStatus(win, label); }
        });
        probeReport.questions = measured.questions;
        probeReport.probeErrors = measured.errors;
        probeReport.measurementStartedAt = measured.startedAt;
        probeReport.measurementFinishedAt = measured.finishedAt;
    }
    function cleanupProbe(probeReport, queueBefore) {
        H.breadcrumb("open-questions", "cleanup");
        try {
            H.removeQueueItems(queueBefore);
            probeReport.queue = { before: queueBefore, after: safe(function () { return app.project.renderQueue.numItems; }, null) };
            probeReport.cleanup = "removed " + H.removeNewItems() + " item(s)";
        } catch (probeCleanupError) { probeReport.cleanup = "failed: " + message(probeCleanupError); }
    }
    function runProbeMode(session) {
        var outFolder = session.outFolder;
        if (!app.project) { alert("Open a disposable project, then run the probe again."); return; }
        if (!confirm(UNDO_WARNING)) { alert("Nothing was changed."); return; }
        H.setPreexisting(H.snapshotItemIds());
        var queueBefore = safe(function () { return app.project.renderQueue.numItems; }, 0);
        H.setBreadcrumbPath(outFolder.fsName + "/current-case.json");
        var probeReport = newProbeReport(session), win = openStatusWindow("extynt open questions");
        app.beginSuppressDialogs();
        try { measureQuestions(probeReport, outFolder, win); }
        catch (probeError) { probeReport.errors.push(message(probeError)); }
        finally { app.endSuppressDialogs(false); closeStatusWindow(win); }
        cleanupProbe(probeReport, queueBefore);
        probeReport.finishedAt = iso();
        var probeFile = H.writeText(outFolder.fsName + "/open-questions.json", JSON.stringify(probeReport));
        alert("extynt open-questions probe finished.\n\nSend this file:\n" + probeFile.fsName + "\n\nIt created and removed its own compositions" + (probeReport.cleanup.slice(0,
          7) === "removed" ? " (" + probeReport.cleanup + ")" : "") + "; the project can be closed without saving.");
    }

    function runVerifyMode(session) {
        var report = session.report, outFolder = session.outFolder;
        var allowExternal = confirm("Some cases write files outside the project into:\n" + outFolder.fsName + "\n(a short render, a .mogrt, a frame, an effect preset, saved and collected project copies).\n\nRun those external-write cases too?");
        var win = null;
        var run = { report: report, resumed: session.resumed, outFolder: outFolder, progressPath: outFolder.fsName + "/progress.jsonl",
          allowExternal: allowExternal, status: function (text) { setStatus(win, text); }, fixtureFiles: {} };
        H.setBreadcrumbPath(outFolder.fsName + "/current-case.json");
        H.startRunLock(outFolder.fsName + "/run-lock.json");
        win = openStatusWindow("extynt live verification");
        app.beginSuppressDialogs();
        try {
            report.runtime = H.probeRuntime(); report.hostKey = H.hostKey(report.runtime);
            report.apiProbes = H.apiProbes();
            H.runCases(run);
        } catch (runError) {
            report.runnerErrors.push(message(runError));
        } finally {
            app.endSuppressDialogs(false);
            closeStatusWindow(win);
            H.releaseRunLock();
        }
        report.finishedAt = iso(); report.resumed = !!session.resumed;
        H.writeText(outFolder.fsName + "/live-report.json", JSON.stringify(report));
        alert("extynt live verification finished: " + report.cases.length + " case(s) this session" + (session.resumed ? " (resumed; progress.jsonl holds every case)" : "") + ".\n\nSend the whole folder:\n" + outFolder.fsName + "\n\nThe last case reopens a saved copy of the working project (switch_project), so the open project is that copy; it can be closed without saving.");
    }

    var MODE_RUNNERS = { DUMP: runDumpMode, PROBE: runProbeMode, VERIFY: runVerifyMode };
    function chooseMode() {
        if (typeof JSON === "undefined") { alert("extynt live verification needs After Effects with a JSON-capable ExtendScript engine."); return null; }
        var answer = askMode();
        if (answer === null) return null;
        var mode = String(answer).replace(/^\s+|\s+$/g, "").toUpperCase();
        if (mode === "VERIFY" && !app.newProject()) { alert("A new project is required; nothing was changed."); return null; }
        return mode;
    }
    function main() {
        var mode = chooseMode();
        if (mode === null) return;
        var session = startSession(mode);
        if (!session) return;
        if (!Object.prototype.hasOwnProperty.call(MODE_RUNNERS, mode)) { alert("Unknown mode " + mode + "; nothing was changed."); return; }
        MODE_RUNNERS[mode](session);
    }
    main();
}());
