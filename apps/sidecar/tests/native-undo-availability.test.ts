/** The panel's Undo after a manual edit that was undone in After Effects: offered again when the project is as the apply left it, withheld while it is not. */
import assert from "node:assert/strict";
import test from "node:test";
import { stampOf } from "../src/snapshot-merge.js";
import { uiEventsFor } from "../src/ui-events.js";
import type { UiEvent } from "../src/ui-contract.js";
import { authorization } from "./sidecar-fixture.js";
import { fieldOf, readJson } from "./http-json.js";
import { nativeProject, nativeRig, until, type NativeRig } from "./native-rig.js";

const NAME = "Other 352";

const changes = async (rig: NativeRig): ReturnType<typeof readJson> => readJson(await fetch(`${rig.base}/v1/changes`, { headers: authorization }));

async function editSecondLayer(rig: NativeRig, name: string): Promise<void> {
  const layer = rig.plugin.state.project.compositions[0]?.layers[1];
  if (layer) layer.name = name;
  const revision = (rig.plugin.state.watch.revision ?? 0) + 1;
  rig.plugin.change({ revision }, ["revision"]);
  await until(() => (rig.sidecar.latest ? stampOf(rig.sidecar.latest.snapshot)?.revision === revision : false));
}

async function appliedRig(t: Parameters<typeof nativeRig>[0]): Promise<{ rig: NativeRig; planId: string }> {
  const rig = await nativeRig(t, { plugin: { project: nativeProject(2) } });
  const planId = await rig.proposeRename();
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  assert.equal(rig.sidecar.plans.get(planId)?.receipt?.postcondition, "passed");
  return { rig, planId };
}

test("Undo is withheld while a manual edit stands and offered again once it is undone in After Effects", async (t) => {
  const { rig } = await appliedRig(t);
  await editSecondLayer(rig, "Edited by hand");
  assert.equal(fieldOf(await changes(rig), "changes.0.undo.available"), false);
  assert.equal(fieldOf(await changes(rig), "changes.0.undo.code"), "UNDO_PROJECT_CHANGED");
  await editSecondLayer(rig, NAME);
  assert.equal(fieldOf(await changes(rig), "changes.0.undo.available"), true, "the project is as the apply left it");
});

test("the Undo offered after an edit and its undo reads the project first, then takes the plan back and confirms it", async (t) => {
  const { rig, planId } = await appliedRig(t);
  await editSecondLayer(rig, "Edited by hand");
  await editSecondLayer(rig, NAME);
  const before = rig.batches().length;
  await rig.ui("ae_undo_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.undoReceipt !== undefined);
  const batches = rig.batches().slice(before);
  assert.equal(batches[0]?.includes("host_call:aeUndoPlan"), false, "the stamp is not the one the apply left, so a guard read comes first");
  assert.equal(batches.at(-1)?.includes("host_call:aeUndoPlan"), true);
  assert.equal(fieldOf(rig.sidecar.plans.get(planId)?.undoReceipt, "undo.restoredPreApplyFingerprint"), true);
  assert.equal(rig.sidecar.plans.get(planId)?.status, "undone");
});

test("an edit still standing at the press is refused by the guard and nothing is undone", async (t) => {
  const { rig, planId } = await appliedRig(t);
  await editSecondLayer(rig, "Edited by hand");
  rig.sidecar.liveStamp = null;
  await rig.ui("ae_undo_plan", { planId });
  assert.equal(rig.writes().includes("aeUndoPlan"), false);
});

test("the panel is told Undo is back once the read that shows the restored project has landed", async (t) => {
  const { rig, planId } = await appliedRig(t);
  await editSecondLayer(rig, "Edited by hand");
  const events: UiEvent[] = [];
  uiEventsFor(rig.sidecar).subscribe((event) => { if (event.type === "undo") events.push(event); });
  await editSecondLayer(rig, NAME);
  await until(() => events.some((event) => fieldOf(event, "planId") === planId && fieldOf(event, "undo.available") === true));
});
