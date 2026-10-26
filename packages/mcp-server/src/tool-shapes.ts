// Argument shapes that several tools share: plan ids, wait budgets, the verbose switch and a plan operation.
import { booleanArg, customArg, numberArg, optionalArg, stringArg } from "./arg.js";
import type { Arg, OptionalArg } from "./arg.js";
import { jsonObject, refine } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";

/** The id of a stored plan. */
export const PLAN_ID = stringArg({ minLength: 1, maxLength: 256 });

/** Asks for the full body instead of the compact view. */
export const VERBOSE = optionalArg(booleanArg({ description: "Return the full body instead of the compact view." }));

/** How long to wait for After Effects to finish, in seconds; the description names the agent's default. */
export function waitArg(agentDefault: number): OptionalArg<number> {
  return optionalArg(numberArg({ min: 0, max: 60, description: `Seconds to wait for After Effects to finish (agent default ${agentDefault}).` }));
}

function hasType(operation: JsonObject): operation is JsonObject {
  return typeof operation.type === "string";
}

/** One plan operation: an object with a string `type`; every other field passes through for the operation's own checks. */
export function operationArg(): Arg<JsonObject> {
  return customArg(refine(jsonObject, hasType, "an object with a string type"), {
    type: "object",
    required: ["type"],
    properties: {
      type: { type: "string", description: "Operation type." },
      target: { type: "object", description: "compositionId/layerId (+propertyPath/effectPath) where applicable." },
    },
  });
}
