/** Usage learning is wired into the real flows: a verified receipt keeps values, a failed step or an undo does not, a snapshot is seen once, and the toggle governs all of it. */
import { fieldOf, recordsOf, textOf, type JsonObject } from "./http-json.js";
import { MockProvider } from "@extynt/llm";
import { claimWork } from "./host-apply.js";
import { authorization, chatTurn, hostCensus, mutableSnapshot, queueHarness, sidecarFor, token, type QueueHarness } from "./sidecar-fixture.js";
import { decodeOrThrow } from "@extynt/decode";
import { effectControlOf } from "../src/effect-notes-learn-kept.js";
import { staticValue } from "../src/effect-notes-plan-facts.js";
import assert from "node:assert/strict";
import test from "node:test";

const BLUR = "ADBE Gaussian Blur 2", BLURRINESS = "ADBE Gaussian Blur 2-0001";
const PATH = `ADBE Effect Parade/${BLUR}/${BLURRINESS}`;
const TARGET = { compositionId: "comp-1", layerId: "layer-1", effectPath: `ADBE Effect Parade/${BLUR}`, propertyPath: PATH };
const setBlur = (value: number) => ({ type: "set_effect_control", target: TARGET, effectMatchName: BLUR, value });
const step = (verificationState: string, operation = "set_effect_control") => ({ operation, verificationState, compositionId: "comp-1", layerId: "layer-1", propertyPath: PATH, basis: "fixture readback" });
async function applied(harness: QueueHarness, input: { operations: JsonObject[]; receipt: JsonObject }): Promise<string> {
  const proposed = await harness.agent("ae_propose_plan", { summary: "Blur", operations: input.operations });
  assert.equal(proposed.body.ok, true, JSON.stringify(proposed.body.error));
  const planId = textOf(proposed.body.data, "planId"), approving = harness.agent("ae_approve_plan", { planId, waitSeconds: 5 });
  await claimWork(harness);
  const posted = await harness.post("/v1/receipts", { planId, operation: "apply_plan", mayHaveMutated: true, mutationState: "applied", appliedOperations: ["set_effect_control"], ...input.receipt });
  assert.equal(posted.status, 201);
  await approving;
  return planId;
}
const executed = (steps: JsonObject[], postcondition = "passed") => ({ status: "executed", postcondition, verification: { state: "exact", basis: "fixture readback", steps } });
async function ready(t: Parameters<typeof queueHarness>[0]): Promise<QueueHarness> {
  const harness = await queueHarness(t);
  await harness.post("/v1/host-census", { ...hostCensus(1), result: { ...hostCensus(1).result, installedEffects: [{ matchName: BLUR, displayName: "Gaussian Blur", available: true }] } });
  await harness.post("/v1/snapshots", mutableSnapshot("learn-before"));
  return harness;
}
type Stats = { kept: { count: number; min: number | null; max: number | null } | null; seen: { count: number; max: number | null } | null };
function usageOf(harness: QueueHarness): Stats | undefined {
  const read = harness.sidecar.collection.effectNotes.read({ matchName: BLUR });
  return read.ok ? read.usage.find((entry) => entry.controlPath === BLURRINESS) : undefined;
}
const keptCount = (harness: QueueHarness): number => usageOf(harness)?.kept?.count ?? 0;
const effectUsage = (harness: QueueHarness) => harness.sidecar.collection.effectNotes.topUsage("effect", 5).map((entry) => [entry.name, entry.kept, entry.seen]);
const keptSummary = (harness: QueueHarness): Array<number | null> => { const kept = usageOf(harness)?.kept; return kept ? [kept.count, kept.min, kept.max] : []; };

