/*
 * extynt live verification runner, part 5 of 7 (ExtendScript, ES3): the files a
 * run writes and the ones a resumed run reads back.
 */
/* global EXTYNT_HV, EXTYNT_LIVE_PACK */
(function () {
    var safe = EXTYNT_HV.safe, iso = EXTYNT_HV.iso;
    var PACK = EXTYNT_LIVE_PACK;

    function writeText(path, text) {
        var file = new File(path);
        file.encoding = "UTF-8"; file.lineFeed = "Unix";
        if (!file.open("w")) throw new Error("Cannot write " + path);
        for (var at = 0; at < text.length; at += 1048576) {
            if (!file.write(text.substring(at, at + 1048576))) { var error = file.error; file.close(); throw new Error("Cannot write " + path + ": " + error); }
        }
        file.close();
        return file;
    }
    function appendLine(path, text) {
        var file = new File(path);
        file.encoding = "UTF-8"; file.lineFeed = "Unix";
        if (!file.open(file.exists ? "e" : "w")) return;
        file.seek(0, 2); file.writeln(text); file.close();
    }
    function readText(path) {
        var file = new File(path);
        if (!file.exists) return null;
        file.encoding = "UTF-8";
        if (!file.open("r")) return null;
        var text = file.read();
        file.close();
        return text;
    }
    var breadcrumbPath = null;
    function setBreadcrumbPath(path) { breadcrumbPath = path; }
    function breadcrumb(id, phase) { heartbeat(); if (breadcrumbPath) {safe(function () { writeText(breadcrumbPath, JSON.stringify({ id: id,
      phase: phase, at: iso() })); return true; }, false);} }
    var RUN_LOCK_NAME = "run-lock.json", RUN_LOCK_STALE_MS = 10 * 60 * 1000;
    var runLockPath = null;
    function heartbeat() { if (runLockPath) {safe(function () { writeText(runLockPath, JSON.stringify({ at: iso(),
      atMs: new Date().getTime() })); return true; }, false);} }
    function startRunLock(path) { runLockPath = path; heartbeat(); }
    function releaseRunLock() { if (runLockPath) safe(function () { new File(runLockPath).remove(); return true; }, false); runLockPath = null; }

    function sessionHeaders(text) {
        var out = { headers: [], unreadable: 0 }, parts = text.split("\n{");
        for (var i = 0; i < parts.length; i += 1) {
            var piece = i === 0 ? parts[i] : "{" + parts[i];
            if (piece.indexOf("{\"header\":true") !== 0) continue;
            var parsed = safe(function () { return JSON.parse(piece); }, null);
            if (parsed) out.headers.push(parsed); else out.unreadable += 1;
        }
        return out;
    }
    function headerRefusal(header, current) {
        var kit = header.kit || {};
        if (kit.packDigest !== current.packDigest
          || kit.extyntVersion !== current.extyntVersion) {return "it was recorded by another kit build (" + String(kit.extyntVersion) + ", pack " + String(kit.packDigest).slice(0,
          8) + ")";}
        if (!header.hostKey || !current.hostKey
          || header.hostKey !== current.hostKey) return "it was recorded on another host (" + String(header.hostKey) + "; this host is " + String(current.hostKey) + ")";
        return null;
    }
    function resumeRefusal(progressText, current, lockAgeMs) {
        var found = sessionHeaders(progressText || "");
        if (found.unreadable > 0 || found.headers.length === 0) return "its progress file has no readable session header";
        for (var i = 0; i < found.headers.length; i += 1) {
            var refused = headerRefusal(found.headers[i], current);
            if (refused) return refused;
        }
        if (lockAgeMs !== null && lockAgeMs < RUN_LOCK_STALE_MS) {return "it is still running (last activity " + Math.round(Math.max(0,
          lockAgeMs) / 1000) + " s ago)";}
        return null;
    }
    function folderRefusal(folder, current) {
        if (new File(folder.fsName + "/live-report.json").exists) return undefined;
        var head = readText(folder.fsName + "/progress.jsonl");
        if (!head || head.indexOf(PACK.kit.packDigest) < 0) return undefined;
        var lock = new File(folder.fsName + "/" + RUN_LOCK_NAME);
        var lockAgeMs = lock.exists ? new Date().getTime() - lock.modified.getTime() : null;
        return resumeRefusal(head, current, lockAgeMs);
    }
    function unfinishedRun(current) {
        var root = new Folder(Folder.myDocuments.fsName + "/extynt Live Verification");
        var found = { folder: null, refused: [] };
        if (!root.exists) return found;
        var folders = root.getFiles(function (entry) { return entry instanceof Folder && /-verify$/.test(entry.name); });
        for (var i = 0; i < folders.length; i += 1) {
            var refusal = folderRefusal(folders[i], current);
            if (refusal === undefined) continue;
            if (refusal) { found.refused.push({ folder: folders[i], reason: refusal }); continue; }
            if (!found.folder || folders[i].name > found.folder.name) found.folder = folders[i];
        }
        return found;
    }
    function recordedIds(text) {
        var ids = {}, marker = "\n{\"id\":\"", at = text.indexOf(marker);
        while (at >= 0) {
            var start = at + marker.length, end = text.indexOf("\"", start);
            if (end < 0) break;
            ids[text.slice(start, end)] = true;
            at = text.indexOf(marker, end);
        }
        return ids;
    }

    EXTYNT_HV.writeText = writeText; EXTYNT_HV.appendLine = appendLine; EXTYNT_HV.readText = readText;
    EXTYNT_HV.setBreadcrumbPath = setBreadcrumbPath; EXTYNT_HV.breadcrumb = breadcrumb;
    EXTYNT_HV.unfinishedRun = unfinishedRun; EXTYNT_HV.recordedIds = recordedIds; EXTYNT_HV.resumeRefusal = resumeRefusal;
    EXTYNT_HV.startRunLock = startRunLock; EXTYNT_HV.releaseRunLock = releaseRunLock; EXTYNT_HV.heartbeat = heartbeat;
}());
