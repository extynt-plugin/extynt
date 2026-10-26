/** The panel's authenticated API: bearer required, bootstrap, prefs, sessions, thumbnails, chat-log export and the host routes. */
import { decodeOrThrow, jsonValue, type JsonValue } from "@extynt/decode";
import type { UiEvent } from "../src/ui-contract.js";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SIDECAR_VERSION } from "../src/server-contracts.js";
import { uiEventsFor } from "../src/ui-events.js";
import { createFrameStore } from "../src/host/frame-store.js";
import { bindUiHost, uiEventSinkFor } from "../src/ui-host.js";
import { fieldOf, listOf, numberOf, parseJson, readJson, recordOf, textOf } from "./http-json.js";
import { authorization, mutableSnapshot, pause } from "./sidecar-fixture.js";
import { BUILD_LINE, startUiSidecar, type UiHarness } from "./ui-fixture.js";

type Test = { after: (fn: () => void | Promise<void>) => void };
const PNG = "data:image/png;base64,iVBORw0KGgo=";

async function setup(t: Test): Promise<{ harness: UiHarness; api: (method: string, path: string, body?: JsonValue) => Promise<{ status: number; json: JsonValue }> }> {
  const harness = await startUiSidecar(t);
  const api = async (method: string, path: string, body?: JsonValue) => {
    const response = await fetch(`http://127.0.0.1:${harness.port}${path}`, { method, headers: { ...authorization, "content-type": "application/json" }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
    return { status: response.status, json: decodeOrThrow(jsonValue, await readJson(response)) };
  };
  return { harness, api };
}

const session = (title: string, count = 1) => ({ title, project: "Fixture", messages: Array.from({ length: count }, (_unused, index) => ({ kind: "user", text: `m${index}` })) });

test("every UI route needs the bearer token", async (t) => {
  const { harness } = await setup(t);
  const routes: Array<[string, string]> = [["GET", "/v1/ui/bootstrap"], ["GET", "/v1/ui/prefs"], ["PATCH", "/v1/ui/prefs"], ["GET", "/v1/ui/sessions"], ["PUT", "/v1/ui/sessions/a"], ["PUT", "/v1/ui/current-session"], ["GET", "/v1/ui/events"], ["GET", "/v1/thumbs/p1"], ["POST", "/v1/ui/chat-logs/export"], ["POST", "/v1/host/read"]];
  for (const [method, path] of routes) {
    const response = await fetch(`http://127.0.0.1:${harness.port}${path}`, { method, ...(method === "GET" ? {} : { body: "{}" }) });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("bootstrap reports the sidecar, the UI build, host, prefs, session and focus", async (t) => {
  const { harness, api } = await setup(t);
  const empty = (await api("GET", "/v1/ui/bootstrap")).json;
  assert.equal(fieldOf(empty, "ok"), true);
  assert.equal(textOf(empty, "sidecarVersion"), SIDECAR_VERSION);
  assert.equal(textOf(empty, "uiBuild"), "0123456789abcdef");
  assert.equal(textOf(empty, "host.state"), "offline");
  assert.deepEqual([fieldOf(empty, "hostInstanceId"), fieldOf(empty, "nativeAccessQuarantine"), fieldOf(empty, "currentSessionId"), fieldOf(empty, "focus"), fieldOf(empty, "project")], [null, null, null, null, null]);
  assert.deepEqual(recordOf(empty, "prefs"), { askBeforeApplying: "risky", suggestPrompts: true, showThumbnails: true, rateLimit: true, diagnostics: false, language: "auto" });
  harness.sidecar.latest = { snapshot: mutableSnapshot("probe-ui"), receivedAt: "2026-10-04T00:00:00.000Z", bytes: 1 };
  harness.sidecar.liveFocus = { projectPath: null, projectName: "Fixture", epoch: null, revision: 1, activeCompositionId: "comp-1", activeCompositionName: "Main", selected: ["a", "b"], selectedLayers: [{ id: "a", index: 1, name: "Title" }], receivedAt: 77 };
  const filled = (await api("GET", "/v1/ui/bootstrap")).json;
  assert.equal(textOf(filled, "project"), "Fixture");
  assert.deepEqual(recordOf(filled, "focus"), { project: "Fixture", compositionId: "comp-1", compositionName: "Main", selected: 2, layerNames: ["Title"], at: 77, kinds: [], selectionFingerprint: null });
  harness.sidecar.liveFocus = { projectPath: null, projectName: "Fixture", epoch: null, revision: 1, activeCompositionId: "comp-1", activeCompositionName: "Main", selected: ["layer-1"], selectedLayers: [{ id: "layer-1", index: 1, name: "Original" }], receivedAt: Date.now() };
  const fresh = (await api("GET", "/v1/ui/bootstrap")).json;
  assert.deepEqual(fieldOf(fresh, "focus.kinds"), ["text"]);
  assert.equal(typeof fieldOf(fresh, "focus.selectionFingerprint"), "string");
  writeFileSync(join(harness.uiDirectory, "main.js"), "no marker here\n");
  assert.equal(fieldOf((await api("GET", "/v1/ui/bootstrap")).json, "uiBuild"), null);
  writeFileSync(join(harness.uiDirectory, "main.js"), `${BUILD_LINE.replace("0123456789abcdef", "fedcba9876543210")}\nmore\n`);
  assert.equal(textOf((await api("GET", "/v1/ui/bootstrap")).json, "uiBuild"), "fedcba9876543210");
});

test("the live apply's own mutation lease is not a quarantine; an unknown or orphaned one is", async (t) => {
  const { harness, api } = await setup(t);
  const { sidecar } = harness, quarantine = async () => fieldOf((await api("GET", "/v1/ui/bootstrap")).json, "nativeAccessQuarantine");
  sidecar.inFlight = { kind: "apply_plan", id: "plan-1", claimedAt: 0 };
  sidecar.nativeBridge.reserve("owner", { requestId: "req-1", kind: "mutation" }, { kind: "apply_plan", id: "plan-1" });
  assert.notEqual(sidecar.nativeBridge.accessQuarantine(), null, "the bridge itself still refuses native access");
  assert.equal(await quarantine(), null, "an apply in flight is not a pause");
  sidecar.inFlight = { kind: "apply_plan", id: "plan-1", claimedAt: 0, nativeSettlement: "unknown", nativeErrorCode: "HOST_TIMEOUT", nativeAccessKind: "mutation" };
  assert.equal(textOf(await quarantine(), "state"), "unresolved", "a call marked unknown shows");
});

test("a mutation lease with no matching apply in flight (after a restart, or another plan) is a quarantine", async (t) => {
  const { harness, api } = await setup(t);
  const { sidecar } = harness, quarantine = async () => fieldOf((await api("GET", "/v1/ui/bootstrap")).json, "nativeAccessQuarantine");
  sidecar.nativeBridge.reserve("owner", { requestId: "req-1", kind: "mutation" }, { kind: "apply_plan", id: "plan-1" });
  assert.equal(textOf(await quarantine(), "code"), "NATIVE_BRIDGE_RESERVED", "no inFlight: a leftover lease shows");
  sidecar.inFlight = { kind: "apply_plan", id: "plan-2", claimedAt: 0 };
  assert.equal(textOf(await quarantine(), "code"), "NATIVE_BRIDGE_RESERVED", "another plan's lease shows");
});

test("prefs are read and patched, and a bad patch is refused", async (t) => {
  const { harness, api } = await setup(t);
  const patched = await api("PATCH", "/v1/ui/prefs", { askBeforeApplying: "always", diagnostics: true });
  assert.equal(patched.status, 200);
  assert.equal(textOf(patched.json, "prefs.askBeforeApplying"), "always");
  assert.equal(fieldOf((await api("GET", "/v1/ui/prefs")).json, "prefs.diagnostics"), true);
  assert.equal(recordOf(parseJson(readFileSync(join(harness.stateDirectory, "ui-prefs.json"), "utf8")), "").askBeforeApplying, "always");
  const hostile: JsonValue[] = [{ nope: 1 }, { askBeforeApplying: "x" }, { rateLimit: "no" }, []];
  for (const bad of hostile) {
    const refused = await api("PATCH", "/v1/ui/prefs", bad);
    assert.equal(refused.status, 422);
    assert.equal(textOf(refused.json, "error.code"), "UI_PREFS_INVALID");
  }
  assert.equal((await api("PATCH", "/v1/ui/prefs", "{nope")).status, 400);
  assert.equal((await api("PATCH", "/v1/ui/prefs", { askBeforeApplying: "never", pad: "x".repeat(5000) })).status, 413);
});

test("sessions can be stored, listed, read, selected and deleted", async (t) => {
  const { api } = await setup(t);
  const stored = await api("PUT", "/v1/ui/sessions/s1", session("First", 3));
  assert.equal(stored.status, 200);
  assert.equal(textOf(stored.json, "session.id"), "s1");
  assert.equal(listOf(stored.json, "session.messages").length, 3);
  await pause(5);
  await api("PUT", "/v1/ui/sessions/s2", session("Second"));
  assert.equal((await api("PUT", "/v1/ui/current-session", { id: "s1" })).status, 200);
  const listed = (await api("GET", "/v1/ui/sessions")).json;
  assert.deepEqual(listOf(listed, "sessions").map((entry) => textOf(entry, "id")), ["s2", "s1"]);
  assert.equal(numberOf(listed, "sessions.1.messageCount"), 3);
  assert.equal(textOf(listed, "currentSessionId"), "s1");
  assert.equal(textOf((await api("GET", "/v1/ui/sessions/s1")).json, "session.title"), "First");
  assert.equal(textOf((await api("GET", "/v1/ui/bootstrap")).json, "currentSessionId"), "s1");
  assert.equal((await api("DELETE", "/v1/ui/sessions/s1")).status, 200);
  assert.equal(fieldOf((await api("GET", "/v1/ui/sessions")).json, "currentSessionId"), null);
  for (const [method, path] of [["GET", "/v1/ui/sessions/s1"], ["DELETE", "/v1/ui/sessions/s1"], ["GET", "/v1/ui/sessions/bad.id"]]) {
    const missing = await api(method ?? "GET", path ?? "");
    assert.equal(missing.status, 404);
    assert.equal(textOf(missing.json, "error.code"), "UI_SESSION_NOT_FOUND");
  }
  assert.equal((await api("PUT", "/v1/ui/current-session", { id: "s1" })).status, 404);
  assert.equal((await api("PUT", "/v1/ui/current-session", { id: 5 })).status, 422);
  assert.equal(fieldOf((await api("PUT", "/v1/ui/current-session", { id: null })).json, "currentSessionId"), null);
  assert.equal((await api("PUT", "/v1/ui/sessions/s3", { title: 5 })).status, 422);
  assert.equal((await api("PUT", "/v1/ui/sessions/s3", "{")).status, 400);
  const tooBig = await api("PUT", "/v1/ui/sessions/s3", { ...session("Big"), pad: "x".repeat(1024 * 1024) });
  assert.equal(tooBig.status, 413);
  assert.equal(textOf(tooBig.json, "error.code"), "UI_SESSION_TOO_LARGE");
  assert.equal((await api("DELETE", "/v1/ui/sessions")).status, 200);
  assert.deepEqual(listOf((await api("GET", "/v1/ui/sessions")).json, "sessions"), []);
});

test("the chat-log export writes one 0600 file under the state directory's exports folder", async (t) => {
  const { harness, api } = await setup(t);
  const logs = join(harness.stateDirectory, "chat-logs");
  mkdirSync(logs);
  writeFileSync(join(logs, "a.jsonl"), '{"n":1}\n{"n":2}\n\n');
  writeFileSync(join(logs, "b.jsonl"), '{"n":3}\n');
  writeFileSync(join(logs, "ignored.txt"), "nope");
  const exported = await api("POST", "/v1/ui/chat-logs/export");
  assert.equal(exported.status, 200);
  const path = textOf(exported.json, "path");
  assert.equal(path.startsWith(join(harness.stateDirectory, "exports")), true);
  assert.match(path, /\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z(?:-\d)?\.jsonl$/);
  const lines = readFileSync(path, "utf8").trimEnd().split("\n");
  assert.equal(lines.length, 4);
  assert.deepEqual([textOf(parseJson(lines[0] ?? ""), "type"), numberOf(parseJson(lines[0] ?? ""), "sessions")], ["manifest", 2]);
  assert.deepEqual(lines.slice(1), ['{"n":1}', '{"n":2}', '{"n":3}']);
  assert.equal(numberOf(exported.json, "sessions"), 2);
  assert.equal(numberOf(exported.json, "bytes"), statSync(path).size);
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
  await api("POST", "/v1/ui/chat-logs/export");
  assert.equal(readdirSync(join(harness.stateDirectory, "exports")).length, 2);
});

test("the chat-log export refuses a symlinked folder", async (t) => {
  const { harness, api } = await setup(t);
  const elsewhere = mkdtempSync(join(tmpdir(), "ae-ui-elsewhere-"));
  symlinkSync(elsewhere, join(harness.stateDirectory, "exports"));
  const refused = await api("POST", "/v1/ui/chat-logs/export");
  assert.equal(refused.status, 500);
  assert.equal(textOf(refused.json, "error.code"), "CHAT_EXPORT_FAILED");
  assert.deepEqual(readdirSync(elsewhere), []);
});

test("thumbnails are served from the host lane's frame store", async (t) => {
  const { harness, api } = await setup(t);
  const frames = createFrameStore(uiEventSinkFor(harness.sidecar));
  const seen: Array<UiEvent | { type: "poke" }> = [];
  uiEventsFor(harness.sidecar).subscribe((event) => seen.push(event));
  assert.equal((await api("GET", "/v1/thumbs/plan-1")).status, 404, "nothing is bound yet");
  bindUiHost(harness.sidecar, { frames, queueCensus: () => true });
  frames.putThumb("plan-1", "before", { dataUrl: PNG, width: 240, height: 135 });
  assert.deepEqual(seen, [{ type: "thumbs", planId: "plan-1" }]);
  frames.putThumb("plan-1", "after", { dataUrl: PNG, width: 240, height: 135 });
  const found = (await api("GET", "/v1/thumbs/plan-1")).json;
  assert.deepEqual([textOf(found, "before.dataUrl"), textOf(found, "after.dataUrl"), numberOf(found, "after.width")], [PNG, PNG, 240]);
  const missing = await api("GET", "/v1/thumbs/nope");
  assert.equal(missing.status, 404);
  assert.equal(textOf(missing.json, "error.code"), "THUMBS_NOT_FOUND");
  assert.equal((await api("GET", "/v1/thumbs/bad%20id")).status, 404);
});

test("host actions: a full read is refused with the plugin offline and otherwise waits for a newer snapshot", async (t) => {
  const { harness, api } = await setup(t);
  assert.equal((await api("POST", "/v1/host/read", { scope: "compositions" })).status, 422);
  const gone = await api("POST", "/v1/host/read", { scope: "full" });
  assert.equal(gone.status, 409, "with the plugin offline there is nothing to wait for");
  assert.equal(textOf(gone.json, "error.code"), "HOST_OFFLINE");
  const offline = harness.sidecar.hostLink.status();
  harness.sidecar.hostLink = { status: () => ({ ...offline, state: "online" }) };
  const reading = api("POST", "/v1/host/read", { scope: "full" });
  for (let waited = 0; waited < 100 && !harness.sidecar.agentMailbox.some((item) => item.approvedData.kind === "refresh_snapshot"); waited += 1) await pause(10);
  assert.ok(harness.sidecar.agentMailbox.some((item) => item.approvedData.kind === "refresh_snapshot"));
  harness.sidecar.agentMailbox.length = 0;
  harness.sidecar.latest = { snapshot: mutableSnapshot("probe-after"), receivedAt: "2026-10-04T01:00:00.000Z", bytes: 1 };
  harness.sidecar.notifyChange();
  const done = await reading;
  assert.equal(done.status, 200);
  assert.equal(fieldOf(done.json, "refreshed"), true);
});
