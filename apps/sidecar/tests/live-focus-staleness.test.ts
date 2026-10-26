/** The live focus when it is wrong, stale or missing: an unsaved project is one project, a stale report is never compared, and the sidecar asks a bounded number of times. */
import { fieldOf, flagOf, parseJson, readJson, recordOf, textOf, type JsonObject } from "./http-json.js";
import { decode } from "@extynt/decode";
import { authorization, chatTurn, mutableSnapshot, onlineHostLink, pause, sidecarFor, token } from "./sidecar-fixture.js";
import { offlineHostLink } from "../src/host/lane-types.js";
import { FOCUS_FRESH_MS, focusAgeMs, focusDifference, type LiveFocus } from "../src/live-focus.js";
import { focusOf, liveFocusReport } from "../src/live-focus-report.js";
import { MockProvider } from "@extynt/llm";
import { PLAN_EXAMPLES } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { present } from "./present.js";

const body = (over: JsonObject = {}) => ({ schemaVersion: "0.1", projectPath: null, projectName: "Fixture", epoch: null, revision: 7, activeCompositionId: "comp-1", activeCompositionName: "Main", selected: ["layer-1"], selectedLayers: [{ id: "layer-1", index: 1, name: "Original" }], ...over });
const snapshotWith = (requestId: string, result: JsonObject = {}) => { const base = mutableSnapshot(requestId); return { ...base, result: { ...base.result, ...result } }; };
const live = (over: Partial<LiveFocus> = {}): LiveFocus => ({ projectPath: null, projectName: "Fixture", epoch: null, revision: 7, activeCompositionId: "comp-1", activeCompositionName: "Main", selected: ["layer-1"], selectedLayers: [], receivedAt: 0, ...over });
type FocusRead = Parameters<typeof focusDifference>[1];
const read = (over: Partial<FocusRead> = {}): FocusRead => ({ project: { name: "Fixture", filePath: null }, activeCompositionId: "comp-1", selection: { compositionId: "comp-1", layerIds: ["layer-1"] }, ...over });
const UNTITLED_READ = { project: { name: "Untitled Project", filePath: null } };

