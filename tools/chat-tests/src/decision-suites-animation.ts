// The suites over the property choice and orchestration (route, specialists, model tier).
import { MODEL_TIER, REQUEST_ROUTE, REQUEST_SPECIALISTS, NO_MATCH, propertyChoice } from "@extynt/decide";
import { specCase } from "./decision-eval-cases.js";
import { type FixtureSet, loadPropertyCases, loadPropertyHabitCases, loadRouteCases, loadSpecialistCases, loadTierCases } from "./decision-fixtures-animation.js";
import { tagsOf } from "./decision-fixtures.js";
import { habitsOf } from "./decision-suites-effects.js";
import type { SpecSuite } from "./decision-eval-types.js";

const ANSWER_ONLY_MISROUTE_COST = 10;

function routeCost(expected: string): (answer: string) => number {
  return (answer) => (answer === "answer-only" && expected !== "answer-only" ? ANSWER_ONLY_MISROUTE_COST : 1);
}

function propertySuite(set: FixtureSet): SpecSuite {
  return {
    name: "property-choice",
    cases: loadPropertyCases(set).cases.map((row) => specCase({
      id: row.id, tags: tagsOf(row), spec: propertyChoice(row.candidates), state: { phrase: row.phrase, target: row.target },
      expected: row.wanted !== null && row.candidates.some((property) => property.key === row.wanted) ? row.wanted : NO_MATCH,
    })),
  };
}

function propertyHabitSuite(): SpecSuite {
  return {
    name: "property-habits",
    cases: loadPropertyHabitCases().cases.map((row) => specCase({
      id: row.id, tags: tagsOf(row), state: { phrase: row.phrase, target: row.target }, expected: row.wanted ?? NO_MATCH,
      spec: propertyChoice(row.candidates, Object.keys(row.habit).length === 0 ? undefined : habitsOf(row.habit)),
    })),
  };
}

/** The suites over the property choice and orchestration (route, specialists, model tier). */
export function animationSuites(set: FixtureSet = "fit"): ReadonlyArray<SpecSuite> {
  return [
    propertySuite(set),
    ...(set === "fit" ? [propertyHabitSuite()] : []),
    {
      name: "request-route",
      cases: loadRouteCases(set).cases.map((row) => specCase({
        id: row.id, tags: tagsOf(row), spec: REQUEST_ROUTE, state: { request: row.request }, expected: row.label, misroute: routeCost(row.label),
      })),
    },
    { name: "request-specialists", cases: loadSpecialistCases(set).cases.map((row) => specCase({ id: row.id, tags: tagsOf(row), spec: REQUEST_SPECIALISTS, state: { request: row.request }, expected: row.roles })) },
    { name: "model-tier", cases: loadTierCases(set).cases.map((row) => specCase({ id: row.id, tags: tagsOf(row), spec: MODEL_TIER, state: { request: row.request }, expected: row.label })) },
  ];
}
