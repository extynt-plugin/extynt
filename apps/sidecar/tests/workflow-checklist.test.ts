/** ADR 0044 rule 8: the request checklist is what "done" means, and the sidecar keeps it. */
import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowId } from "@extynt/workflow";
import { SMALL_REQUEST_MAX_CHARS } from "../src/server-workflow-checklist-model.js";
import { buildProgress, checklistGate, closeUnbuilt, completionWithheld, completionWithheldMessage } from "../src/server-workflow-checklist-completion.js";
import { itemsNamedBy, takeUnlabelledSealHint } from "../src/server-workflow-checklist-stage.js";
import { openItemsNudge, requestScale, checklistStatusLine, itemStates, noteQueueLabel, noteQueueRefusal, noteUnchangedQueue, parseChecklists, recordSeal, serializeChecklists, setChecklist, checklistReply, type Checklist, type ChecklistView } from "../src/server-workflow-checklist.js";
import { AUTOMATIC_CYCLE_CEILING, STALL_CYCLES, automaticCycleStop, noteRecheckCycle, stalledCycles, type CycleBudgetState, type ProgressMark, type ProgressView } from "../src/server-workflow-cycle-budget.js";
import { checklistOf, clearRecheck, requestRecheck, type SidecarActionHost, type SidecarActionLedger } from "../src/server-workflow-sidecar-actions.js";
import { listOf, namesOf } from "../src/server-workflow-operation-json.js";
import { present } from "./agent-test-support.js";
import { parseJson } from "./http-json.js";
import { workflowCycleContract } from "../src/workflow-contract.js";

const JOB: WorkflowId = "job-1";
const checklistIn = (h: SidecarActionHost): Checklist => present(checklistOf(h, JOB), "the checklist");
const host = (): SidecarActionHost => ({ workflowSidecarActions: new Map<WorkflowId, SidecarActionLedger>(), options: { workflowFreeRun: true } });
const bars = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `bar-${String(index + 1).padStart(2, "0")}`, title: `Bar ${index + 1}` }));

type Batch = ChecklistView["batches"][string];
const verified: Batch = { lifecycle: "settled", execution: { mutation: "applied" }, verification: { state: "verified" }, recovery: { state: "none" } };
const unverified: Batch = { lifecycle: "settled", execution: { mutation: "applied" }, verification: { state: "applied_unverified" }, recovery: { state: "none" } };
const rejected: Batch = { lifecycle: "settled", execution: { mutation: "none" }, verification: { state: "not_requested" }, recovery: { state: "none" } };
const inFlight: Batch = { lifecycle: "executing", execution: { mutation: "none" }, verification: { state: "not_requested" }, recovery: { state: "none" } };
const view = (batches: Record<string, Batch>): ChecklistView => ({ batches });

function seal(h: SidecarActionHost, item: string, batchId: string | null): void {
  noteQueueLabel(h, JOB, { stage: item });
  recordSeal(h, JOB, { batchId });
}

test("checklist: the first call sets the list; later calls add items and never remove or rename one", () => {
  const h = host();
  const first = setChecklist(h, JOB, { raw: bars(3) });
  assert.equal(first.ok && first.added.length, 3);
  const second = setChecklist(h, JOB, { raw: [{ id: "bar-02", title: "Renamed" }, { id: "final-report", title: "Final report" }] });
  assert.equal(second.ok && second.added.join(), "final-report");
  assert.equal(second.ok && second.ignored.join(), "bar-02");
  const items = checklistIn(h).items;
  assert.deepEqual(items.map((item) => item.id), ["bar-01", "bar-02", "bar-03", "final-report"], "the omitted items are kept");
  assert.equal(present(items[1], "item").title, "Bar 2", "a rename is ignored");
  const bad = setChecklist(h, JOB, { raw: [{ id: "Not A Slug!", title: "x" }] });
  assert.equal(bad.ok, false);
  assert.equal(setChecklist(h, JOB, { raw: [] }).ok, false);
});

