/** The per-project history of agent changes: scoped to the open project, newest first, bounded, and honest about whether Undo is still safe. */
import { ACTION_PLAN_SCHEMA, type ActionPlan } from "@extynt/action-plan";
import type { StoredPlan } from "@extynt/mcp-server";
import { callTool } from "@extynt/mcp-server";
import { representativeSnapshot } from "@extynt/project-graph";
import assert from "node:assert/strict";
import test from "node:test";
import { CHANGE_HISTORY_LIMIT, changeHistory, type ChangeEntry } from "../src/server-change-history.js";
import { StampedPlanStore, type ProjectIdentity } from "../src/server-plan-store.js";
import { claimWork } from "./host-apply.js";
import { authorization, matchingFocus, mutableSnapshot, queueHarness, type QueueHarness } from "./sidecar-fixture.js";
import { fieldOf, listOf, readJson, recordOf, textOf, type JsonObject } from "./http-json.js";
import { present } from "./present.js";

const project: ProjectIdentity = { name: "Fixture", filePath: null };
const elsewhere: ProjectIdentity = { name: "Other", filePath: "/projects/other.aep" };

interface Applied { planId: string; status?: StoredPlan["status"]; at: string; after?: string | null; mutated?: boolean; groups?: number; of?: ProjectIdentity }
const plan = (planId: string): ActionPlan => ({ schemaVersion: ACTION_PLAN_SCHEMA, planId, summary: `Change ${planId}`, snapshotFingerprint: "fp-0", operations: [], requiresApproval: true });
function record(options: Applied): StoredPlan {
  const status = options.status ?? "verified";
  return {
    plan: plan(options.planId), status, project: options.of ?? project, createdAt: options.at, updatedAt: options.at,
    receipt: { planId: options.planId, operation: "apply_plan", status: status === "failed" && options.mutated !== true ? "rejected" : "executed", receivedAt: options.at, mayHaveMutated: options.mutated !== false, afterFingerprint: options.after === undefined ? "fp-now" : options.after, ...(options.groups ? { undoGroups: options.groups } : {}) },
  };
}
function withoutReceipt(entry: StoredPlan): StoredPlan { const copy = { ...entry }; delete copy.receipt; return copy; }
function withoutProject(entry: StoredPlan): StoredPlan { const copy = { ...entry }; delete copy.project; return copy; }
const storeOf = (...records: StoredPlan[]): Map<string, StoredPlan> => new Map(records.map((entry) => [entry.plan.planId, entry]));
const history = (plans: Map<string, StoredPlan>, extra: { project?: ProjectIdentity | null; currentFingerprint?: string | null; limit?: number } = {}) =>
  changeHistory({ plans, project: extra.project === undefined ? project : extra.project, currentFingerprint: extra.currentFingerprint === undefined ? "fp-now" : extra.currentFingerprint, ...(extra.limit ? { limit: extra.limit } : {}) });

test("only the open project's applied changes are listed, newest first", () => {
  const plans = storeOf(
    record({ planId: "old", at: "2026-10-01T10:00:00.000Z" }),
    record({ planId: "new", at: "2026-10-01T12:00:00.000Z" }),
    record({ planId: "mine-too", at: "2026-10-01T11:00:00.000Z" }),
    record({ planId: "other-project", at: "2026-10-01T13:00:00.000Z", of: elsewhere }),
    { ...withoutReceipt(record({ planId: "never-applied", at: "2026-10-01T14:00:00.000Z" })), status: "prepared" },
    withoutProject(record({ planId: "unknown-project", at: "2026-10-01T15:00:00.000Z" })),
  );
  const listed = history(plans);
  assert.deepEqual(listed.changes.map((change) => change.planId), ["new", "mine-too", "old"]);
  assert.deepEqual(listed.project, project);
  assert.deepEqual(history(plans, { project: elsewhere }).changes.map((change) => change.planId), ["other-project"]);
  assert.deepEqual(history(plans, { project: null }), { project: null, changes: [], truncated: false, sinceLastSeen: 0 }, "no open project, nothing to list");
});

