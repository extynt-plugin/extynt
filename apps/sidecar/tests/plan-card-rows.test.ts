/** The plan card's operation lines and structured rows come from the presentation's value rows. */
import { planCard } from "../src/agent-plan.js";
import assert from "node:assert/strict";
import test from "node:test";

const PRESENTATION = {
  title: "Tweak the crate",
  warnings: [],
  values: [
    { label: "Rename layer", target: "WOODEN_CRATE", before: "WOODEN_CRATE", after: "WOODEN_CRATE_R4" },
    { label: "Opacity", target: "WOODEN_CRATE_R4", before: "100", after: "55" },
    { label: "Add effect: Drop Shadow", target: "WOODEN_CRATE_R4", before: null, after: null },
    { label: "Set text", before: null, after: "Autumn Sale" },
  ],
};

test("each operation line says what changes and to what, with the target in brackets", () => {
  const card = planCard({ planId: "plan-rows", presentation: PRESENTATION }, {});
  assert.deepEqual(card?.operations, [
    "Rename layer: WOODEN_CRATE → WOODEN_CRATE_R4",
    "Opacity: 100 → 55 (WOODEN_CRATE_R4)",
    "Add effect: Drop Shadow (WOODEN_CRATE_R4)",
    "Set text: Autumn Sale",
  ]);
});

test("the card also carries the rows structured, so the panel can lay them out itself", () => {
  const card = planCard({ planId: "plan-rows", presentation: PRESENTATION }, {});
  assert.deepEqual(card?.rows?.[1], { label: "Opacity", target: "WOODEN_CRATE_R4", before: "100", after: "55" });
  assert.deepEqual(card?.rows?.[3], { label: "Set text", before: null, after: "Autumn Sale" });
  assert.equal(card?.rows?.length, 4);
});

test("a plan stored before value rows existed keeps its old lines and gets no rows", () => {
  const legacy = { title: "Old", warnings: [], values: [{ label: "Operation 1", before: "create_layer", after: "New layer" }] };
  const card = planCard({ planId: "plan-old", presentation: legacy }, {});
  assert.deepEqual(card?.operations, ["create_layer · New layer"]);
  assert.equal(card?.rows, undefined);
});
