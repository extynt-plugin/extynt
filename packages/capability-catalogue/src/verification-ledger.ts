// The shapes of the host evidence the verdicts read: a local live-matrix ledger recorded on this computer and the receipts of the running session.

/** Where a plan type stands on one host build. */
export type HostVerificationStatus = "verified" | "unverified" | "unverifiable" | "regressed" | "unknown_type";

/** What this session's receipts recorded for one plan type on this host build. */
export interface RuntimeOperationEvidence {
  readonly count: number;
  readonly lastVerifiedAt: string;
  readonly hostVersion: string;
  readonly lastFailedAt?: string;
  readonly failures?: number;
  readonly lastFailureBasis?: string;
}

/** The live-matrix outcome for one plan type on one host build. */
export interface LedgerPlanTypeResult {
  readonly status: "verified" | "failed" | "unverifiable";
  readonly cases: readonly string[];
  readonly failedCases?: readonly string[] | undefined;
  readonly notes?: string | undefined;
}

/** The live-matrix outcome for one effect: added through ensure_effect and its control tree compared with probe evidence. */
export interface LedgerEffectResult {
  readonly status: "verified" | "drift" | "failed" | "missing";
  readonly detail?: string | undefined;
}

/** Which kit produced a live-matrix claim: the same build under different kits is a different claim. */
export interface LedgerKitIdentity {
  readonly extyntVersion: string;
  readonly packDigest: string;
}

/** One live-matrix run on one host build, as recorded in the local ledger. */
export interface LedgerHostEntry {
  readonly hostKey: string;
  readonly hostLabel: string;
  readonly runAt: string;
  readonly reportDigest: string;
  readonly kit: LedgerKitIdentity;
  readonly planTypes: Readonly<Record<string, LedgerPlanTypeResult>>;
  readonly effects?: Readonly<Record<string, LedgerEffectResult>> | undefined;
}

/** Every live-matrix run recorded on this computer. */
export interface HostVerificationLedger {
  readonly schemaVersion: "0.1";
  readonly hosts: readonly LedgerHostEntry[];
}

/** The ledger of a computer that has recorded nothing. */
export const EMPTY_HOST_VERIFICATION_LEDGER: HostVerificationLedger = { schemaVersion: "0.1", hosts: [] };
