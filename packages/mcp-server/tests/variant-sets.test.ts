// Tests for variant sets: offering, picking, refusing and withdrawing the options of one effect control.
import test from "node:test";
import assert from "node:assert/strict";
import { representativeSnapshot, type ProjectSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { BASE_CATALOGUE, applyEffectControlEvidence, makeHostProfile, makeInventory, mergeEffectControlEvidence } from "@extynt/capability-catalogue";
import { loadFixtureEffectEvidence } from "@extynt/capability-catalogue/test-evidence";
import { agentToolDefinitions, callTool, chooseVariant, IN_PANEL_AGENT_HIDDEN_TOOLS, listTools, type StoredPlan, type ToolContext, type VariantSet } from "../src/index.js";
import { arrayAt, objectsIn, stringAt } from "../src/json.js";
import { parsedJson } from "./support/narrow.js";
import { isJsonArray } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { repoFile } from "./support/fixtures.js";
import { resultData } from "./support/json-results.js";


const EFFECT_PATH = "ADBE Effect Parade/ADBE Gaussian Blur 2";
const TARGET = { compositionId: "comp-main", layerId: "layer-title", effectPath: EFFECT_PATH, propertyPath: `${EFFECT_PATH}/ADBE Gaussian Blur 2-0001` };
const CANDIDATES: JsonObject[] = [{ label: "subtler", value: 6 }, { label: "current", value: 12 }, { label: "stronger", value: 18 }];

type ToolOutput = ReturnType<typeof callTool>;

function present<T>(found: T | null | undefined): T {
  if (found === undefined || found === null) throw new Error("expected a value to be present");
  return found;
}

function objectPayloadOf(result: ToolOutput): JsonObject {
  return present(resultData(result));
}

function rowsPayloadOf(result: ToolOutput): ReadonlyArray<JsonObject> {
  const payload = result.ok ? parsedJson(JSON.stringify(result.data)) : undefined;
  return objectsIn(isJsonArray(payload) ? payload : undefined);
}

function fixture(snapshot: ProjectSnapshot = representativeSnapshot) {
  const plans = new Map<string, StoredPlan>(), variants = new Map<string, VariantSet>();
  const clock = { at: Date.parse("2026-10-03T10:00:00Z") };
  const context: ToolContext = { snapshot, catalogue: BASE_CATALOGUE, panelSessionId: "panel-test", plans, variants, now: () => new Date(clock.at) };
  return { plans, variants, context, clock };
}

function offer(context: ToolContext, args: JsonObject = {}): ToolOutput {
  return callTool("ae_offer_variants", { target: TARGET, effectMatchName: "ADBE Gaussian Blur 2", candidates: CANDIDATES, ...args }, context);
}

function offered(context: ToolContext, args: JsonObject = {}): { setId: string; candidates: Array<{ index: number; label: string; value: JsonValue | undefined; current: boolean }>; next: string } {
  const result = offer(context, args);
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
  const data = objectPayloadOf(result);
  const candidates = objectsIn(arrayAt(data, "candidates")).map((row) => ({ index: Number(row.index), label: String(row.label), value: row.value, current: row.current === true }));
  return { setId: String(data.setId), candidates, next: String(data.next) };
}

function offeredSet(context: ToolContext, args: JsonObject = {}): VariantSet {
  return present(context.variants?.get(offered(context, args).setId));
}

function planIdsOf(set: VariantSet): string[] { return set.candidates.flatMap((candidate) => candidate.planId ? [candidate.planId] : []); }
function statusOf(context: ToolContext, planId: string): string | undefined { return context.plans?.get(planId)?.status; }

function withBlurriness(change: Partial<PropertySnapshot>): ProjectSnapshot {
  const clone: ProjectSnapshot = structuredClone(representativeSnapshot);
  const visit = (properties: PropertySnapshot[]): void => {
    for (const property of properties) {
      if (property.path === TARGET.propertyPath) Object.assign(property, change);
      visit(property.children ?? []);
    }
  };
  for (const composition of clone.compositions) for (const layer of composition.layers) visit(layer.properties);
  return clone;
}

test("each candidate becomes an ordinary plan composed by the path ae_propose_plan uses, and the current value has none", () => {
  const { context, plans, variants } = fixture();
  const result = offered(context);
  const set = present(variants.get(result.setId));
  assert.equal(set.status, "open");
  assert.deepEqual(result.candidates.map((candidate) => [candidate.label, candidate.value, candidate.current]), [["subtler", 6, false], ["current", 12, true], ["stronger", 18, false]], "the values and labels are the model's own, in its order");
  assert.deepEqual(set.candidates.map((candidate) => candidate.planId === null), [false, true, false], "the candidate equal to the current value has no plan");
  assert.equal(plans.size, 2, "one plan per value that would change something");
  for (const planId of planIdsOf(set)) {
    const record = present(plans.get(planId));
    assert.equal(record.status, "prepared", "never approved, applied or queued");
    assert.equal(record.variantSetId, set.setId);
    assert.equal(record.plan.operations.length, 1);
    assert.equal(present(record.plan.operations[0]).type, "set_effect_control");
    assert.equal(record.plan.digest?.length, 64);
    assert.equal(record.plan.requiresApproval, true);
    assert.ok(record.approvalCapability, "the same approval policy: a capability bound to this plan and session");
  }
  const direct = callTool("ae_propose_plan", { summary: "x", operations: [{ type: "set_effect_control", target: TARGET, effectMatchName: "ADBE Gaussian Blur 2", value: 6 }] }, context);
  assert.equal(direct.ok, true);
  const directPlan = present(plans.get(stringAt(objectPayloadOf(direct), "planId") ?? "")).plan;
  const variantPlan = present(plans.get(present(present(set.candidates[0]).planId))).plan;
  assert.deepEqual(variantPlan.operations, directPlan.operations);
  assert.deepEqual([variantPlan.intent, variantPlan.bounds, variantPlan.preconditions, variantPlan.postconditions, variantPlan.snapshotFingerprint], [directPlan.intent, directPlan.bounds, directPlan.preconditions, directPlan.postconditions, directPlan.snapshotFingerprint]);
});

test("the tool says nothing is applied and tells the model to stop; it never returns a plan id to approve", () => {
  const { context } = fixture();
  const result = offered(context);
  assert.match(result.next, /Nothing is applied until they pick/);
  assert.match(result.next, /cannot apply, approve or re-propose/);
  assert.ok(!JSON.stringify(result).includes("plan-"), "no plan id reaches the model");
});

test("it refuses what is not one static numeric control, with a reason that points back to a normal plan, and leaves nothing behind", () => {
  const cases: Array<[string, ToolContext, JsonObject, string, RegExp]> = [
    ["too few candidates", fixture().context, { candidates: CANDIDATES.slice(0, 1) }, "INVALID_ARGUMENT", /2-4 entries/],
    ["too many candidates", fixture().context, { candidates: [1, 2, 3, 4, 5].map((value) => ({ label: `v${value}`, value })) }, "INVALID_ARGUMENT", /2-4 entries/],
    ["no label", fixture().context, { candidates: [{ value: 1 }, { label: "b", value: 2 }] }, "INVALID_ARGUMENT", /label is required/],
    ["a non-finite value", fixture().context, { candidates: [{ label: "a", value: Number.NaN }, { label: "b", value: 2 }] }, "INVALID_ARGUMENT", /finite number/],
    ["a string value", fixture().context, { candidates: [{ label: "a", value: "1" }, { label: "b", value: 2 }] }, "INVALID_ARGUMENT", /finite number/],
    ["a vector for a scalar control", fixture().context, { candidates: [{ label: "a", value: [1, 2] }, { label: "b", value: 2 }] }, "INVALID_ARGUMENT", /one number/],
    ["a repeated value", fixture().context, { candidates: [{ label: "a", value: 1 }, { label: "b", value: 1 }] }, "INVALID_ARGUMENT", /same value/],
    ["a repeated label", fixture().context, { candidates: [{ label: "a", value: 1 }, { label: "A", value: 2 }] }, "INVALID_ARGUMENT", /labelled "A"/],
    ["a control that is not in the snapshot", fixture().context, { target: { ...TARGET, propertyPath: `${EFFECT_PATH}/ADBE Gaussian Blur 2-0099` } }, "VARIANT_CONTROL_NOT_OBSERVED", /not in the current snapshot/],
    ["a keyframed control", fixture(withBlurriness({ keyframeCount: 3 })).context, {}, "VARIANT_CONTROL_NOT_STATIC", /has keyframes.*ae_propose_plan/],
    ["an expression-driven control", fixture(withBlurriness({ expressionEnabled: true })).context, {}, "VARIANT_CONTROL_NOT_STATIC", /expression.*ae_propose_plan/],
    ["a control that is not numeric", fixture(withBlurriness({ value: true, valueType: "boolean" })).context, {}, "VARIANT_CONTROL_NOT_NUMERIC", /normal plan/],
    ["a target that is not set_effect_control's shape", fixture().context, { effectMatchName: "ADBE Glo2" }, "INVALID_TARGET", /effectMatchName/],
  ];
  for (const [what, context, args, code, message] of cases) {
    const result = offer(context, args);
    assert.equal(result.ok, false, what);
    if (result.ok) continue;
    assert.equal(result.error.code, code, `${what}: ${result.error.message}`);
    assert.match(result.error.message, message, what);
    assert.equal(context.plans?.size, 0, `${what}: no plan was left behind`);
    assert.equal(context.variants?.size, 0, `${what}: no set was left behind`);
  }
});

test("a value the host's own range rules refuse refuses the whole set, and the plans already made for earlier values are withdrawn", () => {
  const dimensions = `${EFFECT_PATH}/ADBE Gaussian Blur 2-0002`;
  const snapshot = withBlurriness({});
  const effects = present(present(snapshot.compositions[0]).layers[0]).properties.flatMap((property) => property.children ?? []);
  const blur = present(effects.flatMap((effect) => effect.children ?? []).find((property) => property.path === TARGET.propertyPath));
  const parent = present(effects.find((effect) => effect.path === EFFECT_PATH));
  parent.children = [...(parent.children ?? []), { ...blur, path: dimensions, matchName: "ADBE Gaussian Blur 2-0002", displayName: "Blur Dimensions", value: 1 }];
  const host = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" };
  const installed = [{ matchName: "ADBE Gaussian Blur 2", displayName: "Gaussian Blur", available: true, evidence: [{ kind: "observed" as const, source: "host" as const }] }];
  const hostProfile = applyEffectControlEvidence(makeHostProfile(makeInventory(host, installed)), present(mergeEffectControlEvidence(loadFixtureEffectEvidence(), { effects: {} })));
  const { context, plans, variants } = fixture(snapshot);
  context.hostProfile = hostProfile;
  const result = offer(context, { target: { ...TARGET, propertyPath: dimensions }, candidates: [{ label: "fine", value: 2 }, { label: "absurd", value: 99 }] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error.message, /Blur Dimensions accepts 1-3/);
  assert.equal(plans.size, 0, "the first candidate's plan was removed again");
  assert.equal(variants.size, 0);
});

test("a caller with no variant store is told so instead of offering options nobody can pick", () => {
  const result = callTool("ae_offer_variants", { target: TARGET, effectMatchName: "ADBE Gaussian Blur 2", candidates: CANDIDATES }, { snapshot: representativeSnapshot, catalogue: BASE_CATALOGUE, panelSessionId: "panel-test", plans: new Map() });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "VARIANTS_UNAVAILABLE");
});

test("no candidate can be approved or amended before the user picks: approval needs the pick", () => {
  const { context } = fixture();
  const set = offeredSet(context);
  const first = present(planIdsOf(set)[0]);
  const approve = callTool("ae_approve_plan", { planId: first }, context);
  assert.equal(approve.ok, false);
  if (!approve.ok) assert.equal(approve.error.code, "VARIANT_NOT_PICKED");
  assert.equal(statusOf(context, first), "prepared", "a refused approval leaves it prepared");
  const amend = callTool("ae_amend_plan", { planId: first, edits: [{ op: "replace", index: 0, operation: { type: "set_effect_control", target: TARGET, effectMatchName: "ADBE Gaussian Blur 2", value: 99 } }] }, context);
  assert.equal(amend.ok, false);
  if (!amend.ok) assert.equal(amend.error.code, "VARIANT_PLAN_FIXED");
});

test("picking an option approves exactly that one and withdraws the others", () => {
  const { context } = fixture();
  const set = offeredSet(context);
  const subtler = present(planIdsOf(set)[0]);
  const stronger = present(planIdsOf(set)[1]);
  const picked = chooseVariant(context, { setId: set.setId, choice: 2, currentFingerprint: representativeSnapshot.fingerprint });
  assert.equal(picked.ok && picked.outcome, "picked");
  assert.equal(set.status, "picked");
  assert.equal(set.pickedPlanId, stronger);
  assert.equal(statusOf(context, subtler), "cancelled", "the other option is withdrawn");
  assert.equal(statusOf(context, stronger), "prepared", "the picked option is still unapplied: it goes through the normal approval next");
  const refused = callTool("ae_approve_plan", { planId: subtler }, context);
  assert.equal(refused.ok, false);
  const approved = callTool("ae_approve_plan", { planId: stronger, acknowledgeUnverified: true }, context);
  assert.equal(approved.ok, true, approved.ok ? "" : JSON.stringify(approved.error));
  assert.equal(statusOf(context, stronger), "approved");
  assert.equal(statusOf(context, subtler), "cancelled");
  const again = chooseVariant(context, { setId: set.setId, choice: 0, currentFingerprint: representativeSnapshot.fingerprint });
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.error.code, "VARIANT_SET_CLOSED");
});

