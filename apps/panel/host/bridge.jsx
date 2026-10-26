/* Project pulse, bridge session reader, sidecar kickstart and chat-log destination chooser. It is the host side of the
 * panel-to-sidecar bridge.
 */
/* global aeEaseText, aeKeyValueText, aeSafe, aeSafeGet, aeSafeProperty, aeTruncatedErrorText */
/* exported aeChooseChatLogDestination, aeKickstartInstalledSidecar, aeProjectPulse, aeReadBridgeSession */

var AE_PULSE_DETAIL_LAYERS = 80;
var AE_PULSE_TRANSFORM_PROPERTIES = ["ADBE Anchor Point", "ADBE Position", "ADBE Scale", "ADBE Rotate Z", "ADBE Opacity"];
function aePulseKeySummary(property) {
    var count = aeSafeGet(property, "numKeys", 0);
    var expressionEnabled = aeSafe(function () { return property.expressionEnabled === true; }, false);
    var expression = aeSafe(function () { return String(property.expression || ""); }, "");
    var expressionIdentity = "e" + expressionEnabled + ":" + expression.length + ":" + expression;
    if (!count) return expressionIdentity + (expressionEnabled ? ":base-unknown" : ":v" + aeKeyValueText(aeSafeGet(property, "value", null)));
    return expressionIdentity + ":k" + count + ":" + aeSafe(function () {
      return String(property.keyTime(1)) + "," + String(property.keyTime(count)) + "," + aeKeyValueText(property.keyValue(1)) + "," + aeKeyValueText(property.keyValue(count)) + "," + aeEaseText(property.keyOutTemporalEase(1)) + aeEaseText(property.keyInTemporalEase(count)); },
      "?");
}
function aeBridgeSessionCandidates() {
    var candidates = [];
    try { if (Folder.userData) candidates.push(String(Folder.userData.fsName) + "/extynt/session.json"); } catch (ignoredUserData) {}
    try { candidates.push(String(Folder("~/.config/extynt").fsName) + "/session.json"); } catch (ignoredConfig) {}
    try { candidates.push(String(Folder("~/Library/Application Support/extynt").fsName) + "/session.json"); } catch (ignoredSupport) {}
    return candidates;
}
function aeBridgeReadSessionFile(path) {
    var file = new File(path);
    if (!file.exists) return null;
    if (!file.open("r")) return null;
    var raw = file.read();
    file.close();
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (ignoredParse) { parsed = null; }
    if (parsed && typeof parsed.token === "string" && parsed.token.length > 0 && typeof parsed.port === "number") return parsed;
    return null;
}
/**
 * Reads the sidecar session file. Returns JSON {ok:true,port,token}, or {ok:false,error:{code,message}} with
 * NO_SESSION_FILE or SESSION_UNREADABLE. The bearer token comes only from the per-user session file the sidecar writes
 * with owner-only permissions, never over an HTTP route.
 */
function aeReadBridgeSession() {
    try {
        var candidates = aeBridgeSessionCandidates();
        for (var i = 0; i < candidates.length; i += 1) {
            var session = aeBridgeReadSessionFile(candidates[i]);
            if (session) return JSON.stringify({ ok: true, port: session.port, token: session.token });
        }
        return JSON.stringify({ ok: false, error: { code: "NO_SESSION_FILE", message: "No extynt session file was readable for this user." } });
    } catch (error) { return JSON.stringify({ ok: false, error: { code: "SESSION_UNREADABLE", message: aeTruncatedErrorText(error, 256) } }); }
}

/**
 * Asks launchd to start the installed sidecar on macOS. Returns JSON {ok:true,requested:true},
 * {ok:false,unsupported:true} off macOS, or {ok:false,error:{code,message}} with UID_UNAVAILABLE or
 * SIDECAR_START_FAILED. Starts only the already installed per-user job; the executable and service label are fixed and
 * the one interpolated value is accepted after a digits-only UID check, so no panel or project text becomes shell
 * input.
 */
function aeKickstartInstalledSidecar() {
    try {
        if (!$.os || $.os.indexOf("Mac") !== 0) return JSON.stringify({ ok: false, unsupported: true });
        var uid = String(system.callSystem("/usr/bin/id -u")).replace(/\s+/g, "");
        if (!/^[0-9]+$/.test(uid)) {return JSON.stringify({ ok: false, error: { code: "UID_UNAVAILABLE",
          message: "Could not identify the current macOS user." } });}
        system.callSystem("/bin/launchctl kickstart gui/" + uid + "/com.extynt.sidecar 2>&1");
        return JSON.stringify({ ok: true, requested: true });
    } catch (error) { return JSON.stringify({ ok: false, error: { code: "SIDECAR_START_FAILED",
      message: "Could not request the installed extynt sidecar." } }); }
}

