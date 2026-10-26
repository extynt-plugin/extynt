/** "Ask before applying": what applies without a click under each preference, and who proposed the change. */
import assert from "node:assert/strict";
import test from "node:test";
import { receiptCreatedIds } from "../src/host/job-created-ids.js";
import { autoApplyAllowed, planRisk } from "../src/host/plan-risk.js";
import { uiStoreFor } from "../src/ui-store.js";
import { fieldOf, readJson } from "./http-json.js";
import { authorization } from "./sidecar-fixture.js";
import { COMP, LAYER, nativeRig, until, type NativeRig } from "./native-rig.js";

type RiskSubject = Parameters<typeof planRisk>[0];

async function removal(rig: NativeRig): Promise<string> {
  const proposed = await rig.agent("ae_propose_plan", { summary: "Remove the layer", operations: [{ type: "remove_layer", destructive: true, target: { compositionId: COMP, layerId: LAYER } }] });
  assert.equal(proposed.body.ok, true, JSON.stringify(proposed.body));
  return String(fieldOf(proposed.body, "data.planId"));
}

const seal = (rig: NativeRig, planId: string) => rig.sidecar.queueReadyPlan({ planId, operationCount: 1 }, { requestId: "turn-1", autoApply: true });

test("by default a reversible edit applies without a click, as the panel's own change", async (t) => {
  const rig = await nativeRig(t);
  const planId = await rig.proposeRename();
  const queued = seal(rig, planId);
  assert.equal(queued.autoApply, true);
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  assert.equal(rig.sidecar.plans.get(planId)?.receipt?.postcondition, "passed", JSON.stringify(rig.logged.filter((entry) => entry.event.startsWith("host."))));
  assert.equal(rig.sidecar.hostFacts.planSources.get(planId), "panel");
});

test("a delete waits for the user under the default, and stays claimable by the UI", async (t) => {
  const rig = await nativeRig(t);
  const planId = await removal(rig);
  const queued = seal(rig, planId);
  assert.equal(queued.autoApply, false);
  await new Promise((resolve) => { setTimeout(resolve, 100); });
  assert.equal(rig.sidecar.plans.get(planId)?.status, "prepared");
  const entry = rig.sidecar.readyPlans.find((candidate) => candidate.planId === planId);
  assert.equal(entry?.autoApply, false);
  assert.equal(entry?.deliveredAt, null);
  assert.deepEqual(rig.writes(), []);
});

test("\"always\" asks about every plan, \"never\" about none", async (t) => {
  const always = await nativeRig(t);
  uiStoreFor(always.sidecar).patchPrefs({ askBeforeApplying: "always" });
  assert.equal(seal(always, await always.proposeRename()).autoApply, false);
  const never = await nativeRig(t);
  uiStoreFor(never.sidecar).patchPrefs({ askBeforeApplying: "never" });
  const planId = await removal(never);
  assert.equal(seal(never, planId).autoApply, true);
  await until(() => never.sidecar.plans.get(planId)?.receipt !== undefined);
  assert.ok(never.writes().length >= 1, `the plugin was asked to write: ${JSON.stringify(never.sidecar.plans.get(planId)?.receipt)}`);
});

