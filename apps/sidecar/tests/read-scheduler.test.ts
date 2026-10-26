/** The read scheduler: what the sidecar asks the panel to read, from its own record of what was read at which revision. */
import { baseViewOf, type BaseView } from "../src/read-base-view.js";
import type { LiveStamp } from "../src/read-currency.js";
import { decideRead, freshSchedulerMemory, type ReadDecision, type ReadInput } from "../src/read-rules.js";
import { MAX_READ_COMPOSITIONS, mergeReadScopes, queueSnapshotRefresh, refreshPending, withdrawSnapshotRefresh } from "../src/read-queue.js";
import type { LiveFocus } from "../src/live-focus.js";
import type { AgentMailboxItem, StoredSnapshot } from "../src/server-types.js";
import { validSnapshot } from "./sidecar-fixture.js";
import assert from "node:assert/strict";
import test from "node:test";

type Mailbox = AgentMailboxItem[];
const first = (mailbox: Mailbox): Mailbox[number] => { const item = mailbox[0]; assert.ok(item); return item; };
const T0 = Date.parse("2026-10-03T12:00:00.000Z");
const base = (over: Partial<BaseView> = {}): BaseView => ({ project: { name: "Fixture", filePath: "/p/a.aep" }, hostStamp: { epoch: 3, revision: 10 }, epoch: 3, coverage: false, itemCount: 40, newest: 10, observed: { A: 10, B: 10 }, held: new Set(["A", "B"]), gaps: new Set(), cheapest: "B", missing: [], ...over });
const focus = (over: Partial<LiveFocus> = {}): LiveFocus => ({ projectPath: "/p/a.aep", projectName: "a.aep", epoch: 3, revision: 10, activeCompositionId: "A", activeCompositionName: "A", selected: [], selectedLayers: [], receivedAt: T0, observedAt: T0, ...over });
const stamp = (revision: number, at: number, items: number | null = 40): LiveStamp => ({ epoch: 3, revision, items, at });
const input = (over: Partial<ReadInput> = {}): ReadInput => ({ now: T0, source: "claim", awaitingFirstRead: false, inventoryKnown: true, pending: false, base: base(), focus: focus(), stamp: stamp(10, T0), memory: freshSchedulerMemory(), ...over });

function ticks() {
  let memory = freshSchedulerMemory();
  return (over: Partial<ReadInput>): ReadDecision => { const decision = decideRead(input({ ...over, memory })); memory = decision.memory; return decision; };
}

test("with no read after a pair, a full read is asked for at once, with the effects census only while no inventory is known, and not again for 30 s", () => {
  const tick = ticks(), awaiting = { base: undefined, awaitingFirstRead: true, stamp: null, focus: null };
  assert.deepEqual(tick({ ...awaiting, inventoryKnown: false }).spec, { reason: "pair", read: { scope: "full" }, includeEffects: true });
  assert.equal(tick({ ...awaiting, now: T0 + 29_000 }).spec, null, "the read is still on its way");
  assert.deepEqual(tick({ ...awaiting, now: T0 + 30_000 }).spec, { reason: "pair", read: { scope: "full" } }, "asked again if it never landed; the census is not repeated once the inventory is known");
  assert.equal(tick({ ...awaiting, now: T0 + 70_000, pending: true }).spec, null, "nothing is stacked on a read that is queued");
  assert.equal(tick({ ...awaiting, now: T0 + 90_000, source: "focus" }).spec, null, "a focus report alone does not start the first read: the panel's claim does");
  assert.equal(tick({ base: undefined, awaitingFirstRead: false, now: T0 + 200_000 }).spec, null, "no panel paired, nothing to ask");
});

test("another project or another epoch is a full read, asked twice for the same difference and then given up on", () => {
  const tick = ticks(), other = { focus: focus({ projectPath: "/p/b.aep", projectName: "b.aep" }) };
  assert.deepEqual(tick(other).spec, { reason: "project", read: { scope: "full" } });
  assert.equal(tick({ ...other, now: T0 + 5000 }).spec, null, "spaced 10 s apart");
  assert.equal(tick({ ...other, now: T0 + 10_000 }).spec?.reason, "project");
  const given = tick({ ...other, now: T0 + 30_000 }); assert.equal(given.spec, null); assert.equal(given.memory.ask?.gaveUp, true);
  assert.equal(tick({ focus: focus(), stamp: { ...stamp(10, T0 + 31_000), epoch: 4 }, now: T0 + 31_500 }).spec?.reason, "project", "the stamp's epoch is enough, without a focus report of another project");
});

test("a project that only differs by its placeholder name is not another project", () => {
  const unsaved = base({ project: { name: "Untitled Project", filePath: null }, hostStamp: { epoch: 3, revision: 10 } });
  assert.equal(decideRead(input({ base: unsaved, focus: focus({ projectPath: null, projectName: "Untitled" }) })).spec, null);
});

