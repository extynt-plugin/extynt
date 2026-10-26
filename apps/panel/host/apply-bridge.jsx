/* The stream bridge from the host side: the extynt plugin's hidden "extynt Stream Bridge" command (in no menu; the plugin hands its id to every
 * host-call script as __extyntBridgeCommand) reads and writes streams ExtendScript cannot touch (a Puppet pin's Vertex Offset and Vertex Index). The
 * jsx writes request.json into a private folder under the temp directory, runs the command, and reads response.json. The plugin only lets "set" reach
 * those two pin streams, and only accepts the request from a folder that is private to this user. The token is a single-use nonce that binds the answer
 * to this request; it is not a secret. */
/* global __extyntBridgeCommand */
/* exported aeBridgeCall */
var AE_BRIDGE_SEQUENCE = 0;
function aeBridgeTempDirectory() {
    var names = ["TMPDIR", "TEMP", "TMP"], i, value;
    for (i = 0; i < names.length; i += 1) { value = $.getenv(names[i]); if (value) return String(value).replace(/[\/\\]+$/, ""); }
    return "/tmp";
}
function aeBridgeToken() {
    var chars = "abcdefghijklmnopqrstuvwxyz0123456789", text = "", i;
    for (i = 0; i < 24; i += 1) text += chars.charAt(Math.floor(Math.random() * chars.length));
    AE_BRIDGE_SEQUENCE += 1;
    return text + "-" + new Date().getTime() + "-" + AE_BRIDGE_SEQUENCE;
}
function aeBridgeCommandId() { return (typeof __extyntBridgeCommand === "number" && __extyntBridgeCommand > 0) ? __extyntBridgeCommand : 0; }
function aeBridgeExchange(commandId, request, response, requestText) {
    var text = "";
    try {
        request.open("w"); request.write(requestText); request.close();
        app.executeCommand(commandId);
        if (response.exists) { response.open("r"); text = response.read(); response.close(); }
    } finally {
        if (response.exists) response.remove();
        if (request.exists) request.remove();
    }
    return text;
}
// ops: [{op:"get"|"list"|"set", path:[{match}|{index}], value}]. Returns the plugin's results array; throws when the bridge is missing or refuses.
function aeBridgeCall(comp, layer, ops) {
    var id = aeBridgeCommandId();
    if (!id) throw new Error("BRIDGE_MISSING: the extynt plugin's stream bridge is not installed in this After Effects (reinstall the plugin and restart).");
    var folder = new Folder(aeBridgeTempDirectory() + "/extynt-stream-bridge");
    if (!folder.exists) folder.create();
    var token = aeBridgeToken(), request = new File(folder.fsName + "/request.json"), response = new File(folder.fsName + "/response.json");
    if (response.exists) response.remove();
    var text = aeBridgeExchange(id, request, response, JSON.stringify({ token: token, compId: Number(comp.id), layerId: Number(layer.id), ops: ops }));
    if (!text) throw new Error("BRIDGE_NO_ANSWER: the stream bridge did not answer.");
    var parsed = JSON.parse(text);
    if (!parsed.ok) throw new Error("BRIDGE_REFUSED: " + parsed.error);
    if (parsed.token !== token) throw new Error("BRIDGE_REFUSED: the answer was not for this request.");
    return parsed.results;
}
