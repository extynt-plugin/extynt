// Type-level tests: each alias fails the build unless a spec infers exactly the result type stated.
import assert from "node:assert/strict";
import test from "node:test";
import { decide, decideAll } from "../src/index.js";
import type { BinaryResult, ChoiceResult, LabelsResult, ResultOf, ScoreResult } from "../src/index.js";
import { EFFECTS, FEATURE, IS_SCENE, URGENCY } from "./support.js";
import type { Request } from "./support.js";

type Equals<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type Everything = Awaited<ReturnType<typeof everything>>;

function everything() {
  return decideAll({ text: "" }, { feature: FEATURE, effects: EFFECTS, urgency: URGENCY, scene: IS_SCENE });
}

export type Checks = [
  Expect<Equals<ResultOf<typeof FEATURE>, ChoiceResult<"glow" | "blur" | "none">>>,
  Expect<Equals<ResultOf<typeof EFFECTS>, LabelsResult<"glow" | "blur">>>,
  Expect<Equals<ResultOf<typeof URGENCY>, ScoreResult>>,
  Expect<Equals<ResultOf<typeof IS_SCENE>, BinaryResult>>,
  Expect<Equals<Everything["feature"]["label"], "glow" | "blur" | "none">>,
  Expect<Equals<Everything["effects"]["labels"], ReadonlySet<"glow" | "blur">>>,
  Expect<Equals<Everything["feature"]["probabilities"], Readonly<Record<"glow" | "blur" | "none", number>>>>,
  Expect<Equals<Everything["urgency"]["probabilities"], ReadonlyArray<number>>>,
  Expect<Equals<Everything["scene"]["value"], boolean>>,
  Expect<Equals<Everything["scene"]["source"], "decision-model" | "model" | "deterministic">>,
  Expect<Equals<Parameters<typeof FEATURE.deterministic>[0], Request>>,
];

test("the label type of a result is the union of the spec's label keys", async () => {
  const result = await decide({ text: "glow" }, FEATURE);
  const label: "glow" | "blur" | "none" = result.label;
  assert.equal(label, "glow");
});
