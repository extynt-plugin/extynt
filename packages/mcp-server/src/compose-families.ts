// The walk's dispatch: each operation goes to the handler of the family that owns its declared type, and an
// operation no project-level family claims is an operation on a layer.
import { stringAt } from "./json.js";
import type { ComposePass, FamilyOutcome } from "./compose-pass.js";
import { compositionMarkerHandler, PROJECT_FAMILY_HANDLERS } from "./compose-project-families.js";
import { bindTargetBearingOperation } from "./compose-target-binding.js";
import type { OperationFields } from "./operation-fields.js";

/** Dispatches one operation to its family: the handler that owns its type binds its placeholders and stores it. */
export function dispatchOperation(pass: ComposePass, candidate: OperationFields, index: number): FamilyOutcome {
  const handler = PROJECT_FAMILY_HANDLERS.get(stringAt(candidate, "type") ?? "") ?? compositionMarkerHandler(candidate);
  if (handler) return handler(pass, candidate, index);
  return bindTargetBearingOperation(pass, candidate, index);
}