test("picking the current value applies nothing and just closes the set", () => {
  const { context } = fixture();
  const set = offeredSet(context);
  const outcome = chooseVariant(context, { setId: set.setId, choice: 1, currentFingerprint: representativeSnapshot.fingerprint });
  assert.equal(outcome.ok && outcome.outcome, "kept_current");
  assert.equal(set.status, "picked");
  assert.equal(set.pickedPlanId, null);
  for (const planId of planIdsOf(set)) assert.equal(statusOf(context, planId), "cancelled", "no plan is left to apply");
  for (const planId of planIdsOf(set)) assert.equal(callTool("ae_approve_plan", { planId }, context).ok, false);
});

test("none of these cancels every option", () => {
  const { context } = fixture();
  const set = offeredSet(context);
  const outcome = chooseVariant(context, { setId: set.setId, choice: "none", currentFingerprint: representativeSnapshot.fingerprint });
  assert.equal(outcome.ok && outcome.outcome, "dismissed");
  assert.equal(set.status, "dismissed");
  for (const planId of planIdsOf(set)) assert.equal(statusOf(context, planId), "cancelled");
});

test("a set offered against a project that has since changed is refused in plain words, and closed with nothing applied", () => {
  const { context } = fixture();
  const set = offeredSet(context);
  const outcome = chooseVariant(context, { setId: set.setId, choice: 0, currentFingerprint: "a-different-project" });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, "VARIANT_SET_STALE");
  assert.match(outcome.error.message, /^The project changed after these options were offered, so none of them can be applied safely\. Nothing was changed\. Ask for them again\.$/);
  assert.equal(set.status, "dismissed");
  for (const planId of planIdsOf(set)) assert.equal(statusOf(context, planId), "cancelled");
});

