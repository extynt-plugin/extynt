// Assembles the evaluation suites: each decision's labelled fixtures turned into cases over its spec, and the tournament suites over growing catalogues.
import { animationSuites } from "./decision-suites-animation.js";
import { effectSuites } from "./decision-suites-effects.js";
import { fontDescriptionSuites } from "./decision-suites-font-description.js";
import { requestSuites } from "./decision-suites-request.js";
import { reviewSuites } from "./decision-suites-review.js";
import { scaleSuites } from "./decision-suites-scale.js";
import { turnSuites } from "./decision-suites-turn.js";
import type { FixtureSet } from "./decision-fixtures-animation.js";
import type { ResolveSuite, SpecSuite } from "./decision-eval-types.js";

/** Every spec-based suite, in report order. */
export function allSpecSuites(set: FixtureSet = "fit"): ReadonlyArray<SpecSuite> {
  return set === "heldout" ? [...animationSuites(set), ...reviewSuites(set)] : [...effectSuites(), ...requestSuites(), ...turnSuites(), ...animationSuites(), ...reviewSuites()];
}

/** Every tournament suite, in report order. */
export function allResolveSuites(set: FixtureSet = "fit"): ReadonlyArray<ResolveSuite> {
  return set === "heldout" ? fontDescriptionSuites(set) : [...scaleSuites(), ...fontDescriptionSuites()];
}
