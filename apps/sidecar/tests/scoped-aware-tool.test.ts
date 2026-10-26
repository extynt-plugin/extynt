/** A bounded graph page is an additional observation: it must not narrow inspections or ordinary plans. */
import type { JsonObject } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { callTool } from "@extynt/mcp-server";
import { runScopedAware } from "../src/scoped-aware-tool.js";
import { numberOf } from "./http-json.js";
import { present } from "./present.js";

const base = present(representativeSnapshot.compositions[0]);
const comp = { ...base, layers: [0, 1, 2].map((i) => ({ ...present(base.layers[0]), id: `L${i}`, index: i + 1, name: `Layer ${i}` })) };
const whole: ProjectSnapshot = { ...representativeSnapshot, fingerprint: "fp-whole", compositions: [comp] };
const scoped: ProjectSnapshot = { ...whole, fingerprint: "fp-scoped", compositions: [{ ...comp, layers: [{ ...present(comp.layers[0]), properties: [] }] }], coverage: { kind: "composition-metadata", compositionId: comp.id, properties: "unknown", otherCompositions: "unknown" } };

function rig(current: ProjectSnapshot) {
  let demoted = 0;
  return { demoted: () => demoted, run: (tool: string, args: JsonObject) => runScopedAware(tool, current, {
    call: (snapshot) => callTool(tool, args, snapshot === undefined ? {} : { snapshot }), whole: () => whole, demote: () => { demoted += 1; },
  }) };
}

test("inspection after a graph page still lists every layer", () => {
  const result = rig(scoped).run("ae_inspect_composition", { compositionId: comp.id });
  assert.ok(result.ok);
  assert.equal(numberOf(result, "data.layerCount"), 3);
});

test("a plan on an existing layer outside the page validates against the whole project and makes it current", () => {
  const harness = rig(scoped);
  const args = { summary: "Rename a layer", operations: [{ type: "set_layer_name", target: { compositionId: comp.id, layerId: "L2" }, name: "Renamed" }] };
  const narrowed = callTool("ae_propose_plan", args, { snapshot: scoped });
  assert.equal(narrowed.ok, false, "the scoped snapshot alone cannot see the layer");
  const result = harness.run("ae_propose_plan", args);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(harness.demoted(), 1);
});

test("a whole-project read is untouched", () => {
  const harness = rig(whole);
  assert.ok(harness.run("ae_inspect_composition", { compositionId: comp.id }).ok);
  assert.equal(harness.demoted(), 0);
});
