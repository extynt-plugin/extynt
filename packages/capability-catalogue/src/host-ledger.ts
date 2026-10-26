// Reads and extends the host-verification ledger recorded on this computer by `extynt-host-verification analyze --write-ledger`. Nothing is shipped; a ledger that is absent or unreadable is simply no evidence.
import { decode, literal, map, object, string, union } from "@extynt/decode";
import type { Decoder, JsonValue } from "@extynt/decode";

import { isKept, list, rowsOf, rowsOrNone, skippable, softly } from "./decoder-kit.js";
import { EMPTY_HOST_VERIFICATION_LEDGER } from "./verification-ledger.js";
import type { HostVerificationLedger, LedgerEffectResult, LedgerHostEntry, LedgerPlanTypeResult } from "./verification-ledger.js";

const planTypeResult: Decoder<LedgerPlanTypeResult> = object({
  status: literal("verified", "failed", "unverifiable"),
  cases: list(string()),
  failedCases: softly(list(string())),
  notes: softly(string()),
});

const effectResult: Decoder<LedgerEffectResult> = object({
  status: literal("verified", "drift", "failed", "missing"),
  detail: softly(string()),
});

const hostEntry: Decoder<LedgerHostEntry> = object({
  hostKey: string(),
  hostLabel: string(),
  runAt: string(),
  reportDigest: string(),
  kit: object({ extyntVersion: string(), packDigest: string() }),
  planTypes: rowsOrNone(planTypeResult),
  effects: softly(rowsOf(effectResult)),
});

const readableHosts: Decoder<HostVerificationLedger> = map(object({ hosts: list(skippable(hostEntry)) }), ({ hosts }) => ({
  schemaVersion: "0.1" as const,
  hosts: hosts.filter(isKept),
}));

const noEvidence: Decoder<HostVerificationLedger> = { run: () => EMPTY_HOST_VERIFICATION_LEDGER };

/** Decodes the ledger file: every well-formed entry is kept, anything else in the file is dropped rather than trusted, and a file that is not a ledger is an empty one. */
export const hostVerificationLedger: Decoder<HostVerificationLedger> = union(readableHosts, noEvidence);

/** The ledger in an already-parsed file; callers that hold raw text should decode with `hostVerificationLedger`. */
export function parseHostLedger(value: JsonValue): HostVerificationLedger {
  const result = decode(hostVerificationLedger, value);
  return result.ok ? result.value : EMPTY_HOST_VERIFICATION_LEDGER;
}

/** The ledger with the run added; an earlier run of the same host key and kit version is replaced and every other entry stays. */
export function withLedgerEntry(ledger: HostVerificationLedger, entry: LedgerHostEntry): HostVerificationLedger {
  const kept = ledger.hosts.filter((held) => held.hostKey !== entry.hostKey || held.kit.extyntVersion !== entry.kit.extyntVersion);
  return { schemaVersion: "0.1", hosts: [...kept, entry] };
}
