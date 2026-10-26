// The digest wrapper reads a plan as the JSON it would serialise to, so absent members change nothing.
import assert from "node:assert/strict";
import test from "node:test";
import { computePlanDigest } from "../src/index.js";
import { planDigestJson } from "../src/plan-digest.js";
import { toJsonValue } from "../src/plain-json.js";

const plan = { schemaVersion: "0.2", planId: "wrapper", operations: [{ type: "set_layer_name", name: "After" }], digest: "old" };

test("computePlanDigest matches the typed digest", () => {
  assert.equal(computePlanDigest(plan), planDigestJson(plan));
});

test("members that are undefined do not change the digest", () => {
  assert.equal(planDigestJson(toJsonValue({ ...plan, ignored: undefined }) ?? null), computePlanDigest(plan));
});
