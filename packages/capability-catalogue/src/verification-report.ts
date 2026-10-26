// The warnings an agent must see before approving a plan, derived from each operation's verdict and contract.
import { planTypeUndoability } from "./native-lookup.js";
import { planTypeVerification } from "./verification.js";
import type { PlanTypeVerification, VerificationEvidence } from "./verification.js";
import type { HostVerificationStatus } from "./verification-ledger.js";

/** One operation of a plan with its verdict; `detail` is the hover text for "we could not confirm this". */
export interface OperationVerificationReport {
  readonly index: number;
  readonly type: string;
  readonly status: HostVerificationStatus;
  readonly basis: PlanTypeVerification["basis"];
  readonly detail: string;
  readonly readBack: PlanTypeVerification["readBack"];
  readonly rerun: PlanTypeVerification["rerun"];
  readonly cleanup: string | null;
  readonly unobserved: readonly string[];
  readonly evidenceKitVersion: string | null;
  readonly staleEvidence: boolean;
}

/** The verdicts of a whole plan: per operation, per status, whether the plan needs acknowledgement, and the warnings to show. */
export interface PlanVerificationReport {
  readonly operations: OperationVerificationReport[];
  readonly counts: Record<HostVerificationStatus, number>;
  readonly requiresAcknowledgement: boolean;
  readonly warnings: string[];
}

interface WarningRule {
  readonly applies: (operation: OperationVerificationReport) => boolean;
  readonly message: (operations: readonly OperationVerificationReport[]) => string;
}

const label = (operation: OperationVerificationReport): string => `#${operation.index} ${operation.type}`;
const labels = (operations: readonly OperationVerificationReport[]): string => operations.map(label).join(", ");
const verbEnding = (operations: readonly OperationVerificationReport[]): string => (operations.length === 1 ? "s" : "");
const createsObjects = (operation: OperationVerificationReport): boolean => operation.rerun === "creates" || operation.rerun === "external";
const leavesNoCleanup = (operation: OperationVerificationReport): boolean => (operation.rerun === "creates" || operation.rerun === "ensure") && operation.cleanup === null && planTypeUndoability(operation.type) !== "undo-group";

const WARNING_RULES: readonly WarningRule[] = [
  {
    applies: (operation) => operation.status === "regressed",
    message: (operations) => `REGRESSED_OPERATION: ${labels(operations)} failed read-back on this After Effects build. Do not rely on them.`,
  },
  {
    applies: (operation) => operation.status === "unverifiable",
    message: (operations) => `UNVERIFIABLE_OPERATION: ${labels(operations)} cannot be read back; success can never be confirmed.`,
  },
  {
    applies: (operation) => operation.staleEvidence,
    message: (operations) => `STALE_HOST_EVIDENCE: ${operations.map((operation) => `${label(operation)} (kit ${operation.evidenceKitVersion})`).join(", ")} have evidence from an older or unrecognized extynt kit version; run the current host-verification suite before treating them as current-build evidence.`,
  },
  {
    applies: createsObjects,
    message: (operations) => `NOT_IDEMPOTENT: ${labels(operations)} create${verbEnding(operations)} new objects or files on every run; do not re-propose this plan after it applies.`,
  },
  {
    applies: leavesNoCleanup,
    message: (operations) => `CLEANUP_UNAVAILABLE: no operation removes what ${labels(operations)} create${verbEnding(operations)}; only After Effects Undo reverts it.`,
  },
];

function reportOperation(type: string, index: number, evidence: VerificationEvidence): OperationVerificationReport {
  const { status, basis, detail, readBack, rerun, cleanup, unobserved, evidenceKitVersion, staleEvidence } = planTypeVerification(type, evidence);
  return { index, type, status, basis, detail, readBack, rerun, cleanup, unobserved, evidenceKitVersion, staleEvidence };
}

function countByStatus(operations: readonly OperationVerificationReport[]): Record<HostVerificationStatus, number> {
  const tally = (status: HostVerificationStatus): number => operations.filter((operation) => operation.status === status).length;
  return { verified: tally("verified"), unverified: tally("unverified"), unverifiable: tally("unverifiable"), regressed: tally("regressed"), unknown_type: tally("unknown_type") };
}

function warningsFor(operations: readonly OperationVerificationReport[]): string[] {
  const matched = WARNING_RULES.map((rule) => ({ rule, operations: operations.filter(rule.applies) }));
  return matched.filter((entry) => entry.operations.length > 0).map((entry) => entry.rule.message(entry.operations));
}

/** The verdict of every operation type of a plan, with the warnings an agent must see before approving it. */
export function planVerificationReport(operationTypes: readonly string[], evidence: VerificationEvidence): PlanVerificationReport {
  const operations = operationTypes.map((type, index) => reportOperation(type, index, evidence));
  const counts = countByStatus(operations);
  return { operations, counts, requiresAcknowledgement: counts.unverifiable + counts.regressed + counts.unknown_type > 0, warnings: warningsFor(operations) };
}