function aeChatLogRequestValid(request) {
    return !!request && request.operation === "choose_chat_log_destination" && typeof request.suggestedName === "string"
      && /^[A-Za-z0-9._-]{1,128}\.jsonl$/.test(request.suggestedName);
}
/**
 * Opens the Save dialog for a JSONL chat export. Takes the request JSON; returns JSON {ok:true,cancelled:true},
 * {ok:true,cancelled:false,path}, or {ok:false,error:{code,message}} with INVALID_COMMAND or
 * CHAT_EXPORT_DIALOG_FAILED. The host only chooses a path; the authenticated local sidecar writes the archive there.
 */
function aeChooseChatLogDestination(raw) {
    var request; try { request = JSON.parse(raw); } catch (ignored) { return JSON.stringify({ ok: false, error: { code: "INVALID_COMMAND",
      message: "Chat export request was not valid JSON." } }); }
    if (!aeChatLogRequestValid(request)) {return JSON.stringify({ ok: false, error: { code: "INVALID_COMMAND",
      message: "Only a bounded JSONL chat export name is accepted." } });}
    try {
        var proposal = new File(Folder.desktop.fsName + "/" + request.suggestedName);
        var selected = proposal.saveDlg("Save full extynt chat log", "JSON Lines:*.jsonl");
        if (!selected) return JSON.stringify({ ok: true, cancelled: true });
        var path = String(selected.fsName);
        if (!/\.jsonl$/i.test(path)) path += ".jsonl";
        return JSON.stringify({ ok: true, cancelled: false, path: path });
    } catch (error) { return JSON.stringify({ ok: false, error: { code: "CHAT_EXPORT_DIALOG_FAILED",
      message: "After Effects could not open the chat export Save dialog." } }); }
}

function aePulseLayerIds(active, state) {
    var ids = [], selected = [], i;
    for (i = 1; i <= active.numLayers; i += 1) {
        var id = 0, isSelected = false;
        try { var each = active.layer(i); id = each.id; isSelected = aeSafe(function () { return !!each.selected; }, false); } catch (ignoredLayer) { id = 0; }
        ids.push(id);
        if (isSelected) selected.push(id);
    }
    state.layerIds = ids.join(","); state.selection = selected.join(",");
}
function aePulseTransformKeys(transform) {
    var keys = "";
    for (var p = 0; p < AE_PULSE_TRANSFORM_PROPERTIES.length; p += 1) {
        var name = AE_PULSE_TRANSFORM_PROPERTIES[p];
        var property = transform ? aeSafeProperty(transform, name) : null;
        keys += (property ? aePulseKeySummary(property) : "-") + ",";
    }
    return keys;
}
function aePulseLayerPart(active, index) {
    try {
        var layer = active.layer(index), transform = aeSafeProperty(layer, "ADBE Transform Group"), keys = aePulseTransformKeys(transform);
        return [layer.id, aeSafe(function () { return String(layer.name); }, "?"), layer.enabled, layer.inPoint, layer.outPoint, layer.startTime,
            aeSafe(function () { return layer.parent ? layer.parent.id : 0; }, 0),
            aeSafe(function () { return layer.property("ADBE Effect Parade").numProperties; }, 0), keys].join("|");
    } catch (ignoredSignature) { return "?"; }
}
function aePulseSignature(active) {
    var parts = [String(active.duration), String(active.frameRate), String(active.width) + "x" + String(active.height), String(active.workAreaStart),
      String(active.workAreaDuration)], i;
    for (i = 1; i <= active.numLayers; i += 1) parts.push(aePulseLayerPart(active, i));
    var text = parts.join(";"), hash = 5381;
    for (i = 0; i < text.length; i += 1) hash = (hash * 33 + text.charCodeAt(i)) % 4294967296;
    return hash.toString(16);
}
function aePulseState() {
    var active = app.project.activeItem, file = app.project.file, isComp = !!active && active instanceof CompItem;
    var state = { active: active, file: file, isComp: isComp, layerIds: null, selection: null, signature: null, detail: "structural" };
    if (isComp && active.numLayers <= 500) aePulseLayerIds(active, state);
    if (isComp && active.numLayers <= AE_PULSE_DETAIL_LAYERS) { state.signature = aePulseSignature(active); state.detail = "detailed"; }
    return state;
}
function aePulseReport(state) {
    var active = state.active;
    return JSON.stringify({ ok: true, project: state.file ? String(state.file.fsName) : "untitled", items: app.project.numItems,
      active: active ? String(active.id) : null, layers: state.isComp ? active.numLayers : null, layerIds: state.layerIds, selection: state.selection,
      signature: state.signature, detail: state.detail, dirty: app.project.dirty === true });
}
/**
 * Cheap project-change signal. Returns JSON {ok:true,project:null} with no project, else
 * {ok:true,project,items,active,layers,layerIds,selection,signature,detail,...}, or {ok:false} when the read throws.
 * Never evaluates expression output; source edits are observed, and dependency or base-value freshness needs a
 * targeted read. It lists one entry per layer id, so deleting and re-adding a layer under the same name still
 * republishes.
 */
function aeProjectPulse() {
    try {
        if (!app.project) return JSON.stringify({ ok: true, project: null });
        return aePulseReport(aePulseState());
    } catch (error) { return JSON.stringify({ ok: false }); }
}
