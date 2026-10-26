// The header goal of a job that carried a question: the agent's English sentence is a model prompt, so the panel reads a localized label instead.
import assert from "node:assert/strict";
import test from "node:test";
import { translatorFor } from "@extynt/ui-text";
import { answeredGoal, shownGoal } from "../src/server-workflow-carry.js";

const carried = { goal: "Make the title bounce", question: "Which layer?", kind: "question", savedAt: 0 } as const;

test("an answered goal shows the request and the reply in the panel's language, never the agent's sentence", () => {
  const goal = answeredGoal(carried, "the big one");
  for (const language of ["en", "es", "de", "fr", "ja", "zh-Hans"] as const) {
    const shown = shownGoal(goal, translatorFor(language));
    assert.ok(shown.includes("Make the title bounce") && shown.includes("the big one"), language);
    assert.doesNotMatch(shown, /The agent asked the user|Which layer/, language);
  }
  assert.match(shownGoal(goal, translatorFor("de")), /deine Antwort/);
});

test("a goal that was never answered is shown as it is", () => {
  assert.equal(shownGoal("Make the title bounce", translatorFor("en")), "Make the title bounce");
});
