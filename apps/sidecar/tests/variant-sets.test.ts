/**
 * The variant picker over the real sidecar: the model offers values, the panel lists them and sends the user's pick, and
 * only that pick is ever approved. Auto-apply never touches an option, a stale or closed set is refused in plain words, a
 * pick is a usage vote through the ordinary receipt, and an unconfirmed preview restore is held like an unresolved mutation.
 */
import { fieldOf, listOf, readJson, recordOf, recordsOf, textOf, type JsonObject, type JsonValue } from "./http-json.js";
import { MockProvider } from "@extynt/llm";
import { authorization, chatTurn, claimResponse, hostCensus, mutableSnapshot, queueHarness, sidecarFor, token, type QueueHarness } from "./sidecar-fixture.js";
import assert from "node:assert/strict";
import test from "node:test";

const BLUR = "ADBE Gaussian Blur 2", BLURRINESS = "ADBE Gaussian Blur 2-0001";
const PATH = `ADBE Effect Parade/${BLUR}/${BLURRINESS}`;
const TARGET = { compositionId: "comp-1", layerId: "layer-1", effectPath: `ADBE Effect Parade/${BLUR}`, propertyPath: PATH };
const OFFER = { target: TARGET, effectMatchName: BLUR, candidates: [{ label: "subtler", value: 2 }, { label: "current", value: 4 }, { label: "stronger", value: 8 }] };
const PANEL = { ...authorization, "content-type": "application/json", "X-AE-Panel-Instance": "panel-1" };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface World extends QueueHarness { panel: (method: string, path: string, body?: JsonValue, headers?: Record<string, string>) => Promise<{ status: number; body: JsonObject }>; publish: (requestId: string, layerName?: string) => Promise<void> }