test("a verified receipt records each applied control value, relative to the effect, and counts the effect", async (t) => {
  const harness = await ready(t);
  await applied(harness, { operations: [setBlur(20)], receipt: executed([step("exact")]) });
  assert.deepEqual(keptSummary(harness), [1, 20, 20], "the control path is the one the notes store uses, not the whole property path");
  assert.deepEqual(effectUsage(harness), [[BLUR, 1, 0]]);
  await applied(harness, { operations: [setBlur(35)], receipt: executed([step("exact")]) });
  assert.deepEqual(keptSummary(harness), [2, 20, 35]);
  assert.deepEqual(effectUsage(harness), [[BLUR, 2, 0]]);
});

test("a step that failed to read back, a failed postcondition and a rejected receipt keep nothing", async (t) => {
  const harness = await ready(t);
  await applied(harness, { operations: [setBlur(11)], receipt: executed([step("failed")], "failed") });
  await applied(harness, { operations: [setBlur(12)], receipt: { status: "rejected", postcondition: "not_run", mayHaveMutated: false, mutationState: "not-applied", appliedOperations: [], error: { code: "HOST_REJECTED", message: "fixture" } } });
  await applied(harness, { operations: [setBlur(13)], receipt: executed([], "passed") });
  assert.equal(usageOf(harness), undefined, "no control value was recorded");
  assert.deepEqual(effectUsage(harness), []);
});

async function undone(harness: QueueHarness, planId: string, receipt: JsonObject): Promise<void> {
  const undoing = harness.agent("ae_undo_plan", { planId, scope: "last", waitSeconds: 5 });
  await claimWork(harness, "undo_plan");
  await harness.post("/v1/receipts", { planId, operation: "undo_plan", status: "executed", executed: true, method: "edit-undo", ...receipt });
  await undoing;
}
test("undoing the whole plan removes what it kept, the value and the effect", async (t) => {
  const harness = await ready(t);
  const planId = await applied(harness, { operations: [setBlur(20)], receipt: executed([step("exact")]) });
  assert.deepEqual([keptCount(harness), effectUsage(harness)], [1, [[BLUR, 1, 0]]]);
  await undone(harness, planId, { times: 1 });
  assert.deepEqual([keptCount(harness), effectUsage(harness)], [0, []]);
});

test("a partial undo leaves what the plan kept until its last group is taken back", async (t) => {
  const harness = await ready(t);
  const planId = await applied(harness, { operations: [setBlur(20)], receipt: { ...executed([step("exact")]), undoGroups: 3 } });
  await undone(harness, planId, { times: 1 });
  assert.deepEqual([keptCount(harness), effectUsage(harness)], [1, [[BLUR, 1, 0]]], "one of three undo groups is not the plan taken back");
  await undone(harness, planId, { times: 2 });
  assert.deepEqual([keptCount(harness), effectUsage(harness)], [0, []], "the remaining groups finish it");
});

test("undoing one plan leaves another plan's values", async (t) => {
  const harness = await ready(t);
  await applied(harness, { operations: [setBlur(20)], receipt: executed([step("exact")]) });
  const second = await applied(harness, { operations: [setBlur(40)], receipt: executed([step("exact")]) });
  await undone(harness, second, { times: 1 });
  assert.deepEqual([keptCount(harness), usageOf(harness)?.kept?.max, effectUsage(harness)], [1, 20, [[BLUR, 1, 0]]]);
});

test("an undo that did not run or whose outcome is unknown removes nothing", async (t) => {
  const harness = await ready(t);
  const planId = await applied(harness, { operations: [setBlur(20)], receipt: executed([step("exact")]) });
  const undoing = harness.agent("ae_undo_plan", { planId, waitSeconds: 5 });
  await claimWork(harness, "undo_plan");
  await harness.post("/v1/receipts", { planId, operation: "undo_plan", status: "unknown", executed: false, hostError: { code: "HOST_HOP_TIMED_OUT", message: "fixture" } });
  await undoing;
  assert.equal(usageOf(harness)?.kept?.count, 1);
});

