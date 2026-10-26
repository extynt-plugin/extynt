// The confidence bands fitted on the decision evaluation (verify below which a model answer is dropped, act at which it is taken); provisional, fitted in-sample.
import type { AnySpec, Bands } from "./spec.js";

const FITTED_BANDS: Readonly<Record<string, Bands>> = {
  "request-parts": { verify: 0, act: 0.7 },
  "request-missing": { verify: 0, act: 0.7 },
  "drawn-scene": { verify: 0, act: 0.7 },
  "named-object": { verify: 0, act: 0.7 },
  "layer-style-request": { verify: 0, act: 0.7 },
  "evidence-temporal": { verify: 0.5, act: 0.7 },
  "evidence-visual": { verify: 0, act: 0.7 },
  "evidence-judgement": { verify: 0.8, act: 0.8 },
  "request-scale": { verify: 0, act: 0.7 },
  continuation: { verify: 0, act: 0.7 },
  "ended-in-prose": { verify: 0, act: 0.7 },
  "question-answered": { verify: 0.9, act: 0.9 },
  "visual-waiver": { verify: 0, act: 0.8 },
  "review-proven": { verify: 0, act: 0.7 },
  "frame-quality": { verify: 0.6, act: 0.7 },
  effect: { verify: 0.85, act: 0.85 },
  control: { verify: 0.85, act: 0.85 },
  font: { verify: 0, act: 0.7 },
  property: { verify: 0.9, act: 0.9 },
  "request-route": { verify: 0, act: 0.7 },
  "request-specialists": { verify: 0, act: 0.7 },
  "model-tier": { verify: 0, act: 0.7 },
};

/** The fitted bands of a decision by name, or undefined for a decision that was not fitted. */
export function fittedBands(name: string): Bands | undefined {
  return FITTED_BANDS[name];
}

/** The spec routed by its fitted bands; a spec that was not fitted keeps its own. */
export function withFittedBands<Spec extends AnySpec<never>>(spec: Spec): Spec {
  const bands = fittedBands(spec.name);
  return bands === undefined ? spec : { ...spec, bands };
}
