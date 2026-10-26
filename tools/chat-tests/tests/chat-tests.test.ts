/** Tests that every chat scenario names a real asset and that offline scenarios can be answered offline. */
import { decodeOrThrow, object, string } from "@extynt/decode";
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { COMPOSITION_ASSETS, PATHS, freshProbe, type CompositionAsset } from "../src/assets.js";
import { SCENARIOS, scenarioById } from "../src/scenarios.js";
import { checkExpectations, formatVerdict, runScenarios, type ScenarioRun } from "../src/run.js";
import { startSidecar } from "../src/sidecar.js";
import type { SidecarHandle } from "../src/sidecar-client.js";
import { probeOf, required, type ProbeResult } from "./test-support.js";

const assetIds = Object.keys(COMPOSITION_ASSETS);

test("every scenario names a real asset, and the offline ones can actually be answered offline", () => {
  for (const scenario of SCENARIOS) {
    assert.ok(assetIds.includes(scenario.asset), `${scenario.id} names unknown asset ${scenario.asset}`);
    assert.ok(scenario.message.trim().length > 0, `${scenario.id} has an empty message`);
    if (scenario.offline) assert.match(scenario.message, /rename/i, `${scenario.id} is marked offline but the mock provider cannot answer it`);
  }
  assert.ok(SCENARIOS.some((scenario) => scenario.offline), "at least one scenario must run without a model");
  assert.ok(SCENARIOS.some((scenario) => !scenario.offline), "at least one scenario must exercise a real model");
});

test("each asset carries the composition shape the sidecar validates", () => {
  for (const asset of Object.values(COMPOSITION_ASSETS)) {
    const result = probeOf(asset);
    const layers = required(result.compositions[0], `${asset.id} composition`).layers;
    if (asset.empty) {
      assert.equal(layers.length, 0, `${asset.id} is marked empty but carries layers`);
      assert.equal(result.selectedLayerIds.length, 0, `${asset.id} is marked empty but selects a layer`);
      continue;
    }
    assert.ok(layers.length >= 2, `${asset.id} needs more than one layer or the briefing has nothing to choose between`);
    assert.ok(result.selectedLayerIds.length === 1, `${asset.id} must select exactly one layer`);
    for (const layer of layers) assert.ok(layer.propertyPaths.some((property) => property.path.startsWith("ADBE Transform Group")), `${asset.id}/${layer.id} has no transform`);
    assert.equal(layers.filter((layer) => layer.id === result.selectedLayerIds[0]).length, 1, `${asset.id} selects a layer it does not contain`);
  }
});

type ProbeLayer = ProbeResult["compositions"][number]["layers"][number];

const LAYER_TYPE_PATHS: Readonly<Record<string, readonly [RegExp | string, string]>> = {
  text: [PATHS.textDocument, "is text without Source Text"],
  shape: [PATHS.shapeRoot, "is a shape without Contents"],
};

function assertLayerCoherent(assetId: string, layer: ProbeLayer, sources: ProbeResult["sources"]): void {
  const label = `${assetId}/${layer.id}`;
  const paths = layer.propertyPaths.map((property) => property.path);
  assert.equal(new Set(paths).size, paths.length, `${label} has duplicate property paths`);
  for (const path of [PATHS.position, PATHS.scale, PATHS.rotation, PATHS.opacity]) assert.ok(paths.includes(path), `${label} is missing ${path}`);
  const [needed, why] = LAYER_TYPE_PATHS[layer.type] ?? [];
  if (typeof needed === "string") assert.ok(paths.includes(needed), `${label} ${why}`);
  if (layer.type === "shape") {
    assert.ok(paths.some((path) => /ADBE Vector Shape - (Rect|Ellipse)/.test(path)), `${label} has no modelled geometry`);
    assert.ok(paths.some((path) => path.endsWith("ADBE Vector Fill Color")), `${label} has no observable fill`);
  }
  if (layer.type === "av" && layer.sourceId !== null) assert.ok(sources.some((source) => source.id === layer.sourceId), `${label} points at missing source ${layer.sourceId}`);
}

test("showcase fixtures are internally coherent AE snapshots, not prompt-shaped wish lists", () => {
  for (const asset of Object.values(COMPOSITION_ASSETS)) {
    const result = probeOf(asset);
    assert.equal(result.compositions.length, 1, `${asset.id} must describe exactly one active test composition`);
    const composition = required(result.compositions[0], `${asset.id} composition`);
    assert.equal(composition.id, result.activeCompositionId, `${asset.id} active composition identity drifted`);
    assert.ok(composition.width > 0 && composition.height > 0, `${asset.id} needs real frame dimensions`);
    assert.ok(composition.duration > 0 && composition.frameRate > 0, `${asset.id} needs real timeline bounds`);
    assert.equal(new Set(composition.layers.map((layer) => layer.id)).size, composition.layers.length, `${asset.id} has duplicate layer ids`);
    assert.equal(new Set(composition.layers.map((layer) => layer.index)).size, composition.layers.length, `${asset.id} has duplicate layer indexes`);
    assert.deepEqual(composition.layers.filter((layer) => layer.isSelected).map((layer) => layer.id), result.selectedLayerIds, `${asset.id} selection flags disagree with the envelope`);
    for (const layer of composition.layers) assertLayerCoherent(asset.id, layer, result.sources);
  }
});