async function world(t: Parameters<typeof queueHarness>[0]): Promise<World> {
  const harness = await queueHarness(t);
  await fetch(`${harness.base}/v1/pair`, { headers: PANEL });
  const panel: World["panel"] = async (method, path, body, headers = {}) => {
    const response = await fetch(`${harness.base}${path}`, { method, headers: { ...PANEL, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: recordOf(await readJson(response), "") };
  };
  const publish: World["publish"] = async (requestId, layerName = "Original") => { await fetch(`${harness.base}/v1/snapshots`, { method: "POST", headers: PANEL, body: JSON.stringify(mutableSnapshot(requestId, ["layer-1"], layerName)) }); };
  await fetch(`${harness.base}/v1/host-census`, { method: "POST", headers: PANEL, body: JSON.stringify({ ...hostCensus(1), result: { ...hostCensus(1).result, installedEffects: [{ matchName: BLUR, displayName: "Gaussian Blur", available: true }] } }) });
  await publish("variants-1");
  return { ...harness, panel, publish };
}

const planStatuses = (w: World): string[] => [...w.sidecar.plans.values()].map((record) => record.status);
const offerSet = async (w: World, args: JsonObject = OFFER): Promise<string> => {
  const offered = await w.agent("ae_offer_variants", args);
  assert.equal(offered.body.ok, true, JSON.stringify(offered.body.error));
  return textOf(offered.body.data, "setId");
};

test("an offered set reaches the panel with the model's words and numbers, and nothing is queued, approved or applied", async (t) => {
  const w = await world(t);
  const setId = await offerSet(w);
  const listed = await w.panel("GET", "/v1/variants");
  assert.equal(listed.status, 200);
  const [set] = recordsOf(listed.body, "sets");
  assert.equal(textOf(set, "setId"), setId);
  assert.deepEqual([textOf(set, "status"), fieldOf(set, "stale")], ["open", false]);
  assert.deepEqual(recordsOf(set, "candidates").map((candidate) => [candidate.label, candidate.value, candidate.current]), [["subtler", 2, false], ["current", 4, true], ["stronger", 8, false]]);
  assert.equal(textOf(set, "names.control"), "Blurriness");
  assert.equal(fieldOf(set, "composition.width"), 1920, "the panel is told what frame to picture the options on");
  assert.ok(!JSON.stringify(listed.body).includes("plan-"), "plan ids never leave the sidecar");
  assert.equal(listed.body.writeAuthorizing, false);
  assert.deepEqual(planStatuses(w), ["prepared", "prepared"], "one ordinary plan per value that would change something");
  assert.equal((await w.claim()).item, null, "nothing is waiting for the panel to apply");
  assert.deepEqual(listOf(await (await fetch(`${w.base}/v1/chat/plans/ready`, { headers: authorization })).json(), "plans"), [], "nothing is in the commit queue");
  const [planId] = [...w.sidecar.plans.keys()];
  const refused = await w.agent("ae_approve_plan", { planId: String(planId) });
  assert.equal(refused.body.error?.code, "VARIANT_NOT_PICKED", "not even an agent can approve an option the user has not picked");
  assert.deepEqual(planStatuses(w), ["prepared", "prepared"]);
});

test("the choice routes belong to the paired panel", async (t) => {
  const w = await world(t);
  const setId = await offerSet(w);
  for (const [method, path, body] of [["GET", "/v1/variants", undefined], ["POST", "/v1/variants/choose", { setId, choice: 0 }]] as const) {
    const refused = await w.panel(method, path, body, { "X-AE-Panel-Instance": "someone-else" });
    assert.equal(refused.status, 409, path);
    assert.equal(textOf(refused.body, "error.code"), "STALE_PANEL_INSTANCE", path);
  }
  assert.deepEqual(planStatuses(w), ["prepared", "prepared"], "a refused request changed nothing");
  assert.equal((await w.panel("POST", "/v1/variants/choose", { setId: "nope", choice: 0 })).status, 404);
  assert.equal((await w.panel("POST", "/v1/variants/choose", { choice: 0 })).status, 400, "a body without a set is not a choice");
});

async function nextHostItem(w: World): Promise<JsonObject | null> {
  const { item } = await w.claim();
  if (item?.kind !== "capture_frame") return item;
  await w.post("/v1/captures", { captureId: textOf(item, "command.captureId"), ok: true, providerShared: false, dataUrl: "data:image/png;base64,aGVsbG8=", originalWidth: 1920, originalHeight: 1080, previewWidth: 1280, previewHeight: 720, resized: true });
  return null;
}

async function appliedByHost(w: World, planId: string): Promise<void> {
  const approving = w.agent("ae_approve_plan", { planId, waitSeconds: 5 });
  let item: JsonObject | null = null;
  for (let attempt = 0; attempt < 200 && !item; attempt += 1) { item = await nextHostItem(w); if (!item) await wait(10); }
  assert.ok(item, "the picked plan was offered to the panel");
  const step = { operation: "set_effect_control", verificationState: "exact", compositionId: "comp-1", layerId: "layer-1", propertyPath: PATH, basis: "fixture readback" };
  await w.post("/v1/pipeline", { event: "apply-begin", detail: `${planId} 1 operations` });
  const settled = await w.post("/v1/receipts", { planId, operation: "apply_plan", mayHaveMutated: true, mutationState: "applied", appliedOperations: ["set_effect_control"], status: "executed", postcondition: "passed", verification: { state: "exact", basis: "fixture readback", steps: [step] } });
  assert.equal(settled.status, 201, JSON.stringify(await settled.json()));
  await approving;
}

test("a pick leaves exactly one ordinary plan, applied like any plan, and its kept value is the usage vote", async (t) => {
  const w = await world(t);
  const setId = await offerSet(w);
  const picked = await w.panel("POST", "/v1/variants/choose", { setId, choice: 2 });
  assert.equal(picked.status, 200, JSON.stringify(picked.body));
  assert.equal(textOf(picked.body, "outcome"), "picked");
  assert.equal(textOf(picked.body, "set.status"), "picked");
  const planId = textOf(picked.body, "plan.planId");
  assert.match(textOf(picked.body, "plan.title"), /Blurriness on Original to 8 \(stronger\)/, "the card the panel draws is the ordinary plan's");
  assert.deepEqual([...w.sidecar.plans.values()].map((record) => [record.plan.operations.map((operation) => operation.type).join(), record.status]).sort(), [["set_effect_control", "cancelled"], ["set_effect_control", "prepared"]], "the other option was withdrawn, and the pick itself is still unapplied");
  assert.equal((await w.claim()).item, null, "choosing approves nothing: the normal approval comes next");
  await appliedByHost(w, planId);
  assert.equal(w.sidecar.plans.get(planId)?.status, "verified");
  const read = w.sidecar.collection.effectNotes.read({ matchName: BLUR });
  const kept = read.ok ? read.usage.find((entry) => entry.controlPath === BLURRINESS)?.kept : undefined;
  assert.deepEqual([kept?.count, kept?.min, kept?.max], [1, 8, 8], "the picked value is now a usage vote, recorded by the ordinary receipt path");
  const again = await w.panel("POST", "/v1/variants/choose", { setId, choice: 0 });
  assert.equal(again.status, 409);
  assert.equal(textOf(again.body, "error.code"), "VARIANT_SET_CLOSED");
});

test("keeping the current value, or none of these, applies nothing and withdraws every option", async (t) => {
  const w = await world(t);
  const first = await offerSet(w);
  const kept = await w.panel("POST", "/v1/variants/choose", { setId: first, choice: 1 });
  assert.equal(textOf(kept.body, "outcome"), "kept_current");
  assert.equal(fieldOf(kept.body, "plan"), undefined, "no plan comes back to be applied");
  assert.deepEqual(planStatuses(w), ["cancelled", "cancelled"]);
  const second = await offerSet(w, { ...OFFER, candidates: [{ label: "lower", value: 1 }, { label: "higher", value: 9 }] });
  const none = await w.panel("POST", "/v1/variants/choose", { setId: second, choice: "none" });
  assert.equal(textOf(none.body, "outcome"), "dismissed");
  assert.deepEqual(planStatuses(w), ["cancelled", "cancelled", "cancelled", "cancelled"]);
  assert.equal((await w.claim()).item, null);
  const read = w.sidecar.collection.effectNotes.read({ matchName: BLUR });
  assert.equal(read.ok ? read.usage.find((entry) => entry.controlPath === BLURRINESS)?.kept ?? null : null, null, "no vote was recorded for a value nobody applied");
});

test("a set offered before the project changed is refused in plain words, closed, and nothing is applied", async (t) => {
  const w = await world(t);
  const setId = await offerSet(w);
  await w.publish("variants-2", "Renamed by hand");
  const stale = await w.panel("GET", "/v1/variants");
  assert.equal(fieldOf(recordsOf(stale.body, "sets")[0], "stale"), true, "the panel can tell before it asks");
  const refused = await w.panel("POST", "/v1/variants/choose", { setId, choice: 2 });
  assert.equal(refused.status, 409);
  assert.equal(textOf(refused.body, "error.code"), "VARIANT_SET_STALE");
  assert.equal(textOf(refused.body, "error.message"), "The project changed after these options were offered, so none of them can be applied safely. Nothing was changed. Ask for them again.");
  assert.equal(textOf(refused.body, "set.status"), "dismissed");
  assert.deepEqual(planStatuses(w), ["cancelled", "cancelled"]);
  assert.equal((await w.claim()).item, null);
});

test("with auto-apply on, an in-panel turn that offers variants applies none of them and returns no plan card", async (t) => {
  const seen: string[] = [];
  const provider = new MockProvider({ script: (input) => {
    seen.push(...(input.tools ?? []).map((tool) => tool.name));
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    if (called.includes("ae_offer_variants")) return { text: "Here are three strengths to choose from.", toolCalls: [] };
    return { text: "", toolCalls: [{ id: "offer", name: "ae_call_tool", arguments: { name: "ae_offer_variants", arguments: OFFER } }] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/pair`, { headers: PANEL });
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: PANEL, body: JSON.stringify(mutableSnapshot("variants-turn")) });
  const reply = await chatTurn(address, "make the blur subtler", [], { autoApply: true });
  assert.ok(seen.includes("ae_call_tool"), "the in-panel agent reaches ae_offer_variants through the dispatcher");
  assert.ok(provider.stepInputs[0]?.tools?.some((tool) => tool.name === "ae_tool_schema" && tool.description.includes("ae_offer_variants")), "and the catalogue lists it by name");
  const briefing = provider.stepInputs[0]?.system ?? "";
  assert.match(briefing, /you MAY put 2-4 values you choose to the user with ae_offer_variants \(reach it with ae_tool_schema\) instead of guessing one/, "the agent is told it may offer variants");
  assert.match(briefing, /It is optional; nothing is applied until they pick, auto-apply never applies those options/, "never mandatory, and never auto-applied");
  assert.ok(!/make the glow subtler.*\b(always|must)\b/i.test(briefing.slice(briefing.indexOf("15. For a subjective"), briefing.indexOf("15. For a subjective") + 400)), "no canned trigger");
  assert.deepEqual(reply.tools.map((tool) => [tool.name, tool.ok]).filter(([name]) => name === "ae_offer_variants"), [["ae_offer_variants", true]]);
  assert.deepEqual(reply.plans, [], "no plan card, so the panel has nothing to auto-apply");
  assert.deepEqual([...sidecar.plans.values()].map((record) => record.status), ["prepared", "prepared"], "the options wait for the pick");
  assert.deepEqual(listOf(await readJson(await fetch(`${base}/v1/chat/plans/ready`, { headers: authorization })), "plans"), [], "none is in the commit queue");
  const claimed = await readJson(claimResponse(sidecar));
  assert.equal(fieldOf(claimed, "item") ?? null, null, "and none is waiting in the mailbox");
  const listed = await readJson(await fetch(`${base}/v1/variants`, { headers: PANEL }));
  assert.equal(recordsOf(listed, "sets").length, 1, "the set is there for the panel to draw");
});

test("an unconfirmed preview restore is held like an unresolved mutation, and only the paired panel can report one", async (t) => {
  const w = await world(t);
  const health = async (): Promise<JsonValue> => await readJson(await fetch(`${w.base}/health`, { headers: authorization }));
  assert.equal(fieldOf(await health(), "nativeMutationQuarantine"), null);
  const report = { code: "PREVIEW_RESTORE_UNCONFIRMED", message: "A preview could not confirm it put the control back." };
  const refused = await w.panel("POST", "/v1/panel/events", report, { "X-AE-Panel-Instance": "someone-else" });
  assert.equal(refused.status, 409);
  assert.equal(fieldOf(await health(), "nativeMutationQuarantine"), null, "an unpaired report holds nothing");
  assert.equal((await w.panel("POST", "/v1/panel/events", report)).status, 201);
  const held = await health();
  assert.equal(fieldOf(held, "nativeMutationQuarantine.state"), "unresolved");
  assert.equal(fieldOf(held, "nativeMutationQuarantine.accessKind"), "mutation");
  assert.equal(fieldOf(held, "nativeAccessQuarantine.state"), "unresolved", "the panel's connection badge reads the same evidence");
});

test("pairing a new panel instance clears the plans, so it clears the sets of options that pointed at them", async (t) => {
  const w = await world(t);
  await offerSet(w);
  assert.equal(recordsOf((await w.panel("GET", "/v1/variants")).body, "sets").length, 1);
  const second = { ...PANEL, "X-AE-Panel-Instance": "panel-2" };
  await fetch(`${w.base}/v1/pair`, { headers: second });
  await fetch(`${w.base}/v1/snapshots`, { method: "POST", headers: second, body: JSON.stringify(mutableSnapshot("variants-2")) });
  const listed = await w.panel("GET", "/v1/variants", undefined, { "X-AE-Panel-Instance": "panel-2" });
  assert.deepEqual(recordsOf(listed.body, "sets"), [], "no option is left pointing at a plan that no longer exists");
  assert.deepEqual(planStatuses(w), []);
});
