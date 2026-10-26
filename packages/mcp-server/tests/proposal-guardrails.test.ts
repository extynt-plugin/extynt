// Proves that ae_propose_plan guards what an agent may propose: it refuses bad values, destinations and drafts at once, keeps a refused draft repairable, and discloses what a plan will do.
import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { representativeSnapshot } from "@extynt/project-graph";
import { BASE_CATALOGUE, applyEffectControlEvidence, makeHostProfile, makeInventory } from "@extynt/capability-catalogue";
import { VERIFIED_HOST } from "./support/fixtures.js";
import { callTool, statusFromApplyReceipt } from "../src/index.js";
import type { StoredPlan } from "../src/index.js";
import { arrayAt, booleanAt, integerAt, objectAt, objectsIn, stringAt, stringsIn } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { refusalOf, storedOperations } from "./support/json-results.js";
import { cardLines, noticesOf, planContext, presentationOf, propose, successObject } from "./support/proposal-views.js";

const HOST = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" };
const TITLE = { compositionId: "comp-main", layerId: "layer-title" };
const OPACITY = "ADBE Transform Group/ADBE Opacity";
const BLUR = "ADBE Effect Parade/ADBE Gaussian Blur 2";
const installed = (matchName: string) => ({ matchName, displayName: matchName, available: true, evidence: [{ kind: "observed" as const, source: "host" as const }] });
const noticeWith = (notices: ReadonlyArray<JsonObject>, code: string): JsonObject | undefined => notices.find((notice) => stringAt(notice, "code") === code);
const renderTo = (outputPath: string): JsonObject => ({ type: "render_composition", compositionId: "comp-main", outputPath, destinationPolicy: "explicit-local-path" });

test("a proposed plan is approvable and the plan types resolve in the registry", () => {
  const plans = new Map<string, StoredPlan>();
  const context = { snapshot: representativeSnapshot, catalogue: BASE_CATALOGUE, panelSessionId: "panel-test", plans, ...VERIFIED_HOST };
  const proposed = propose("Fade the title in over 2 seconds", [{ type: "animate_property", target: { ...TITLE, propertyPath: OPACITY }, role: "transform.opacity", keyframes: [{ time: 0, value: 0, curve: "ease-out" }, { time: 2, value: 100 }] }], context);
  const planId = stringAt(successObject(proposed), "planId");
  assert.ok(planId);
  assert.ok(callTool("ae_approve_plan", { planId }, context).ok, "a proposed plan must be stored for approval");
  assert.equal(stringAt(successObject(callTool("ae_describe_native_operation", { id: "animate_property" }, {})), "id"), "property.animate");
  const searched = successObject(callTool("ae_search_native_operations", { query: "animate_control" }, {}));
  assert.ok(objectsIn(arrayAt(searched, "entries")).some((entry) => stringAt(entry, "planType") === "animate_control"));
});

test("refresh and bootstrap track edits: the same revision is unchanged, a new fingerprint is a change", () => {
  const context = planContext();
  const refresh = successObject(callTool("ae_refresh_snapshot", {}, context));
  assert.equal(stringAt(refresh, "status"), "queued");
  const knownRevision = stringAt(refresh, "knownRevision") ?? "";
  const unchanged = successObject(callTool("ae_get_bootstrap_context", { knownRevision }, { snapshot: representativeSnapshot }));
  assert.equal(stringAt(unchanged, "status"), "NOT_MODIFIED");
  const edited = { ...representativeSnapshot, fingerprint: "edited-graph" };
  const changed = successObject(callTool("ae_get_bootstrap_context", { knownRevision }, { snapshot: edited }));
  assert.equal(booleanAt(objectAt(changed, "changedSince"), "project"), true, "same host revision but a new fingerprint is a change");
});

function blurContext(): ReturnType<typeof planContext> {
  const profile = makeHostProfile(makeInventory(HOST, [installed("ADBE Gaussian Blur 2"), installed("ADBE Apply Color LUT2")]));
  const hostProfile = applyEffectControlEvidence(profile, { effects: { "ADBE Gaussian Blur 2": { controls: [{ m: "ADBE Gaussian Blur 2-0001", n: "Blurriness", t: "OneD", v: 0, min: 0, max: 30000 }] } } });
  return planContext({ hostProfile });
}