test("the list is bounded and says when it was cut", () => {
  const plans = storeOf(...Array.from({ length: CHANGE_HISTORY_LIMIT + 10 }, (_, index) => record({ planId: `p${index}`, at: new Date(Date.parse("2026-10-01T00:00:00.000Z") + index * 1000).toISOString() })));
  const listed = history(plans);
  assert.equal(listed.changes.length, CHANGE_HISTORY_LIMIT);
  assert.equal(listed.truncated, true);
  assert.equal(listed.changes[0]?.planId, `p${CHANGE_HISTORY_LIMIT + 9}`, "the newest is first, the oldest are the ones dropped");
  assert.equal(history(plans, { limit: 3 }).changes.length, 3);
});

const only = (entry: StoredPlan): ChangeEntry | undefined => history(storeOf(entry)).changes[0];
const projectMoved = { available: false, code: "UNDO_PROJECT_CHANGED", reason: "the project changed after this was applied" };

test("a change whose project is where it left it can be undone, and says how many steps are left", () => {
  const fine = only(record({ planId: "fine", at: "2026-10-01T12:00:00.000Z", groups: 3 }));
  assert.deepEqual(fine?.undo, { available: true });
  assert.equal(fine?.undoGroupsRemaining, 3);
  const partly = only({ ...record({ planId: "partly", status: "partially_undone", at: "2026-10-01T10:00:00.000Z", groups: 3 }), undo: { groups: 3, undone: 1, stateFingerprint: "fp-now" } });
  assert.deepEqual(partly?.undo, { available: true });
  assert.equal(partly?.undoGroupsRemaining, 2, "a partly undone change says how many steps are left");
  assert.deepEqual(only(record({ planId: "half", status: "failed", mutated: true, at: "2026-10-01T10:10:00.000Z" }))?.undo, { available: true }, "a plan that failed part-way after writing is undoable like any other");
});

test("a project that moved on is named as the reason", () => {
  assert.deepEqual(only(record({ planId: "moved-on", at: "2026-10-01T11:00:00.000Z", after: "fp-before-the-user-edited" }))?.undo, projectMoved);
});

test("an undone change, a failed one that wrote nothing, and an unconfirmed undo each say so", () => {
  const undone = only(record({ planId: "undone", status: "undone", at: "2026-10-01T10:30:00.000Z" }));
  assert.deepEqual(undone?.undo, { available: false, code: "ALREADY_UNDONE", reason: "already undone" });
  assert.equal(undone?.undoGroupsRemaining, 0);
  const nothing = only(record({ planId: "nothing", status: "failed", mutated: false, at: "2026-10-01T10:20:00.000Z" }));
  assert.deepEqual(nothing?.undo, { available: false, code: "NOTHING_CHANGED", reason: "nothing was changed" });
  assert.equal(nothing?.undoGroupsRemaining, 0);
  const unsure = only(record({ planId: "unsure", status: "undo_unverified", at: "2026-10-01T10:05:00.000Z" }));
  assert.equal(fieldOf(unsure, "undo.code"), "UNDO_UNCONFIRMED");
  assert.match(String(fieldOf(unsure, "undo.reason")), /could not be confirmed/);
});

test("a newer change on top, and a plan only After Effects can undo, are each refused with their own reason", () => {
  const older = record({ planId: "older", at: "2026-10-01T10:00:00.000Z" }), newer = record({ planId: "newer", at: "2026-10-01T11:00:00.000Z" });
  const listed = history(storeOf(older, newer)).changes;
  assert.deepEqual(listed.map((change) => change.undo.available), [true, false]);
  assert.match(String(fieldOf(listed[1], "undo.reason")), /newer change .* undo that one first/);
  const scoped: StoredPlan = { ...record({ planId: "renamed", at: "2026-10-01T12:00:00.000Z" }), approvalCapability: { token: "token", panelSessionId: "panel", planId: "renamed", snapshotFingerprint: "fp-0", selectionFingerprint: "", freshness: representativeSnapshot.freshness, issuedAt: "2026-10-01T12:00:00.000Z", expiresAt: "2026-10-01T12:02:00.000Z", oneTime: true, readSetDigest: "digest" } };
  assert.equal(fieldOf(history(storeOf(scoped)).changes[0], "undo.code"), "SCOPED_UNDO_UNSUPPORTED");
});

