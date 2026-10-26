// The orchestration decisions: whether a message needs an answer or an edit, how many hands the edit takes, and which specialists and which kind of model should take part.
import { choice, labels } from "./spec.js";
import type { ChoiceSpec, LabelsSpec } from "./spec.js";
import { isDrawnScene } from "./drawn-scene.js";
import { isAnswerOnly, isPlannedRequest } from "./request-shape.js";
import { checksRequest, expressionRequest, motionRequest, plansRequest, stagesRequest } from "./request-specialist-cues.js";
import type { RequestText } from "./request-parts.js";
import { containsWord, foldRequest } from "./request-text.js";
import { EXPRESSION_PATTERN, JUDGEMENT_PATTERN, MOTION_PATTERN } from "./request-vocabulary.js";

/** How a message is handled: answered from what is known, built by one agent, or built by an agent with specialists. */
export type Route = "answer-only" | "single-agent" | "specialist-workflow";

/** The specialist roles a long or designed request may use, as the sidecar's registry names them. */
export const SPECIALIST_ROLES = ["visual-scene", "motion", "execution", "planner", "reviewer", "expression"] as const;

/** One specialist role. */
export type SpecialistRole = (typeof SPECIALIST_ROLES)[number];

/** Whether the model that carries a job should be a cheap fast one or the strongest the user has. */
export type ModelStrength = "fast" | "strong";

/** How a message is handled: an answer when it asks a question, a specialist workflow for a long or drawn request, otherwise one agent. */
export function routeOf(request: string): Route {
  if (isAnswerOnly(request)) return "answer-only";
  return isPlannedRequest(request) || isDrawnScene(request) ? "specialist-workflow" : "single-agent";
}

/** Whether a message needs no edit, only an answer, or an edit by one agent, or an edit that needs specialists too; any language. */
export const REQUEST_ROUTE: ChoiceSpec<RequestText, Route> = choice<RequestText, Route>({
  name: "request-route",
  instructions: [
    "A motion designer writes to an After Effects copilot. Decide how the message is handled.",
    "A question, a request to explain or to look something up, or a remark with nothing to change needs an answer only. Anything that asks the project to change needs an edit.",
    "An edit with several separate sections or deliverables, or a scene that has to be drawn, needs specialists besides the agent; one effect, layer or adjustment does not.",
  ].join(" "),
  labels: {
    "answer-only": "a question or request to explain, with nothing in the project to change",
    "single-agent": "one edit the agent can build alone: one effect, one layer, an adjustment or a few closely related values",
    "specialist-workflow": "a long edit of several sections or deliverables, or a scene to draw, that gains from a planner, a designer or a reviewer",
  },
  guarded: ["answer-only"],
  deterministic: (state) => routeOf(state.request),
});

/** The specialist roles the sidecar's own rules start: a designer for a drawn scene, motion and execution for a long or timed build, a planner for several parts, a reviewer for a check, expressions for a wiggle, loop or link. A question about a topic needs only a reviewer of frames. */
export function specialistsOf(request: string): ReadonlyArray<SpecialistRole> {
  const roles = wantedRoles(request);
  return isAnswerOnly(request) ? roles.filter((role) => role === "reviewer") : roles;
}

function wantedRoles(request: string): ReadonlyArray<SpecialistRole> {
  const chosen: ReadonlyArray<readonly [SpecialistRole, boolean]> = [
    ["visual-scene", isDrawnScene(request)],
    ["motion", motionRequest(request)],
    ["execution", stagesRequest(request)],
    ["planner", plansRequest(request)],
    ["reviewer", checksRequest(request)],
    ["expression", expressionRequest(request)],
  ];
  return chosen.filter(([, wanted]) => wanted).map(([role]) => role);
}

/** Which specialists a request needs: a visual designer for a scene to draw, a motion specialist for animation of it, an implementation planner, a checklist planner, a frame reviewer, an expression writer. */
export const REQUEST_SPECIALISTS: LabelsSpec<RequestText, SpecialistRole> = labels<RequestText, SpecialistRole>({
  name: "request-specialists",
  instructions: "A motion designer's request asks for work in After Effects. Decide which specialist roles the work needs besides the agent that builds it. Pick a role only when its job is part of the request.",
  criteria: { true: "The request's work includes this role's job.", false: "The request's work does not need this role." },
  labels: {
    "visual-scene": "draws a scene, illustration, character or logo mark as vector artwork before it is animated",
    motion: "designs the timing, trajectories and easing of the animation of a drawn scene",
    execution: "plans a large build into small dependency-ordered stages with the evidence each needs",
    planner: "breaks a long request with several sections, shots or deliverables into a checklist",
    reviewer: "looks at rendered frames of finished sections and finds what does not match the request",
    expression: "writes After Effects expressions that drive properties, such as wiggle, loops or links between layers",
  },
  deterministic: (state) => specialistsOf(state.request),
});

/** Whether the request is simple enough for a cheap fast model, or needs the strongest model the user has: a drawn scene, a long or planned build, motion, an expression or a judgement of look. */
export function strengthOf(request: string): ModelStrength {
  const text = foldRequest(request);
  const judged = [isDrawnScene(request), isPlannedRequest(request), containsWord(text, MOTION_PATTERN), containsWord(text, EXPRESSION_PATTERN), containsWord(text, JUDGEMENT_PATTERN)];
  return judged.some((hard) => hard) ? "strong" : "fast";
}

/** Whether the request is simple enough for a cheap fast model, or needs the strongest model the user has; any language. */
export const MODEL_TIER: ChoiceSpec<RequestText, ModelStrength> = choice<RequestText, ModelStrength>({
  name: "model-tier",
  instructions: "A motion designer's request asks for work in After Effects. Decide whether a small fast model can do it reliably, or whether the work needs the strongest model: judging a look, drawing a scene, planning several sections or writing expressions. A question that only asks what the project contains or has (comps, layers, effects, fonts, settings) is read-only and fast.",
  labels: {
    fast: "a small, well-defined edit such as setting a value, adding one common effect or renaming and organizing layers, or a question that only reads and reports what the project holds",
    strong: "work that needs design judgement, drawing, several coordinated parts, animation timing or expressions",
  },
  deterministic: (state) => strengthOf(state.request),
});
