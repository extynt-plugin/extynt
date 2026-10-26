/** What /v1/changes and the UI event hook report about the changes the host lane applied: who asked, what is new, and whether Undo still holds. */
import assert from "node:assert/strict";
import test from "node:test";
import { markChangesSeen } from "../src/host/facts.js";
import { uiEventsFor } from "../src/ui-events.js";
import type { UiEvent } from "../src/ui-contract.js";
import { authorization } from "./sidecar-fixture.js";
import { fieldOf, readJson } from "./http-json.js";
import { nativeRig, until } from "./native-rig.js";

test("a change carries who asked for it, and counts as new until the changes are marked seen", async (t) => {
  const rig = await nativeRig(t);
  const planId = await rig.proposeRename();
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  const listed = async () => readJson(await fetch(`${rig.base}/v1/changes`, { headers: authorization }));
  const first = await listed();
  assert.equal(fieldOf(first, "changes.0.planId"), planId);
  assert.equal(fieldOf(first, "changes.0.source"), "agent");
  assert.equal(fieldOf(first, "changes.0.unseen"), true);
  assert.equal(fieldOf(first, "sinceLastSeen"), 1);
  markChangesSeen(rig.sidecar, rig.sidecar.now().getTime() + 1000);
  const second = await listed();
  assert.equal(fieldOf(second, "sinceLastSeen"), 0);
  assert.equal(fieldOf(second, "changes.0.unseen"), false);
});

test("a revision event recomputes undo availability from the stamp it carries and publishes it", async (t) => {
  const rig = await nativeRig(t);
  const planId = await rig.proposeRename();
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  const events: UiEvent[] = [];
  uiEventsFor(rig.sidecar).subscribe((event) => { if (event.type !== "poke") events.push(event); });
  const stamped = rig.plugin.state.watch.revision ?? 0;
  rig.plugin.change({ revision: stamped }, ["revision"]);
  await until(() => events.some((event) => event.type === "undo"));
  assert.equal(fieldOf(events.find((event) => event.type === "undo"), "undo.available"), true, "the revision is still the one the apply left");
  events.length = 0;
  rig.plugin.change({ revision: stamped + 3 }, ["revision"]);
  await until(() => events.some((event) => event.type === "undo"));
  const moved = events.find((event) => event.type === "undo");
  assert.equal(fieldOf(moved, "undo.available"), false);
  assert.match(String(fieldOf(moved, "undo.reason")), /project changed/);
});