test("the list asks exactly what the real undo asks: the same answer for every case, and asking changes nothing", () => {
  const cases: StoredPlan[] = [
    record({ planId: "fine", at: "2026-10-01T12:00:00.000Z" }),
    record({ planId: "moved", at: "2026-10-01T11:00:00.000Z", after: "elsewhere" }),
    record({ planId: "undone", status: "undone", at: "2026-10-01T10:00:00.000Z" }),
    record({ planId: "failed-clean", status: "failed", mutated: false, at: "2026-10-01T09:00:00.000Z" }),
  ];
  const plans = storeOf(...cases);
  const before = JSON.stringify([...plans.values()]);
  const listed = history(plans).changes;
  assert.equal(JSON.stringify([...plans.values()]), before, "listing never writes a plan");
  for (const change of listed) {
    const real = callTool("ae_undo_plan", { planId: change.planId }, { snapshot: { ...representativeSnapshot, fingerprint: "fp-now" }, plans: new Map([...plans].map(([id, entry]) => [id, structuredClone(entry)])) });
    assert.equal(real.ok, change.undo.available, `${change.planId}: the list and the real undo agree`);
    if (!real.ok && !change.undo.available && change.undo.code !== "ALREADY_UNDONE" && change.undo.code !== "NOTHING_CHANGED") assert.equal(real.error.code, change.undo.code, `${change.planId}: and give the same refusal`);
  }
});

test("the plan store stamps the open project once and a replaced plan keeps it", () => {
  let open: ProjectIdentity | undefined = project;
  const store = new StampedPlanStore(() => open);
  store.set("a", withoutProject(record({ planId: "a", at: "2026-10-01T10:00:00.000Z" })));
  assert.deepEqual(store.get("a")?.project, project);
  open = elsewhere;
  store.set("a", withoutProject(record({ planId: "a", at: "2026-10-01T10:00:00.000Z" })));
  assert.deepEqual(store.get("a")?.project, project, "replacing a plan does not move it to whatever project is open now");
  store.set("b", withoutProject(record({ planId: "b", at: "2026-10-01T10:00:00.000Z" })));
  assert.deepEqual(store.get("b")?.project, elsewhere);
  open = undefined;
  store.set("c", withoutProject(record({ planId: "c", at: "2026-10-01T10:00:00.000Z" })));
  assert.equal(store.get("c")?.project, undefined, "with no project open nothing is guessed");
});

const inProject = (requestId: string, layerName: string, of: ProjectIdentity) => { const base = mutableSnapshot(requestId, ["layer-1"], layerName); return { ...base, result: { ...base.result, project: of } }; };
const shown = { fingerprint: "" };
async function show(harness: QueueHarness, requestId: string, layerName: string, of: ProjectIdentity): Promise<void> {
  shown.fingerprint = textOf(await readJson(await harness.post("/v1/snapshots", inProject(requestId, layerName, of))), "fingerprint");
}
async function listChanges(harness: QueueHarness): Promise<JsonObject> {
  const response = await fetch(`${harness.base}/v1/changes`, { headers: authorization });
  assert.equal(response.status, 200);
  const body = await readJson(response);
  return recordOf(body, "");
}
async function applyChange(harness: QueueHarness, tag: string, appliedName: string, of: ProjectIdentity): Promise<string> {
  const planId = String((await harness.agent("ae_prepare_change")).body.data.planId);
  const before = shown.fingerprint;
  await harness.post("/v1/panel/focus", matchingFocus({ projectName: of.name, projectPath: of.filePath }));
  const approving = harness.agent("ae_approve_plan", { planId, waitSeconds: 5 });
  await claimWork(harness);
  await show(harness, `${tag}-after`, appliedName, of);
  await harness.post("/v1/receipts", { planId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["ensure_effect"], mayHaveMutated: true, mutationState: "applied", beforeFingerprint: before });
  assert.equal((await approving).body.data.status, "verified");
  return planId;
}

