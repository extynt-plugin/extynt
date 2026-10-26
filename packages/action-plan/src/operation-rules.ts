// The one table that says how every operation kind is validated; a kind missing from it, or listed twice, does not compile.
import type { JsonValue } from "@extynt/decode";
import { DIRECT_RULES } from "./direct-rules.js";
import { EXTENDED_RULES } from "./extended-rules.js";
import { LAYER_RULES } from "./layer-rules.js";
import type { OperationRule } from "./layer-targets.js";
import type { ActionPlanV2Operation } from "./plan-types.js";

type OperationKind = ActionPlanV2Operation["type"];

const OPERATION_RULES = { ...DIRECT_RULES, ...LAYER_RULES, ...EXTENDED_RULES } satisfies Readonly<Record<OperationKind, OperationRule>>;
const RULES_BY_KIND: ReadonlyMap<string, OperationRule> = new Map<string, OperationRule>(Object.entries(OPERATION_RULES));

/** The rule for an operation's `type`, or undefined when no operation has that type. */
export function ruleFor(type: JsonValue | undefined): OperationRule | undefined { return typeof type === "string" ? RULES_BY_KIND.get(type) : undefined; }