test("the open composition is read at once when the snapshot lacks it, with the items when their count differs or is unknown", () => {
  const tick = ticks();
  assert.deepEqual(tick({ focus: focus({ activeCompositionId: "C" }), stamp: stamp(10, T0, 41) }).spec, { reason: "composition", read: { scope: "compositions", compositionIds: ["C"], includeItems: true } });
  assert.deepEqual(ticks()({ focus: focus({ activeCompositionId: "C" }), stamp: stamp(10, T0, 40) }).spec?.read, { scope: "compositions", compositionIds: ["C"], includeItems: false }, "a composition that was already counted: only itself");
  assert.deepEqual(ticks()({ focus: focus({ activeCompositionId: "C" }), stamp: null }).spec?.read, { scope: "compositions", compositionIds: ["C"], includeItems: true }, "an unknown count is read with the items");
  assert.equal(ticks()({ focus: focus({ activeCompositionId: "C" }), base: base({ gaps: new Set(["C"]) }) }).spec, null, "an unread composition belongs to a read still paging: it is not asked for again");
  const pages = { compositionPages: { unread: ["U"], oversized: ["C"], capped: false } };
  const stored: StoredSnapshot = { snapshot: { ...validSnapshot, result: { ...validSnapshot.result, compositions: [], ...pages } }, receivedAt: "2026-10-03T12:00:00.000Z", bytes: 1 };
  const view = baseViewOf(stored);
  assert.deepEqual([...view.gaps], ["U"], "an old panel's oversized list is no permanent gap");
  assert.equal(ticks()({ focus: focus({ activeCompositionId: "C" }), base: base({ gaps: view.gaps, held: view.held }) }).spec?.reason, "composition", "so the open composition is asked for again");
  assert.equal(ticks()({ focus: focus({ activeCompositionId: "C" }), base: base({ coverage: true }) }).spec, null, "a scoped collection snapshot holds the composition it was asked about, so the open one being absent from it asks for nothing");
  assert.equal(decideRead(input({ source: "event", focus: focus({ activeCompositionId: "C" }), stamp: { ...stamp(11, T0), ttlMs: 2500 }, base: base({ coverage: true }) })).spec?.reason, "edit", "but an edit that moved the revision does: the scoped snapshot is stale");
});

test("a selection change is never a reason to read", () => {
  const tick = ticks();
  for (const selected of [[], ["l1"], ["l1", "l2"], ["l9"]]) assert.equal(tick({ focus: focus({ selected }), now: T0 + selected.length }).spec, null);
  assert.equal(tick({ focus: focus({ activeCompositionId: "B" }) }).spec, null, "nor is switching to a composition the snapshot holds");
  assert.equal(tick({ focus: focus({ activeCompositionId: null }) }).spec, null);
});

test("an edit is read as soon as its revision is seen: the open composition, and the items only when their count moved", () => {
  const tick = ticks();
  const settled = tick({ stamp: stamp(12, T0 + 500), now: T0 + 600 });
  assert.deepEqual(settled.spec, { reason: "edit", read: { scope: "compositions", compositionIds: ["A"], includeItems: false } });
  assert.equal(tick({ stamp: stamp(12, T0 + 500), now: T0 + 5000 }).spec, null, "a revision already asked about is never asked twice, even if the read never landed");
  const changed = ticks();
  assert.deepEqual(changed({ stamp: stamp(13, T0 + 6000, 41), now: T0 + 6100 }).spec?.read, { scope: "compositions", compositionIds: ["A"], includeItems: true }, "an item added or removed");
});

test("nothing is read for an edit that the snapshot already holds or that a read in flight will answer", () => {
  const up = ticks();
  assert.equal(up({ stamp: stamp(11, T0), now: T0, base: base({ observed: { A: 11, B: 10 } }) }).spec, null, "the open composition was already read at this revision, and the count is unchanged");
  const pending = ticks();
  assert.equal(pending({ stamp: stamp(11, T0), now: T0, pending: true }).spec, null, "a refresh is queued or running");
  assert.equal(pending({ stamp: stamp(11, T0), now: T0 + 1 }).spec?.reason, "edit", "a refresh that ended without catching up is not mistaken for an answer");
  const noStamps = ticks();
  assert.equal(noStamps({ stamp: stamp(11, T0), now: T0, base: base({ newest: null, observed: { A: null, B: null } }) }).spec, null, "a read that carried no stamp has nothing to compare");
});

test("with no composition open only the item list can be stale, and one composition carries that read", () => {
  const tick = ticks(), none = focus({ activeCompositionId: null });
  assert.equal(tick({ focus: none, stamp: stamp(11, T0, 40), now: T0 }).spec, null, "count unchanged: nothing to read");
  const counted = ticks();
  assert.deepEqual(counted({ focus: none, stamp: stamp(12, T0, 41), now: T0 }).spec?.read, { scope: "compositions", compositionIds: ["B"], includeItems: true }, "the cheapest composition carries the item list");
  const lone = ticks();
  assert.deepEqual(lone({ focus: none, stamp: stamp(12, T0, 41), base: base({ cheapest: null }), now: T0 }).spec, { reason: "edit", read: { scope: "full" } });
});

