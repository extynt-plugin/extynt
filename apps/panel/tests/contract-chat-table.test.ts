/** Panel contract: GFM tables in a reply are drawn as tables. */
import assert from "node:assert/strict";
import test from "node:test";
import { answered, nth, rowsOf, textsOf } from "./contract-helpers.js";
import { createPanelHarness } from "./contract.test.js";

test("a markdown table in an answer is drawn as a table, not raw pipes", () => {
  const answer = ["Compare:", "", "| Layer | Opacity |", "| :--- | ---: |", "| Title | 100 |", "| Glow | 40 |", "", "Done."].join("\n");
  const harness = createPanelHarness({ respond: answered(answer) });
  harness.send("compare");
  const row = nth(rowsOf(harness, "assistant"), 0);
  const cells = (tag: string): string[] => row.all((node) => node.tagName === tag).map((node) => node.textContent);
  assert.deepEqual(cells("TH"), ["Layer", "Opacity"]);
  assert.deepEqual(cells("TD"), ["Title", "100", "Glow", "40"]);
  assert.equal(row.all((node) => node.tagName === "TR").length, 3);
  assert.ok(row.find((node) => node.classList.has("md-align-right")), "the right-aligned column is marked");
  assert.ok(!row.all(() => true).some((node) => node.textContent.includes("|")), "no raw pipes remain");
  assert.deepEqual(textsOf(row, "para"), ["Compare:", "Done."]);
});

test("a pipe line without a delimiter row stays a paragraph", () => {
  const harness = createPanelHarness({ respond: answered("a | b\nplain") });
  harness.send("x");
  const row = nth(rowsOf(harness, "assistant"), 0);
  assert.equal(row.all((node) => node.tagName === "TABLE").length, 0);
});
