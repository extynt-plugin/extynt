// Tests that a queue call's default card title is plain words, never an operation's own name.
import test from "node:test";
import assert from "node:assert/strict";
import { queueSummary } from "../src/queue-words.js";

test("the default title says what the first change does in plain words", () => {
  assert.equal(queueSummary(undefined, [{ type: "ensure_effect" }]), "Add an effect");
  assert.equal(queueSummary("", [{ type: "ensure_effect" }, { type: "set_effect_control" }, { type: "set_effect_control" }]), "Add an effect and 2 more changes");
  assert.equal(queueSummary(undefined, [{ type: "tracker_to_nulls" }]), "Make a change");
  assert.equal(queueSummary("Blur the title", [{ type: "ensure_effect" }]), "Blur the title");
});