test("checklist: an item is done only after a batch applied and verified", () => {
  const h = host();
  setChecklist(h, JOB, { raw: bars(3) });
  seal(h, "bar-01", "b1");
  seal(h, "bar-02", "b2");
  seal(h, "bar-03", "b3");
  const states = (batches: Record<string, Batch>) => itemStates(checklistIn(h), view(batches)).map((item) => item.status);
  assert.deepEqual(states({ b1: inFlight, b2: inFlight, b3: inFlight }), ["open", "open", "open"]);
  assert.deepEqual(states({ b1: verified, b2: unverified, b3: rejected }), ["done", "open", "open"], "applied_unverified and rejected are not done");
  assert.deepEqual(states({ b1: { ...verified, recovery: { state: "undone" } }, b2: verified, b3: verified }), ["open", "done", "done"], "an undone batch is not done");
});

test("checklist: completion is refused with no checklist; many open items give the count and the next item, not the list", () => {
  const h = host();
  const missing = checklistGate(h, JOB, view({}), undefined);
  assert.equal(missing.code, "CHECKLIST_MISSING");
  assert.match(missing.code ? missing.message : "", /ae_workflow_checklist/);
  setChecklist(h, JOB, { raw: bars(22) });
  for (let index = 1; index <= 7; index += 1) seal(h, `bar-${String(index).padStart(2, "0")}`, `b${index}`);
  const batches = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`b${index + 1}`, verified]));
  const incomplete = checklistGate(h, JOB, view(batches), undefined);
  assert.equal(incomplete.code, "CHECKLIST_INCOMPLETE");
  const message = incomplete.code ? incomplete.message : "";
  assert.match(message, /15 of 22 items are still open; the next one is bar-08: Bar 8\./);
  assert.match(message, /stage "bar-08"/);
  assert.match(message, /^CHECKLIST_INCOMPLETE: Only call this when every checklist item is built, or closed as unbuilt with a reason\./, "the rule comes first");
  assert.doesNotMatch(message, /bar-09/, "the open list is not repeated");
});

test("checklist: with five or fewer items open the refusal keeps the list", () => {
  const h = host();
  setChecklist(h, JOB, { raw: bars(8) });
  for (let index = 1; index <= 3; index += 1) seal(h, `bar-0${index}`, `b${index}`);
  const batches = Object.fromEntries(Array.from({ length: 3 }, (_, index) => [`b${index + 1}`, verified]));
  const gate = checklistGate(h, JOB, view(batches), undefined);
  const message = gate.code ? gate.message : "";
  assert.match(message, /5 of 8 checklist items have no verified batch: bar-04, bar-05, bar-06, bar-07, bar-08/);
});

test("checklist: the in-cycle nudge names the open count and the next item", () => {
  const h = host();
  assert.equal(openItemsNudge(h, JOB, view({})), undefined, "no checklist, no nudge");
  setChecklist(h, JOB, { raw: bars(3) });
  seal(h, "bar-01", "b1");
  assert.match(openItemsNudge(h, JOB, view({ b1: verified })) ?? "", /2 of 3 checklist items are still open; the next is bar-02: Bar 2\. Continue with a tool call/);
  seal(h, "bar-02", "b2");
  seal(h, "bar-03", "b3");
  assert.equal(openItemsNudge(h, JOB, view({ b1: verified, b2: verified, b3: verified })), undefined, "nothing open, no nudge");
});

test("checklist: an item may be closed as unbuilt only after an attempt, and the reason is kept", () => {
  const h = host();
  setChecklist(h, JOB, { raw: bars(2) });
  seal(h, "bar-01", "b1");
  const batches = { b1: verified };
  const untried = checklistGate(h, JOB, view(batches), [{ id: "bar-02", reason: "too hard" }]);
  assert.equal(untried.code, "CHECKLIST_INCOMPLETE", "no batch was attempted for bar-02");
  assert.match(untried.code ? untried.message : "", /no batch was attempted for them: bar-02/);
  seal(h, "bar-02", "b2");
  const stillRunning = checklistGate(h, JOB, view({ ...batches, b2: inFlight }), [{ id: "bar-02", reason: "too hard" }]);
  assert.equal(stillRunning.code, "CHECKLIST_INCOMPLETE", "a batch still in flight is not an attempt that failed");
  const tried = checklistGate(h, JOB, view({ ...batches, b2: unverified }), [{ id: "bar-02", reason: "the host never verified the glow" }]);
  assert.deepEqual(tried.code === undefined ? tried.unbuilt : undefined, [{ id: "bar-02", title: "Bar 2", reason: "the host never verified the glow" }]);
  const again = checklistGate(h, JOB, view({ ...batches, b2: unverified }), undefined);
  assert.equal(again.code, undefined, "an accepted claim need not be repeated");
});

