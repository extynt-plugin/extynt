// Reads a plan's operations into what the preference tally counts: effects added, effects taken off, fonts written, effect controls written and transform properties written.
import type { StoredPlan } from "@extynt/mcp-server";
import type { TallyOperation } from "./preference-tally.js";

type PlanOperation = StoredPlan["plan"]["operations"][number];

const SIBLING_SUFFIX = /#\d+$/;
const TRANSFORM_ROLE = /^transform\./;

function lastSegment(path: string | undefined): string | undefined {
  const last = path?.split("/").at(-1);
  return last === undefined || last === "" ? undefined : last;
}

function controlOf(effectMatchName: string, propertyPath: string | undefined): TallyOperation[] {
  const leaf = lastSegment(propertyPath)?.replace(SIBLING_SUFFIX, "");
  return leaf === undefined || effectMatchName === "" ? [] : [{ type: "control", control: `${effectMatchName}/${leaf}` }];
}

function propertyOf(role: string | undefined): TallyOperation[] {
  return role !== undefined && TRANSFORM_ROLE.test(role) ? [{ type: "property", property: role }] : [];
}

function fontOf({ font }: Extract<PlanOperation, { type: "set_text_document" }>): TallyOperation[] {
  return typeof font === "string" && font !== "" ? [{ type: "set_text_document", font }] : [];
}

function removedOf(effectPath: string | undefined): TallyOperation[] {
  const removedEffect = lastSegment(effectPath);
  return removedEffect === undefined ? [] : [{ type: "remove_effect", removedEffect }];
}

function tallyOf(operation: PlanOperation): TallyOperation[] {
  switch (operation.type) {
    case "ensure_effect": return [{ type: operation.type, effectMatchName: operation.effectMatchName }];
    case "remove_effect": return removedOf(operation.target.effectPath);
    case "set_text_document": return fontOf(operation);
    case "set_effect_control":
    case "animate_control": return controlOf(operation.effectMatchName, operation.target.propertyPath);
    case "set_layer_property":
    case "animate_property": return propertyOf(operation.role);
    default: return [];
  }
}

/** What the tally counts in a plan. */
export function tallyOperations(plan: { readonly operations: ReadonlyArray<PlanOperation> }): TallyOperation[] {
  return plan.operations.flatMap(tallyOf);
}