test("ae_propose_plan rejects probed out-of-range effect values and keeps the refused draft", () => {
  const context = blurContext();
  const control = { ...TITLE, effectPath: BLUR, propertyPath: `${BLUR}/ADBE Gaussian Blur 2-0001` };
  const refused = propose("Bad blur", [{ type: "animate_control", target: control, role: "blur.amount", effectMatchName: "ADBE Gaussian Blur 2", keyframeMode: "merge", keyframes: [{ time: 0, value: 10 }, { time: 1, value: -5 }] }], context);
  const { code, message } = refusalOf(refused);
  assert.equal(code, "INVALID_VALUE");
  assert.match(message, /Blurriness accepts 0-30000/);
  assert.equal(context.plans.size, 1, "the refused plan is kept for ae_amend_plan");
  assert.equal([...context.plans.values()][0]?.status, "draft", "a refused plan is never approvable");
});

test("a dialog-opening effect is noted as user assisted, named the way this host names it", () => {
  const lut = "ADBE Effect Parade/ADBE Apply Color LUT2";
  const dialog = propose("LUT", [{ type: "ensure_effect", target: { ...TITLE, effectPath: lut }, capabilityId: "host:ADBE Apply Color LUT2", effectMatchName: "ADBE Apply Color LUT2", effectPath: lut }], blurContext());
  const assisted = noticeWith(noticesOf(dialog), "EFFECT_USER_ASSISTED");
  assert.equal(stringAt(assisted, "title"), "After Effects will open the ADBE Apply Color LUT2 dialog — finish it to continue.");
  assert.deepEqual(arrayAt(assisted, "operationIndexes"), [0]);
});

test("large composed plans carry a staging advisory", () => {
  const composition = representativeSnapshot.compositions[0];
  const layer = composition?.layers[0];
  assert.ok(composition && layer);
  const target = { compositionId: composition.id, layerId: layer.id };
  const operations = Array.from({ length: 30 }, (_, index): JsonObject => ({ type: "add_marker", target, time: index * 0.1, comment: `m${index}` }));
  const result = propose("Many markers", operations, planContext());
  const staging = noticeWith(noticesOf(result), "LARGE_PLAN");
  assert.ok(staging, "the long plan is still disclosed");
  assert.equal(stringAt(staging, "severity"), "note", "a long plan is expected, not an error");
  assert.match(stringAt(staging, "title") ?? "", /30 operations, applied as 2 undo groups/);
  const warnings = stringsIn(arrayAt(presentationOf(result), "warnings"));
  assert.ok(warnings.some((warning) => /30 operations/.test(warning)));
  assert.equal(warnings.some((warning) => /^[A-Z_]+:/.test(warning)), false, "no code prefixes survive into the reader-facing text");
});

test("a rejected execution stays failed no matter what the read-back claims", () => {
  assert.equal(statusFromApplyReceipt({ status: "rejected", postcondition: "passed" }), "failed");
  assert.equal(statusFromApplyReceipt({ status: "executed", postcondition: "passed" }), "verified");
  assert.equal(statusFromApplyReceipt({ status: "executed", postcondition: "pending_refresh" }), "applied_unverified");
  assert.equal(statusFromApplyReceipt(undefined), "failed");
});

test("ae_get_capture_frame rejects malformed capture ids and reports an unknown capture instead of a fabricated pending status", () => {
  const malformed: ReadonlyArray<JsonObject> = [{}, { captureId: "" }, { captureId: 42 }, { captureId: "x".repeat(500) }];
  for (const args of malformed) {
    const result = callTool("ae_get_capture_frame", args, { snapshot: representativeSnapshot });
    assert.equal(refusalOf(result).code, "INVALID_ARGUMENT", `captureId ${JSON.stringify(args).slice(0, 40)} must be rejected`);
  }
  const unknown = refusalOf(callTool("ae_get_capture_frame", { captureId: "frame-1" }, { snapshot: representativeSnapshot }));
  assert.equal(unknown.code, "CAPTURE_NOT_FOUND", "this adapter has no capture store, so no capture can be pending here");
  assert.match(unknown.message, /No bounded capture/);
});

