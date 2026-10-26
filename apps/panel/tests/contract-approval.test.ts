/** Panel contract: a design shown for approval before anything is built is a waiting decision with its own Build button, not only prose the reader must answer by typing. */
import assert from "node:assert/strict";
import test from "node:test";
import { bar, barButton, chatBodies, chatResponder, typeInComposer } from "./contract-helpers.js";
import { createPanelHarness } from "./contract.test.js";
import { fieldOf } from "./json-narrow.js";

const BRIEF = "Here is the plan for the rocket scene. Shall I build and apply this?";
const briefReply = chatResponder(() => ({ answer: BRIEF, approval: { kind: "design-brief" } }));

test("a design brief waiting for approval puts a Build it button in the bar, and pressing it approves once", () => {
  const harness = createPanelHarness({ respond: briefReply });
  harness.send("Make a rocket animation. Show me the plan first.");
  assert.deepEqual(bar(harness).actions, ["Build it"]);
  assert.equal(bar(harness).state, "needs-you");
  const button = barButton(harness, "approve-brief");
  assert.ok(button, "the bar offers the approval");
  button.click();
  const bodies = chatBodies(harness);
  assert.equal(bodies.length, 2);
  assert.equal(fieldOf(bodies[1], "message"), "Yes, build and apply it.");
});

test("typing something else first takes the Build it button away", () => {
  let turns = 0;
  const harness = createPanelHarness({ respond: chatResponder(() => (turns++ === 0 ? { answer: BRIEF, approval: { kind: "design-brief" } } : { answer: "Done." })) });
  harness.send("Make a rocket animation. Show me the plan first.");
  typeInComposer(harness, "make the planet bigger");
  harness.click("chat");
  assert.equal(barButton(harness, "approve-brief"), null);
});

test("a plain question carries no approval button", () => {
  const harness = createPanelHarness({ respond: chatResponder(() => ({ answer: "6 or 30 seconds?" })) });
  harness.send("Make a rocket animation");
  assert.equal(barButton(harness, "approve-brief"), null);
});
