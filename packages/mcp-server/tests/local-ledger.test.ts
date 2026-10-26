// Tests for the local host-verification ledger: tolerant reading of the file and replace-on-write.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLocalHostLedger, writeLocalHostLedgerEntry } from "../src/local-ledger.js";

const goodEntry = {
  hostKey: "26.2.1x2 (2) Windows/unknown",
  hostLabel: "After Effects 26.2",
  runAt: "2026-10-01T00:00:00Z",
  reportDigest: "abc",
  kit: { extyntVersion: "1.0.0", packDigest: "def" },
  planTypes: {
    add_solid: { status: "verified", cases: ["basic"] },
    broken: { status: "mystery", cases: [] },
  },
  effects: { "ADBE Glo2": { status: "drift", detail: "range" }, other: 7 },
};

function ledgerFile(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "ledger.json");
  writeFileSync(path, content);
  return path;
}

test("a ledger keeps well-formed entries and drops malformed rows inside them", () => {
  const ledger = readLocalHostLedger(ledgerFile(JSON.stringify({ hosts: [goodEntry, { hostKey: 3 }] })));
  assert.equal(ledger.hosts.length, 1);
  assert.deepEqual(Object.keys(ledger.hosts[0]?.planTypes ?? {}), ["add_solid"]);
  assert.deepEqual(Object.keys(ledger.hosts[0]?.effects ?? {}), ["ADBE Glo2"]);
});

test("an absent, unparseable or shapeless ledger is empty", () => {
  assert.deepEqual(readLocalHostLedger(join(tmpdir(), "no-such-ledger.json")).hosts, []);
  assert.deepEqual(readLocalHostLedger(ledgerFile("not json")).hosts, []);
  assert.deepEqual(readLocalHostLedger(ledgerFile("[1, 2]")).hosts, []);
});

test("writing an entry replaces the same host and kit and keeps the rest", () => {
  const path = ledgerFile(JSON.stringify({ hosts: [goodEntry] }));
  writeLocalHostLedgerEntry({ ...goodEntry, runAt: "2026-10-02T00:00:00Z", planTypes: {}, effects: {} }, path);
  const ledger = readLocalHostLedger(path);
  assert.equal(ledger.hosts.length, 1);
  assert.equal(ledger.hosts[0]?.runAt, "2026-10-02T00:00:00Z");
});