const BAD_LAYER = { compositionId: "comp-main", layerId: "__new__:layer0" };

function refusedTwiceContext(): ReturnType<typeof planContext> {
  return planContext({ hostProfile: makeHostProfile(makeInventory(HOST, [installed("ADBE Gaussian Blur 2")])) });
}

function badInTwoPlaces(): ReadonlyArray<JsonObject> {
  const layerId = representativeSnapshot.compositions[0]?.layers[0]?.id ?? "";
  return [
    { type: "create_layer", layerType: "text", name: "Bad\u0001Name", target: BAD_LAYER },
    { type: "set_layer_name", name: "Renamed", target: BAD_LAYER },
    { type: "ensure_effect", target: { compositionId: "comp-main", layerId, effectPath: "ADBE Effect Parade/ADBE Ramp" }, capabilityId: "adobe.ramp", effectMatchName: "ADBE Ramp", effectPath: "ADBE Effect Parade/ADBE Ramp" },
  ];
}

test("a refused plan reports every bad operation at once and keeps the draft under the id it names", () => {
  const context = refusedTwiceContext();
  const { code, message } = refusalOf(propose("Bad in two places", badInTwoPlaces(), context));
  const [planId] = [...context.plans.keys()];
  assert.ok(planId, "the draft is in the plan store");
  assert.equal(context.plans.get(planId)?.status, "draft", "the refused plan is kept, because it is what gets repaired");
  assert.equal(code, "INVALID_VALUE", "the code is still the first problem's, so a caller that knows one code is not surprised");
  assert.match(message, /create_layer \[INVALID_VALUE\] at #0/);
  assert.match(message, /ensure_effect \[EFFECT_NOT_INSTALLED\] at #2/);
  assert.match(message, /Later operation #1 uses what this creates/);
  assert.match(message, new RegExp(`ae_amend_plan on plan ${planId}`), "the model is told how to repair it, not just that it is wrong");
});

test("a refused plan is repaired in place by index and keeps its id", () => {
  const context = refusedTwiceContext();
  refusalOf(propose("Bad in two places", badInTwoPlaces(), context));
  const [planId] = [...context.plans.keys()];
  const fixedLayer: JsonObject = { type: "create_layer", layerType: "text", name: "Good Name", text: "Good Name", target: BAD_LAYER };
  const amended = successObject(callTool("ae_amend_plan", { planId: planId ?? "", edits: [{ op: "replace", index: 0, operation: fixedLayer }, { op: "remove", index: 2 }] }, context));
  assert.equal(stringAt(amended, "planId"), planId, "the plan keeps its id, so the user's card is the same plan");
  assert.equal(stringAt(amended, "status"), "prepared");
  assert.equal(booleanAt(amended, "amended"), true);
  assert.equal(integerAt(amended, "operationCount"), 2, "the caller is told how long the plan is now without being handed it");
  assert.equal("plan" in amended, false, "the amended plan is not echoed back");
  assert.equal(arrayAt(objectAt(amended, "presentation"), "values")?.length, 2, "two operations remain: the layer and its rename");
  assert.equal(storedOperations(context.plans.get(planId ?? "")).length, 2);
});

test("a refusal groups identical problems into one line instead of repeating the same sentence per operation", () => {
  const context = planContext({ hostProfile: makeHostProfile(makeInventory(HOST, [])) });
  const target = { compositionId: "comp-main", layerId: representativeSnapshot.compositions[0]?.layers[0]?.id ?? "" };
  const operations = Array.from({ length: 6 }, (_, index): JsonObject => ({ type: "add_marker", target, action: "add_marker", time: index, comment: `Beat ${index}` }));
  const { message } = refusalOf(propose("Six markers", operations, context));
  assert.match(message, /6 operations cannot run as written/);
  assert.match(message, /add_marker \[UNKNOWN_FIELD\] at #0, #1, #2, #3, #4, #5/);
  assert.equal((message.match(/Unknown field: action/g) ?? []).length, 1, "the same problem is stated once, not once per operation");
  assert.equal(message.split("\n").length, 3, `count line, one grouped problem line, one repair line: ${message}`);
  assert.match(message, /at the top level of add_marker/);
});

const REFUSED_DESTINATIONS: ReadonlyArray<{ readonly summary: string; readonly operation: JsonObject; readonly code: string }> = [
  { summary: "Outside home", operation: renderTo("/renders/main.mov"), code: "INVALID_ARGUMENT" },
  { summary: "Escape", operation: renderTo("/EXTYNT_OUT_DIR/../../etc/hosts"), code: "INVALID_ARGUMENT" },
  { summary: "Relative", operation: renderTo("renders/out.mov"), code: "INVALID_VALUE" },
  { summary: "Import credentials", operation: { type: "import_file", newItemId: "__new__:item", path: "/etc/hosts" }, code: "INVALID_ARGUMENT" },
];

test("ae_propose_plan refuses a system location and stores nothing for it", () => {
  const denied = planContext();
  const { code, message } = refusalOf(propose("Export a preview", [renderTo("/etc/extynt-probe.mov")], denied));
  assert.equal(code, "INVALID_ARGUMENT", "a system location is not a destination the model may choose");
  assert.match(message, /system location|home directory/);
  assert.equal(denied.plans.size, 0, "a refused plan is never stored");
});

test("ae_propose_plan refuses destinations and sources outside the user's home", () => {
  for (const { summary, operation, code } of REFUSED_DESTINATIONS) assert.equal(refusalOf(propose(summary, [operation], planContext())).code, code, summary);
  assert.ok(propose("Queue a render", [renderTo("/EXTYNT_OUT_DIR/queued.mov")], planContext()).ok, "the placeholder root is a valid destination");
});

test("every path a proposal reads or writes is named on the approval card", () => {
  const folder = join(homedir(), "extynt-wave1-fixtures");
  const homeSource = join(folder, "plate.mov");
  const homeRender = join(folder, "main.mov");
  const proposal = propose("Import and render", [{ type: "import_file", newItemId: "__new__:item", path: homeSource }, renderTo(homeRender)], planContext());
  const lines = cardLines(proposal);
  assert.ok(lines.some((line) => line.includes(`source ${homeSource}`)), `the card must name the import source: ${JSON.stringify(lines)}`);
  assert.ok(lines.some((line) => line.includes(`destination ${homeRender}`)), `the card must name the render destination: ${JSON.stringify(lines)}`);
});

test("approving a draft that failed validation says so, and a connected panel does not change the answer", () => {
  const context = planContext();
  refusalOf(propose("Missing layer", [{ type: "add_marker", target: { compositionId: "comp-main", layerId: "999999" }, time: 1, comment: "x" }], context));
  const draft = [...context.plans.values()][0];
  assert.equal(draft?.status, "draft");
  const { code, message } = refusalOf(callTool("ae_approve_plan", { planId: draft?.plan.planId }, context));
  assert.equal(code, "PLAN_NOT_VALIDATED");
  assert.match(message, /failed validation.*nothing was applied/);
  assert.equal(draft?.status, "draft", "a refused approval leaves the draft alone");
});

test("an ensure_effect with initialization is refused with the set_effect_control route, and that route validates", () => {
  const ensure: JsonObject = { type: "ensure_effect", target: { ...TITLE, effectPath: BLUR }, capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: BLUR };
  const initialized = propose("Blur", [{ ...ensure, enabled: true, initialization: { blurriness: 25, dimensions: 1, repeatEdgePixels: false } }], planContext());
  assert.match(refusalOf(initialized).message, /set_effect_control/, "the refusal names the route that sets the value");
  const control: JsonObject = { type: "set_effect_control", target: { ...TITLE, effectPath: BLUR, propertyPath: `${BLUR}/ADBE Gaussian Blur 2-0001` }, effectMatchName: "ADBE Gaussian Blur 2", value: 25 };
  const routed = propose("Blur", [ensure, control], planContext());
  assert.ok(routed.ok, routed.ok ? "" : JSON.stringify(routed.error));
});
