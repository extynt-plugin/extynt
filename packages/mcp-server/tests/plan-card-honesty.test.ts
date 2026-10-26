// Tests that a plan card names its action instead of a generic title, and that a plan which changes nothing is refused at the seal and costs no undo step.
import test from "node:test";
import assert from "node:assert/strict";
import { callTool, changesNothing } from "../src/index.js";
import { planCardTitle } from "../src/plan-row-title.js";
import type { PlanValueRow } from "../src/plan-rows.js";
import { stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { payloadOf } from "./support/json-results.js";
import { queueContext } from "./support/queue-context.js";

const TITLE = { compositionId: "comp-main", layerId: "layer-title" };
const row = (label: string, target: string, before: string | null, after: string | null): PlanValueRow => ({ label, target, before, after });

test("a generic title is replaced by the first change in plain words, and a written title is kept", () => {
  const font = row("Set font", "Title", "Helvetica", "Times New Roman");
  assert.equal(planCardTitle("Make a change", [font]), "Set font to Times New Roman on Title");
  assert.equal(planCardTitle("Make a change", [font, row("Opacity", "Title", "100", "50")]), "Set font to Times New Roman on Title and 1 more change");
  assert.equal(planCardTitle("Set the headline in a serif", [font]), "Set the headline in a serif");
});

test("a plan changes nothing only when every row already holds its value", () => {
  assert.equal(changesNothing([row("Opacity", "A", "50", "50")]), true);
  assert.equal(changesNothing([row("Opacity", "A", "50", "50"), row("Position", "A", "1, 2", "3, 4")]), false);
  assert.equal(changesNothing([row("Opacity", "A", null, "50")]), false);
  assert.equal(changesNothing([]), false);
});

test("sealing a plan that renames a layer to its own name applies nothing and leaves no plan open", () => {
  const context = queueContext();
  const rename: JsonObject = { type: "set_layer_name", target: TITLE, name: "TITLE — Summer" };
  assert.equal(callTool("ae_queue_add", { operations: [rename] }, context).ok, true);
  const finished = payloadOf(callTool("ae_queue_finish", {}, context));
  assert.equal(finished.sealed, false);
  assert.equal(finished.unchanged, true);
  assert.match(stringAt(finished, "next") ?? "", /no undo step/);
  assert.equal(context.queue.planId, null);
});
