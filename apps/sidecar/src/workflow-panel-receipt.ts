// The receipt the panel reports for an applied plan or an undo, and the exact facts the workflow coordinator reads from it.

import { array, boolean, decodeOrThrow, type Decoder, fallback, type Infer, literal, map, number, object, optional, skippingInvalidRecord, string } from "@extynt/decode";
import type { StoredReceipt } from "@extynt/mcp-server";
import type { WorkflowPostconditionEvidence } from "@extynt/workflow";

/** One verification step of a panel receipt, reduced to the fields the coordinator grades. */
export type PanelStep = Infer<typeof panelStep>;

/** What the coordinator reads from a panel receipt after decoding it once. */
export interface ReceiptFacts {
  readonly status: string | undefined;
  readonly mutationState: string | undefined;
  readonly mayHaveMutated: boolean;
  readonly undoGroups: number | "invalid" | undefined;
  readonly beforeFingerprint: string | null | undefined;
  readonly afterFingerprint: string | undefined;
  readonly receiptId: string | undefined;
  readonly receivedAt: string | undefined;
  readonly postcondition: string;
  readonly verificationTrimmed: boolean;
  readonly verificationReported: boolean;
  readonly verificationState: string;
  readonly steps: readonly PanelStep[];
  readonly postconditions: readonly WorkflowPostconditionEvidence[];
  readonly created: Readonly<Record<string, string>> | undefined;
  readonly method: string | undefined;
  readonly undoRestored: boolean;
}

const stepShape = object({
  operation: optional(fallback(string(), undefined)),
  verificationState: optional(fallback(string(), undefined)),
  observed: optional(fallback(boolean(), undefined)),
  expressionMotionUnverified: optional(fallback(boolean(), undefined)),
  layerId: optional(fallback(string(), undefined)),
  compositionId: optional(fallback(string(), undefined)),
  newCompositionId: optional(fallback(string(), undefined)),
  itemId: optional(fallback(string(), undefined)),
});

const NO_STEP: Infer<typeof stepShape> = {};
const panelStep = fallback(stepShape, NO_STEP);

const evidenceRow: Decoder<WorkflowPostconditionEvidence | undefined> = fallback(
  map(
    object({
      postconditionId: string(),
      kind: literal("structural", "host_evidence", "visual", "temporal"),
      state: literal("passed", "failed", "unavailable", "not_evaluated"),
      basis: string(),
      observedFingerprint: optional(fallback(string(), undefined)),
    }),
    (row): WorkflowPostconditionEvidence => ({
      postconditionId: row.postconditionId.slice(0, 128),
      kind: row.kind,
      state: row.state,
      basis: row.basis.slice(0, 1000),
      ...(row.observedFingerprint === undefined ? {} : { observedFingerprint: row.observedFingerprint.slice(0, 512) }),
    }),
  ),
  undefined,
);

const evidenceList = fallback(array(evidenceRow), undefined);

type VerificationFacts = { readonly state?: string; readonly steps?: readonly PanelStep[]; readonly postconditions?: readonly (WorkflowPostconditionEvidence | undefined)[] };
const NO_VERIFICATION: VerificationFacts = {};
const verificationFacts = fallback(
  object({ state: optional(fallback(string(), undefined)), steps: optional(fallback(array(panelStep), undefined)), postconditions: optional(evidenceList) }),
  NO_VERIFICATION,
);

const createdFacts = fallback(skippingInvalidRecord(string()), undefined);

const receiptShape = object({
  status: optional(fallback(string(), undefined)),
  mutationState: optional(fallback(string(), undefined)),
  mayHaveMutated: optional(fallback(boolean(), undefined)),
  undoGroups: optional(fallback(number(), "invalid" as const)),
  beforeFingerprint: optional(fallback(string(), null)),
  afterFingerprint: optional(fallback(string(), undefined)),
  receiptId: optional(fallback(string(), undefined)),
  receivedAt: optional(fallback(string(), undefined)),
  postcondition: optional(fallback(string(), undefined)),
  verificationTrimmed: optional(fallback(boolean(), undefined)),
  verification: optional(verificationFacts),
  postconditions: optional(evidenceList),
  created: optional(createdFacts),
  method: optional(fallback(string(), undefined)),
  undo: optional(fallback(object({ restoredPreApplyFingerprint: optional(fallback(boolean(), undefined)) }), undefined)),
});

function evidenceOf(rows: readonly (WorkflowPostconditionEvidence | undefined)[] | undefined): readonly WorkflowPostconditionEvidence[] | undefined {
  return rows?.flatMap((row) => (row === undefined ? [] : [row]));
}

type ReceiptShape = Infer<typeof receiptShape>;

function verificationReported(receipt: StoredReceipt): boolean {
  return typeof receipt.verification === "object" && receipt.verification !== null;
}

function reportedVerification(receipt: StoredReceipt, shape: ReceiptShape): Pick<ReceiptFacts, "verificationReported" | "verificationState" | "steps" | "postconditions"> {
  const verification = shape.verification;
  return {
    verificationReported: verificationReported(receipt),
    verificationState: verification?.state ?? "",
    steps: verification?.steps ?? [],
    postconditions: evidenceOf(shape.postconditions) ?? evidenceOf(verification?.postconditions) ?? [],
  };
}

/** The facts of a panel receipt: each field read leniently, so a malformed field reads as absent rather than as authority. */
export function receiptFacts(receipt: StoredReceipt): ReceiptFacts {
  const shape = decodeOrThrow(receiptShape, receipt);
  return {
    status: shape.status,
    mutationState: shape.mutationState,
    mayHaveMutated: shape.mayHaveMutated === true,
    undoGroups: shape.undoGroups,
    beforeFingerprint: shape.beforeFingerprint,
    afterFingerprint: shape.afterFingerprint,
    receiptId: shape.receiptId,
    receivedAt: shape.receivedAt,
    postcondition: shape.postcondition ?? "unknown",
    verificationTrimmed: shape.verificationTrimmed === true,
    created: shape.created,
    method: shape.method,
    undoRestored: shape.undo?.restoredPreApplyFingerprint === true,
    ...reportedVerification(receipt, shape),
  };
}
