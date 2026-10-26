/** The orchestration section is re-sent on every step of every cycle, so it carries each fact once and none of a specialist's stream. */
import assert from "node:assert/strict";
import test from "node:test";
import { handoffContract, orchestrationBriefing, WORKFLOW_OWNER, type WorkflowOrchestrationBundle, type WorkflowSpecialistBrief } from "../src/workflow-orchestration.js";

const row = (label: string) => `${label} ${"detail ".repeat(20)}`.trim();
const visual: WorkflowSpecialistBrief = { role: "visual-scene", objective: "Draw the ident", requirements: [row("req-visual")], deliverables: [row("deliver-visual")], constraints: [row("constrain-visual")], verification: [row("verify-visual")], scene: { canvas: [1920, 1080], order: "bottom-to-top", layers: [], warnings: ["Ring Burst scene"] } };
const motion: WorkflowSpecialistBrief = { role: "motion", objective: "Move it", requirements: [row("req-motion")], deliverables: [row("deliver-motion")], constraints: [row("constrain-motion")], verification: [row("verify-motion")] };

function bundle(): WorkflowOrchestrationBundle {
  const specialists = [visual, motion];
  return {
    owner: WORKFLOW_OWNER, mode: "partial", specialists, unavailable: [], handoff: handoffContract(specialists, "Build the ident"),
    activity: [{ role: "visual-scene", status: "completed", turn: 1, text: `<svg>${"STREAMED-DRAWING ".repeat(2_000)}</svg>`, reasoning: "STREAMED-REASONING ".repeat(2_000), updatedAt: "2026-10-13T00:00:00.000Z" }],
  };
}

test("the owner's orchestration section leaves out a specialist's stream and the rows the handoff already repeats", () => {
  const text = orchestrationBriefing(bundle());
  assert.doesNotMatch(text, /STREAMED-/, "the stream (its drawing and reasoning) is not re-sent every step");
  assert.match(text, /Ring Burst/, "the compiled scene is kept");
  assert.match(text, /Draw the ident/, "each specialist keeps its objective");
  for (const label of ["deliver-visual", "constrain-visual", "deliver-motion", "constrain-motion", "req-visual", "req-motion", "verify-visual", "verify-motion"]) {
    assert.equal(text.split(label).length - 1, 1, `${label} appears once, in the handoff`);
  }
  assert.match(text, /"requiredEvidenceKinds"/);
  assert.ok(text.length * 4 < JSON.stringify(bundle()).length, "and the section is a fraction of the raw bundle");
});