test("every showcase brief starts from the concrete fixture state it describes", () => {
  const layersOf = (assetId: string) => {
    const result = probeOf(required(COMPOSITION_ASSETS[assetId], assetId));
    return new Map(required(result.compositions[0], assetId).layers.map((layer) => [layer.id, new Set(layer.propertyPaths.map((property) => property.path))]));
  };
  const requireLayer = (assetId: string, layerId: string, paths: readonly string[] = []) => {
    const properties = layersOf(assetId).get(layerId);
    assert.ok(properties, `${assetId} is missing ${layerId}`);
    for (const path of paths) assert.ok(properties.has(path), `${assetId}/${layerId} is missing ${path}`);
  };

  requireLayer("summer-launch", "layer-title", [PATHS.textDocument, PATHS.position, PATHS.opacity, PATHS.glow]);
  requireLayer("summer-launch", "layer-lower-third", [PATHS.textDocument, PATHS.position, PATHS.opacity]);
  requireLayer("summer-launch", "layer-accent", [PATHS.shapeRoot, PATHS.scale]);
  requireLayer("summer-launch", "layer-plate", [PATHS.blur, PATHS.blurAmount]);
  requireLayer("summer-launch", "layer-null", [PATHS.position]);
  requireLayer("social-square", "layer-social-background", [PATHS.shapeRoot]);
  requireLayer("social-square", "layer-social-badge", [PATHS.shapeRoot, PATHS.scale]);
  requireLayer("social-square", "layer-social-headline", [PATHS.textDocument]);
  requireLayer("social-square", "layer-social-supporting", [PATHS.textDocument]);

  const fromScratch = ["three-beat-title-card", "product-feature-callout", "kinetic-quote", "staged-brand-opener", "multi-scene-launch-teaser"];
  for (const id of fromScratch) {
    assert.equal(scenarioById(id).asset, "empty-ident", `${id} must start from the empty build fixture`);
    assert.equal(layersOf("empty-ident").size, 0, `${id} would not be a from-scratch test`);
  }
});

function renameRun(scenario: ScenarioRun["scenario"]): Omit<ScenarioRun, "failures"> {
  return {
    scenario,
    logLines: [{ event: "agent.tool", tool: "ae_propose_plan", args: '{"summary":"Rename to Hero","operations":[{"type":"set_layer_name","target":{"compositionId":"comp-main","layerId":"layer-title"},"name":"Hero"}]}' }],
    report: { status: 200, outcome: "planned", answer: "Done.", notes: [], tools: [], plans: [{ planId: "p1", title: "Rename", operations: ["set_layer_name · TITLE — Summer"] }], durationMs: 5 },
  };
}

test("expectations fail when they should, so a green run means something", () => {
  const scenario = scenarioById("rename-selected-layer");
  const base = renameRun(scenario);
  const report = required(base.report);
  assert.deepEqual(checkExpectations(base, scenario.expect), []);
  assert.ok(checkExpectations({ ...base, report: { ...report, outcome: "answered" } }, scenario.expect).length, "a wrong outcome must fail");
  assert.ok(checkExpectations({ ...base, report: { ...report, plans: [] } }, scenario.expect).length, "a missing plan must fail");
  assert.ok(checkExpectations({ ...base, report: { ...report, status: 500 } }, scenario.expect).length, "a failed request must fail");
  const errored: Omit<ScenarioRun, "failures"> = { ...base, report: { ...report, tools: [{ name: "ae_propose_plan", ok: false, code: "TARGET_NOT_FOUND" }] } };
  assert.deepEqual(checkExpectations(errored, scenario.expect), [], "a recovered tool error is not a scenario failure");
  assert.ok(checkExpectations(errored, { ...scenario.expect, noToolErrors: true }).length, "noToolErrors must still catch it");
});