test("options whose approval has lapsed are refused, not applied late", () => {
  const { context, clock } = fixture();
  const set = offeredSet(context);
  clock.at += 11 * 60_000;
  const outcome = chooseVariant(context, { setId: set.setId, choice: 0, currentFingerprint: representativeSnapshot.fingerprint });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.error.code, "VARIANT_SET_EXPIRED");
  for (const planId of planIdsOf(set)) assert.equal(statusOf(context, planId), "cancelled");
});

test("keeping the current value needs no fresh project: it changes nothing, so there is nothing to go stale", () => {
  const { context } = fixture();
  const set = offeredSet(context);
  const outcome = chooseVariant(context, { setId: set.setId, choice: 1, currentFingerprint: "a-different-project" });
  assert.equal(outcome.ok && outcome.outcome, "kept_current");
});

test("an unknown set, a bad choice and an unreadable project each get a plain refusal", () => {
  const { context } = fixture();
  const set = offeredSet(context);
  const refusal = (input: { setId: string; choice: JsonValue | undefined; currentFingerprint: string | null }): string => { const outcome = chooseVariant(context, input); return outcome.ok ? "ok" : outcome.error.code; };
  assert.equal(refusal({ setId: "nope", choice: 0, currentFingerprint: "x" }), "VARIANT_SET_NOT_FOUND");
  assert.equal(refusal({ setId: set.setId, choice: 7, currentFingerprint: "x" }), "INVALID_ARGUMENT");
  assert.equal(refusal({ setId: set.setId, choice: "1", currentFingerprint: "x" }), "INVALID_ARGUMENT");
  assert.equal(refusal({ setId: set.setId, choice: 0, currentFingerprint: null }), "NO_SNAPSHOT");
  assert.equal(set.status, "open", "none of those refusals closed or applied anything");
});

