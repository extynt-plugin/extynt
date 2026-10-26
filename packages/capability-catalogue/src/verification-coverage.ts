// Read-only audit of where operation confidence comes from and which receipt observers are worth improving first.
import { PLAN_TYPE_CONTRACTS } from "./plan-type-contracts.js";
import type { PlanTypeContract, ReadBackLevel } from "./plan-type-contracts.js";
import { planTypeVerification } from "./verification.js";
import type { PlanTypeVerification, VerificationEvidence } from "./verification.js";
import type { HostVerificationStatus } from "./verification-ledger.js";

/** How an operation's receipt observer should be improved next. */
export type VerificationUpgradeClass = "already-exact" | "strengthen-partial" | "add-structural-observer" | "host-only" | "unobservable";

/** One plan type in the audit. */
export interface VerificationCoverageRow {
  readonly planType: string;
  readonly readBack: ReadBackLevel;
  readonly status: HostVerificationStatus;
  readonly basis: PlanTypeVerification["basis"];
  readonly upgrade: VerificationUpgradeClass;
  readonly missingFields: readonly string[];
  readonly nextEvidence: string;
}

/** The audit: every plan type with its upgrade path, counted by upgrade class and by current status. */
export interface VerificationCoverageReport {
  readonly hostKey: string | null;
  readonly rows: VerificationCoverageRow[];
  readonly counts: Record<VerificationUpgradeClass, number>;
  readonly byStatus: Record<HostVerificationStatus, number>;
}

interface UpgradePath {
  readonly upgrade: VerificationUpgradeClass;
  readonly nextEvidence: string;
}

const UPGRADE_PATHS: Readonly<Record<ReadBackLevel, UpgradePath>> = {
  exact: { upgrade: "already-exact", nextEvidence: "Preserve fresh probe comparison and bank exact per-apply receipt evidence." },
  partial: { upgrade: "strengthen-partial", nextEvidence: "Extend the probe or receipt observer for the listed fields; keep the result partial until every requested field is compared." },
  "not-read": { upgrade: "add-structural-observer", nextEvidence: "Add a post-apply host/probe observer before this operation may produce a verified receipt." },
  "host-readback": { upgrade: "host-only", nextEvidence: "Preserve the host-returned value in the receipt and classify it separately from snapshot structural evidence." },
  unobservable: { upgrade: "unobservable", nextEvidence: "Keep this explicitly unverifiable; use a human, visual, temporal, or external-file criterion when appropriate." },
};

function coverageRow(planType: string, contract: PlanTypeContract, evidence: VerificationEvidence): VerificationCoverageRow {
  const { status, basis } = planTypeVerification(planType, evidence);
  return { planType, readBack: contract.readBack, status, basis, missingFields: contract.unobserved, ...UPGRADE_PATHS[contract.readBack] };
}

function countByUpgrade(rows: readonly VerificationCoverageRow[]): Record<VerificationUpgradeClass, number> {
  const tally = (upgrade: VerificationUpgradeClass): number => rows.filter((row) => row.upgrade === upgrade).length;
  return {
    "already-exact": tally("already-exact"),
    "strengthen-partial": tally("strengthen-partial"),
    "add-structural-observer": tally("add-structural-observer"),
    "host-only": tally("host-only"),
    unobservable: tally("unobservable"),
  };
}

function countByStatus(rows: readonly VerificationCoverageRow[]): Record<HostVerificationStatus, number> {
  const tally = (status: HostVerificationStatus): number => rows.filter((row) => row.status === status).length;
  return { verified: tally("verified"), unverified: tally("unverified"), unverifiable: tally("unverifiable"), regressed: tally("regressed"), unknown_type: tally("unknown_type") };
}

/** Audits every plan type against the evidence given, or against its contract alone when there is none. */
export function verificationCoverage(options: { hostKey?: string | null; ledger?: VerificationEvidence["ledger"]; runtimeEvidence?: VerificationEvidence["runtimeEvidence"] } = {}): VerificationCoverageReport {
  const evidence: VerificationEvidence = { hostKey: options.hostKey ?? null, ledger: options.ledger, runtimeEvidence: options.runtimeEvidence };
  const rows = Object.entries(PLAN_TYPE_CONTRACTS).map(([planType, contract]) => coverageRow(planType, contract, evidence));
  return { hostKey: evidence.hostKey, rows, counts: countByUpgrade(rows), byStatus: countByStatus(rows) };
}

/** The audit as a Markdown table. */
export function renderVerificationCoverage(report: VerificationCoverageReport): string {
  const lines = [
    "# Operation verification coverage",
    "",
    `Host: ${report.hostKey ?? "none (contract-only audit)"}`,
    "",
    `- exact receipt observers: ${report.counts["already-exact"]}`,
    `- partial observers to strengthen: ${report.counts["strengthen-partial"]}`,
    `- operations needing structural observers: ${report.counts["add-structural-observer"]}`,
    `- host-returned evidence paths: ${report.counts["host-only"]}`,
    `- scripting-unobservable operations: ${report.counts.unobservable}`,
    "",
    "| Operation | Readback | Current status | Basis | Upgrade path | Missing fields |",
    "|---|---|---|---|---|---|",
    ...report.rows.map((row) => `| ${row.planType} | ${row.readBack} | ${row.status} | ${row.basis} | ${row.upgrade} | ${row.missingFields.join(", ") || "—"} |`),
  ];
  return `${lines.join("\n")}\n`;
}