test("the panel's own Apply queues the plan for the lane instead of handing the command back", async (t) => {
  const rig = await nativeRig(t);
  const planId = await rig.proposeRename();
  const approved = await rig.ui("ae_approve_plan", { planId, waitSeconds: 10 });
  assert.equal(approved.body.ok, true, JSON.stringify(approved.body));
  assert.equal(fieldOf(approved.body, "data.status"), "verified", "the call waits for the receipt, as an agent's does");
  assert.equal(fieldOf(approved.body, "data.receipt.postcondition"), "passed");
  const listed = await readJson(await fetch(`${rig.base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "panel" }, body: JSON.stringify({ name: "ae_list_plans", arguments: { limit: 5 } }) }));
  assert.equal(fieldOf(listed, "data.0.source"), "panel");
  assert.equal(rig.sidecar.hostFacts.planSources.get(planId), "panel");
});

function record(types: string[], readSetDigest?: string): RiskSubject {
  return { plan: { operations: types.map((type) => ({ type })) }, ...(readSetDigest ? { approvalCapability: { readSetDigest } } : {}) };
}

test("risk covers deletes, render, import and export, scoped-undo-unsupported plans and external agents", () => {
  assert.deepEqual(planRisk(record(["set_layer_name"]), "panel"), { risky: false, reasons: [] });
  assert.deepEqual(planRisk(record(["remove_layer"]), "panel").reasons, ["delete"]);
  assert.deepEqual(planRisk(record(["delete_project_item"]), "panel").reasons, ["delete"]);
  for (const type of ["render_composition", "import_file", "export_mogrt"]) assert.deepEqual(planRisk(record([type]), "panel").reasons, ["outside-project"], type);
  assert.deepEqual(planRisk(record(["set_layer_name"]), "agent").reasons, ["external-agent"]);
  assert.deepEqual(planRisk(record(["set_layer_name"], "abc"), "panel").reasons, ["scoped-undo-unsupported"]);
  const risky = planRisk(record(["remove_layer"]), "panel");
  assert.deepEqual([autoApplyAllowed("risky", risky), autoApplyAllowed("always", { risky: false, reasons: [] }), autoApplyAllowed("never", risky)], [false, false, true]);
});

const removeLayer = (layerId: string) => ({ type: "remove_layer", destructive: true, target: { compositionId: COMP, layerId } });
interface TestOperation { type: string; destructive?: boolean; target?: { compositionId?: string; layerId?: string; itemId?: string; effectPath?: string; propertyPath?: string }; maskId?: string }
const withOps = (operations: TestOperation[]): RiskSubject => ({ plan: { operations } });

test("removing what this job created does not wait for a click; anything unproven still does", () => {
  const owned = new Set(["500"]);
  assert.deepEqual(planRisk(withOps([removeLayer("500")]), "panel", owned).reasons, [], "created by an earlier batch of the job");
  assert.deepEqual(planRisk(withOps([{ type: "create_layer", target: { compositionId: COMP, layerId: "__new__:bg" } }, removeLayer("__new__:bg")]), "panel").reasons, [], "created earlier in the same plan");
  assert.deepEqual(planRisk(withOps([{ type: "remove_mask", destructive: true, target: { compositionId: COMP, layerId: "500" }, maskId: "m1" }]), "panel", owned).reasons, [], "a mask on a job-created layer");
  assert.deepEqual(planRisk(withOps([removeLayer(LAYER)]), "panel", owned).reasons, ["delete"], "a layer that existed before the job");
  assert.deepEqual(planRisk(withOps([removeLayer("500")]), "panel").reasons, ["delete"], "no job context");
  assert.deepEqual(planRisk(withOps([removeLayer("__new__:unknown")]), "panel", owned).reasons, ["delete"], "an unbound placeholder");
  assert.deepEqual(planRisk(withOps([removeLayer("500"), { type: "delete_project_item", destructive: true, target: { itemId: "9" } }]), "panel", owned).reasons, ["delete"], "a project item the job did not create stays risky");
  assert.deepEqual(planRisk(withOps([removeLayer("500")]), "agent", owned).reasons, ["external-agent"], "an external agent plan stays risky");
});

test("the job deleting its own compositions, items and what sits under them auto-applies; the user's stay risky", () => {
  const delItem = (itemId: string) => ({ type: "delete_project_item", destructive: true, target: { itemId } });
  const owned = new Set(["WORLD_THEM", "WORLD_US", "L9"]);
  assert.deepEqual(planRisk(withOps([delItem("WORLD_THEM"), delItem("WORLD_US")]), "panel", owned).reasons, [], "compositions the job created");
  assert.deepEqual(planRisk(withOps([delItem("WORLD_THEM"), delItem("9")]), "panel", owned).reasons, ["delete"], "a pre-existing composition");
  assert.deepEqual(planRisk(withOps([{ type: "cleanup_project", destructive: true }]), "panel", owned).reasons, ["delete"], "cleanup_project stays risky");
  const under = (type: string, layerId: string) => ({ type, destructive: true, target: { compositionId: COMP, layerId, effectPath: "e", propertyPath: "p" } });
  for (const type of ["remove_effect", "delete_keyframes"]) {
    assert.deepEqual(planRisk(withOps([under(type, "L9")]), "panel", owned).reasons, [], `${type} on a job-created layer`);
    assert.deepEqual(planRisk(withOps([under(type, LAYER)]), "panel", owned).reasons, ["delete"], `${type} on the user's layer`);
  }
  assert.deepEqual(planRisk(withOps([{ type: "remove_layer", destructive: true, target: { compositionId: "WORLD_US", layerId: LAYER } }]), "panel", owned).reasons, ["delete"], "a user's layer inside a job-created composition stays risky");
  assert.deepEqual(planRisk(withOps([{ type: "remove_layer", destructive: true, target: { compositionId: "WORLD_US", layerId: "L9" } }]), "panel", owned).reasons, [], "a job-created layer inside a job-created composition");
});

test("a job's created ids are read from batch receipts, and a batch without one adds nothing", () => {
  const batch = (createdId: string) => ({ execution: { receipt: { createdBindings: [{ createdId }] } } });
  assert.deepEqual(receiptCreatedIds([batch("500"), { execution: { receipt: null } }, undefined, batch("501")]), ["500", "501"]);
  assert.deepEqual(receiptCreatedIds([]), []);
});
