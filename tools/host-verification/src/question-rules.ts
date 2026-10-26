/**
 * Derivation rules for the open-questions probe: each question's recorded data becomes the
 * short, decisive facts a finding can be closed from. Judgement lives in the `question-rules-*`
 * modules, never in the ExtendScript, so a wrong assumption in the probe shows up as data.
 */
import type { JsonValue } from "./json.js";
import { effectColourPrecision, keyRangeValue, parentCompensation, questionData, shapeWithoutPaint, staticOverKeyframes } from "./question-data.js";
import { deriveEffectColorPrecision, deriveShapeWithoutPaint } from "./question-rules-appearance.js";
import { deriveKeyRangeValue, deriveStaticWriteOverKeyframes } from "./question-rules-keyframes.js";
import { deriveParentCompensation } from "./question-rules-parenting.js";
import { hostOutcome } from "./question-values.js";

type QuestionDeriver = (data: JsonValue | undefined) => string[];

function deriveStatic(data: JsonValue | undefined): string[] {
  const recorded = questionData(staticOverKeyframes, data);
  return deriveStaticWriteOverKeyframes({ keyWrite: recorded.keyWrite, numKeys: recorded.keysBefore.numKeys, keys: recorded.keysBefore.keys }, recorded.cases);
}

function deriveColour(data: JsonValue | undefined): string[] {
  const recorded = questionData(effectColourPrecision, data);
  return deriveEffectColorPrecision(
    { sent: recorded.sent, readBack: recorded.composition.readBack, writeOutcome: hostOutcome(recorded.composition.write) },
    recorded.cases,
  );
}

/** The deriver of each open question, by question id. */
export const QUESTION_DERIVERS: Record<string, QuestionDeriver> = {
  "q1-parent-compensation-scope": (data) => deriveParentCompensation(questionData(parentCompensation, data).cases),
  "q2-value-outside-the-key-range": (data) => deriveKeyRangeValue(questionData(keyRangeValue, data).cases),
  "q3-static-write-over-keyframes": deriveStatic,
  "q4-shape-path-without-paint": (data) => deriveShapeWithoutPaint(questionData(shapeWithoutPaint, data).cases),
  "q5-effect-control-colour-precision": deriveColour,
};