test("a new set for the same control replaces the old one, whose plans are withdrawn", () => {
  const { context } = fixture();
  const first = offeredSet(context);
  const second = offeredSet(context, { candidates: [{ label: "lower", value: 3 }, { label: "higher", value: 30 }] });
  assert.equal(first.status, "dismissed");
  assert.equal(first.reason, "superseded");
  assert.equal(second.status, "open");
  for (const planId of planIdsOf(first)) assert.equal(statusOf(context, planId), "cancelled");
  for (const planId of planIdsOf(second)) assert.equal(statusOf(context, planId), "prepared");
});

test("ae_list_plans marks each option with its set so a panel can keep it out of the ordinary plan list", () => {
  const { context } = fixture();
  const set = offeredSet(context);
  const ordinary = callTool("ae_propose_plan", { summary: "plain", operations: [{ type: "set_effect_control", target: TARGET, effectMatchName: "ADBE Gaussian Blur 2", value: 4 }] }, context);
  assert.equal(ordinary.ok, true);
  const listed = callTool("ae_list_plans", {}, context);
  const rows = rowsPayloadOf(listed);
  assert.equal(rows.filter((row) => row.variantSetId === set.setId).length, 2);
  assert.equal(rows.filter((row) => row.variantSetId === undefined).length, 1);
});