test("checklist: refusals before any batch existed count as an attempt only when repeated or at the seal", () => {
  const h = host();
  setChecklist(h, JOB, { raw: bars(2) });
  noteQueueLabel(h, JOB, { stage: "bar-01" });
  noteQueueRefusal(h, JOB, {});
  assert.equal(checklistGate(h, JOB, view({}), [{ id: "bar-01", reason: "x" }]).code, "CHECKLIST_INCOMPLETE", "one refused queue call is a typo, not an attempt");
  noteQueueRefusal(h, JOB, {});
  assert.equal(present(itemStates(checklistIn(h), view({}))[0], "item state").attempted, true);
  seal(h, "bar-02", null);
  assert.equal(present(itemStates(checklistIn(h), view({}))[1], "item state").attempted, true, "a refused seal is a whole attempt");
});

test("checklist: a queue dropped as unchanged is a whole attempt, so work already built under another stage can be closed", () => {
  const h = host();
  setChecklist(h, JOB, { raw: [{ id: "comp", title: "Comp and text" }, { id: "anim", title: "Fade and pop" }] });
  seal(h, "comp", "b1");
  const batches = { b1: verified };
  noteQueueLabel(h, JOB, { stage: "anim" });
  noteUnchangedQueue(h, JOB);
  assert.equal(present(itemStates(checklistIn(h), view(batches))[1], "item state").attempted, true, "every value was already in After Effects");
  const closed = checklistGate(h, JOB, view(batches), [{ id: "anim", reason: "already applied in the comp batch" }]);
  assert.deepEqual(closed.code === undefined ? closed.unbuilt : undefined, [{ id: "anim", title: "Fade and pop", reason: "already applied in the comp batch" }]);
  seal(h, "comp", "b2");
  assert.deepEqual(checklistIn(h).batchItems.b2, ["comp"], "the dropped queue's label does not ride into the next seal");
});

test("checklist: the status line is one bounded line however long the list", () => {
  const h = host();
  setChecklist(h, JOB, { raw: bars(22) });
  for (let index = 1; index <= 7; index += 1) seal(h, `bar-0${index}`, `b${index}`);
  const batches = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`b${index + 1}`, verified]));
  assert.equal(checklistStatusLine(h, JOB, view(batches)), "Checklist 7/22 done; open: bar-08, bar-09, bar-10, … (+12)");
  const huge = host();
  setChecklist(huge, JOB, { raw: Array.from({ length: 200 }, (_, index) => ({ id: `item-${"x".repeat(30)}-${index}`, title: "t" })) });
  const line = present(checklistStatusLine(huge, JOB, view({})), "the status line");
  assert.ok(line.length <= 240 && !line.includes("\n"), line);
  assert.equal(checklistStatusLine(host(), JOB, view({})), undefined, "no checklist, no line");
});

test("checklist: it survives a restart through the saved handoff", () => {
  const h = host();
  setChecklist(h, JOB, { raw: bars(2) });
  seal(h, "bar-01", "b1");
  const saved = parseJson(JSON.stringify(serializeChecklists(h.workflowSidecarActions)));
  const restored = present(parseChecklists(saved).get(JOB), "the restored checklist");
  assert.deepEqual(restored.items, checklistIn(h).items);
  assert.deepEqual(restored.batchItems, { b1: ["bar-01"] });
  assert.equal(parseChecklists({ [JOB]: { items: "nope" } }).size, 0, "malformed state is dropped");
});

