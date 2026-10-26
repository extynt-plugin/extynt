// The labelled fixtures of the animation-input and orchestration decisions, and of font descriptions.
import { propertyCandidates } from "@extynt/decide";
import { array, literal, nullable, number, record, string } from "@extynt/decode";
import { casesFile } from "./decision-fixtures.js";

const request = { request: string() };

/** Which fixture set a loader reads: the cases the bands were fitted on, or the held-out cases the fit never saw. */
export type FixtureSet = "fit" | "heldout";

const prefix = (set: FixtureSet): string => (set === "heldout" ? "heldout/" : "");

/** The property-choice cases: a phrase, the target's properties and the key meant (null for none). */
export const loadPropertyCases = (set: FixtureSet = "fit") => casesFile(`${prefix(set)}property-choice.json`, { phrase: string(), target: string(), candidates: propertyCandidates, wanted: nullable(string()) });

/** The property-habit cases: a phrase, the target's properties, the user's use counts by property key and the key meant (null for none). */
export const loadPropertyHabitCases = () => casesFile("property-habits.json", { phrase: string(), target: string(), candidates: propertyCandidates, habit: record(string(), number()), wanted: nullable(string()) });

/** The route cases. */
export const loadRouteCases = (set: FixtureSet = "fit") => casesFile(`${prefix(set)}route.json`, { ...request, label: literal("answer-only", "single-agent", "specialist-workflow") });

/** The specialist cases: a request and the roles it needs. */
export const loadSpecialistCases = (set: FixtureSet = "fit") => casesFile(`${prefix(set)}specialists.json`, {
  ...request, roles: array(literal("visual-scene", "motion", "execution", "planner", "reviewer", "expression")),
});

/** The model-tier cases. */
export const loadTierCases = (set: FixtureSet = "fit") => casesFile(`${prefix(set)}model-tier.json`, { ...request, label: literal("fast", "strong") });

/** The font-description cases: the words, and every installed family that is a fair answer (none when empty). */
export const loadFontDescriptionCases = (set: FixtureSet = "fit") => casesFile(`${prefix(set)}font-description.json`, { phrase: string(), accepted: array(string()) });
