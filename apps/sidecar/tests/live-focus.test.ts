/** The live focus: the panel's report of what After Effects shows, and the sidecar's check of its own read before the agent acts. */
import { fieldOf, flagOf, parseJson, readJson, recordOf, textOf, type JsonObject } from "./http-json.js";
import { decode, isJsonObject } from "@extynt/decode";
import { authorization, chatTurn, mutableSnapshot, pause, sidecarFor, token, validSnapshot } from "./sidecar-fixture.js";
import { offlineHostLink } from "../src/host/lane-types.js";
import { focusDifference, type LiveFocus } from "../src/live-focus.js";
import { focusOf, liveFocusReport } from "../src/live-focus-report.js";
import { MockProvider } from "@extynt/llm";
import { PLAN_EXAMPLES } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { present } from "./present.js";

const body = (over: JsonObject = {}) => ({ schemaVersion: "0.1", projectPath: null, projectName: "Fixture", epoch: null, revision: 7, activeCompositionId: "comp-1", activeCompositionName: "Main", selected: ["layer-1"], selectedLayers: [{ id: "layer-1", index: 1, name: "Original" }], ...over });
const withCompositions = (requestId: string, ids: string[]) => {
  const base = mutableSnapshot(requestId), main = present(base.result.compositions[0]);
  return { ...base, result: { ...base.result, activeCompositionId: present(ids[0]), compositions: [main, ...ids.map((id) => ({ ...main, id, name: `Comp ${id}`, layers: [] }))] } };
};
const live = (over: Partial<LiveFocus> = {}): LiveFocus => ({ projectPath: null, projectName: "Fixture", epoch: null, revision: 7, activeCompositionId: "comp-1", activeCompositionName: "Main", selected: ["layer-1"], selectedLayers: [], receivedAt: 0, ...over });
const SCOPED = { kind: "composition-metadata" as const, compositionId: "comp-1", properties: "unknown" as const, otherCompositions: "unknown" as const };
type FocusRead = Parameters<typeof focusDifference>[1];
const read = (over: Partial<FocusRead> = {}): FocusRead => ({ project: { name: "Fixture", filePath: null }, activeCompositionId: "comp-1", selection: { compositionId: "comp-1", layerIds: ["layer-1"] }, ...over });

