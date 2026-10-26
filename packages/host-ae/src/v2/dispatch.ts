// The v0.2 to host mailbox dispatch: the family tables merge into one table that the compiler checks covers every operation type.
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import type { HostPlanOperation } from "../host-plan-operation.js";
import { refuse, type CompilationRefusal, type CompilerTable, type HostOutcome, type OperationOf, type OperationType } from "./compiler-table.js";
import { EFFECT_COMPILERS, OPTION_COMPILERS, TEXT_COMPILERS } from "./effect-compilers.js";
import { LAYER_ANIMATION_COMPILERS, LAYER_STATE_COMPILERS, LAYER_STRUCTURE_COMPILERS, LAYER_WRITE_COMPILERS, MARKER_COMPILERS } from "./layer-compilers.js";
import { COMPOSITION_COMPILERS, FOOTAGE_COMPILERS, OUTPUT_COMPILERS, PROJECT_ITEM_COMPILERS, PROJECT_SETTINGS_COMPILERS } from "./project-compilers.js";
import { MASK_COMPILERS, SHAPE_COMPILERS } from "./shape-compilers.js";
import { KEYFRAME_COMPILERS, TOOL_COMPILERS } from "./tool-compilers.js";

type Compilers = CompilerTable<OperationType>;

const COMPILERS: Compilers = {
  ...EFFECT_COMPILERS, ...TEXT_COMPILERS, ...OPTION_COMPILERS,
  ...LAYER_WRITE_COMPILERS, ...LAYER_ANIMATION_COMPILERS, ...LAYER_STATE_COMPILERS, ...LAYER_STRUCTURE_COMPILERS, ...MARKER_COMPILERS,
  ...SHAPE_COMPILERS, ...MASK_COMPILERS, ...KEYFRAME_COMPILERS, ...TOOL_COMPILERS,
  ...PROJECT_ITEM_COMPILERS, ...FOOTAGE_COMPILERS, ...COMPOSITION_COMPILERS, ...OUTPUT_COMPILERS, ...PROJECT_SETTINGS_COMPILERS,
};

type CompiledHostOperations = { ok: true; operations: HostPlanOperation[] } | CompilationRefusal;

function isRefusal(outcome: HostOutcome): outcome is CompilationRefusal {
  return "code" in outcome;
}

function compileKind<Kind extends OperationType>(kind: Kind, operation: OperationOf<Kind>): HostOutcome {
  const compile: (operation: OperationOf<Kind>) => HostOutcome = COMPILERS[kind];
  return compile(operation);
}

function compileOperation(operation: ActionPlanV2Operation): HostOutcome {
  if (!Object.hasOwn(COMPILERS, operation.type)) return refuse("UNSUPPORTED_OPERATION", `Operation ${operation.type} is not supported by the native AE mailbox.`);
  return compileKind(operation.type, operation);
}

export function compileHostOperations(operations: readonly ActionPlanV2Operation[]): CompiledHostOperations {
  const compiled: HostPlanOperation[] = [];
  for (const operation of operations) {
    const outcome = compileOperation(operation);
    if (isRefusal(outcome)) return outcome;
    compiled.push(outcome);
  }
  return { ok: true, operations: compiled };
}
