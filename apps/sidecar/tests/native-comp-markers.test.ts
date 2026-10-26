/** A composition's own marker list: asked of the jsx details call (the native composition read carries none), parsed, placed on the verify envelope and proved by it. */
import assert from "node:assert/strict";
import test from "node:test";
import { parsePropertyDetails, residualScopes, toProbeEnvelope } from "../src/native-snapshot/index.js";
import type { PropertyDetailsResult } from "../src/native-snapshot/index.js";
import { detailsRequestFor } from "../src/host/read-batch.js";
import { markerCompositionsBy } from "../src/host/touched.js";
import { withoutCompositionMarkers, type Folded } from "../src/host/fold-read.js";
import { reachOf } from "../src/host/read-details.js";
import { createdApplyIds } from "../src/verify/receipt-build.js";
import { appliedUnverifiedMessage } from "../src/server-workflow-cycle-batches.js";
import { runVerify } from "./verify-fixtures.js";
import { readSetOf, type Row } from "./native-fixtures.js";

const rowsAt = (count: number): Row[] => Array.from({ length: count }, (_, index) => ({ time: (index + 1) / 25, comment: `m${index}`, duration: 0, chapter: null, url: null, label: 0, cuePointName: null }));
const compositionDetails = (count: number, truncated = false): PropertyDetailsResult => ({ ok: true, layers: [], compositions: [{ compId: "5", markers: { count, markers: rowsAt(truncated ? 3 : count), ...(truncated ? { truncated: true } : {}) } }] });
const addMarker = (index: number): Row => ({ operation: "add_marker", compositionId: "5", time: (index + 1) / 25, comment: `m${index}` });

function verifyAgainst(details: PropertyDetailsResult | undefined, operations: Row[]): Row[] {
  const read = { ...readSetOf(), ...(details ? { details } : {}) };
  const outcome = runVerify({ operations, hostSteps: operations.map(() => ({ compositionId: "5" })) }, toProbeEnvelope(read, null));
  const steps = outcome.receipt.verification?.steps;
  return Array.isArray(steps) ? steps.filter((step): step is Row => !!step && typeof step === "object") : [];
}

test("six composition markers verify from the details call's marker list, the production failure of run 10", () => {
  const steps = verifyAgainst(compositionDetails(6), [0, 1, 2, 3, 4, 5].map(addMarker));
  assert.deepEqual(steps.map((step) => step.verificationState), Array(6).fill("exact"));
  assert.deepEqual(steps.map((step) => step.basis), Array(6).fill("marker-fields"));
});

test("without the marker list, or with a truncated one, the same markers stay unverified", () => {
  assert.equal(verifyAgainst(undefined, [addMarker(0)])[0]?.basis, "composition-markers-not-fully-serialized");
  assert.equal(verifyAgainst(compositionDetails(1500, true), [addMarker(5)])[0]?.basis, "composition-markers-not-fully-serialized");
});

test("the details parser keeps composition marker rows and refuses a malformed list", () => {
  const good = parsePropertyDetails(JSON.stringify({ ok: true, layers: [], compositions: [{ compId: "5", markers: { count: 2, markers: rowsAt(2) } }] }));
  assert.equal(good.ok, true);
  assert.equal(good.compositions?.[0]?.markers.markers.length, 2);
  assert.equal(parsePropertyDetails(JSON.stringify({ ok: true, layers: [], compositions: [{ compId: "5", markers: { count: 2 } }] })).ok, false);
  assert.equal(parsePropertyDetails(JSON.stringify({ ok: true, layers: [] })).compositions, undefined);
});

test("a marker operation naming no layer asks for its composition's marker list, in the batch and again when the read lacks it", () => {
  const operations = [{ operation: "add_marker", compositionId: "5", time: 1 }, { operation: "add_marker", compositionId: "5", layerId: "11", time: 1 }, { type: "update_marker", target: { compositionId: "6" }, time: 2 }, { operation: "set_layer_name", compositionId: "7", layerId: "1" }];
  assert.deepEqual(markerCompositionsBy(operations), ["5", "6"]);
  const request = detailsRequestFor([], ["5", "x"]);
  assert.deepEqual(request?.markerCompositions, ["5"], "only an id the jsx accepts goes in the request");
  assert.deepEqual(request?.scopes, []);
  assert.equal(detailsRequestFor([], []), null);
  const lacking = toProbeEnvelope(readSetOf(), null);
  assert.deepEqual(residualScopes({ scopes: [], markerCompositions: ["5"] }, lacking)?.markerCompositions, ["5"]);
  const held = toProbeEnvelope({ ...readSetOf(), details: compositionDetails(2) }, null);
  assert.equal(residualScopes({ scopes: [], markerCompositions: ["5"] }, held), null);
});

test("the marker list is dropped from the state an apply posts, so the next ordinary read matches it", () => {
  const envelope = toProbeEnvelope({ ...readSetOf(), details: compositionDetails(2) }, null);
  const folded = { envelope, read: readSetOf(), previous: undefined, complete: true, details: { fromStore: 0, asked: false } } satisfies Folded;
  const posted = withoutCompositionMarkers(folded);
  assert.equal(JSON.stringify(posted.envelope.result.compositions).includes("markers"), false);
  assert.equal(JSON.stringify(posted.envelope.result.compositions), JSON.stringify(toProbeEnvelope(readSetOf(), null).result.compositions));
});

test("the reopen message names what the read-back could not check, not shapes", () => {
  const unproved = (type: string, basis: string) => ({ type, verification: "applied_unverified", basis });
  const batch = { execution: { receipt: { outcomes: [...Array.from({ length: 6 }, () => unproved("add_marker", "composition-markers-not-fully-serialized")), unproved("set_layer_property", "x"), { type: "set_layer_name", verification: "verified", basis: "layer-name" }] } } };
  const message = appliedUnverifiedMessage(batch);
  assert.match(message, /6 composition markers, 1 set layer property results/);
  assert.doesNotMatch(message, /shape/i);
  assert.match(appliedUnverifiedMessage({ execution: { receipt: null } }), /could not confirm every change/);
  assert.match(appliedUnverifiedMessage({ execution: { receipt: { outcomes: [unproved("draw_vector_shapes", "shape-host-readback-unavailable")] } } }), /1 shape details/);
});

test("markers on a composition the same plan creates are read back under After Effects' id, and a placeholder never reaches the host", () => {
  const operations = [{ operation: "create_composition", newCompositionId: "__new__:comp:launch", name: "EXTYNT_LAUNCH_30" }, { operation: "add_marker", compositionId: "__new__:comp:launch", time: 0, comment: "01 REQUEST" }];
  const steps: Array<Record<string, string>> = [{ operation: "create_composition", status: "applied", requestedCompositionId: "__new__:comp:launch", compositionId: "42" }, { operation: "add_marker", status: "applied", compositionId: "42" }];
  const created = createdApplyIds({ ok: true, steps }).ids;
  const resolved = markerCompositionsBy(operations).map((id) => created[id] ?? id);
  assert.deepEqual(resolved, ["42"]);
  assert.deepEqual(reachOf([], resolved).markerCompositions, ["42"]);
  assert.equal(reachOf([], ["__new__:comp:launch"]).markerCompositions, undefined, "an unresolved placeholder is left out instead of failing the whole details call");
});
