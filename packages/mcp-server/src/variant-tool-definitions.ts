// The tool that puts a choice between values to the user.
import { arrayArg, numberArg, objectArg, optionalArg, reportedArg, stringArg, unionArg } from "./arg.js";
import { MAX_LABEL_CHARS, MAX_QUESTION_CHARS, MAX_VARIANTS, MIN_VARIANTS } from "./variant-offer.js";
import { defineTool } from "./tool.js";
import type { ToolEntry } from "./tool.js";

export const AE_OFFER_VARIANTS = defineTool("ae_offer_variants", {
  description: `Optional. For a subjective look adjustment of ONE effect control that holds a single constant value (for example "make the glow subtler"), you may put ${MIN_VARIANTS}-${MAX_VARIANTS} values you choose to the user instead of guessing one: write a short label for each (for example subtler, current, stronger) and optionally a one-line question. Bracketing around the control's current value usually reads best; include the current value itself as a candidate if the user should be able to keep it. The panel shows each as a small picture where it can make one, and the user picks one or none. Each candidate is an ordinary approval-required plan (one set_effect_control), so it is validated exactly as ae_propose_plan would; nothing is applied until the user picks, and a pick applies exactly that one like any plan (apply, read back, verify) and withdraws the others. You cannot apply, approve or re-propose a candidate: say in a short sentence that the options are shown, then stop. The control must be observed in the current snapshot with no keyframes and no expression, and a number or list of numbers; otherwise this refuses and you write a normal plan instead. Never required: use it only when a choice serves the user better than one best guess.`,
  access: "write",
  input: {
    target: objectArg({
      compositionId: stringArg({ minLength: 1, maxLength: 512 }),
      layerId: stringArg({ minLength: 1, maxLength: 512 }),
      effectPath: stringArg({ minLength: 1, maxLength: 512 }),
      propertyPath: stringArg({ minLength: 1, maxLength: 512 }),
    }, { description: "The control, exactly as set_effect_control's target: effectPath is ADBE Effect Parade/<effectMatchName>; propertyPath is <effectPath>/<control matchName>." }),
    effectMatchName: stringArg({ minLength: 1, maxLength: 512, description: "The effect's match name, as set_effect_control takes it." }),
    candidates: arrayArg(objectArg({
      label: reportedArg(stringArg({ minLength: 1, maxLength: MAX_LABEL_CHARS, description: "A short label you write for this option." })),
      value: unionArg([
        numberArg(),
        arrayArg(numberArg(), { minItems: 2, maxItems: 4 }),
      ], { description: "A finite number, or 2-4 finite numbers for a vector, in the same shape as the control's current value. You choose it; nothing in code suggests one." }),
    }), { minItems: MIN_VARIANTS, maxItems: MAX_VARIANTS }),
    question: optionalArg(stringArg({ minLength: 1, maxLength: MAX_QUESTION_CHARS, description: "Optional: one line shown above the options." })),
  },
});

/** The tool that puts a choice between values to the user. */
export const VARIANT_TOOLS = [
  AE_OFFER_VARIANTS,
] satisfies ReadonlyArray<ToolEntry>;