test("through the sidecar: scoped to the open project, newest first, and Undo goes from safe to refused as the project moves on", async (t) => {
  const harness = await queueHarness(t);
  assert.deepEqual(await listChanges(harness), { ok: true, project: null, changes: [], truncated: false, sinceLastSeen: 0, writeAuthorizing: false }, "no project yet, nothing listed");

  await show(harness, "a-before", "Original", project);
  const first = await applyChange(harness, "a", "First applied", project);
  harness.clock.ms += 60_000;
  const second = await applyChange(harness, "b", "Second applied", project);

  const listed = await listChanges(harness);
  assert.deepEqual(listOf(listed, "changes").map((change) => textOf(change, "planId")), [second, first], "newest first");
  assert.equal(fieldOf(listed, "project.name"), "Fixture");
  assert.equal(fieldOf(listed, "changes.0.status"), "verified");
  assert.equal(fieldOf(listed, "changes.0.undoGroupsRemaining"), 1);
  assert.equal(typeof fieldOf(listed, "changes.0.operations"), "number");
  assert.equal(fieldOf(listed, "changes.0.appliedAt"), new Date(harness.clock.ms).toISOString());
  assert.deepEqual(fieldOf(listed, "changes.0.undo"), { available: true });
  assert.equal(fieldOf(listed, "changes.1.undo.available"), false);
  assert.equal(fieldOf(listed, "changes.1.undo.code"), "UNDO_NOT_LATEST");
  assert.match(textOf(listed, "changes.1.undo.reason"), /undo that one first/);
  const refused = await harness.agent("ae_undo_plan", { planId: first });
  assert.equal(refused.body.ok, false);
  assert.equal(refused.body.error?.code, "UNDO_NOT_LATEST", "the real undo says the same");

  await show(harness, "user-edit", "The user renamed it", project);
  const moved = await listChanges(harness);
  assert.equal(fieldOf(moved, "changes.0.undo.code"), "UNDO_PROJECT_CHANGED");
  assert.match(textOf(moved, "changes.0.undo.reason"), /project changed/);
  const stale = await harness.agent("ae_undo_plan", { planId: second });
  assert.equal(stale.body.error?.code, "UNDO_PROJECT_CHANGED", "and the real undo agrees that the project changed");
  assert.equal(listOf(await listChanges(harness), "changes").length, 2, "asking and refusing leave the history as it was");

  await show(harness, "other-open", "Other original", elsewhere);
  assert.deepEqual(listOf(await listChanges(harness), "changes"), [], "another project open: this one's changes are not shown there");
  const elsewhereChange = await applyChange(harness, "c", "Other applied", elsewhere);
  const other = await listChanges(harness);
  assert.deepEqual(listOf(other, "changes").map((change) => textOf(change, "planId")), [elsewhereChange]);
  assert.equal(fieldOf(other, "project.filePath"), "/projects/other.aep");

  await show(harness, "back", "The user renamed it", project);
  assert.deepEqual(listOf(await listChanges(harness), "changes").map((change) => textOf(change, "planId")), [second, first], "back in the first project its own history returns");
});