function liveBlur(id: string, value: number, keyframeCount = 0) {
  const flat = mutableSnapshot(id), group = { valueType: "unknown", value: null, canSetValue: false };
  const control = { path: PATH, matchName: BLURRINESS, displayName: "Blurriness", kind: "property", valueType: "number", value, canSetValue: true };
  const propertyPaths = [{ path: "ADBE Effect Parade", matchName: "ADBE Effect Parade", displayName: "Effects", kind: "group", ...group }, { path: `ADBE Effect Parade/${BLUR}`, matchName: BLUR, displayName: "Gaussian Blur", kind: "group", ...group },
    keyframeCount > 0 ? { ...control, keyframeCount } : control];
  const compositions = flat.result.compositions.map((composition) => ({ ...composition, layers: composition.layers.map((layer) => ({ ...layer, propertyPaths })) }));
  return { ...flat, result: { ...flat.result, compositions } };
}
const seenOf = (harness: QueueHarness) => usageOf(harness)?.seen;
const keptOf = (harness: QueueHarness) => usageOf(harness)?.kept;
test("seen: an accepted snapshot records the effect values it shows once, however often it is re-read", async (t) => {
  const harness = await ready(t);
  for (const id of ["a", "b", "c"]) await harness.post("/v1/snapshots", liveBlur(`seen-${id}`, 4));
  assert.deepEqual([seenOf(harness)?.count, keptOf(harness)], [1, null], "the same control on the same layer is one sighting");
  assert.deepEqual(effectUsage(harness), [[BLUR, 0, 1]], "one layer carries the effect");
  await harness.post("/v1/snapshots", liveBlur("seen-d", 9));
  const read = harness.sidecar.collection.effectNotes.read({ matchName: BLUR, controlPath: BLURRINESS });
  assert.deepEqual([read.ok && read.usage[0]?.seen?.max, seenOf(harness)?.count], [9, 1], "a changed value replaces the old sighting rather than adding one");
});

test("seen: a keyframed control is not a setting, and a snapshot with no effects records nothing", async (t) => {
  const harness = await ready(t);
  await harness.post("/v1/snapshots", liveBlur("seen-keyed", 4, 3));
  assert.equal(usageOf(harness), undefined, "the value at one moment of an animation is not what the user set");
  assert.deepEqual(effectUsage(harness), [[BLUR, 0, 1]], "the effect itself is still carried by the layer");
});

test("with 'Learn from my work' off, receipts and snapshots record nothing, and undo still works", async (t) => {
  const harness = await ready(t);
  const notes = harness.sidecar.collection.effectNotes;
  const planId = await applied(harness, { operations: [setBlur(20)], receipt: executed([step("exact")]) });
  assert.equal(keptCount(harness), 1);
  assert.equal(notes.setLearnFromWork(false).ok, true);
  await undone(harness, planId, { times: 1 });
  assert.equal(keptCount(harness), 0, "taking a value back is always allowed");
  await harness.post("/v1/snapshots", liveBlur("off-1", 7));
  assert.equal(usageOf(harness), undefined, "a snapshot seen while off records nothing");
  await applied(harness, { operations: [setBlur(50)], receipt: executed([step("exact")]) });
  assert.deepEqual([keptCount(harness), usageOf(harness)], [0, undefined], "a verified receipt while off records nothing");
  assert.deepEqual(notes.topUsage("effect", 5), [], "and nothing is offered while it is off");
  notes.setLearnFromWork(true);
  await harness.post("/v1/snapshots", liveBlur("on-1", 8));
  assert.equal(usageOf(harness)?.seen?.count, 1, "turned back on, the next snapshot is learned");
});

test("effect usage reaches the notes read, and the receipt path survives a storage failure", async (t) => {
  const harness = await ready(t);
  await applied(harness, { operations: [setBlur(20)], receipt: executed([step("exact")]) });
  const read = await harness.agent("ae_read_effect_notes", { matchName: BLUR });
  assert.equal(fieldOf(read.body.data, "effectUsage.rank"), 1);
  assert.equal(fieldOf(read.body.data, "effectUsage.kept"), 1);
  assert.equal(fieldOf(read.body.data, "writeAuthorizing"), false);
  const notes = harness.sidecar.collection.effectNotes;
  notes.recordKeptUsage = () => { throw new Error("disk full"); };
  notes.recordKeptEvents = () => { throw new Error("disk full"); };
  const plan = await applied(harness, { operations: [setBlur(30)], receipt: executed([step("exact")]) });
  const status = await harness.agent("ae_get_plan_status", { planId: plan });
  assert.equal(textOf(status.body.data, "status"), "verified", "a learning failure never reaches the receipt");
});

