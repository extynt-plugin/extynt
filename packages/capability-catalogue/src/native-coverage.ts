// How much of the native operation registry is implemented, fixture-backed and verified on a host.
import { NATIVE_OPERATION_SCHEMA } from "./native-operation-types.js";
import type { NativeOperationDefinition, NativeOperationDomain, NativeOperationStatus } from "./native-operation-types.js";
import { NATIVE_OPERATION_REGISTRY } from "./native-registry.js";
import { PLAN_TYPE_CONTRACTS } from "./plan-type-contracts.js";
import { planTypeVerification } from "./verification.js";
import type { VerificationEvidence } from "./verification.js";
import type { HostVerificationStatus } from "./verification-ledger.js";

/** The registry's size and how it divides by domain, status, fixture and live evidence; `runtimeVerified` counts entries with a plan type verified exactly by a live-host receipt. */
export interface NativeOperationCoverage {
  schemaVersion: typeof NATIVE_OPERATION_SCHEMA;
  total: number;
  domains: Record<NativeOperationDomain, number>;
  statuses: Record<NativeOperationStatus, number>;
  fixtureBacked: number;
  runtimeVerified: number;
  planTypeVerification: Record<HostVerificationStatus, number>;
}

const NO_VERIFICATION: VerificationEvidence = { hostKey: null };

function domainCounts(registry: readonly NativeOperationDefinition[]): Record<NativeOperationDomain, number> {
  const counts: Record<NativeOperationDomain, number> = {
    project: 0, composition: 0, layer: 0, transform: 0, timing: 0, parenting: 0, "track-matte": 0, text: 0, mask: 0, shape: 0, camera: 0, light: 0,
    "3d-material": 0, audio: 0, effects: 0, expressions: 0, markers: 0, footage: 0, "guides-color": 0, render: 0, "essential-graphics": 0,
    presets: 0, "layer-styles": 0, tracking: 0, puppet: 0, roto: 0,
  };
  for (const entry of registry) counts[entry.domain] += 1;
  return counts;
}

function statusCounts(registry: readonly NativeOperationDefinition[]): Record<NativeOperationStatus, number> {
  const counts: Record<NativeOperationStatus, number> = { implemented: 0, documented_only: 0, probe_needed: 0, unsupported: 0 };
  for (const entry of registry) counts[entry.implementationStatus] += 1;
  return counts;
}

/** Every ActionPlan type an implemented registry entry can emit, deduplicated and sorted. */
export function executablePlanTypes(registry: readonly NativeOperationDefinition[] = NATIVE_OPERATION_REGISTRY): string[] {
  return [...new Set(registry.filter((entry) => entry.implementationStatus === "implemented").flatMap((entry) => entry.planTypes))].sort();
}

/** Plan types the planner can emit that have no verification contract (must stay empty; a test enforces it). */
export function planTypesMissingContracts(registry: readonly NativeOperationDefinition[] = NATIVE_OPERATION_REGISTRY): string[] {
  return executablePlanTypes(registry).filter((type) => !Object.hasOwn(PLAN_TYPE_CONTRACTS, type));
}

function planTypeVerificationCounts(registry: readonly NativeOperationDefinition[], evidence: VerificationEvidence): Record<HostVerificationStatus, number> {
  const counts: Record<HostVerificationStatus, number> = { verified: 0, unverified: 0, unverifiable: 0, regressed: 0, unknown_type: 0 };
  for (const type of executablePlanTypes(registry)) counts[planTypeVerification(type, evidence).status] += 1;
  return counts;
}

function isFixtureBacked(entry: NativeOperationDefinition): boolean {
  return entry.evidence.includes("host-handler") && entry.evidence.includes("fixture");
}

/** The registry's coverage, for the given verified plan types (live-host receipts) and host verification evidence. */
export function nativeOperationCoverage(
  registry: readonly NativeOperationDefinition[] = NATIVE_OPERATION_REGISTRY,
  runtimeVerifiedPlanTypes: ReadonlySet<string> = new Set(),
  verification: VerificationEvidence = NO_VERIFICATION,
): NativeOperationCoverage {
  const verifiedAtRuntime = (entry: NativeOperationDefinition): boolean => entry.implementationStatus === "implemented" && entry.planTypes.some((type) => runtimeVerifiedPlanTypes.has(type));
  return {
    schemaVersion: NATIVE_OPERATION_SCHEMA,
    total: registry.length,
    domains: domainCounts(registry),
    statuses: statusCounts(registry),
    fixtureBacked: registry.filter(isFixtureBacked).length,
    runtimeVerified: registry.filter(verifiedAtRuntime).length,
    planTypeVerification: planTypeVerificationCounts(registry, verification),
  };
}
