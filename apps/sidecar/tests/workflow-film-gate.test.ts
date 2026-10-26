// Completion looks at the finished film: an empty stretch of the master, a shot that is only a background, a built scene that is not placed, and host failures nothing fixed hold it.
import assert from "node:assert/strict";
import test from "node:test";
import type { CompositionSnapshot } from "@extynt/project-graph";
import { FILM_INCOMPLETE, filmRefusal, type FilmGateDeps, type FilmPayload, type FilmState } from "../src/server-workflow-film-gate.js";
import { comp, layer, shot } from "./workflow-film-fixtures.js";

const LONG_GOAL = "Build a 30 second launch film with fifteen shots, each with its own title, motion and colour. ".repeat(6);

interface Built { readonly goal?: string; readonly comps: CompositionSnapshot[]; readonly created: Array<[string, string]>; readonly outcomes?: ReadonlyArray<{ readonly payload: FilmPayload & { readonly type: string }; readonly outcome: string; readonly basis?: string }> }
function deps(built: Built): FilmGateDeps {
  const operations: Record<string, { payload: FilmPayload }> = {};
  built.created.forEach(([placeholder, name], index) => { operations[`op${index}`] = { payload: { type: "create_composition", newCompositionId: placeholder, name } }; });
  const outcomes: Array<{ operationId: string; type: string; outcome: string; basis?: string }> = [];
  (built.outcomes ?? []).forEach((outcome, index) => { operations[`fx${index}`] = { payload: outcome.payload }; outcomes.push({ operationId: `fx${index}`, type: outcome.payload.type, outcome: outcome.outcome, ...(outcome.basis ? { basis: outcome.basis } : {}) }); });
  const state: FilmState = {
    jobs: { j: { goalSummary: built.goal ?? LONG_GOAL, batchIds: ["b"] } },
    batches: { b: { operationIds: Object.keys(operations), recovery: { state: "none" }, execution: { receipt: { outcomes, createdBindings: built.created.map(([placeholder], index) => ({ placeholder, createdId: `c${index}` })) } } } },
    operations,
  };
  return { state: { workflowCoordinator: { workflowStore: { getState: () => state } } }, planState: { normalizedLatest: () => ({ compositions: built.comps }) } };
}
const refusal = (built: Built) => filmRefusal(deps(built), "j");
function messageOf(built: Built): string {
  const refused = refusal(built);
  assert.ok(refused);
  return refused.message;
}

const filledShot = (n: number): CompositionSnapshot => comp(`shot${n}`, `SHOT_${n}`, 3, [layer(`t${n}`, "TITLE", { type: "text" }), layer(`b${n}`, "BG_INK")]);
const filledMaster = (): { comps: CompositionSnapshot[]; created: Array<[string, string]> } => {
  const shots = Array.from({ length: 10 }, (_, i) => filledShot(i + 1));
  return { comps: [comp("c0", "MASTER", 30, shots.map((s, i) => shot(i + 1, i * 3, s.id))), ...shots], created: [["__new__:master", "MASTER"]] };
};

test("a master whose shots all sit at 0-3 s is refused with the empty time ranges", () => {
  const stacked = Array.from({ length: 3 }, (_, i) => ({ ...shot(i + 1, 0, `shot${i + 1}`) }));
  const refused = refusal({ comps: [comp("c0", "MASTER", 30, stacked), filledShot(1), filledShot(2), filledShot(3)].map((c, i) => i > 0 ? { ...c, id: `shot${i}` } : c), created: [["__new__:master", "MASTER"]] });
  assert.equal(refused?.code, FILM_INCOMPLETE);
  assert.match(refused?.message ?? "", /MASTER draws nothing at 2-30 s/);
  assert.match(refused?.message ?? "", /startTime/);
});

test("a shot that holds only a background is named as empty", () => {
  const full = filledMaster();
  full.comps[1] = comp("shot1", "SHOT_1", 3, [layer("bg", "BG_INK")]);
  const message = messageOf(full);
  assert.match(message, /only a background: BAR_1 \(SHOT_1\)/);
  assert.match(message, /Build the content of each into its shot comp\. Fix/);
  assert.doesNotMatch(message, /place the comp that has it/);
});

test("a comp the job built with content that the master does not reach is refused as unplaced", () => {
  const full = filledMaster();
  full.comps.push(comp("world", "WORLD_THEM", 12, [layer("w1", "Title", { type: "text" }), layer("w2", "Bar", { type: "shape" })]));
  full.created.push(["__new__:world", "WORLD_THEM"]);
  assert.match(messageOf(full), /WORLD_THEM has content but is not placed in MASTER/);
});

test("a filled master with every shot placed and built passes", () => {
  const full = filledMaster();
  full.comps[0] = comp("c0", "MASTER", 30, full.comps.slice(1).map((s, i) => shot(i + 1, i * 3, s.id)));
  assert.equal(refusal(full), null);
});

test("an unresolved set_layer_timing failure is listed unless a later write on the same layer succeeded", () => {
  const full = filledMaster();
  full.comps[0] = comp("c0", "MASTER", 30, full.comps.slice(1).map((s, i) => shot(i + 1, i * 3, s.id)));
  const timing = (layerId: string) => ({ type: "set_layer_timing", target: { compositionId: "c0", layerId }, inPoint: 99, outPoint: 100 });
  const failed = messageOf({ ...full, outcomes: [{ payload: timing("s1"), outcome: "readback_mismatch", basis: "layer-timing-mismatch" }, { payload: timing("s2"), outcome: "readback_mismatch", basis: "layer-timing-mismatch" }] });
  assert.match(failed, /set_layer_timing \(layer-timing-mismatch\) failed 2 times/);
  assert.match(failed, /startTime/);
  const fixed = refusal({ ...full, outcomes: [{ payload: timing("s1"), outcome: "readback_mismatch", basis: "layer-timing-mismatch" }, { payload: timing("s1"), outcome: "confirmed" }] });
  assert.equal(fixed, null);
});

test("a small job and a job with no master of its own are unaffected", () => {
  const stacked = [shot(1, 0, "shot1")];
  assert.equal(refusal({ goal: "make the title bigger", comps: [comp("c0", "MASTER", 30, stacked)], created: [["__new__:master", "MASTER"]] }), null);
  assert.equal(refusal({ comps: [comp("c0", "MASTER", 30, stacked)], created: [] }), null);
});

test("the same film gets the same refusal, so the repeated-refusal rule ends the turn", () => {
  const created: Array<[string, string]> = [["__new__:master", "MASTER"]];
  const built = { comps: [comp("c0", "MASTER", 30, [shot(1, 0, "shot1")]), filledShot(1)].map((c, i) => i ? { ...c, id: "shot1" } : c), created };
  assert.equal(messageOf(built), messageOf(built));
});
