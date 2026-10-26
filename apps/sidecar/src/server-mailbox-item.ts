// What the panel lease reads from a queued mailbox item: its kind, plan, capture, approval and the fingerprint an undo was requested against.
import { decodeOrThrow, fallback, object, string } from "@extynt/decode";

import { lenientObject } from "./server-mcp-arguments.js";
import type { AgentMailboxItem } from "./server-types.js";

type MailboxItemFacts = {
  readonly kind: string;
  readonly planId: string | undefined;
  readonly approvedPlanId: string | undefined;
  readonly claimId: string;
  readonly approvalToken: string;
  readonly panelSessionId: string | undefined;
  readonly expectedFingerprint: string | undefined;
};

const itemHead = lenientObject({
  kind: fallback(string(), undefined),
  planId: fallback(string(), undefined),
  command: fallback(object({ captureId: fallback(string(), undefined) }), undefined),
  approval: fallback(object({ token: fallback(string(), undefined), panelSessionId: fallback(string(), undefined) }), undefined),
  expectedFingerprint: fallback(string(), undefined),
});

function claimIdOf(kind: string, planId: string | undefined, captureId: string | undefined): string {
  if (planId) return planId;
  if (kind === "capture_frame" && captureId) return captureId;
  return kind;
}

/** The lease's reading of one mailbox item. */
export function mailboxItemFacts(item: AgentMailboxItem): MailboxItemFacts {
  const read = decodeOrThrow(itemHead, item.approvedData);
  const kind = read.kind ?? "apply_plan";
  const planId = item.planId ?? read.planId;
  return {
    kind,
    planId,
    approvedPlanId: read.planId,
    claimId: claimIdOf(kind, planId, read.command?.captureId),
    approvalToken: read.approval?.token ?? "",
    panelSessionId: read.approval?.panelSessionId,
    expectedFingerprint: read.expectedFingerprint,
  };
}
