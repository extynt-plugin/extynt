// "Ask before applying", the pure half: which plans are risky enough to wait for the user, and what each preference does with that.
// Reversible, verifiable edits are not risky; deletes, render/import/export, plans whose scoped undo is unsupported and plans an
// external agent proposed are.
import { ownedRemovalIndexes } from "@extynt/mcp-server";
import type { AskBeforeApplying } from "../ui-contract.js";
import type { PlanSource } from "./facts.js";

type RiskReason = "delete" | "outside-project" | "scoped-undo-unsupported" | "external-agent";
interface PlanRisk { risky: boolean; reasons: RiskReason[] }

interface RiskSubject {
  plan: { operations: ReadonlyArray<{ type: string }> };
  approvalCapability?: { readSetDigest?: string | undefined } | null | undefined;
}

const OUTSIDE_PROJECT: ReadonlySet<string> = new Set(["render_composition", "import_file", "export_mogrt", "replace_footage"]);

function isDelete(type: string): boolean {
  return type.startsWith("remove_") || type.startsWith("delete_") || type === "cleanup_project";
}

/** Why `record` (its operation types and any scoped read-set approval) would wait for the user: deletes of anything the job did not create (`ownedIds`), work outside the project, unsupported scoped undo, an external proposer. */
export function planRisk(record: RiskSubject, source: PlanSource, ownedIds?: ReadonlySet<string>): PlanRisk {
  const { operations } = record.plan, owned = ownedRemovalIndexes(operations, ownedIds), reasons: RiskReason[] = [];
  if (operations.some((operation, index) => isDelete(operation.type) && !owned.has(index))) reasons.push("delete");
  if (operations.some((operation) => OUTSIDE_PROJECT.has(operation.type))) reasons.push("outside-project");
  if (record.approvalCapability?.readSetDigest) reasons.push("scoped-undo-unsupported");
  if (source === "agent") reasons.push("external-agent");
  return { risky: reasons.length > 0, reasons };
}

/** Whether the preference lets a plan of this risk apply without a click. */
export function autoApplyAllowed(ask: AskBeforeApplying, risk: PlanRisk): boolean {
  if (ask === "always") return false;
  return ask === "never" || !risk.risky;
}
