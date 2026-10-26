// The suite over the reviewer's pre-screen: whether the receipts alone prove the covered work.
import { REVIEW_PROVEN } from "@extynt/decide";
import { specCase } from "./decision-eval-cases.js";
import { tagsOf } from "./decision-fixtures.js";
import { loadReviewCases } from "./decision-fixtures-review.js";
import type { FixtureSet } from "./decision-fixtures-animation.js";
import type { SpecSuite } from "./decision-eval-types.js";

/** The review pre-screen suite. */
export function reviewSuites(set: FixtureSet = "fit"): ReadonlyArray<SpecSuite> {
  return [{ name: "review-proven", cases: loadReviewCases(set).cases.map(({ id, expected, lang, hard, ...state }) => specCase({ id, tags: tagsOf({ lang, hard }), spec: REVIEW_PROVEN, state, expected })) }];
}
