// State claims: a message that asserts how the project is right now is detected by its structure, not by a list of complaints, and a plain request or question is not.
import assert from "node:assert/strict";
import test from "node:test";
import { ASSERTS_CURRENT_STATE, assertsCurrentState } from "../src/index.js";

const CLAIMS = [
  "start on 0 instead of 1 second",
  "I undid too far",
  "the orbit is not a circle, it looks like an octagon and is not smooth",
  "it's clipping at the right edge",
  "the sphere drifts, it keeps sliding left after the bounce",
  "You removed the shadow I had on the card",
  "The subtitle isn't aligned with the title anymore",
  "It starts late, I wanted it at the first frame",
];

const REQUESTS = [
  "Make the title start at 0 seconds",
  "Add a glow to the title and make it pulse",
  "What's in this comp?",
  "Make it so the card has a shadow",
  "Use the font that is installed for the caption",
  "Make the orbit a smooth circle",
  "Please undo the last change",
  "Duplicate the layer and move the copy to the right",
];

test("a message that states something about the present project is a state claim", () => {
  for (const message of CLAIMS) assert.equal(assertsCurrentState(message), true, message);
});

test("a request or a question that states nothing about the present project is not", () => {
  for (const message of REQUESTS) assert.equal(assertsCurrentState(message), false, message);
});

test("the decision spec answers with the same function and can ask a model in any language", () => {
  assert.equal(ASSERTS_CURRENT_STATE.deterministic({ message: "it's not a circle" }), true);
  assert.equal(ASSERTS_CURRENT_STATE.deterministic({ message: "make it a circle" }), false);
  assert.equal(ASSERTS_CURRENT_STATE.useModel, true);
});