test("checklist: the contract asks for the checklist only where the tool exists, and says planning is long", () => {
  const withChecklist = present(workflowCycleContract({ workflowJobId: "seed", workflowCycle: 0, workflowChecklist: true }), "the contract");
  assert.match(withChecklist, /8\. Planning is long; operations are small/);
  assert.match(withChecklist, /ae_workflow_checklist/);
  assert.match(withChecklist, /Set stage to the item's id/);
  assert.match(withChecklist, /ae_workflow_unbuilt/);
  for (const planned of [false, true]) assert.doesNotMatch(present(workflowCycleContract({ workflowJobId: "seed", workflowCycle: 0, workflowChecklist: true, workflowPlanned: planned }), "the contract"), /ae_workflow_complete|80%/, "a checklist job is never told the completion tool's name or where it opens");
  const without = present(workflowCycleContract({ workflowJobId: "seed", workflowCycle: 0 }), "the contract");
  assert.doesNotMatch(without, /ae_workflow_checklist/);
  assert.match(without, /Only ae_workflow_complete ends the job/, "a job without a checklist keeps its completion instructions");
  assert.doesNotMatch(withChecklist + without, /few stages|sparingly/);
});

function budget(freeRunLedger: Map<WorkflowId, SidecarActionLedger>): { state: CycleBudgetState; land(): void } {
  let applied = 0;
  const store = (): ProgressView => {
    const batchIds = Array.from({ length: applied }, (_, index) => `batch-${index}`);
    return { jobs: { [JOB]: { batchIds, stageIds: [] } }, batches: Object.fromEntries(batchIds.map((id) => [id, { execution: { mutation: "applied" }, verification: { state: "verified" } }])), stages: {} };
  };
  const state: CycleBudgetState = { workflowProgressMarks: new Map<string, ProgressMark>(), now: () => new Date(0), workflowCycleCeiling: AUTOMATIC_CYCLE_CEILING, workflowCoordinator: { workflowStore: { getState: store } }, workflowSidecarActions: freeRunLedger, options: { workflowFreeRun: true } };
  return { state, land: () => { applied += 1; } };
}

test("stall budget: observation-only rechecks the sidecar forced are not stalls", () => {
  const ledgers = new Map<WorkflowId, SidecarActionLedger>();
  const { state } = budget(ledgers);
  const h: SidecarActionHost = { workflowSidecarActions: ledgers, options: { workflowFreeRun: true } };
  assert.equal(automaticCycleStop(state, JOB, 0), null);
  for (let cycle = 1; cycle < STALL_CYCLES; cycle += 1) assert.equal(automaticCycleStop(state, JOB, cycle), null);
  requestRecheck(h, JOB, "an unverified mutation");
  assert.equal(automaticCycleStop(state, JOB, STALL_CYCLES), null, "the pending recheck cycle is not counted");
  clearRecheck(h, JOB);
  noteRecheckCycle(state, JOB);
  assert.equal(stalledCycles(state, JOB, STALL_CYCLES), STALL_CYCLES - 1, "the recheck cycle that ran does not count either");
  assert.deepEqual(automaticCycleStop(state, JOB, STALL_CYCLES + 1), { kind: "stalled", cycles: STALL_CYCLES }, "stalls are still stalls: the pause comes one cycle later");
});

test("stall budget: a checklist item newly done is progress", () => {
  const ledgers = new Map<WorkflowId, SidecarActionLedger>();
  const h: SidecarActionHost = { workflowSidecarActions: ledgers, options: { workflowFreeRun: true } };
  setChecklist(h, JOB, { raw: bars(1) });
  seal(h, "bar-01", "batch-0");
  const { state, land } = budget(ledgers);
  assert.equal(automaticCycleStop(state, JOB, 1), null);
  for (let cycle = 2; cycle < STALL_CYCLES; cycle += 1) assert.equal(automaticCycleStop(state, JOB, cycle), null);
  land();
  assert.equal(automaticCycleStop(state, JOB, STALL_CYCLES), null);
  assert.equal(stalledCycles(state, JOB, STALL_CYCLES), 0);
});

test("request scale: a short goal naming up to three things is small; a long one or one naming four is long", () => {
  assert.equal(requestScale("make the title red"), "small");
  assert.equal(requestScale("make bars BAR_01, BAR_02, BAR_03, BAR_04"), "long", "four names in a short goal");
  assert.equal(requestScale(`make the title red ${"x ".repeat(SMALL_REQUEST_MAX_CHARS)}`), "long", "over the length threshold");
  assert.equal(requestScale("a".repeat(SMALL_REQUEST_MAX_CHARS)), "small", "the threshold itself is small");
  assert.equal(requestScale("build the film with bars BAR_01, BAR_02, BAR_03, BAR_04, BAR_05, a glow, a blur, a drop shadow and a vignette"), "long");
});

test("request scale: a small job with no checklist passes the gate; an explicit checklist is honored", () => {
  const h = { ...host(), workflowCoordinator: { workflowStore: { getState: () => ({ jobs: { [JOB]: { goalSummary: "make the title red" } } }) } } };
  const gate = checklistGate(h, JOB, view({}), undefined);
  assert.equal(gate.code, undefined);
  assert.equal(checklistStatusLine(h, JOB, view({})), undefined);
  setChecklist(h, JOB, { raw: bars(1) });
  assert.equal(checklistGate(h, JOB, view({}), undefined).code, "CHECKLIST_INCOMPLETE");
  const long = { ...host(), workflowCoordinator: { workflowStore: { getState: () => ({ jobs: { [JOB]: { goalSummary: "make bars BAR_01, BAR_02, BAR_03, BAR_04" } } }) } } };
  assert.equal(checklistGate(long, JOB, view({}), undefined).code, "CHECKLIST_MISSING");
});

test("checklist: a seal with no stage inherits the last labelled open item, so completion sees it", () => {
  const h = host();
  setChecklist(h, JOB, { raw: bars(3) });
  seal(h, "bar-01", "b1");
  const noStage = recordSeal(h, JOB, { batchId: "b2" }, view({ b1: inFlight, b2: inFlight }));
  assert.deepEqual(noStage, { items: ["bar-01"], inherited: true });
  const checklist = checklistIn(h);
  assert.deepEqual(checklist.batchItems.b2, ["bar-01"]);
  assert.equal(present(itemStates(checklist, view({ b1: rejected, b2: verified }))[0], "item state").status, "done");
  assert.deepEqual(checklistGate(h, JOB, view({ b1: rejected, b2: verified }), undefined).code, "CHECKLIST_INCOMPLETE");
  seal(h, "bar-02", "b3");
  seal(h, "bar-03", "b4");
  assert.equal(checklistGate(h, JOB, view({ b1: verified, b2: verified, b3: verified, b4: verified }), undefined).code, undefined);
});

test("checklist: a designer's later batches inherit the stage its delegation named; even once its first batch verified", () => {
  const h = host();
  setChecklist(h, JOB, { raw: bars(2) });
  noteQueueLabel(h, JOB, { stage: "bar-01" });
  recordSeal(h, JOB, { batchId: "d1" }, view({ d1: inFlight }));
  recordSeal(h, JOB, { batchId: "d2" }, view({ d1: verified, d2: inFlight }));
  const checklist = checklistIn(h);
  assert.deepEqual(checklist.batchItems, { d1: ["bar-01"], d2: ["bar-01"] });
  recordSeal(h, JOB, { batchId: "d3" }, view({ d1: verified, d2: verified, d3: inFlight }));
  assert.deepEqual(checklistIn(h).batchItems.d3, ["bar-01"], "still the delegation's item: never a false credit to the next one");
  assert.match(takeUnlabelledSealHint(h, JOB) ?? "", /counted toward bar-01.*bar-02/);
});

test("checklist: stage names match ignoring case, spaces, dashes and underscores, or by title prefix", () => {
  const h = host();
  setChecklist(h, JOB, { raw: [{ id: "bar-01", title: "Opening bar" }, { id: "bar-02", title: "Closing bar" }] });
  const c = checklistIn(h);
  assert.deepEqual(itemsNamedBy(c, "Bar_01"), ["bar-01"]);
  assert.deepEqual(itemsNamedBy(c, "bar 02: draw it"), ["bar-02"]);
  assert.deepEqual(itemsNamedBy(c, "BAR01"), ["bar-01"]);
  assert.deepEqual(itemsNamedBy(c, "closing"), ["bar-02"]);
  assert.deepEqual(itemsNamedBy(c, "bar"), [], "ambiguous");
  assert.deepEqual(itemsNamedBy(c, "nothing"), []);
});

test("checklist: a seal that still names no item returns the open ids once", () => {
  const h = host();
  setChecklist(h, JOB, { raw: bars(3) });
  const out = recordSeal(h, JOB, { batchId: "x1" }, view({ x1: inFlight }));
  assert.deepEqual(out.items, []);
  const hint = takeUnlabelledSealHint(h, JOB);
  assert.match(hint ?? "", /bar-01, bar-02, bar-03/);
  assert.equal(takeUnlabelledSealHint(h, JOB), undefined);
});

test("checklist: with no earlier label, a seal takes the job's one open item", () => {
  const h = host();
  setChecklist(h, JOB, { raw: bars(1) });
  assert.deepEqual(recordSeal(h, JOB, { batchId: "s1" }, view({ s1: inFlight })).items, ["bar-01"]);
});

test("checklist: crediting holds when the list changes mid-job (add today; remove or rename if a revise path is ever added)", () => {
  const h = host();
  setChecklist(h, JOB, { raw: bars(2) });
  seal(h, "bar-01", "b1");
  setChecklist(h, JOB, { raw: [{ id: "extra", title: "Extra shot" }] });
  const checklist = checklistIn(h);
  assert.deepEqual(itemStates(checklist, view({ b1: verified })).map((state) => state.status), ["done", "open", "open"], "a new item starts open");
  assert.deepEqual(recordSeal(h, JOB, { batchId: "b2" }, view({ b1: verified, b2: inFlight })).items, ["bar-01"], "no label: still the last stage, never the new item");
  assert.deepEqual(itemsNamedBy(checklist, "extra shot"), ["extra"], "fuzzy matching sees the current list");
  seal(h, "extra", "b3");
  assert.deepEqual(checklist.batchItems.b3, ["extra"]);
  noteQueueLabel(h, JOB, { stage: "bar-02" });
  checklist.items = checklist.items.filter((item) => item.id !== "bar-02" && item.id !== "bar-01");
  checklist.items.push({ id: "bar-01a", title: "Bar 1, first half" });
  assert.deepEqual(recordSeal(h, JOB, { batchId: "b4" }, view({})).items, ["extra"], "the stale label is dropped; the last stage still exists");
  assert.deepEqual(checklist.batchItems.b1, ["bar-01"], "credit for the old id is kept");
  assert.deepEqual(itemStates(checklist, view({ b1: verified })).map((state) => state.status), ["open", "open"], "the successor is open, not credited by accident");
  checklist.items = checklist.items.filter((item) => item.id !== "extra");
  const out = recordSeal(h, JOB, { batchId: "b5" }, view({}));
  assert.deepEqual(out.items, ["bar-01a"], "the last stage is gone, so the one open item is taken");
  assert.match(checklistStatusLine(h, JOB, view({})) ?? "", /bar-01a/);
});

const hostWithGoal = (goal: string): SidecarActionHost => Object.assign(host(), { workflowCoordinator: { workflowStore: { getState: () => ({ jobs: { [JOB]: { goalSummary: goal } } }) } } });
const sentences = Array.from({ length: 10 }, (_, index) => `Shot number ${index + 1} shows the ${["logo", "title", "ring", "stars", "grid", "bars", "dots", "wave", "card", "end"][index]} sliding in over two seconds.`);
const BRIEF = sentences.join(" ");
const specs = (ids: number[]) => ids.map((index) => ({ id: `s-${index}`, title: `Shot ${index}`, spec: present(sentences[index], "sentence") }));

test("coverage: three items covering three of ten sentences gain gap items holding the other seven, in the brief's own words", () => {
  const h = hostWithGoal(BRIEF);
  const set = setChecklist(h, JOB, { raw: specs([0, 1, 2, 5]) });
  assert.ok(set.ok && set.gaps?.length);
  const gaps = checklistIn(h).items.filter((item) => (set.gaps ?? []).includes(item.id));
  assert.deepEqual(gaps.map((item) => item.id), ["gap-01", "gap-02"], "neighbours share an item; a covered sentence between them splits it");
  assert.deepEqual(gaps.map((item) => item.spec), [sentences.slice(3, 5).join(" "), sentences.slice(6).join(" ")]);
  assert.ok(gaps.every((item) => (item.spec ?? "").length <= 400 && item.title.length <= 40));
  assert.match(String(checklistReply({ batches: {} }, set).gaps), /Added gap-01, gap-02 for parts of the request no item covered/);
});

test("coverage: full verbatim coverage passes, ignoring case and whitespace; growth re-checks and never removes", () => {
  const h = hostWithGoal(BRIEF);
  const all = specs([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const second = present(all[1], "second spec");
  second.spec = second.spec.toUpperCase().replace(/ /g, "  ");
  assert.equal(setChecklist(h, JOB, { raw: all }).ok, true);
  const grown = setChecklist(h, JOB, { raw: [{ id: "extra", title: "Extra", spec: "not in the brief at all" }] });
  assert.equal(grown.ok, false);
  assert.equal(checklistIn(h).items.length, 10);
  assert.equal(setChecklist(h, JOB, { raw: [{ id: "extra", title: "Extra", spec: sentences[2] ?? "" }] }).ok, true);
});

test("coverage: quote and dash styles, list markers and edge punctuation do not make a copied spec foreign", () => {
  const brief = `${BRIEF}\n- The tagline reads \u201CBuilt for launch day\u201D \u2014 hold it for two seconds.\n- Then cut to the end card.`;
  const h = hostWithGoal(brief);
  const items = [...specs([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), { id: "tag", title: "Tagline", spec: 'the tagline reads "Built for launch day" - hold it for two seconds. Then cut to the end card' }];
  assert.equal(setChecklist(h, JOB, { raw: items }).ok, true);
  const reworded = setChecklist(hostWithGoal(brief), JOB, { raw: [...specs([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), { id: "tag", title: "Tagline", spec: "The tagline says Built for launch day." }] });
  assert.ok(reworded.ok && reworded.dropped?.join() === "tag" && reworded.gaps?.length === 1, "a reworded spec is left out, and its sentences come back as a gap item");
});

test("coverage: an off-brief spec is left out, not a refusal, and coverage judges the rest; a list with no copied spec is refused", () => {
  const items = [...specs([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), { id: "report", title: "Final report", spec: "Write a final report." }, { id: "rev", title: "Review", kind: "review", covers: ["report"] }];
  const h = hostWithGoal(BRIEF);
  const set = setChecklist(h, JOB, { raw: items, planned: true });
  assert.ok(set.ok && set.dropped?.join() === "report");
  assert.deepEqual(checklistIn(h).items.map((item) => item.id), sentences.slice(0, 10).map((_, index) => `s-${index}`), "the invented item and the review left with nothing to cover are gone");
  const thin = specs([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  present(thin[4], "spec 4").spec = "A paraphrase of the grid shot.";
  present(thin[5], "spec 5").spec = "Another paraphrase.";
  const filled = setChecklist(hostWithGoal(BRIEF), JOB, { raw: thin });
  assert.ok(filled.ok && filled.dropped?.join() === "s-4,s-5" && filled.gaps?.join() === "gap-01", "dropping never opens a hole in coverage");
});

test("coverage: a spec not copied from the brief, a bare list and an oversized spec are each refused", () => {
  const foreign = setChecklist(hostWithGoal(BRIEF), JOB, { raw: [{ id: "s-4", title: "Grid", spec: "A paraphrase of the grid shot." }] });
  assert.match(foreign.ok ? "" : foreign.message, /spec of s-4 is not copied/);
  const h2 = hostWithGoal(BRIEF);
  const bare = setChecklist(h2, JOB, { raw: bars(10) });
  assert.match(bare.ok ? "" : bare.message, /Missing on bar-01, bar-02/);
  const long = hostWithGoal(`${BRIEF} `.repeat(3).trim());
  const swallow = setChecklist(long, JOB, { raw: [{ id: "all", title: "Everything", spec: `${BRIEF} ${BRIEF}`.slice(0, 700) }] });
  assert.match(swallow.ok ? "" : swallow.message, /all cover more than 400 characters/);
});

test("coverage: review items need no spec, the model's own list may carry specs, and a small job is unaffected", () => {
  const h = hostWithGoal(BRIEF);
  const items = [...specs([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), { id: "rev", title: "Review", kind: "review", covers: ["s-0"] }];
  assert.equal(setChecklist(h, JOB, { raw: items, planned: true }).ok, true);
  const small = hostWithGoal("Add a title card that says Hello.");
  assert.equal(setChecklist(small, JOB, { raw: bars(1) }).ok, true);
});

test("completion gate: withheld below 80% of the build items; closed-unbuilt counts, reviews are outside the ratio", () => {
  const h = host();
  setChecklist(h, JOB, { raw: bars(5) });
  const checklist = () => checklistIn(h);
  checklist().items.push({ id: "review-01", title: "Review", kind: "review", covers: ["bar-01"] });
  const withheld = (batches: Record<string, Batch>) => completionWithheld(h, JOB, view(batches));
  assert.deepEqual(withheld({}), { settled: 0, total: 5, next: "bar-01" });
  for (const [index, id] of ["bar-01", "bar-02", "bar-03"].entries()) seal(h, id, `b${index + 1}`);
  assert.equal(withheld({ b1: verified, b2: verified, b3: verified })?.settled, 3, "3 of 5 is under 80%");
  seal(h, "bar-04", "b4");
  assert.equal(withheld({ b1: verified, b2: verified, b3: verified, b4: unverified })?.settled, 3);
  assert.equal(completionWithheld(h, JOB, view({ b1: verified, b2: verified, b3: verified, b4: verified })), undefined, "4 of 5 opens it, the open review does not count");
  const closed = closeUnbuilt(h, JOB, view({ b1: verified, b2: verified, b3: verified, b4: unverified }), [{ id: "bar-04", reason: "never verified" }, { id: "bar-05", reason: "x" }, { id: "review-01", reason: "x" }]);
  assert.ok(closed.ok);
  assert.equal(namesOf(closed.data.closed).join(), "bar-04");
  assert.equal(listOf(closed.data.refused).length, 2);
  assert.equal(completionWithheld(h, JOB, view({ b1: verified, b2: verified, b3: verified, b4: unverified })), undefined, "an item closed unbuilt counts toward 80%");
  assert.equal(buildProgress(h, JOB, view({}))?.total, 5);
  assert.equal(completionWithheldMessage(), "Only call this when every checklist item is built, or closed as unbuilt with a reason. Keep building the checklist.", "no count, threshold or next item: the refusal is no status check");
});

test("completion gate: no checklist, or a small job, is never withheld", () => {
  const h = host();
  assert.equal(completionWithheld(h, JOB, view({})), undefined);
  assert.equal(closeUnbuilt(h, JOB, view({}), [{ id: "bar-01", reason: "x" }]).ok, false);
  assert.equal(completionWithheld(h, undefined, view({})), undefined);
  Object.assign(h, { workflowCoordinator: { workflowStore: { getState: () => ({ jobs: { [JOB]: { goalSummary: "Trim the title." } } }) } } });
  setChecklist(h, JOB, { raw: bars(5) });
  assert.equal(completionWithheld(h, JOB, view({})), undefined, "a small job is exempt");
});
