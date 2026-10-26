// The reply says a requested typeface is not installed and which installed family stood in, from the recorded substitution and the font the applied plan set; it says nothing for a stand-in no plan used.
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentPlanCard } from "../src/agent-types.js";
import { standInSentences, withStandIn } from "../src/server-workflow-stand-in.js";

const plan = (after: string): AgentPlanCard => ({ planId: "p", title: "Set title font", operations: ["set_text_document"], warnings: [], expressions: [], requiresAcknowledgement: false, autoApply: true, rows: [{ label: "Set font", target: "Title", before: "Arial", after }] });
const didot = { requested: "didot", offered: ["Times New Roman", "Georgia"] };

test("a recorded substitution is reported with the stand-in the plan set, whatever the request's wording", () => {
  const sentences = standInSentences([didot, didot], [plan("Times New Roman Bold")]);
  assert.deepEqual(sentences, ["Didot is not installed on this computer, so Times New Roman was used instead."]);
  assert.equal(withStandIn("Applied: Set title font.", sentences), "Applied: Set title font.\n\nDidot is not installed on this computer, so Times New Roman was used instead.");
});

test("nothing is added when no plan set an offered family, or the answer already names the font", () => {
  assert.deepEqual(standInSentences([didot], [plan("Arial")]), []);
  assert.deepEqual(standInSentences([], [plan("Georgia")]), []);
  const said = "Didot is missing, so I used Times New Roman.";
  assert.equal(withStandIn(said, ["Didot is not installed on this computer, so Times New Roman was used instead."]), said);
});
