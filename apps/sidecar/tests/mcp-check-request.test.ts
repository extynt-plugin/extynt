/** ae_check_request: the external client's "am I done?" answer, from the project and the plans clients applied this session. */
import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_PLAN_SCHEMA, type Operation } from "@extynt/action-plan";
import { array, boolean, decodeOrThrow, object, string } from "@extynt/decode";
import { createSnapshot } from "@extynt/project-graph";
import { listTools, PANEL_AGENT_ONLY_TOOLS, type StoredPlan } from "@extynt/mcp-server";
import { checkRequest } from "../src/server-mcp-check.js";
import type { PlanSource } from "../src/host/facts.js";
import { readJson, textOf } from "./http-json.js";
import { effect, key, layer, property, snapshotOf } from "./coverage-fixtures.js";
import { authorization, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";

const COMP = snapshotOf([]).compositions[0]?.id ?? "";

const ANSWER = object({ ok: boolean(), data: object({ complete: boolean(), missing: array(string()) }) });
const REQUEST = "Give the title a glow and a drop shadow.";
const titleWith = (...matchNames: string[]) => snapshotOf([layer("title", { type: "text", properties: matchNames.map(effect) })]);

type Row = { layerId: string; verdict: "IN_FRAME" | "OFF_FRAME" };
const target = (layerId: string) => ({ compositionId: COMP, layerId, snapshotFingerprint: "fp-0", selectionFingerprint: "sel-0" });
const rename: Operation = { type: "set_layer_name", target: target("title"), name: "Title" };
const essential: Operation = { type: "add_essential_property", target: target("title") };
let counter = 0;
function stored(status: StoredPlan["status"], operations: Operation[], rows: Row[] = []): StoredPlan {
  counter += 1;
  const frameChecks = rows.map((row) => ({ compositionId: COMP, layerId: row.layerId, layer: row.layerId, verdict: row.verdict, ...(row.verdict === "OFF_FRAME" ? { message: `${row.layerId} is outside its frame.` } : {}) }));
  const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, counter)).toISOString();
  return { plan: { schemaVersion: ACTION_PLAN_SCHEMA, planId: `plan-${counter}`, summary: "Change", snapshotFingerprint: "fp-0", operations, requiresApproval: true }, status, receipt: { frameChecks }, createdAt: stamp, updatedAt: stamp };
}

function run(snapshot: ReturnType<typeof snapshotOf>, plans: StoredPlan[], request = REQUEST, source: PlanSource = "agent") {
  return checkRequest({ plans: new Map(plans.map((plan) => [plan.plan.planId, plan])), sources: new Map(plans.map((plan) => [plan.plan.planId, source])), latest: snapshot, request });
}

test("a feature the request names that the project lacks is reported, and the next step says to add it", () => {
  const check = run(titleWith("ADBE Glo2"), []);
  assert.equal(check.complete, false);
  assert.equal(check.missing.length, 1);
  assert.match(check.missing[0] ?? "", /drop shadow/);
  assert.match(check.next, /Add the missing features in one plan, then check again/);
  assert.deepEqual(check.offFrame, []);
});

test("an orbit that only spins a holder in place is reported, and the next step names the fix", () => {
  const rotation = property("ADBE Transform Group/ADBE Rotate Z", { keyframes: [key(0, 0), key(6, 360)], keyframeCount: 2 });
  const spinning = snapshotOf([layer("holder", { type: "null", properties: [rotation] }), layer("rocket", { parentId: "holder", properties: [property("ADBE Transform Group/ADBE Position", { valueType: "vector", value: [-1, -2] })] })]);
  const check = run(spinning, [], "A rocket orbiting a planet.");
  assert.equal(check.complete, false);
  assert.match(check.missing[0] ?? "", /^orbit motion/);
});

test("every named feature present and nothing off-frame is complete", () => {
  const check = run(titleWith("ADBE Glo2", "ADBE Drop Shadow"), [stored("verified", [rename], [{ layerId: "title", verdict: "IN_FRAME" }])]);
  assert.deepEqual(check, { complete: true, missing: [], offFrame: [], next: "Everything requested is present and in frame; give your final answer." });
});

