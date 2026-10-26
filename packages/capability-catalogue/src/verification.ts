// The verdict on how far one plan type can be trusted on the connected host build, from this computer's ledger, this session's receipts and the plan type's contract.
import { evidenceHostName, ledgerKeyApplies, ledgerKeyAppliesToFamily } from "./host-keys.js";
import { PLAN_TYPE_CONTRACTS } from "./plan-type-contracts.js";
import type { PlanTypeContract, ReadBackLevel, RerunBehaviour } from "./plan-type-contracts.js";
import { compareSemverVersions } from "./semver-order.js";
import type { HostVerificationLedger, HostVerificationStatus, LedgerHostEntry, LedgerPlanTypeResult, RuntimeOperationEvidence } from "./verification-ledger.js";

/** The extynt kit version evidence is compared against; ledger runs from an older or unreadable version are stale. */
export const EVIDENCE_PRODUCT_VERSION = "0.1.0";

/** The evidence a verdict reads: the connected host's key, this computer's ledger and this session's receipts by plan type. */
export interface VerificationEvidence {
  readonly hostKey: string | null;
  readonly ledger?: HostVerificationLedger | undefined;
  readonly runtimeEvidence?: Readonly<Record<string, RuntimeOperationEvidence>> | undefined;
}

/** A plan type's verdict, with the contract facts and the age of the evidence behind it; `detail` explains the verdict in words. */
export interface PlanTypeVerification {
  readonly planType: string;
  readonly status: HostVerificationStatus;
  readonly basis: "unknown-plan-type" | "unobservable-contract" | "live-matrix" | "receipt-readback" | "live-matrix-failure" | "receipt-readback-failure" | "no-host-evidence" | "no-host-connected";
  readonly hostKey: string | null;
  readonly readBack: ReadBackLevel | null;
  readonly rerun: RerunBehaviour | null;
  readonly cleanup: string | null;
  readonly unobserved: readonly string[];
  readonly detail: string;
  readonly evidenceKitVersion: string | null;
  readonly staleEvidence: boolean;
}

interface Verdict {
  readonly status: HostVerificationStatus;
  readonly basis: PlanTypeVerification["basis"];
  readonly detail: string;
}

type ContractFacts = Pick<PlanTypeVerification, "planType" | "hostKey" | "readBack" | "rerun" | "cleanup" | "unobserved">;
type EvidenceAge = Pick<PlanTypeVerification, "evidenceKitVersion" | "staleEvidence">;
type Receipt = RuntimeOperationEvidence | undefined;

function newestFirst(entries: readonly LedgerHostEntry[]): LedgerHostEntry[] {
  return [...entries].sort((left, right) => {
    if (left.runAt === right.runAt) return 0;
    return left.runAt < right.runAt ? 1 : -1;
  });
}

function applicableLedgerHost(planType: string, hostKey: string, ledger: HostVerificationLedger | undefined): LedgerHostEntry | undefined {
  const hosts = ledger?.hosts ?? [];
  const exact = hosts.filter((entry) => ledgerKeyApplies(entry.hostKey, hostKey));
  const family = hosts.filter((entry) => !exact.includes(entry) && ledgerKeyAppliesToFamily(entry.hostKey, hostKey));
  const preferred = [
    ...newestFirst(exact.filter((entry) => entry.hostKey === hostKey)),
    ...newestFirst(exact.filter((entry) => entry.hostKey !== hostKey)),
    ...newestFirst(family),
  ];
  return preferred.find((entry) => entry.planTypes[planType] !== undefined);
}

function receiptRegressed(receipt: Receipt): boolean {
  if (!receipt?.lastFailedAt) return false;
  return !receipt.lastVerifiedAt || receipt.lastFailedAt >= receipt.lastVerifiedAt;
}

function ledgerFailureVerdict(result: LedgerPlanTypeResult | undefined, source: string): Verdict | undefined {
  if (result?.status !== "failed") return undefined;
  const cause = (result.failedCases ?? []).join(", ") || result.notes || "see ledger";
  return { status: "regressed", basis: "live-matrix-failure", detail: `Live matrix failed on ${source}: ${cause}.` };
}

