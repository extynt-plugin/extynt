/** What a scenario requires of a run, as the decoder a prompt's `expect` line is read through. */
import { boolean, literal, number, object, optional, record, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { wireValue } from "@extynt/fake-plugin";
import { stringList } from "./string-list.js";

/** The structural facts that must hold of a run, never the model's wording. */
export const expectationOf = object({
  outcome: optional(literal("answered", "planned", "failed")),
  plans: optional(object({ min: optional(number()), max: optional(number()) })),
  anyOperationMatches: optional(stringList),
  targetsLayer: optional(string()),
  targetsComposition: optional(string()),
  requiredOperationTypes: optional(stringList),
  requiredPropertyPaths: optional(stringList),
  requiredControlValues: optional(record(string(), wireValue)),
  forbiddenTargets: optional(stringList),
  answerMentions: optional(stringList),
  onlyTools: optional(stringList),
  noToolErrors: optional(boolean()),
  execution: optional(literal("success", "refused")),
});

/** The requirements a scenario places on a run. */
export type ScenarioExpectation = Infer<typeof expectationOf>;
