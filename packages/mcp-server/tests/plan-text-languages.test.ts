// The plan card's notices and title render in every interface language through the real composing functions, and English stays the default.
import { LANGUAGES, translatorFor } from "@extynt/ui-text";
import assert from "node:assert/strict";
import test from "node:test";
import { largePlanNotice } from "../src/notices.js";
import { planCardTitle } from "../src/plan-row-title.js";

const rows = [{ label: "Position", target: "Title", before: "1", after: "2" }];

test("the large-plan notice names its counts in every language and is English by default", () => {
  assert.equal(largePlanNotice(100, 50)?.title, "This is one step in After Effects: 100 operations, applied as 2 undo groups.");
  for (const language of LANGUAGES) {
    const notice = largePlanNotice(100, 50, translatorFor(language));
    assert.ok(notice?.title.includes("100") && notice.title.includes("2"), language);
    assert.equal(notice?.title === largePlanNotice(100, 50)?.title, language === "en", language);
  }
});

test("the card title keeps the plan's summary and is the same sentence shape in English", () => {
  assert.equal(planCardTitle("Move the title", rows), "Move the title");
  for (const language of LANGUAGES) assert.ok(planCardTitle("Move the title", rows, translatorFor(language)).length > 0, language);
});
