// The labelled fixtures of the review pre-screen: the text-only record of covered work and whether it proves the work.
import { array, boolean, number, string } from "@extynt/decode";
import { casesFile } from "./decision-fixtures.js";
import type { FixtureSet } from "./decision-fixtures-animation.js";

/** The review-proven cases: the goal, the specs and receipt counts of the covered work, and whether the record proves it. */
export const loadReviewCases = (set: FixtureSet = "fit") => casesFile(`${set === "heldout" ? "heldout/" : ""}review-proven.json`, {
  goal: string(), specs: array(string()), batches: number(), exact: number(), approximate: number(), unconfirmed: number(),
  operations: array(string()), expected: boolean(),
});