test("the tool is advertised to external agents and to the in-panel agent, with the guidance and no built-in multipliers", () => {
  for (const tools of [listTools("all"), agentToolDefinitions()]) assert.ok(tools.some((tool) => tool.name === "ae_offer_variants"));
  assert.ok(!listTools("agent").some((tool) => tool.name === "ae_offer_variants"), "external clients are not offered it; it is still callable by name");
  assert.ok(!IN_PANEL_AGENT_HIDDEN_TOOLS.has("ae_offer_variants"), "the in-panel agent has it");
  const definition = present(listTools("all").find((tool) => tool.name === "ae_offer_variants"));
  assert.match(definition.description, /Optional\./);
  assert.match(definition.description, /you choose|values you choose/);
  assert.match(definition.description, /nothing is applied until the user picks/i);
  assert.deepEqual(definition.inputSchema.required, ["target", "effectMatchName", "candidates"]);
  assert.equal(definition.planCard, undefined, "it never produces a plan card, so nothing it makes can be auto-applied");
  for (const file of ["variant-offer.ts", "variant-sets.ts", "variant-tool-definitions.ts"]) {
    const source = repoFile(`packages/mcp-server/src/${file}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/\b(0\.5|1\.5|1\.25|0\.75)\b/.test(source), `${file}: no built-in multiplier`);
    assert.ok(!/\*\s*(value|current)|(value|current)\s*\*/.test(source), `${file}: no value is ever derived from another`);
  }
});

test("the plans' own text is bounded to one plain line even when the label is not", () => {
  const { context, plans } = fixture();
  const result = offer(context, { candidates: [{ label: "line one\nline two\u0007", value: 7 }, { label: "other", value: 8 }] });
  assert.equal(result.ok, true);
  for (const record of plans.values()) assert.ok(!/[\n\u0007]/.test(record.plan.summary), "the plan summary is a single plain line");
});
