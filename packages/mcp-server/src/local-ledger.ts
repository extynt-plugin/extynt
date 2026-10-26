// The host-verification ledger of this computer: what `extynt-host-verification analyze --write-ledger` recorded. Nothing ships with the product; no file means no evidence.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EMPTY_HOST_VERIFICATION_LEDGER, withLedgerEntry } from "@extynt/capability-catalogue";
import type { HostVerificationLedger, LedgerEffectResult, LedgerHostEntry, LedgerPlanTypeResult } from "@extynt/capability-catalogue";
import { array, decode, decodeJson, jsonValue, literal, map, object, optional, record, string, union } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import { stateDirectory } from "@extynt/host-native";

const HOST_LEDGER_FILE = "host-verification-ledger.json";

const planTypeResult: Decoder<LedgerPlanTypeResult> = object({
  status: literal("verified", "failed", "unverifiable"),
  cases: array(string()),
  failedCases: optional(array(string())),
  notes: optional(string()),
});

const effectResult: Decoder<LedgerEffectResult> = object({
  status: literal("verified", "drift", "failed", "missing"),
  detail: optional(string()),
});

function wellFormed<T>(entry: Decoder<T>): Decoder<ReadonlyArray<T>> {
  return map(array(jsonValue), (items) => items.flatMap((item) => {
    const outcome = decode(entry, item);
    return outcome.ok ? [outcome.value] : [];
  }));
}

function wellFormedRows<T>(entry: Decoder<T>): Decoder<Readonly<Record<string, T>>> {
  const rows = record(string(), jsonValue);
  const nothing = map(jsonValue, () => ({}));
  return map(union(rows, nothing), (found) => Object.fromEntries(Object.entries(found).flatMap(([name, item]) => {
    const outcome = decode(entry, item);
    return outcome.ok ? [[name, outcome.value]] : [];
  })));
}

const hostEntry: Decoder<LedgerHostEntry> = object({
  hostKey: string(),
  hostLabel: string(),
  runAt: string(),
  reportDigest: string(),
  kit: object({ extyntVersion: string(), packDigest: string() }),
  planTypes: wellFormedRows(planTypeResult),
  effects: optional(wellFormedRows(effectResult)),
});

const ledgerFile: Decoder<HostVerificationLedger> = map(
  union(object({ hosts: wellFormed(hostEntry) }), map(jsonValue, () => ({ hosts: [] }))),
  ({ hosts }): HostVerificationLedger => ({ schemaVersion: "0.1", hosts }),
);

/** Where this computer keeps its host-verification ledger. */
export function hostLedgerPath(): string {
  return join(stateDirectory(), HOST_LEDGER_FILE);
}

let held: { readonly path: string; readonly modifiedAt: number; readonly ledger: HostVerificationLedger } | undefined;

function loadLedger(path: string): HostVerificationLedger {
  const outcome = decodeJson(readFileSync(path, "utf8"), ledgerFile);
  return outcome.ok ? outcome.value : EMPTY_HOST_VERIFICATION_LEDGER;
}

/** The ledger on disk, re-read only when the file changes; an absent or unreadable file is an empty ledger, and every malformed entry in it is dropped rather than trusted. */
export function readLocalHostLedger(path: string = hostLedgerPath()): HostVerificationLedger {
  try {
    const modifiedAt = statSync(path).mtimeMs;
    if (held?.path === path && held.modifiedAt === modifiedAt) return held.ledger;
    const ledger = loadLedger(path);
    held = { path, modifiedAt, ledger };
    return ledger;
  } catch {
    return EMPTY_HOST_VERIFICATION_LEDGER;
  }
}

/** Adds the run to the local ledger, replacing an earlier run of the same host key and kit version. */
export function writeLocalHostLedgerEntry(entry: LedgerHostEntry, path: string = hostLedgerPath()): void {
  const next = withLedgerEntry(readLocalHostLedger(path), entry);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}