test("a control path is the parameter path under the effect, a sibling suffix is dropped, and only static numbers and vectors are values", () => {
  assert.deepEqual(effectControlOf(PATH), { effectSegment: BLUR, controlPath: BLURRINESS });
  assert.deepEqual(effectControlOf("ADBE Effect Parade/ADBE Glo2#2/ADBE Glo2-0001"), { effectSegment: "ADBE Glo2#2", controlPath: "ADBE Glo2-0001" }, "the second glow is the same effect, and its slot keeps the suffix");
  assert.deepEqual(effectControlOf("ADBE Effect Parade/ADBE Glo2/ADBE Group-0001/ADBE Inner#3-0002#2")?.controlPath, "ADBE Group-0001/ADBE Inner#3-0002");
  assert.equal(effectControlOf("ADBE Transform Group/ADBE Position"), undefined);
  assert.equal(effectControlOf("ADBE Effect Parade/ADBE Glo2"), undefined, "an effect itself has no control path");
  assert.deepEqual([4, [1, 2], [1], true, "4", Number.NaN, [1, "2"], null].map((candidate) => decodeOrThrow(staticValue, candidate)), [4, [1, 2], undefined, undefined, undefined, undefined, undefined, undefined]);
});

test("the in-panel briefing names the user's most-used effects in one labelled line, and only while learning is on and there is something to say", async (t) => {
  const provider = new MockProvider({ answer: "ok" });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const post = <T>(path: string, body: T) => fetch(`http://${address.host}:${address.port}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
  await post("/v1/host-census", { ...hostCensus(1), result: { ...hostCensus(1).result, installedEffects: [{ matchName: BLUR, displayName: "Gaussian Blur", available: true }] } });
  const briefing = async (): Promise<string> => { await chatTurn(address, "hi"); return provider.stepInputs.at(-1)?.system ?? ""; };
  await post("/v1/snapshots", mutableSnapshot("brief-none"));
  assert.doesNotMatch(await briefing(), /Your usage/, "no usage, no line");
  await post("/v1/snapshots", liveBlur("brief-seen", 4));
  const text = await briefing(), lines = text.split("\n").filter((line) => line.startsWith("Your usage")), [line = ""] = lines;
  assert.equal(lines.length, 1);
  assert.match(line, /effects: Gaussian Blur\.$/);
  assert.ok(text.indexOf("Runtime state (") < text.indexOf(line), "it sits in the live half, so the cached half does not change with usage");
  sidecar.collection.effectNotes.setLearnFromWork(false);
  assert.doesNotMatch(await briefing(), /Your usage/, "off means omitted entirely");
});

test("a capability search carries the user's use of an effect and lets it break ties", async (t) => {
  const harness = await ready(t);
  await harness.post("/v1/snapshots", liveBlur("search-seen", 4));
  const found = await harness.agent("ae_search_host_capabilities", { query: "Gaussian Blur", kinds: ["effect"] });
  const row = recordsOf(found.body.data, "entries").find((entry) => fieldOf(entry, "matchName") === BLUR);
  assert.equal(fieldOf(row, "used"), 1);
  harness.sidecar.collection.effectNotes.setLearnFromWork(false);
  const off = recordsOf((await harness.agent("ae_search_host_capabilities", { query: "Gaussian Blur", kinds: ["effect"] })).body.data, "entries").find((entry) => fieldOf(entry, "matchName") === BLUR);
  assert.equal(fieldOf(off, "used"), undefined, "off means no usage is offered");
});
