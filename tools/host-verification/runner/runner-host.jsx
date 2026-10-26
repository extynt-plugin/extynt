/*
 * extynt live verification runner, part 4 of 7 (ExtendScript, ES3): what the
 * host is. Identifies the After Effects build and records what its scripting
 * surface actually exposes, read from live instances.
 */
/* global EXTYNT_HV, aeEyesOpenProbe */
(function () {
    var safe = EXTYNT_HV.safe, plain = EXTYNT_HV.plain, message = EXTYNT_HV.message;

    function hostKey(runtime) { return runtime ? runtime.appVersion + " (" + ((runtime.buildNumber === null
      || runtime.buildNumber === undefined) ? "?" : runtime.buildNumber) + ") " + runtime.platform + "/" + runtime.architecture : null; }
    function runtimeOf(parsed) {
        if (parsed && parsed.result && parsed.result.runtime) return parsed.result.runtime;
        return (parsed && parsed.error && parsed.error.details) ? parsed.error.details : null;
    }
    function canonicalVersion(raw) { var parts = String(raw).replace(/x\d+$/, "").split("."); while (parts.length < 3
      && /^\d+$/.test(parts[0])) parts.push("0"); return parts.join("."); }
    function osFamily() { var os = String($.os); return /win/i.test(os) ? "Windows" : (/mac|darwin/i.test(os) ? "macOS" : "unknown"); }
    function osArchitecture(reported) {
        var a = String(reported).toLowerCase();
        if (a === "arm64" || a === "aarch64") return "arm64";
        if (a === "x86_64" || a === "amd64" || a === "x64") return "x86_64";
        return /^windows\/64\b/i.test(String($.os)) ? "x86_64" : "unknown";
    }
    function probeRuntime() {
        var comp = app.project.items.addComp("extynt runtime probe", 64, 64, 1, 1, 24); comp.openInViewer();
        var parsed = safe(function () { return JSON.parse(aeEyesOpenProbe(JSON.stringify({ schemaVersion: "0.1", requestId: "live-runtime",
          limits: {} }))); }, null);
        safe(function () { comp.remove(); return true; }, false);
        var runtime = runtimeOf(parsed) || {};
        var build = (runtime.buildNumber === undefined || runtime.buildNumber === null) ? safe(function () { return String(app.buildNumber); },
          null) : runtime.buildNumber;
        return { appVersion: canonicalVersion(runtime.appVersion === undefined ? app.version : runtime.appVersion), buildNumber: build,
          platform: osFamily(), architecture: osArchitecture(runtime.architecture), os: String($.os), locale: safe(function () {
          return String($.locale); }, null) };
    }
    function reflectNames(object) {
        if (!object) return null;
        var reflection = safe(function () { return object.reflect; }, null), props = [], methods = [], j;
        var rp = reflection ? safe(function () { return reflection.properties; }, []) : [], rm = reflection ? safe(function () {
          return reflection.methods; }, []) : [];
        for (j = 0; j < rp.length; j += 1) props.push(String(rp[j].name));
        for (j = 0; j < rm.length; j += 1) methods.push(String(rm[j].name));
        return { properties: props, methods: methods };
    }

    var GLOBAL_NAMES = ["CharacterRange", "ParagraphRange", "KeyframeEase", "Shape", "MarkerValue", "TextDocument", "ImportOptions", "BlendingMode",
      "TrackMatteType", "PropertyValueType", "KeyframeInterpolationType", "ParagraphJustification", "LightType", "AutoOrientType"];
    function probeGlobals() {
        var globals = {};
        for (var n = 0; n < GLOBAL_NAMES.length; n += 1) globals[GLOBAL_NAMES[n]] = safe(function () { return typeof $.global[GLOBAL_NAMES[n]]; }, "error");
        return globals;
    }
    function probeLayerSurfaces(out, comp) {
        var text = comp.layers.addText("Probe"), shape = comp.layers.addShape(), camera = comp.layers.addCamera("Camera", [32, 32]),
          light = comp.layers.addLight("Light", [32, 32]), solid = comp.layers.addSolid([1, 0, 0], "Solid", 64, 64, 1, 1);
        out.Application = reflectNames(app); out.Project = reflectNames(app.project); out.CompItem = reflectNames(comp);
        out.TextLayer = reflectNames(text); out.ShapeLayer = reflectNames(shape); out.CameraLayer = reflectNames(camera);
          out.LightLayer = reflectNames(light); out.AVLayer = reflectNames(solid);
        out.FootageItem = reflectNames(solid.source); out.SolidSource = reflectNames(safe(function () { return solid.source.mainSource; }, null));
        out.PropertyGroup = reflectNames(solid.property("ADBE Transform Group"));
          out.Property = reflectNames(solid.property("ADBE Transform Group").property("ADBE Opacity"));
        var mask = safe(function () { return solid.property("ADBE Mask Parade").addProperty("ADBE Mask Atom"); }, null);
          out.MaskPropertyGroup = reflectNames(mask);
        var doc = safe(function () { return text.property("ADBE Text Properties").property("ADBE Text Document").value; }, null);
          out.TextDocumentInstance = reflectNames(doc);
        out.CharacterRangeInstance = reflectNames(safe(function () { return doc.characterRange(0, 1); }, null));
        out.MarkerValueInstance = reflectNames(safe(function () { return new MarkerValue("probe"); }, null));
    }
    function probeRenderQueue(out, comp) {
        var queued = safe(function () { return app.project.renderQueue.items.add(comp); }, null);
        out.RenderQueueItem = reflectNames(queued); out.OutputModule = reflectNames(safe(function () { return queued.outputModule(1); }, null));
        out.renderSettingsTemplates = safe(function () { return plain(queued.templates, 0); }, null); out.outputModuleTemplates = safe(function () {
          return plain(queued.outputModule(1).templates, 0); }, null);
        safe(function () { queued.remove(); return true; }, false);
        out.compGuidesReadable = safe(function () { return comp.guides !== undefined; }, false);
    }
    function installedEffects() {
        var installed = safe(function () { return app.effects; }, null), effectsList = [];
        if (!installed) return null;
        for (var ei = 0; ei < installed.length; ei += 1) {effectsList.push({ matchName: safe(function () { return String(installed[ei].matchName); },
          null), displayName: safe(function () { return String(installed[ei].displayName); }, null), category: safe(function () {
          return String(installed[ei].category); }, null), version: safe(function () { return String(installed[ei].version); }, null) });}
        return effectsList;
    }
    function projectSettings() {
        return { bitsPerChannel: safe(function () { return app.project.bitsPerChannel; }, null), linearBlending: safe(function () {
          return app.project.linearBlending; }, null), workingSpace: safe(function () { return app.project.workingSpace; }, null),
          linearizeWorkingSpace: safe(function () { return app.project.linearizeWorkingSpace; }, null), expressionEngine: safe(function () {
          return app.project.expressionEngine; }, null) };
    }
    function apiProbes() {
        var out = { globals: probeGlobals() };
        app.beginUndoGroup("extynt live api probe");
        var comp = null;
        try {
            comp = app.project.items.addComp("extynt api probe", 64, 64, 1, 1, 24);
            probeLayerSurfaces(out, comp);
            probeRenderQueue(out, comp);
        } catch (probeError) { out.error = message(probeError); }
        finally { app.endUndoGroup(); if (comp) safe(function () { comp.remove(); return true; }, false); }
        out.installedEffects = installedEffects();
        out.projectSettings = projectSettings();
        return out;
    }

    EXTYNT_HV.hostKey = hostKey; EXTYNT_HV.probeRuntime = probeRuntime; EXTYNT_HV.reflectNames = reflectNames; EXTYNT_HV.apiProbes = apiProbes;
}());
