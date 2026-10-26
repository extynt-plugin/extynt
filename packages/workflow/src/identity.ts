// Workflow identifiers and the goal digest: the two pure value helpers every other module builds on.

import { createHash } from "node:crypto";

/** A bounded workflow identifier: 1-128 characters from a conservative alphabet. */
export type WorkflowId = string;

const WORKFLOW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Whether the value is a well-formed workflow identifier. */
export function isWorkflowId(value: string | undefined): value is WorkflowId {
  return typeof value === "string" && WORKFLOW_ID_PATTERN.test(value);
}

/** The sha256 hex digest of a job's retained, redacted goal summary. */
export function workflowGoalDigest(goalSummary: string): string {
  return createHash("sha256").update(goalSummary).digest("hex");
}