test("an off-frame receipt row is reported until a later check of the same layer is in frame", () => {
  const complete = titleWith("ADBE Glo2", "ADBE Drop Shadow");
  const off = stored("applied", [rename], [{ layerId: "title", verdict: "OFF_FRAME" }]);
  const flagged = run(complete, [off]);
  assert.equal(flagged.complete, false);
  assert.deepEqual(flagged.offFrame, ["title is outside its frame."]);
  assert.match(flagged.next, /off-frame/);
  const fixed = run(complete, [off, stored("verified", [rename], [{ layerId: "title", verdict: "IN_FRAME" }])]);
  assert.equal(fixed.complete, true);
  assert.deepEqual(fixed.offFrame, []);
});

test("a finding about a layer that is no longer drawn does not stand", () => {
  const hidden = snapshotOf([layer("title", { type: "text", enabled: false, properties: [effect("ADBE Glo2"), effect("ADBE Drop Shadow")] })]);
  assert.deepEqual(run(hidden, [stored("applied", [], [{ layerId: "title", verdict: "OFF_FRAME" }])]).offFrame, []);
});

test("an undone plan, a plan that never ran and a panel plan prove nothing", () => {
  const request = "Expose an Essential Graphics property.";
  const operations = [essential];
  const bare = snapshotOf([layer("title", { type: "text" })]);
  for (const status of ["undone", "partially_undone", "approved", "failed", "cancelled"] as const) assert.equal(run(bare, [stored(status, operations)], request).complete, false, status);
  assert.equal(run(bare, [stored("applied", operations)], request, "panel").complete, false, "a plan the panel applied is not an external client's");
  const counted = run(bare, [stored("applied_unverified", operations)], request);
  assert.deepEqual([counted.complete, counted.missing], [true, []], "an applied plan is the proof for a feature the snapshot cannot read back");
});

test("an off-frame row of an undone plan is not held against the client", () => {
  assert.deepEqual(run(titleWith("ADBE Glo2", "ADBE Drop Shadow"), [stored("undone", [], [{ layerId: "title", verdict: "OFF_FRAME" }])]).offFrame, []);
});

test("a project read without layer properties is not claimed complete", () => {
  const unread = createSnapshot({ ...titleWith(), coverage: { kind: "composition-metadata", compositionId: COMP, properties: "unknown", otherCompositions: "unknown" } });
  const check = run(unread, [stored("verified", [rename])]);
  assert.equal(check.complete, false);
  assert.match(check.next, /cannot be confirmed/);
});

test("nothing applied and nothing named is not complete, and the offFrame list is bounded", () => {
  assert.equal(run(snapshotOf([]), [], "Make it nicer.").complete, false);
  const layers = Array.from({ length: 9 }, (_, at) => `layer-${at}`);
  const many = run(snapshotOf(layers.map((id) => layer(id))), [stored("applied", [], layers.map((layerId) => ({ layerId, verdict: "OFF_FRAME" as const })))], "Make it nicer.");
  assert.equal(many.offFrame.length, 6);
});

test("the tool is advertised to external clients, is not panel-only, and answers over the wire", async (t) => {
  assert.ok(listTools("agent").some((tool) => tool.name === "ae_check_request"));
  assert.equal(PANEL_AGENT_ONLY_TOOLS.has("ae_check_request"), false);
  assert.ok((listTools("all").find((tool) => tool.name === "ae_check_request")?.description.length ?? 999) <= 300);
  const sidecar = sidecarFor({ port: 0, token, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("mcp-check")) });
  const call = (args: { request?: string }) => fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "x-ae-client": "agent" }, body: JSON.stringify({ name: "ae_check_request", arguments: args }) });
  const answered = decodeOrThrow(ANSWER, await readJson(await call({ request: "Add a glow to the layer." })));
  assert.equal(answered.ok, true);
  assert.equal(answered.data.complete, false);
  assert.match(answered.data.missing[0] ?? "", /Glow/);
  const refused = await call({});
  assert.equal(refused.status, 422);
  assert.equal(textOf(await readJson(refused), "error.code"), "INVALID_ARGUMENTS");
});
