/** Decodes one line of a benchmark ledger, upgrading a row of the previous schema first. */
import { array, boolean, decode, decodeJson, literal, map, nullable, number, object, record, string, union } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import { isWireObject, wireObject } from "@extynt/fake-plugin";
import type { BenchmarkLedgerRow, LedgerTurn } from "./benchmark-ledger.js";
import type { RoleUsage } from "./ledger-usage.js";
import type { WireObject } from "./wire-types.js";

const PREVIOUS_SCHEMA = "0.1";
const CURRENT_SCHEMA = "0.2";

const nullableString = nullable(string());
const nullableNumber = nullable(number());
const cutoff = nullable(union(literal("harness"), literal("provider"), literal("transport")));
const callsBasis = union(literal("reported"), literal("steps"), literal("none"));
const evidenceMode = union(literal("planning-only"), literal("headless-apply"), literal("headless-fixture-readback"), literal("live-host-structural"), literal("live-host-temporal-visual"));
const list = <T>(item: Decoder<T>): Decoder<T[]> => map(array(item), (items) => [...items]);
const counts = record(string(), number());
const roleUsage: Decoder<RoleUsage> = object({ calls: nullableNumber, freshInputTokens: number(), cachedInputTokens: number(), outputTokens: number() });
const usageByRole = record(string(), roleUsage);

const turn: Decoder<LedgerTurn> = object({
  index: number(),
  passed: boolean(),
  cutoff,
  wallMs: nullableNumber,
  callsBasis,
  modelCalls: nullableNumber,
  usageByRole,
});

const rowDecoder: Decoder<BenchmarkLedgerRow> = object({
  schemaVersion: literal(CURRENT_SCHEMA),
  runId: string(),
  recordedAt: string(),
  revision: object({ git: nullableString, dirty: nullable(boolean()) }),
  scenario: object({ id: string(), asset: string() }),
  runtime: object({ provider: nullableString, model: nullableString, evidenceMode }),
  result: object({ outcome: nullableString, expectationPassed: boolean(), cutoff, failureCodes: list(string()) }),
  work: object({
    steps: number(),
    workflowCycles: nullableNumber,
    stageSelections: number(),
    stageReselections: number(),
    queuedOperations: number(),
    batchCount: number(),
    batchUtilization: nullableNumber,
  }),
  refusals: object({ total: number(), firstAttemptAdmitted: nullable(boolean()), byToolAndCode: counts, byOperationAndCode: counts }),
  usage: object({ inputTokens: number(), outputTokens: number(), totalTokens: number(), cachedInputTokens: number(), freshInputTokens: number() }),
  modelCalls: object({ total: nullableNumber, byRole: record(string(), nullableNumber), basis: callsBasis }),
  usageByRole,
  turns: list(turn),
  folding: object({ count: number(), removedCharacters: number() }),
  target: object({ expectedLayerId: nullableString, matched: nullable(boolean()) }),
  receipt: object({
    state: union(literal("not-applied"), literal("applied-unverified"), literal("verified"), literal("partial-or-failed")),
    appliedOperations: number(), failedOperations: number(), basis: union(literal("none"), literal("headless-fixture"), literal("live-host")),
  }),
  timing: object({ totalMs: nullableNumber, authoringMs: nullableNumber, hostSettleMs: nullableNumber }),
});

function countOf(row: WireObject | undefined, key: string): number {
  const value = row?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function upgradePrevious(row: WireObject): WireObject {
  const usage = isWireObject(row.usage) ? row.usage : {};
  const input = countOf(usage, "inputTokens"), cached = Math.min(countOf(usage, "cachedInputTokens"), input);
  const main = { calls: null, freshInputTokens: input - cached, cachedInputTokens: cached, outputTokens: countOf(usage, "outputTokens") };
  return { ...row, schemaVersion: CURRENT_SCHEMA, usage: { ...usage, freshInputTokens: main.freshInputTokens }, modelCalls: { total: null, byRole: { main: null }, basis: "none" }, usageByRole: { main }, turns: [] };
}

/** Reads one ledger line, or throws naming the file and line. */
export function decodeLedgerLine(text: string, where: string): BenchmarkLedgerRow {
  const parsed = decodeJson(text, wireObject);
  if (!parsed.ok) throw new Error(`${where}: unsupported benchmark ledger schema undefined.`);
  const version = parsed.value.schemaVersion;
  if (version !== CURRENT_SCHEMA && version !== PREVIOUS_SCHEMA) throw new Error(`${where}: unsupported benchmark ledger schema ${String(version)}.`);
  const row = version === PREVIOUS_SCHEMA ? upgradePrevious(parsed.value) : parsed.value;
  const decoded = decode(rowDecoder, row);
  if (!decoded.ok) throw new Error(`${where}: malformed benchmark ledger row.`);
  return decoded.value;
}
