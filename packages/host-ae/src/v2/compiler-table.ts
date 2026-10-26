// The shared shapes of the per-kind compiler tables: one compiler for every v0.2 operation type, checked exhaustive by the type system.
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import type { HostPlanOperation } from "../host-plan-operation.js";

export type CompilationRefusal = { ok: false; code: string; message: string };

export type OperationType = ActionPlanV2Operation["type"];

export type OperationOf<Kind extends OperationType> = Extract<ActionPlanV2Operation, { type: Kind }>;

export type HostOutcome = HostPlanOperation | CompilationRefusal;

export type CompilerTable<Kind extends OperationType> = { readonly [Type in Kind]: (operation: OperationOf<Type>) => HostOutcome };

/** Fixes the kinds a family table covers from its keys, and types each compiler's operation to exactly its kind. */
export function compilerTable<Kind extends OperationType>(compilers: CompilerTable<Kind>): CompilerTable<Kind> {
  return compilers;
}

export function refuse(code: string, message: string): CompilationRefusal {
  return { ok: false, code, message };
}