test("a missing or old stamp is unknown, and a stale focus is no focus", () => {
  const tick = ticks();
  tick({ stamp: null }); assert.equal(tick({ stamp: null, now: T0 + 60_000 }).spec, null, "a hidden or busy panel sends no stamp: no edit can be inferred");
  assert.equal(decideRead(input({ focus: null, stamp: null, base: base({ held: new Set(["A"]) }) })).spec, null, "an open composition nobody reported is not a gap");
});

test("a read with a stamp that lands on the live revision ends the gap", () => {
  const tick = ticks();
  assert.equal(tick({ stamp: stamp(11, T0), now: T0, base: base({ newest: 11, observed: { A: 11, B: 10 } }) }).spec, null);
});

test("queued asks coalesce into the one item: ids are united, the items are read if either wants them, the full read wins", () => {
  const scoped = (ids: string[], includeItems = false) => ({ reason: "edit" as const, read: { scope: "compositions" as const, compositionIds: ids, includeItems } });
  const mailbox: Mailbox = [], state = { agentMailbox: mailbox, readSequence: 0, now: () => new Date(T0) };
  queueSnapshotRefresh(state, scoped(["A"]));
  queueSnapshotRefresh(state, scoped(["B", "A"], true));
  assert.equal(state.agentMailbox.length, 1); assert.deepEqual(first(mailbox).approvedData.read, { scope: "compositions", compositionIds: ["A", "B"], includeItems: true });
  const readId = first(mailbox).approvedData.readId; assert.match(String(readId), /^read-/);
  queueSnapshotRefresh(state, { reason: "project", read: { scope: "full" }, includeEffects: true });
  assert.deepEqual(first(mailbox).approvedData.read, { scope: "full" }); assert.equal(first(mailbox).approvedData.reason, "project"); assert.equal(first(mailbox).approvedData.includeEffects, true); assert.equal(first(mailbox).approvedData.readId, readId, "the item nobody has taken keeps its identity");
  queueSnapshotRefresh(state, scoped(["C"]));
  assert.deepEqual(first(mailbox).approvedData.read, { scope: "full" }, "full stays full");
  assert.equal(refreshPending({ agentMailbox: state.agentMailbox, inFlight: undefined }), true);
  withdrawSnapshotRefresh(state); assert.equal(state.agentMailbox.length, 0);
  assert.equal(refreshPending({ agentMailbox: state.agentMailbox, inFlight: { kind: "refresh_snapshot", id: "x", claimedAt: 0 } }), true, "a running refresh counts");
});

test("a legacy item without a scope is a full read, and more compositions than a request may name become a full read", () => {
  const mailbox: Mailbox = [{ approvedData: { kind: "refresh_snapshot" } }], state = { agentMailbox: mailbox, readSequence: 0, now: () => new Date(T0) };
  queueSnapshotRefresh(state, { reason: "edit", read: { scope: "compositions", compositionIds: ["A"], includeItems: false } });
  assert.deepEqual(first(mailbox).approvedData.read, { scope: "full" });
  const ids = Array.from({ length: MAX_READ_COMPOSITIONS }, (_, index) => `c${index}`);
  assert.deepEqual(mergeReadScopes({ scope: "compositions", compositionIds: ids, includeItems: false }, { scope: "compositions", compositionIds: ["extra"], includeItems: false }), { scope: "full" });
});

test("a composition the item list names but the snapshot never read is asked for, twice at most", () => {
  const tick = ticks(), absent = { base: base({ missing: ["Z"] }), stamp: stamp(10, T0) };
  assert.deepEqual(tick(absent).spec, { reason: "composition", read: { scope: "compositions", compositionIds: ["Z"], includeItems: false } });
  assert.equal(tick({ ...absent, now: T0 + 1000 }).spec, null, "spaced apart");
  assert.equal(tick({ ...absent, now: T0 + 5000 }).spec?.reason, "composition");
  assert.equal(tick({ ...absent, now: T0 + 11_000 }).spec, null, "and then given up on");
  assert.equal(ticks()({ ...absent, pending: true }).spec, null, "never stacked on a read already queued");
});

test("the base view names the compositions the items list holds that no read did, apart from the host's own gaps", () => {
  const snapshot = structuredClone(validSnapshot);
  Object.assign(snapshot.result, {
    items: [{ id: "imported", type: "composition", name: "Imported" }, { id: "gap", type: "composition", name: "Gap" }, { id: "f1", type: "folder", name: "Folder" }],
    compositions: [],
    compositionPages: { unread: ["gap"], oversized: [], capped: false },
  });
  const view = baseViewOf({ snapshot, receivedAt: "2026-10-03T12:00:00.000Z", bytes: 1 });
  assert.deepEqual(view.missing, ["imported"]);
});