async function start(t: { after: (fn: () => void) => void }, options: Partial<Parameters<typeof sidecarFor>[0]> = {}) {
  const clock = { ms: Date.parse("2026-10-03T12:00:00.000Z") };
  const sidecar = sidecarFor({ port: 0, token, panelSessionId: "panel-stale", panelSnapshotWaitMs: 150, quietAgentLog: true, now: () => new Date(clock.ms), ...options });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`, json = { ...authorization, "content-type": "application/json" };
  const post = <T>(path: string, value: T) => fetch(`${base}${path}`, { method: "POST", headers: json, body: JSON.stringify(value) });
  const refreshes = () => sidecar.agentMailbox.filter((item) => item.approvedData.kind === "refresh_snapshot").length;
  const log = () => { try { return readFileSync(join(String(sidecar.options.stateDirectory), "pipeline.log"), "utf8"); } catch { return ""; } };
  const count = (event: string) => log().split("\n").filter((line) => line.includes(`"event":"${event}"`)).length;
  const health = async () => readJson(await fetch(`${base}/health`, { headers: authorization }));
  const readLands = async (requestId: string, result: JsonObject = {}) => { clock.ms += 10; await post("/v1/snapshots", snapshotWith(requestId, result)); };
  await post("/v1/snapshots", snapshotWith("probe-stale", {}));
  return { sidecar, address, base, clock, post, refreshes, log, count, health, readLands, focus: (over: JsonObject = {}) => post("/v1/panel/focus", body(over)) };
}

test("an unsaved project is one project whichever placeholder name the pulse and the read give it", () => {
  const untitled = live({ projectName: "Untitled" });
  assert.equal(focusDifference(untitled, read(UNTITLED_READ)), null, "the pulse says Untitled, the project read says Untitled Project");
  assert.equal(focusDifference(live({ projectName: "untitled project" }), read({ project: { name: "Untitled", filePath: null } })), null, "case and either placeholder");
  assert.equal(focusDifference(live({ projectName: "Untitled", epoch: 3 }), read({ ...UNTITLED_READ, hostStamp: { epoch: 3, revision: 1 } })), null);
  assert.equal(focusDifference(live({ projectName: "Untitled", epoch: 4 }), read({ ...UNTITLED_READ, hostStamp: { epoch: 3, revision: 1 } })), "project", "a different unsaved project (File > New) still differs by its epoch");
  assert.equal(focusDifference(untitled, read({ project: { name: "Hero", filePath: null } })), "project", "a name that is not a placeholder is a different project");
  assert.equal(focusDifference(untitled, read({ project: { name: "Untitled Project", filePath: "/p/a.aep" } })), "project", "saved since");
});

test("a project the pulse calls Untitled and the read calls Untitled Project no longer re-asks for a read every ten seconds", async (t) => {
  const h = await start(t);
  await h.post("/v1/snapshots", snapshotWith("probe-untitled", UNTITLED_READ));
  await h.focus({ projectName: "Untitled" });
  for (let beat = 0; beat < 6; beat += 1) { h.clock.ms += 10_500; await h.focus({ projectName: "Untitled", revision: 8 + beat }); }
  assert.equal(h.refreshes(), 0); assert.equal(h.count("focus.refresh-requested"), 0, "the storm: one request per keepalive, forever");
  const health = await h.health();
  assert.equal(flagOf(health, "liveFocus.matchesSnapshot"), true); assert.equal(textOf(health, "liveFocus.snapshotProject"), "Untitled Project");
});

test("a real difference that survives a completed read is asked about twice, then given up on once, until either side changes", async (t) => {
  const h = await start(t);
  const keepalive = async () => { h.clock.ms += 10_500; await h.sidecar.agentMailbox.splice(0); await h.focus({ projectName: "Other.aep", projectPath: "/p/Other.aep" }); };
  await h.focus({ projectName: "Other.aep", projectPath: "/p/Other.aep" });
  for (let beat = 0; beat < 6; beat += 1) await keepalive();
  assert.equal(h.count("read.scheduled"), 2, "asked twice for the same pair, whatever the panel does with the request");
  assert.equal(h.count("read.gave-up"), 1, "and says so once");
  await h.readLands("probe-same", {});
  await keepalive();
  assert.equal(h.count("read.scheduled"), 2, "a read of the same project is the same pair");
  await h.readLands("probe-moved", { selectedLayerIds: ["layer-1", "layer-2"] });
  await keepalive();
  assert.equal(h.count("read.scheduled"), 2, "selection is not part of the pair: the overlay answers it");
  await h.readLands("probe-other-project", { project: { name: "Moved.aep", filePath: "/p/Moved.aep" } });
  await h.focus({ projectName: "Third.aep", projectPath: "/p/Third.aep" });
  assert.equal(h.count("read.scheduled"), 3, "a live view that moved to another project is a new pair");
});

test("a report whose pulse is old is stale: present, not fresh, not compared, and never a reason to re-read", async (t) => {
  const h = await start(t);
  await h.focus({ projectName: "Other.aep", projectPath: "/p/Other.aep", observedAt: h.clock.ms - 20_000 });
  assert.equal(h.refreshes(), 0, "an old body re-posted by a keepalive starts nothing");
  const health = await h.health();
  assert.equal(flagOf(health, "liveFocus.present"), true); assert.equal(flagOf(health, "liveFocus.fresh"), false);
  assert.equal(fieldOf(health, "liveFocus.ageMs"), 20_000); assert.equal(fieldOf(health, "liveFocus.receivedAgeMs"), 0);
  assert.equal(fieldOf(health, "liveFocus.matchesSnapshot"), null); assert.equal(fieldOf(health, "liveFocus.difference"), null);
  h.clock.ms += 5_000; await h.focus({ observedAt: h.clock.ms - 100 });
  assert.equal(flagOf(await h.health(), "liveFocus.fresh"), true, "a pulse that answered a moment ago makes it fresh again");
});

test("a report that arrived long ago is stale with no observedAt, and an observedAt from the future ages from its arrival", () => {
  assert.equal(focusAgeMs(live({ receivedAt: 1_000 }), 31_000), 30_000);
  assert.equal(focusAgeMs(live({ receivedAt: 1_000, observedAt: 500 }), 31_000), 30_500, "observed before it arrived: the older time counts");
  assert.equal(focusAgeMs(live({ receivedAt: 1_000, observedAt: 90_000 }), 31_000), 30_000, "never later than the arrival");
  assert.equal(focusAgeMs(live({ receivedAt: 5_000 }), 1_000), 0);
  assert.equal(FOCUS_FRESH_MS, 15_000);
});

test("observedAt is optional, a non-negative integer, and the only field added to the strict report", () => {
  const ok = decode(liveFocusReport, body({ observedAt: 1_700_000_000_000 }));
  assert.equal(ok.ok && focusOf(ok.value, 1_700_000_000_500).observedAt, 1_700_000_000_000);
  const without = decode(liveFocusReport, body());
  assert.equal(without.ok && "observedAt" in focusOf(without.value, 5), false);
  for (const bad of [-1, 1.5, "1700", null, Number.MAX_SAFE_INTEGER + 2]) assert.equal(decode(liveFocusReport, body({ observedAt: bad })).ok, false, `observedAt ${String(bad)}`);
  assert.equal(decode(liveFocusReport, body({ observedAt: 5, extra: 1 })).ok, false, "other unknown fields stay refused");
});

test("with no live view and a panel connected, one bounded re-read is asked for and the answer carries a note", async (t) => {
  const h = await start(t);
  h.clock.ms += 20_000;
  const pending = h.sidecar.ensureFocusCurrent(5);
  while (h.refreshes() === 0) await pause(5);
  await pause(20); assert.equal(h.refreshes(), 1, "one item however long it takes");
  await h.readLands("probe-after-unavailable");
  const outcome = await pending;
  assert.equal(outcome.state, "refreshed"); assert.match(outcome.note ?? "", /Live selection from After Effects is unavailable.*the project was re-read just now/);
  assert.match(h.log(), /"event":"focus\.refresh-requested".*"reason":"unavailable"/);
});

test("a stale live view is treated the same way, and a re-read that never lands is a note, not a failure", async (t) => {
  const h = await start(t);
  await h.focus({ observedAt: h.clock.ms }); h.clock.ms += 20_000;
  const outcome = await h.sidecar.ensureFocusCurrent(0.3);
  assert.equal(outcome.state, "timeout"); assert.match(outcome.note ?? "", /Live selection from After Effects is unavailable and the project could not be re-read.*selection .* may be out of date/);
  assert.equal(h.refreshes(), 1); assert.match(h.log(), /"event":"focus\.refresh-timeout".*"reason":"unavailable"/);
});

test("nothing is asked when no panel is connected, when there is no read, or when the read is moments old", async (t) => {
  const h = await start(t);
  h.clock.ms += 20_000; h.sidecar.hostLink = offlineHostLink(0);
  assert.equal((await h.sidecar.ensureFocusCurrent(0.2)).state, "unknown", "After Effects is not connected"); assert.equal(h.refreshes(), 0);
  h.sidecar.hostLink = onlineHostLink(); await h.readLands("probe-moments-ago");
  assert.equal((await h.sidecar.ensureFocusCurrent(0.2)).state, "unknown", "a read a few milliseconds old is as good as a re-read"); assert.equal(h.refreshes(), 0);
  h.sidecar.latest = undefined; h.clock.ms += 20_000;
  assert.equal((await h.sidecar.ensureFocusCurrent(0.2)).state, "unknown", "no read to doubt"); assert.equal(h.refreshes(), 0);
});

test("the briefing of a turn says the live selection is unavailable instead of trusting the last read silently", async (t) => {
  const provider = new MockProvider({ answer: "ok" });
  const h = await start(t, { chatProvider: provider });
  h.clock.ms += 20_000;
  await chatTurn(h.address, "rename the selected layer");
  assert.match(present(provider.stepInputs[0]).system, /Live selection from After Effects is unavailable and the project could not be re-read/);
  assert.equal(h.refreshes(), 1);
});

const firstExample = (): JsonObject => recordOf(parseJson(JSON.stringify(Object.values(PLAN_EXAMPLES)[0]).replace(/"compositionId":"C"/g, '"compositionId":"comp-1"').replace(/"layerId":"L"/g, '"layerId":"layer-1"')), "");

test("an agent's plan-authoring call gets the note too; the panel's own calls and the context tools do not wait", async (t) => {
  const h = await start(t);
  h.clock.ms += 20_000;
  const call = async (name: string, args: JsonObject, agent: boolean) => {
    const response = await fetch(`${h.base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", ...(agent ? { "X-AE-Client": "agent" } : {}) }, body: JSON.stringify({ name, arguments: { ...(agent ? { waitSeconds: 0 } : {}), ...args } }) });
    return readJson(response);
  };
  assert.equal(fieldOf(await call("ae_get_current_context", {}, true), "focusNote"), undefined); assert.equal(h.refreshes(), 0, "a context read is not a plan-creating call");
  assert.equal(fieldOf(await call("ae_propose_plan", firstExample(), false), "focusNote"), undefined); assert.equal(h.refreshes(), 0, "only agent calls are gated");
  const proposed = await call("ae_propose_plan", firstExample(), true);
  assert.match(String(fieldOf(proposed, "focusNote")), /Live selection from After Effects is unavailable/); assert.equal(h.refreshes(), 1);
});
