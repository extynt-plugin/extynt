// The canonical plan digest: stable encoding, root digest exclusions, key order independence, and the scoped read set that shares it.
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { type JsonObject } from "@extynt/decode";
import { metadataReadSet, validateActionPlanJson } from "../src/index.js";
import { planDigestJson } from "../src/plan-digest.js";
import { target } from "./fixtures.js";
import { buildPlan, refusal } from "./plan-builders.js";

const EXPECTED = "89ba100e9984e5e67606b32aa6721f841939dca82c7a7838a9b53ceae7a30e29";
const renameOperation = { type: "set_layer_name", target: { compositionId: "7", layerId: "8" }, name: "After" } satisfies JsonObject;
const fixture = { schemaVersion: "0.2", planId: "canonical-fixture", requiresApproval: true, bounds: { maxOperations: 1 }, operations: [renameOperation], description: "Unicode: 漢字" } satisfies JsonObject;

function scopedSnapshot(): ProjectSnapshot {
  const composition = representativeSnapshot.compositions[0];
  if (composition === undefined) assert.fail("the representative snapshot holds a composition");
  return { ...representativeSnapshot, hostStamp: { epoch: 1, revision: 4 }, coverage: { kind: "composition-metadata", compositionId: composition.id, properties: "unknown", otherCompositions: "unknown" }, compositions: [{ ...composition, itemIndex: 1 }] };
}

function rename(name: string): JsonObject {
  return { type: "set_layer_name", target, name };
}

test("the digest encodes the plan canonically", () => {
  assert.equal(planDigestJson(fixture), EXPECTED);
  assert.equal(planDigestJson({ ...fixture, operations: [{ ...renameOperation, name: "Changed" }] }), "3566688474708df24f290970235d7056f74f4bc0caec72894c50777157662bd0");
});

test("the digest leaves out the plan's own digest fields", () => {
  assert.equal(planDigestJson({ ...fixture, digest: "old", planDigest: "another" }), EXPECTED);
});

test("the digest does not depend on key order", () => {
  const reordered = { description: fixture.description, operations: [{ name: "After", target: { layerId: "8", compositionId: "7" }, type: "set_layer_name" }], bounds: fixture.bounds, requiresApproval: true, planId: fixture.planId, schemaVersion: fixture.schemaVersion } satisfies JsonObject;
  assert.equal(planDigestJson(reordered), EXPECTED);
});

test("validation accepts the sealed plan and refuses one whose contents changed", () => {
  const sealed = buildPlan({ operations: [rename("After")] });
  assert.equal(validateActionPlanJson(sealed, representativeSnapshot).ok, true);
  const changed = { ...sealed, operations: [rename("Changed")] };
  const refused = validateActionPlanJson(changed, representativeSnapshot);
  assert.equal(refused.ok ? "ok" : refused.code, "INVALID_DIGEST");
});

test("scoped read sets use the plan's canonical identity", () => {
  const snapshot = scopedSnapshot();
  const plan = buildPlan({ operations: [rename("After")], snapshot });
  const accepted = validateActionPlanJson(plan, snapshot);
  if (!accepted.ok) assert.fail(accepted.message);
  const readSet = metadataReadSet(accepted.plan, snapshot);
  assert.equal(readSet?.planDigest, planDigestJson(plan));
  const changed = validateActionPlanJson(buildPlan({ operations: [rename("Changed")], snapshot }), snapshot);
  if (!changed.ok) assert.fail(changed.message);
  assert.notEqual(metadataReadSet(changed.plan, snapshot)?.digest, readSet?.digest);
});

test("scoped read sets refuse an operation they cannot narrow", () => {
  const snapshot = scopedSnapshot();
  const write = { type: "set_layer_property", target, propertyPath: "ADBE Transform Group/ADBE Opacity", role: "transform.opacity", value: 50 } satisfies JsonObject;
  assert.equal(refusal([write], { snapshot }).code, "READ_SET_UNSUPPORTED");
});
