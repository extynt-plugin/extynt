/** The details call that rides with a write: only layers After Effects can be asked about, every kind, one scope per composition. */
import assert from "node:assert/strict";
import test from "node:test";
import { DETAILS_MAX_LAYERS } from "../src/native-snapshot/index.js";
import { detailsRequestFor } from "../src/host/read-batch.js";
import { touchedBy } from "../src/host/touched.js";

const ALL_KINDS = ["textDocument", "keyDigest", "marker", "maskPath", "shapePath", "layerRef"];

test("no touched layer means no details call", () => {
  assert.equal(detailsRequestFor([]), null);
});

test("layers are grouped by composition, each named once, with every kind asked", () => {
  const request = detailsRequestFor([{ compId: "229", layerId: "351" }, { compId: "253", layerId: "378" }, { compId: "229", layerId: "352" }, { compId: "229", layerId: "351" }]);
  assert.deepEqual(request?.scopes, [{ compId: "229", layerIds: ["351", "352"] }, { compId: "253", layerIds: ["378"] }]);
  assert.deepEqual(request?.include, ALL_KINDS);
});

test("a placeholder id is left out: one malformed id would make the host refuse the whole call", () => {
  assert.equal(detailsRequestFor([{ compId: "229", layerId: "new-layer-1" }]), null);
  assert.deepEqual(detailsRequestFor([{ compId: "229", layerId: "new-layer-1" }, { compId: "229", layerId: "351" }])?.scopes, [{ compId: "229", layerIds: ["351"] }]);
  assert.equal(detailsRequestFor([{ compId: "comp-1", layerId: "351" }]), null);
});

test("the call names at most the layers the host will read", () => {
  const many = Array.from({ length: DETAILS_MAX_LAYERS + 40 }, (_, index) => ({ compId: "229", layerId: String(1000 + index) }));
  const asked = detailsRequestFor(many)?.scopes.flatMap((scope) => scope.layerIds ?? []);
  assert.equal(asked?.length, DETAILS_MAX_LAYERS);
});

test("touched layers come from a compiled command and from an authored plan alike", () => {
  const command = [{ operation: "set_layer_name", compositionId: "229", layerId: "351" }, { operation: "precompose_layers", compositionId: "229", layerIds: ["352", "351"] }];
  assert.deepEqual(touchedBy(command), [{ compId: "229", layerId: "351" }, { compId: "229", layerId: "352" }]);
  const plan = [{ type: "set_layer_name", target: { compositionId: "253", layerId: "378" }, name: "X" }, { type: "create_composition", name: "Y" }, "junk"];
  assert.deepEqual(touchedBy(plan), [{ compId: "253", layerId: "378" }]);
  assert.deepEqual(touchedBy(undefined), []);
});
