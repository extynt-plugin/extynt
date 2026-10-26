// Evidence waivers: whether values read back from After Effects stand in for a rendered frame, the one language judgement behind skipping a picture.
import { goalAsksJudgement, goalIsLiteralValues } from "./evidence-kinds.js";
import { binary } from "./spec.js";
import type { BinarySpec } from "./spec.js";

/** What the waiver decision reads: the goal and the facts about the batch that was applied. */
export type WaiverCase = {
  readonly goal: string;
  readonly designed: boolean;
  readonly structuralOperations: boolean;
  readonly exactValuesOnly: boolean;
  readonly allConfirmed: boolean;
};

/** Whether a verified, fully confirmed batch is proved by its read-back so that no rendered frame is required; the sidecar's deterministic answer never infers a look from wording, so a goal about a scene, a match or a judgement keeps its frame. */
export const VISUAL_WAIVER: BinarySpec<WaiverCase> = binary<WaiverCase>({
  name: "visual-waiver",
  instructions: "A batch of operations was applied in After Effects and every written value was confirmed by reading it back. The state holds the user's goal and facts about the batch. Decide whether the read-back is enough proof, so that no rendered frame has to be captured.",
  stakes: "high",
  wantsImage: true,
  criteria: {
    true: "The goal asks only for exact values or structure that the read-back proves, and nothing about how the picture looks or moves.",
    false: "The goal asks for a look, a scene, a match, a style, or motion, or something was designed or created whose appearance matters.",
  },
  deterministic: (state) => state.allConfirmed
    && ((state.structuralOperations && !state.designed && !goalAsksJudgement(state.goal)) || (state.exactValuesOnly && goalIsLiteralValues(state.goal))),
});
