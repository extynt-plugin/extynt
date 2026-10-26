// How sure a yes or no answer is: the probability's distance from a coin flip, rescaled to 0 to 1 (the definition the TypeSafe docs give for noul answers).

/** The confidence of a yes or no answer with the given probability of yes: |2p - 1|. */
export function yesConfidence(probability: number): number {
  return Math.abs(2 * probability - 1);
}