async function start(t: { after: (fn: () => void) => void }, options: Partial<Parameters<typeof sidecarFor>[0]> = {}) {
  const clock = { ms: Date.parse("2026-10-03T12:00:00.000Z") };
  const sidecar = sidecarFor({ port: 0, token, panelSessionId: "panel-focus", panelSnapshotWaitMs: 150, quietAgentLog: true, now: () => new Date(clock.ms), ...options });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`, json = { ...authorization, "content-type": "application/json" };
  const post = <T>(path: string, value: T, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method: "POST", headers: { ...json, ...headers }, body: typeof value === "string" ? value : JSON.stringify(value) });
  const call = async (name: string, args: JsonObject = {}, agent = true): Promise<JsonObject> => {
    const answer = await readJson(await post("/v1/mcp/tools/call", { name, arguments: { ...(agent ? { waitSeconds: 0 } : {}), ...args } }, agent ? { "X-AE-Client": "agent" } : {}));
    return isJsonObject(answer) ? answer : {};
  };
  const refreshes = () => sidecar.agentMailbox.filter((item) => item.approvedData.kind === "refresh_snapshot").length;
  const log = () => { try { return readFileSync(join(String(sidecar.options.stateDirectory), "pipeline.log"), "utf8"); } catch { return ""; } };
  await post("/v1/snapshots", mutableSnapshot("probe-focus"));
  return { sidecar, base, clock, post, call, refreshes, log, focus: (over: JsonObject = {}) => post("/v1/panel/focus", body(over)) };
}

test("the focus route takes a report, shows it on /health, and tells the log what changed", async (t) => {
  const h = await start(t);
  assert.equal((await h.focus()).status, 200);
  const health = await readJson(await fetch(`${h.base}/health`, { headers: authorization }));
  assert.equal(flagOf(health, "liveFocus.present"), true); assert.equal(flagOf(health, "liveFocus.fresh"), true); assert.equal(flagOf(health, "liveFocus.matchesSnapshot"), true);
  assert.equal(textOf(health, "liveFocus.projectName"), "Fixture"); assert.equal(fieldOf(health, "liveFocus.ageMs"), 0); assert.equal(fieldOf(health, "liveFocus.selectedCount"), 1);
  assert.match(h.log(), /"event":"focus\.changed".*"selected":1/);
  await h.focus({ selected: ["layer-9"], selectedLayers: [] }); h.clock.ms += 3000;
  const behind = await readJson(await fetch(`${h.base}/health`, { headers: authorization }));
  assert.equal(flagOf(behind, "liveFocus.matchesSnapshot"), true, "the selection is laid over the read, so a moved selection is no difference"); assert.equal(fieldOf(behind, "liveFocus.difference"), null); assert.equal(fieldOf(behind, "liveFocus.ageMs"), 3000);
  await h.focus({ activeCompositionId: "comp-9", activeCompositionName: "Elsewhere", selected: [], selectedLayers: [] });
  const other = await readJson(await fetch(`${h.base}/health`, { headers: authorization }));
  assert.equal(flagOf(other, "liveFocus.matchesSnapshot"), false); assert.equal(textOf(other, "liveFocus.difference"), "composition");
});

test("health without a report says there is none", async (t) => {
  const h = await start(t);
  assert.equal(flagOf(await readJson(await fetch(`${h.base}/health`, { headers: authorization })), "liveFocus.present"), false);
});

test("the focus route is strict: unknown fields, wrong types and oversize lists are refused", async (t) => {
  const h = await start(t);
  const refused = async (over: JsonObject, why: string) => { const response = await h.focus(over); assert.equal(response.status, 422, why); assert.equal(textOf(await readJson(response), "error.code"), "INVALID_FOCUS", why); };
  await refused({ extra: 1 }, "an unknown field");
  await refused({ schemaVersion: "0.2" }, "another schema");
  await refused({ projectName: 5 }, "a name that is not text");
  await refused({ projectName: "x".repeat(513) }, "a name over 512");
  await refused({ projectPath: "p".repeat(4097) }, "a path over 4096");
  await refused({ epoch: -1 }, "a negative epoch"); await refused({ revision: 1.5 }, "a fractional revision");
  await refused({ activeCompositionId: "bad id!" }, "an id with spaces");
  await refused({ selected: Array.from({ length: 257 }, (_, i) => `l${i}`), selectedLayers: [] }, "257 selected ids");
  await refused({ selected: ["a b"], selectedLayers: [] }, "an id that is not an id");
  await refused({ selectedLayers: Array.from({ length: 65 }, (_, i) => ({ id: "layer-1", index: i, name: "n" })) }, "65 named layers");
  await refused({ selectedLayers: [{ id: "layer-7", index: 1, name: "not selected" }] }, "a named layer that is not selected");
  await refused({ selectedLayers: [{ id: "layer-1", index: 1, name: "n", extra: true }] }, "an unknown layer field");
  await refused({ selectedLayers: [{ id: "layer-1", index: "1", name: "n" }] }, "an index that is text");
  assert.equal((await h.post("/v1/panel/focus", [])).status, 422, "not an object");
  assert.equal((await h.post("/v1/panel/focus", "{nope")).status, 400);
  assert.equal(h.sidecar.liveFocus, null, "nothing refused was kept");
  assert.equal((await h.focus({ selected: Array.from({ length: 256 }, (_, i) => `l${i}`), selectedLayers: [] })).status, 200, "256 ids is the limit, not past it");
});

test("an oversized focus report is refused before it is parsed", async (t) => {
  const h = await start(t);
  const response = await h.post("/v1/panel/focus", JSON.stringify(body({ projectName: "x".repeat(40_000) })));
  assert.equal(response.status, 413); assert.equal(textOf(await readJson(response), "error.code"), "BODY_LIMIT");
  assert.equal(h.sidecar.liveFocus, null);
});

test("the focus route needs the session token and the paired panel", async (t) => {
  const h = await start(t);
  assert.equal((await fetch(`${h.base}/v1/panel/focus`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body()) })).status, 401);
  h.sidecar.activePanelInstanceId = "panel-a";
  assert.equal((await h.post("/v1/panel/focus", body(), { "X-AE-Panel-Instance": "panel-old" })).status, 409, "a panel from an earlier session");
  assert.equal((await h.post("/v1/panel/focus", body())).status, 409, "no instance at all, while one is paired");
  assert.equal((await h.post("/v1/panel/focus", body(), { "X-AE-Panel-Instance": "panel-a" })).status, 200);
});

test("matching focus gives no refresh; a revision-only difference gives none either", async (t) => {
  const h = await start(t);
  await h.focus();
  assert.equal((await h.sidecar.ensureFocusCurrent(0.2)).state, "current"); assert.equal(h.refreshes(), 0);
  await h.focus({ revision: 99 });
  assert.equal((await h.sidecar.ensureFocusCurrent(0.2)).state, "current", "edits move the revision; lineage and the apply check own them"); assert.equal(h.refreshes(), 0);
});

test("a different selection is the sidecar's to follow: no refresh is asked for, however many reports move it", async (t) => {
  const h = await start(t);
  await h.focus({ selected: ["layer-2"], selectedLayers: [{ id: "layer-2", index: 2, name: "Other" }] });
  assert.equal((await h.sidecar.ensureFocusCurrent(0.2)).state, "current");
  await h.focus({ selected: [], selectedLayers: [] }); await h.focus({ selected: ["layer-1", "layer-7"], selectedLayers: [] });
  assert.equal((await h.sidecar.ensureFocusCurrent(0.2)).state, "current"); assert.equal(h.refreshes(), 0);
  assert.doesNotMatch(h.log(), /focus\.refresh-requested/);
});

test("another open composition is a difference too, and a read that never lands proceeds with a note", async (t) => {
  const h = await start(t);
  await h.focus({ activeCompositionId: "comp-2", activeCompositionName: "Other comp" });
  const outcome = await h.sidecar.ensureFocusCurrent(0.3);
  assert.equal(outcome.state, "timeout"); assert.match(outcome.note ?? "", /different composition than the last read.*ae_refresh_snapshot/);
  assert.equal(h.refreshes(), 1);
  assert.match(h.log(), /"event":"focus\.refresh-timeout".*"reason":"composition"/);
});

test("a read that lands before the focus report that agrees with it still counts", async (t) => {
  const h = await start(t);
  await h.focus({ activeCompositionId: "comp-2", activeCompositionName: "Two", selected: [], selectedLayers: [] });
  const pending = h.sidecar.ensureFocusCurrent(6);
  while (h.refreshes() === 0) await pause(5);
  h.clock.ms += 10; await h.post("/v1/snapshots", withCompositions("probe-late", ["comp-3"]));
  await pause(30); await h.focus({ activeCompositionId: "comp-3", activeCompositionName: "Three", selected: [], selectedLayers: [] });
  assert.equal((await pending).state, "refreshed", "the focus report that followed the read agreed with it");
  assert.match(h.log(), /"event":"focus\.refresh-requested".*"reason":"composition"/); assert.doesNotMatch(h.log(), /focus\.refresh-timeout/);
});

test("a read that lands and still lacks the newest focus's composition is given up on with a note", async (t) => {
  const h = await start(t);
  await h.focus({ activeCompositionId: "comp-2", activeCompositionName: "Two", selected: [], selectedLayers: [] });
  const pending = h.sidecar.ensureFocusCurrent(2.7);
  while (h.refreshes() === 0) await pause(5);
  h.clock.ms += 10; await h.post("/v1/snapshots", withCompositions("probe-wrong", ["comp-3"]));
  const outcome = await pending;
  assert.equal(outcome.state, "timeout"); assert.match(outcome.note ?? "", /Selection may be out of date.*different composition/);
});

test("a focus report older than 15 s says nothing and starts no refresh", async (t) => {
  const h = await start(t);
  await h.focus({ selected: ["layer-9"], selectedLayers: [] }); h.clock.ms += 15_001; h.sidecar.hostLink = offlineHostLink(0);
  assert.equal((await h.sidecar.ensureFocusCurrent(0.2)).state, "unknown"); assert.equal(h.refreshes(), 0);
  const health = await readJson(await fetch(`${h.base}/health`, { headers: authorization }));
  assert.equal(flagOf(health, "liveFocus.fresh"), false);
});

test("no report and no snapshot are both left to the panel's own checks", async (t) => {
  const h = await start(t);
  assert.equal((await h.sidecar.ensureFocusCurrent(0.1)).state, "unknown"); assert.equal(h.refreshes(), 0);
  h.sidecar.latest = undefined; await h.focus();
  assert.equal((await h.sidecar.ensureFocusCurrent(0.1)).state, "unknown");
});

test("another project is marked at once: a refresh is queued on the report itself, once, and the context tools say so", async (t) => {
  const h = await start(t);
  await h.focus({ projectName: "Other.aep", projectPath: "/p/Other.aep" });
  assert.equal(h.refreshes(), 1); assert.match(h.log(), /"event":"focus\.project-switched".*"project":"Other\.aep"/);
  await h.focus({ projectName: "Other.aep", projectPath: "/p/Other.aep", revision: 8 });
  assert.equal(h.refreshes(), 1, "a keepalive of the same switch does not stack another");
  const context = await h.call("ae_get_current_context");
  assert.match(String(context.focusNote), /Project changed: After Effects now has "Other\.aep" open, but the last read is of "Fixture"/);
  const health = h.sidecar.focusHealth();
  assert.equal(health.present && health.difference, "project");
  h.clock.ms += 10_500; await h.focus({ projectName: "Other.aep", projectPath: "/p/Other.aep" });
  assert.equal(h.refreshes(), 1, "the item is still waiting, so there is still only one");
});

test("the briefing of a turn names the project change instead of presenting the old project as current", async (t) => {
  const provider = new MockProvider({ answer: "ok" });
  const h = await start(t, { chatProvider: provider });
  await h.focus({ projectName: "Other.aep", projectPath: "/p/Other.aep" });
  await chatTurn({ host: new URL(h.base).hostname, port: Number(new URL(h.base).port) }, "what is in this project?");
  const briefing = present(provider.stepInputs[0]).system;
  assert.match(briefing, /Project changed: After Effects now has "Other\.aep" open, but the last read is of "Fixture"/);
  assert.match(briefing, /ae_refresh_snapshot/);
});

test("a turn whose read matches carries no note and starts no refresh", async (t) => {
  const provider = new MockProvider({ answer: "ok" });
  const h = await start(t, { chatProvider: provider });
  await h.focus();
  await chatTurn({ host: new URL(h.base).hostname, port: Number(new URL(h.base).port) }, "hi");
  assert.doesNotMatch(present(provider.stepInputs[0]).system, /Project changed|Selection may be out of date/); assert.equal(h.refreshes(), 0);
});

test("a turn whose selection differs asks for no read and carries no note: the selection is laid over the read", async (t) => {
  const provider = new MockProvider({ answer: "ok" });
  const h = await start(t, { chatProvider: provider });
  await h.focus({ selected: ["layer-2"], selectedLayers: [] });
  await chatTurn({ host: new URL(h.base).hostname, port: Number(new URL(h.base).port) }, "rename the selected layer");
  assert.equal(h.refreshes(), 0); assert.doesNotMatch(present(provider.stepInputs[0]).system, /Selection may be out of date/);
});

test("a turn whose composition differs asks for a read first and goes on with a note when none arrives", async (t) => {
  const provider = new MockProvider({ answer: "ok" });
  const h = await start(t, { chatProvider: provider });
  await h.focus({ activeCompositionId: "comp-2", activeCompositionName: "Two", selected: [], selectedLayers: [] });
  await chatTurn({ host: new URL(h.base).hostname, port: Number(new URL(h.base).port) }, "rename the selected layer");
  assert.equal(h.refreshes(), 1); assert.match(present(provider.stepInputs[0]).system, /Selection may be out of date/);
});

const firstExample = (): JsonObject => recordOf(parseJson(JSON.stringify(Object.values(PLAN_EXAMPLES)[0]).replace(/"compositionId":"C"/g, '"compositionId":"comp-1"').replace(/"layerId":"L"/g, '"layerId":"layer-1"')), "");

test("ae_propose_plan and ae_approve_plan from an agent check the focus first; the panel's own calls and other tools do not", async (t) => {
  const h = await start(t);
  await h.focus();
  const proposed = await h.call("ae_propose_plan", firstExample());
  assert.equal(proposed.ok, true); assert.equal(proposed.focusNote, undefined, "a matching focus adds nothing"); assert.equal(h.refreshes(), 0);
  const planId = String(fieldOf(proposed, "data.planId"));
  await h.focus({ activeCompositionId: "comp-4", activeCompositionName: "Four", selected: [], selectedLayers: [] });
  assert.equal(h.refreshes(), 1, "the scheduler asks for the unknown composition on the report itself, before any tool is called");
  h.sidecar.agentMailbox.splice(0);
  const quiet = await h.call("ae_get_plan_status", { planId });
  assert.equal(quiet.focusNote, undefined); assert.equal(h.refreshes(), 0, "a status read is not a plan-creating call");
  const panelCall = await h.call("ae_get_current_context", {}, false);
  assert.equal(panelCall.focusNote, undefined); assert.equal(h.refreshes(), 0, "only agent calls are gated");
  const second = await h.call("ae_propose_plan", firstExample());
  assert.equal(second.ok, true); assert.match(String(second.focusNote), /Selection may be out of date/); assert.equal(h.refreshes(), 1, "proposing re-reads when the open composition moved");
  await h.sidecar.agentMailbox.splice(0);
  const approved = await h.call("ae_approve_plan", { planId, acknowledgeUnverified: true });
  assert.match(String(approved.focusNote), /Selection may be out of date/); assert.equal(h.refreshes(), 1, "approving re-reads too");
});

test("the plan authoring tools are gated alike", async (t) => {
  const h = await start(t);
  await h.focus({ activeCompositionId: "comp-4", activeCompositionName: "Four", selected: [], selectedLayers: [] });
  for (const name of ["ae_plan_create", "ae_plan_add", "ae_offer_variants"]) {
    h.sidecar.agentMailbox.splice(0);
    await h.call(name, { summary: "x", operations: [] });
    assert.equal(h.refreshes(), 1, `${name} asks for a read`);
  }
});

test("project identity: a path decides, an unsaved project is told by its name, the epoch only when both sides carry one", () => {
  assert.equal(focusDifference(live(), read()), null);
  assert.equal(focusDifference(live({ projectPath: "/p/a.aep" }), read({ project: { name: "a.aep", filePath: "/p/a.aep" } })), null);
  assert.equal(focusDifference(live({ projectPath: "/p/b.aep" }), read({ project: { name: "a.aep", filePath: "/p/a.aep" } })), "project");
  assert.equal(focusDifference(live({ projectPath: "/p/a.aep" }), read()), "project", "a project that has been saved since");
  assert.equal(focusDifference(live({ projectName: "Other" }), read()), "project");
  assert.equal(focusDifference(live({ epoch: 3 }), read({ hostStamp: { epoch: 3, revision: 1 } })), null);
  assert.equal(focusDifference(live({ epoch: 4 }), read({ hostStamp: { epoch: 3, revision: 1 } })), "project", "the same file opened again");
  assert.equal(focusDifference(live({ epoch: 4 }), read()), null, "a read without a stamp has no epoch to compare");
  assert.equal(focusDifference(live({ revision: 12 }), read({ hostStamp: { epoch: 1, revision: 1 } })), null);
});

test("selection: the set of ids decides, order does not, a scoped read says nothing, a cut-off list only has to be contained", () => {
  const many = Array.from({ length: 256 }, (_, i) => `l${i}`);
  assert.equal(focusDifference(live({ selected: ["a", "b"] }), read({ selection: { compositionId: "comp-1", layerIds: ["b", "a"] } })), null);
  assert.equal(focusDifference(live({ selected: ["a"] }), read({ selection: { compositionId: "comp-1", layerIds: ["a", "b"] } })), "selection");
  assert.equal(focusDifference(live({ selected: [] }), read()), "selection");
  assert.equal(focusDifference(live({ activeCompositionId: null, selected: [] }), read({ activeCompositionId: null, selection: { compositionId: null, layerIds: [] } })), null);
  assert.equal(focusDifference(live({ selected: ["x"] }), read({ coverage: SCOPED })), null, "a scoped read lists only what it was asked about");
  assert.equal(focusDifference(live({ activeCompositionId: "comp-2" }), read({ coverage: SCOPED })), null, "a scoped read is bound to its own composition: another one being open is no difference");
  assert.equal(focusDifference(live({ projectName: "Other.aep", projectPath: "/other.aep" }), read({ coverage: SCOPED })), "project", "another project still is");
  assert.equal(focusDifference(live({ selected: many }), read({ selection: { compositionId: "comp-1", layerIds: [...many, "more", "and more"] } })), null);
  assert.equal(focusDifference(live({ selected: [...many.slice(1), "z"] }), read({ selection: { compositionId: "comp-1", layerIds: many } })), "selection");
});

test("a decoded focus report keeps what it accepted, with the time it arrived", () => {
  const parsed = decode(liveFocusReport, body());
  assert.equal(parsed.ok, true);
  if (parsed.ok) { const focus = focusOf(parsed.value, 1234); assert.equal(focus.receivedAt, 1234); assert.deepEqual(focus.selectedLayers, [{ id: "layer-1", index: 1, name: "Original" }]); }
  assert.equal(validSnapshot.result.project.name, "Fixture", "the fixture these tests are written against");
});

test("a refresh the read overtook is taken back, so the panel does not read the project twice", async (t) => {
  const h = await start(t);
  await h.focus({ activeCompositionId: "comp-2", activeCompositionName: "Two", selected: [], selectedLayers: [] });
  const pending = h.sidecar.ensureFocusCurrent(5);
  while (h.refreshes() === 0) await pause(5);
  h.clock.ms += 10; await h.post("/v1/snapshots", withCompositions("probe-overtook", ["comp-2"]));
  assert.equal((await pending).state, "refreshed"); assert.equal(h.refreshes(), 0);
});
