// What a goal asks to be shown: motion over time, a look in a rendered frame, or a judgement of the picture; the three questions the verification plan is built from.
import { goalConcepts } from "./evidence-concepts.js";
import type { GoalConcept } from "./evidence-concept-tables.js";
import { binary } from "./spec.js";
import type { BinarySpec } from "./spec.js";

/** What the evidence decisions read: the user's goal in their words. */
export type GoalText = { readonly goal: string };

const MOTION_CONCEPTS: ReadonlyArray<GoalConcept> = ["motion", "sequence", "counting"];

const PICTURE_CONCEPTS: ReadonlyArray<GoalConcept> = ["transform", "look", "colour", "layout"];

const DRAWN_CONCEPTS: ReadonlyArray<GoalConcept> = ["look", "colour", "layout"];

function namesAny(goal: string, concepts: ReadonlyArray<GoalConcept>): boolean {
  const named = goalConcepts(goal);
  return concepts.some((concept) => named.has(concept));
}

/** Whether the goal's words ask for something to move or change over time: animation, a sequence, a count or a delay. */
export function goalIsTemporal(goal: string): boolean {
  return namesAny(goal, MOTION_CONCEPTS);
}

/** Whether the goal's words ask for a judgement about the picture: a look, a mood, a match to a reference, an improvement, in any of the four languages. */
export function goalAsksJudgement(goal: string): boolean {
  return namesAny(goal, ["judgement"]);
}

/** Whether the goal asks for something to be seen: anything temporal, a judgement, or a look, a colour, a layout or a placement. */
export function goalIsVisual(goal: string): boolean {
  return goalIsTemporal(goal) || goalAsksJudgement(goal) || namesAny(goal, PICTURE_CONCEPTS);
}

/** Whether the goal names no scene, motion, look, colour, layout or judgement, so literal values read back from After Effects are the whole request. */
export function goalIsLiteralValues(goal: string): boolean {
  return !goalIsTemporal(goal) && !goalAsksJudgement(goal) && !namesAny(goal, DRAWN_CONCEPTS);
}

/** Whether the request needs motion shown over time: something moves, changes, counts, sequences or waits, in any language. */
export const NEEDS_MOTION_EVIDENCE: BinarySpec<GoalText> = binary<GoalText>({
  name: "evidence-temporal",
  instructions: "A motion designer's request asks for work in After Effects. Decide whether the request asks for anything to move, animate, change over time, loop, transition, count, appear after a delay or follow a sequence, so that its timing and motion have to be shown, not only its still look.",
  criteria: {
    true: "Something in the request moves, animates, eases, loops, transitions, counts, appears after a delay or changes over time.",
    false: "The request asks only for a still look, a value or a setting, with no motion and no change over time.",
  },
  deterministic: (state) => goalIsTemporal(state.goal),
});

/** Whether the request needs its look shown in a rendered frame: something is drawn, styled, coloured, placed or moved. */
export const NEEDS_FRAME_EVIDENCE: BinarySpec<GoalText> = binary<GoalText>({
  name: "evidence-visual",
  instructions: "A motion designer's request asks for work in After Effects. Decide whether the request asks for something that appears in the picture: a drawing, a design, a colour, a layout, an effect, a placement or motion, so that the result has to be seen in a rendered frame.",
  criteria: {
    true: "The request asks for something that changes how the picture looks, where it sits or how it moves.",
    false: "The request asks only for housekeeping or exact values that do not change the picture, such as renaming, organizing, setting project options or timing a layer.",
  },
  deterministic: (state) => goalIsVisual(state.goal),
});

/** Whether the request asks for a judgement about the picture: a look, a mood, a match to a reference, an improvement. */
export const ASKS_PICTURE_JUDGEMENT: BinarySpec<GoalText> = binary<GoalText>({
  name: "evidence-judgement",
  instructions: "A motion designer's request asks for work in After Effects. Decide whether the request asks for a judgement about how the picture looks: a style or mood, a match to a reference, a polish, an improvement, a whole scene, rather than literal values.",
  criteria: {
    true: "Success depends on how the picture looks to a viewer: a style, mood, polish, improvement, whole scene or match to a reference.",
    false: "The request gives literal values or structural instructions whose success is a number or a relation, not a look.",
  },
  deterministic: (state) => goalAsksJudgement(state.goal),
});
