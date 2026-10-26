/** The receipt for a refusal before After Effects is touched. */
import type { ApprovedData } from "./host-types.js";

interface NotRunReceipt {
  planId: string | undefined;
  operation: "apply_plan";
  status: "rejected";
  postcondition: "not_run";
  appliedOperations: never[];
  mayHaveMutated: false;
  mutationState: "not-applied";
  hostError: { code: string; message: string };
  approvalId?: string;
}

function approvalIdOf(approvedData: ApprovedData | null | undefined): { approvalId?: string } {
  const token = approvedData?.approval?.token;
  return typeof token === "string" && token ? { approvalId: token } : {};
}

/** Names the approval held for this plan or batch when there is one, so the sidecar can match the refusal to it. */
export function notRunReceipt(approvedData: ApprovedData | null | undefined, code: string, text: string): NotRunReceipt {
  return {
    planId: approvedData?.planId || undefined,
    operation: "apply_plan",
    status: "rejected",
    postcondition: "not_run",
    appliedOperations: [],
    mayHaveMutated: false,
    mutationState: "not-applied",
    hostError: { code, message: text },
    ...approvalIdOf(approvedData),
  };
}