function receiptFailureVerdict(receipt: Receipt): Verdict | undefined {
  if (!receiptRegressed(receipt)) return undefined;
  const basis = receipt?.lastFailureBasis ? ` (${receipt.lastFailureBasis})` : "";
  return { status: "regressed", basis: "receipt-readback-failure", detail: `A later receipt contradicted the write on this host${basis}.` };
}

function ledgerVerifiedVerdict(result: LedgerPlanTypeResult | undefined, source: string): Verdict | undefined {
  if (result?.status !== "verified") return undefined;
  return { status: "verified", basis: "live-matrix", detail: `Live matrix on ${source}: ${result.cases.join(", ")}.` };
}

function receiptVerifiedVerdict(receipt: Receipt): Verdict | undefined {
  if (!receipt || receipt.count <= 0) return undefined;
  return { status: "verified", basis: "receipt-readback", detail: `${receipt.count} exact receipt read-back(s) on ${receipt.hostVersion}.` };
}

function ledgerUnverifiableVerdict(result: LedgerPlanTypeResult | undefined, source: string): Verdict | undefined {
  if (result?.status !== "unverifiable") return undefined;
  return { status: "unverifiable", basis: "live-matrix", detail: result.notes ?? `The live matrix on ${source} could not observe this result.` };
}

function hostEvidenceVerdict(planType: string, hostKey: string, evidence: VerificationEvidence): Verdict | undefined {
  const host = applicableLedgerHost(planType, hostKey, evidence.ledger);
  const result = host?.planTypes[planType];
  const source = host ? evidenceHostName(host.hostKey) : "";
  const receipt = evidence.runtimeEvidence?.[planType];
  const verdicts = [
    ledgerFailureVerdict(result, source),
    receiptFailureVerdict(receipt),
    ledgerVerifiedVerdict(result, source),
    receiptVerifiedVerdict(receipt),
    ledgerUnverifiableVerdict(result, source),
  ];
  return verdicts.find((verdict) => verdict !== undefined);
}

function evidenceAge(planType: string, evidence: VerificationEvidence): EvidenceAge {
  if (!evidence.hostKey) return { evidenceKitVersion: null, staleEvidence: false };
  const entry = applicableLedgerHost(planType, evidence.hostKey, evidence.ledger);
  if (!entry) return { evidenceKitVersion: evidence.runtimeEvidence?.[planType] ? "current" : null, staleEvidence: false };
  const version = entry.kit.extyntVersion;
  const order = compareSemverVersions(version, EVIDENCE_PRODUCT_VERSION);
  return { evidenceKitVersion: version, staleEvidence: order === null || order < 0 };
}

function contractFacts(planType: string, contract: PlanTypeContract | undefined, hostKey: string | null): ContractFacts {
  if (!contract) return { planType, hostKey, readBack: null, rerun: null, cleanup: null, unobserved: [] };
  return { planType, hostKey, readBack: contract.readBack ?? null, rerun: contract.rerun ?? null, cleanup: contract.cleanup ?? null, unobserved: contract.unobserved ?? [] };
}

function verdictWithoutHostEvidence(contract: PlanTypeContract | undefined, evidence: VerificationEvidence, planType: string): Verdict {
  if (!contract) return { status: "unknown_type", basis: "unknown-plan-type", detail: "This plan type has no verification contract; treat it as invalid." };
  if (contract.readBack === "unobservable") return { status: "unverifiable", basis: "unobservable-contract", detail: contract.notes ?? "After Effects offers no way to read this result back." };
  if (!evidence.hostKey) return { status: "unverified", basis: "no-host-connected", detail: "No After Effects host is connected, so no host build evidence applies." };
  const verdict = hostEvidenceVerdict(planType, evidence.hostKey, evidence);
  return verdict ?? { status: "unverified", basis: "no-host-evidence", detail: "No recorded evidence for this host build; treated as supported until a read-back says otherwise." };
}

/** The verdict for one plan type on the connected host build: its contract, the evidence behind the verdict and whether that evidence is stale. */
export function planTypeVerification(planType: string, evidence: VerificationEvidence): PlanTypeVerification {
  const contract = Object.hasOwn(PLAN_TYPE_CONTRACTS, planType) ? PLAN_TYPE_CONTRACTS[planType] : undefined;
  const facts = { ...contractFacts(planType, contract, evidence.hostKey), ...evidenceAge(planType, evidence) };
  return { ...facts, ...verdictWithoutHostEvidence(contract, evidence, planType) };
}