test("an undone change says so and the change under it becomes undoable again", async (t) => {
  const harness = await queueHarness(t);
  await show(harness, "u-before", "Original", project);
  await applyChange(harness, "u1", "First applied", project);
  harness.clock.ms += 60_000;
  const second = await applyChange(harness, "u2", "Second applied", project);

  const undoing = harness.agent("ae_undo_plan", { planId: second, waitSeconds: 5 });
  await claimWork(harness, "undo_plan");
  await show(harness, "u-restored", "First applied", project);
  await harness.post("/v1/receipts", { planId: second, operation: "undo_plan", status: "executed", executed: true, method: "edit-undo" });
  assert.equal((await undoing).body.data.status, "undone");

  const listed = await listChanges(harness);
  assert.equal(fieldOf(listed, "changes.0.status"), "undone");
  assert.equal(fieldOf(listed, "changes.0.undo.code"), "ALREADY_UNDONE");
  assert.equal(fieldOf(listed, "changes.0.undoGroupsRemaining"), 0);
  assert.equal(fieldOf(listed, "changes.1.status"), "verified");
  assert.deepEqual(fieldOf(listed, "changes.1.undo"), { available: true }, "with the newer change gone and the project where it left it, the older one can be undone");
});

test("each change says whether any of it may have reached After Effects, so a failure reads Partly applied or Didn't apply", () => {
  const plans = storeOf(
    record({ planId: "partly", status: "failed", mutated: true, at: "2026-10-01T12:00:00.000Z" }),
    record({ planId: "nothing", status: "failed", mutated: false, at: "2026-10-01T11:00:00.000Z" }),
    record({ planId: "fine", at: "2026-10-01T10:00:00.000Z" }),
  );
  assert.deepEqual(history(plans).changes.map((change) => [change.planId, change.mayHaveMutated]), [["partly", true], ["nothing", false], ["fine", true]]);
  const unknown = record({ planId: "unknown", status: "failed", at: "2026-10-01T09:00:00.000Z" });
  delete present(unknown.receipt).mayHaveMutated;
  assert.equal(present(history(storeOf(unknown)).changes[0]).mayHaveMutated, false, "a receipt that does not say is not claimed as a mutation");
});

test("a change row carries the job and batch it belongs to and who made it", () => {
  const plans = storeOf(record({ planId: "chat-1", at: "2026-10-01T10:00:00.000Z" }), record({ planId: "mcp-1", at: "2026-10-01T11:00:00.000Z" }), record({ planId: "built", at: "2026-10-01T12:00:00.000Z" }), record({ planId: "lone", at: "2026-10-01T13:00:00.000Z" }));
  const facts = {
    sources: new Map<string, "panel" | "agent">([["chat-1", "panel"], ["mcp-1", "agent"], ["built", "panel"]]),
    designerPlans: new Set(["built"]),
    workflow: (planId: string) => (planId === "lone" ? { jobId: null, batch: null } : { jobId: "job-1", batch: `batch-${planId}` }),
  };
  const rows = changeHistory({ plans, project, currentFingerprint: "fp-now", facts }).changes;
  const by = (id: string): ChangeEntry => present(rows.find((row) => row.planId === id));
  assert.deepEqual([by("chat-1").origin, by("chat-1").jobId, by("chat-1").batch, by("chat-1").source], ["chat", "job-1", "batch-chat-1", "panel"]);
  assert.equal(by("mcp-1").origin, "mcp");
  assert.equal(by("built").origin, "designer", "a plan the designer built says so, whoever asked for the job");
  assert.deepEqual([by("lone").origin, by("lone").jobId, by("lone").batch], [null, null, null]);
});

test("a change lists the files it wrote outside the project, bounded", () => {
  const base = record({ planId: "renders", at: "2026-10-01T12:00:00.000Z" });
  const written = Array.from({ length: 20 }, (_, index) => ({ path: `/renders/out-${index}.mov`, operation: "render_composition" }));
  const entry = only({ ...base, receipt: { ...present(base.receipt), externalOutputs: written } });
  assert.equal(entry?.files.length, 16);
  assert.deepEqual(entry?.files[0], { path: "/renders/out-0.mov", operation: "render_composition" });
  assert.deepEqual(only(record({ planId: "none", at: "2026-10-01T12:00:00.000Z" }))?.files, []);
});
