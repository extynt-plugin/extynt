/**
 * Chat scenarios: a request a person would actually type, plus the structural facts that must
 * hold whatever the model says. Expectations never pin the model's wording — that is what
 * changes between models and runs — except where the answer is the deliverable.
 */
import { loadPrompts } from "./prompts.js";
import type { ScenarioExpectation } from "./scenario-expectation.js";

export type { ScenarioExpectation } from "./scenario-expectation.js";

/** One request a person would type, the project it runs against, and what must hold afterwards. */
export interface Scenario {
  id: string;
  asset: string;
  offline: boolean;
  message: string;
  followUps?: string[];
  facts?: string[][];
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  expect: ScenarioExpectation;
  notes?: string;
}

const BUILT_IN_SCENARIOS: readonly Scenario[] = [
  {
    id: "rename-selected-layer",
    asset: "summer-launch",
    offline: true,
    message: "rename to Hero",
    expect: { outcome: "planned", plans: { min: 1 }, targetsLayer: "layer-title", anyOperationMatches: ["Hero"] },
    notes: "The one request the offline mock provider understands, so the plumbing is covered without a model.",
  },
  {
    id: "title-slide-and-fade",
    asset: "summer-launch",
    offline: false,
    message: "Animate the selected title so it slides in from the left and fades up over the first half second, then holds on screen until the end of the composition.",
    expect: { outcome: "planned", plans: { min: 1 }, targetsLayer: "layer-title", anyOperationMatches: ["ADBE Position", "ADBE Opacity"] },
    notes: "The core case: two properties on one layer, and the hold has to be understood as 'no later keyframes'.",
  },
  {
    id: "question-about-the-comp",
    asset: "summer-launch",
    offline: false,
    message: "What layers are in this composition, and which one is selected?",
    expect: { outcome: "answered", plans: { max: 0 }, answerMentions: ["TITLE"] },
    notes: "A question must not become a plan; the briefing alone can answer it.",
  },
  {
    id: "effect-on-selected-title",
    asset: "summer-launch",
    offline: false,
    message: "Add a soft glow to the selected title.",
    expect: { outcome: "planned", plans: { min: 1 }, targetsLayer: "layer-title" },
    notes: "Effect work goes through the capability catalogue, not a guessed matchName.",
  },
  {
    id: "selection-follows-the-asset",
    asset: "social-square",
    offline: false,
    message: "Move the selected layer down by 100 pixels.",
    expect: { outcome: "planned", plans: { min: 1 }, targetsLayer: "layer-social-badge" },
    notes: "A different asset selects a different layer, which catches a briefing that targets the wrong one.",
  },
  {
    id: "history-is-carried",
    asset: "summer-launch",
    offline: false,
    message: "Now make it twice as slow.",
    history: [
      { role: "user", content: "Animate the selected title so it fades up over the first half second." },
      { role: "assistant", content: "Here is the plan. Review it and press Apply." },
    ],
    expect: { outcome: "planned", targetsLayer: "layer-title" },
    notes: "Follow-up wording only resolves against the carried history.",
  },
];

/** The scenario with this id, or a throw listing the known ids. */
export function scenarioById(id: string): Scenario {
  const scenario = SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`Unknown scenario "${id}". Known: ${SCENARIOS.map((entry) => entry.id).join(", ")}.`);
  return scenario;
}

/** The built-in scenarios followed by the prompt library. */
export const SCENARIOS: readonly Scenario[] = [...BUILT_IN_SCENARIOS, ...loadPrompts().map((prompt) => prompt.scenario)];
