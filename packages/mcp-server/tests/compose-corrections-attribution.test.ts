// Tests for compose corrections attribution.
import test from "node:test";
import assert from "node:assert/strict";
import { fixEntries } from "../src/batch-fix-entries.js";
import { acceptedVerdicts } from "../src/batch-verdicts.js";


const BLUR = "ADBE Effect Parade/ADBE Gaussian Blur 2";

function waitingFixture() {
  const target = { compositionId: "comp-main", layerId: "layer-title" };
  const root = { type: "ensure_effect", effectPath: BLUR, target };
  const control = { type: "set_effect_control", target: { ...target, effectPath: BLUR, propertyPath: `${BLUR}/ADBE Gaussian Blur 2-0001` } };
  const waiting = "The exact effect control path is not present in the current snapshot or an earlier ensure_effect operation.";
  return {
    stored: [root, ...Array.from({ length: 18 }, () => control)],
    problems: [
      { index: 0, type: "ensure_effect", code: "INVALID_OPERATION", message: "ensure_effect refused" },
      ...Array.from({ length: 18 }, (_, at) => ({ index: at + 1, type: "set_effect_control", code: "TARGET_NOT_FOUND", message: waiting })),
    ],
  };
}

test("controls that wait on a refused target-silent ensure_effect are one consequence under it", () => {
  const { stored, problems } = waitingFixture();
  const entries = fixEntries(acceptedVerdicts({ submitted: stored, stored, bindings: {}, problems }).map((verdict) => ({ ...verdict })));
  assert.equal(entries.length, 1, "one fault, not one entry per control");
  const consequences = entries[0]?.consequences ?? [];
  assert.equal(consequences.length, 1);
  assert.equal(consequences[0]?.code, "TARGET_NOT_FOUND");
  assert.deepEqual(consequences[0]?.positions.length, 18);
});