test("a cut-off turn and a report that disagrees with the store are told apart from a failed turn", () => {
  const scenario = scenarioById("rename-selected-layer");
  const base = renameRun(scenario);
  const report = required(base.report);
  const cutOff = checkExpectations({ ...base, report: { ...report, status: 0, outcome: undefined, plans: [], cutOff: "harness", durationMs: 600_000 } }, scenario.expect);
  assert.equal(cutOff.length, 1, JSON.stringify(cutOff));
  assert.match(required(cutOff[0]), /cut the turn off after 600s with no answer/);
  assert.match(required(cutOff[0]), /says nothing about whether the agent could do it/);
  const stalled = checkExpectations({ ...base, report: { ...report, status: 0, outcome: undefined, plans: [], cutOff: "provider", failure: { code: "PROVIDER_TIMEOUT", message: "DeepSeek took too long to respond." }, durationMs: 147_600 } }, scenario.expect);
  assert.equal(stalled.length, 1, JSON.stringify(stalled));
  assert.match(required(stalled[0]), /the provider stopped answering after 148s/);
  assert.match(required(stalled[0]), /DeepSeek took too long to respond/);
  const disagree = checkExpectations({ ...base, store: [], report: { ...report, plans: [{ planId: "p1", title: "Rename", operations: ["set_layer_name · TITLE — Summer"] }] } }, scenario.expect);
  assert.ok(disagree.some((failure) => /the plan store holds nothing while the turn reported p1/.test(failure)), JSON.stringify(disagree));
  assert.deepEqual(checkExpectations({ ...base, store: [{ planId: "p1", status: "prepared" }] }, scenario.expect), []);
  const withDraft: Omit<ScenarioRun, "failures"> = { ...base, store: [{ planId: "p0", status: "draft" }, { planId: "p1", status: "prepared" }] };
  assert.deepEqual(checkExpectations(withDraft, scenario.expect), []);
  assert.match(formatVerdict({ ...withDraft, failures: [] }), /p0\(draft — a draft, not applicable\)/);
  assert.match(formatVerdict({ ...withDraft, failures: [] }), /RESULT: ok \(store: 1 deliverable plan\(s\)\)/);
  const refusedTwo: Omit<ScenarioRun, "failures"> = { ...base, report: { ...report, tools: [{ name: "ae_propose_plan", ok: false, code: "INVALID_VALUE", message: "12 operations cannot run as written. Nothing was applied." }] } };
  assert.match(formatVerdict({ ...refusedTwo, failures: [] }), /refused: ae_propose_plan\(INVALID_VALUE, 12 operations\)/);
});

let sidecar: SidecarHandle;

before(async () => { sidecar = await startSidecar({ kind: "mock" }); });
after(async () => { await sidecar?.stop(); });

test("every asset is accepted by the sidecar's snapshot validator", async () => {
  for (const asset of Object.values(COMPOSITION_ASSETS)) {
    const published = await sidecar.publishSnapshot(freshProbe(asset, `probe-validator-${asset.id}`));
    assert.equal(published.status, 201, `${asset.id} was refused: ${JSON.stringify(published.body).slice(0, 200)}`);
  }
});

test("re-publishing an asset is a fresh observation, not a replay of a superseded one", async () => {
  const [first, second] = Object.values(COMPOSITION_ASSETS);
  const stamp = (asset: CompositionAsset | undefined, tag: string) => freshProbe(required(asset), `probe-fresh-${tag}`);
  assert.equal((await sidecar.publishSnapshot(stamp(first, "a1"))).status, 201);
  assert.equal((await sidecar.publishSnapshot(stamp(second ?? first, "b1"))).status, 201);
  assert.equal((await sidecar.publishSnapshot(stamp(first, "a2"))).status, 201, "the first asset must be publishable again");
  const replayed = await sidecar.publishSnapshot(stamp(first, "a1"));
  assert.equal(replayed.status, 409);
  assert.equal(decodeOrThrow(object({ error: object({ code: string() }) }), replayed.body).error.code, "SUPERSEDED_SNAPSHOT");
});

test("the offline scenario drives a real turn through a real sidecar", async () => {
  const runs = await runScenarios(["rename-selected-layer"], { kind: "mock" }, { quiet: true });
  const run = required(runs[0]);
  assert.deepEqual(run.failures, [], `the offline scenario failed: ${run.failures.join("; ")}`);
  assert.equal(run.report?.status, 200);
  assert.equal(run.report?.outcome, "planned");
  assert.ok((run.report?.plans.length ?? 0) >= 1, "a plan came back");
  assert.ok(run.logLines.some((line) => line.event === "agent.turn"), "the agent.turn line is present");
  assert.ok(run.logLines.some((line) => line.event === "agent.tool" && line.tool === "ae_queue_add"), "the queue_add call is logged");
  assert.ok(run.logLines.some((line) => line.event === "agent.tool" && line.tool === "ae_queue_finish"), "and so is the seal that produced the card");
});

test("live scenarios are reported as skipped rather than quietly dropped when there is no model", async () => {
  const runs = await runScenarios(["question-about-the-comp"], { kind: "mock" }, { quiet: true });
  assert.ok(required(runs[0]).skipped, "a live scenario with no model must say it was skipped");
  assert.deepEqual(required(runs[0]).failures, []);
});
