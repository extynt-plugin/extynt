// Tests how verification evidence is matched to a host build.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJson } from "./json-input.js";
import { SUPPORTED_HOSTS, ledgerKeyAppliesToFamily, parseHostKey, parseHostLedger, planTypeVerification, supportedHostKey, supportedHostLabel, withLedgerEntry, type HostVerificationLedger, type LedgerHostEntry, type LedgerPlanTypeResult } from "../src/index.js";

const UNRECORDED_KIT = { extyntVersion: "unrecorded", packDigest: "" };
const entry = (hostKey: string, planTypes: Readonly<Record<string, LedgerPlanTypeResult>>, runAt = ""): LedgerHostEntry => ({ hostKey, hostLabel: hostKey, runAt, reportDigest: "", kit: UNRECORDED_KIT, planTypes });
const ledgerOf = (...hosts: LedgerHostEntry[]): HostVerificationLedger => ({ schemaVersion: "0.1", hosts });
const verified = (name: string): LedgerPlanTypeResult => ({ status: "verified", cases: [name] });

test("host keys parse to a major and a normalised OS family", () => {
  assert.deepEqual(parseHostKey("26.2.1x2 (2) macOS/unknown"), { major: 26, os: "macOS", version: "26.2.1" });
  assert.deepEqual(parseHostKey("26.2.1x2 (2) Windows/unknown"), { major: 26, os: "Windows", version: "26.2.1" });
  assert.deepEqual(parseHostKey("25.6 (61) win32/arm64"), { major: 25, os: "Windows", version: "25.6" });
  assert.equal(parseHostKey("24.6 (61) darwin/arm64")?.os, "macOS");
  assert.equal(parseHostKey("26.2.1x2 (?) unknown/unknown")?.os, null);
  assert.equal(parseHostKey("not a key"), null);
});

test("evidence from another patch build of the same major and OS applies and names its source", () => {
  const ledger = ledgerOf(entry("26.2.1x2 (2) Windows/unknown", { dolly_camera: verified("camera.dolly") }));
  const result = planTypeVerification("dolly_camera", { hostKey: "26.4.0x7 (9) Windows/arm64", ledger });
  assert.equal(result.status, "verified");
  assert.match(result.detail, /Live matrix on After Effects 26\.2\.1 Windows/);
  const mac = planTypeVerification("dolly_camera", { hostKey: "26.2.1x2 (2) macOS/arm64", ledger: ledgerOf(entry("26.2.1x2 (2) macOS/unknown", { dolly_camera: verified("camera.dolly") })) });
  assert.match(mac.detail, /After Effects 26\.2\.1 macOS/);
});

test("a different major or a different OS does not borrow evidence", () => {
  const ledger = ledgerOf(entry("26.2.1x2 (2) Windows/unknown", { dolly_camera: verified("camera.dolly") }));
  assert.equal(planTypeVerification("dolly_camera", { hostKey: "25.6x1 (3) Windows/unknown", ledger }).status, "unverified");
  assert.equal(planTypeVerification("dolly_camera", { hostKey: "26.2.1x2 (2) macOS/arm64", ledger }).status, "unverified");
  assert.equal(ledgerKeyAppliesToFamily("26.2.1x2 (2) Windows/unknown", "26.9 (1) Windows/x64"), true);
  assert.equal(ledgerKeyAppliesToFamily("26.2.1x2 (2) Windows/unknown", "26.9 (1) macOS/x64"), false);
});

test("the exact build beats a newer run on the same major; otherwise the newest same-major run wins", () => {
  const exact = entry("26.2.1x2 (2) Windows/unknown", { dolly_camera: verified("exact") }, "2026-01-01T00:00:00.000Z");
  const newer = entry("26.4.0x7 (9) Windows/unknown", { dolly_camera: verified("newer") }, "2026-06-01T00:00:00.000Z");
  const newest = entry("26.5.0x1 (1) Windows/unknown", { dolly_camera: verified("newest") }, "2026-09-01T00:00:00.000Z");
  assert.match(planTypeVerification("dolly_camera", { hostKey: "26.2.1x2 (2) Windows/x64", ledger: ledgerOf(newer, exact) }).detail, /exact/);
  assert.match(planTypeVerification("dolly_camera", { hostKey: "26.3.0x1 (5) Windows/x64", ledger: ledgerOf(exact, newest, newer) }).detail, /newest/);
});

test("failures still win over family evidence, and this copy's receipt failure beats a ledger pass", () => {
  const failed = entry("26.2.1x2 (2) Windows/unknown", { dolly_camera: { status: "failed", cases: [], failedCases: ["camera.dolly"] } });
  assert.equal(planTypeVerification("dolly_camera", { hostKey: "26.4 (9) Windows/x64", ledger: ledgerOf(failed) }).status, "regressed");
  const passed = ledgerOf(entry("26.2.1x2 (2) Windows/unknown", { dolly_camera: verified("camera.dolly") }));
  const runtimeEvidence = { dolly_camera: { count: 1, lastVerifiedAt: "2026-01-01", hostVersion: "26.4", lastFailedAt: "2026-02-01", failures: 1 } };
  assert.equal(planTypeVerification("dolly_camera", { hostKey: "26.4 (9) Windows/x64", ledger: passed, runtimeEvidence }).status, "regressed");
});

test("the supported hosts are After Effects 25 and 26 on macOS and Windows, each with a key its own family matches", () => {
  assert.deepEqual(SUPPORTED_HOSTS.map(supportedHostLabel), ["After Effects 25 macOS", "After Effects 26 macOS", "After Effects 25 Windows", "After Effects 26 Windows"]);
  for (const host of SUPPORTED_HOSTS) assert.equal(parseHostKey(supportedHostKey(host))?.major, host.major);
});

test("a ledger read from disk keeps well-formed entries and drops everything else", () => {
  const good = entry("26.2.1x2 (2) Windows/unknown", { dolly_camera: verified("camera.dolly") });
  const parsed = parseHostLedger(parseJson(JSON.stringify({ schemaVersion: "0.1", hosts: [good, { hostKey: 3 }, "x", { ...good, kit: null }] })));
  assert.deepEqual(parsed.hosts, [good]);
  assert.deepEqual(parseHostLedger("not a ledger").hosts, []);
  assert.deepEqual(parseHostLedger(null).hosts, []);
});

test("a new run replaces an earlier run of the same host and kit and leaves other runs alone", () => {
  const first = entry("26.2.1x2 (2) Windows/unknown", { dolly_camera: verified("a") });
  const other = entry("26.2.1x2 (2) macOS/unknown", { dolly_camera: verified("b") });
  const rerun = { ...first, runAt: "2026-10-14T10:00:00.000Z", planTypes: { dolly_camera: verified("c") } };
  const ledger = withLedgerEntry(withLedgerEntry(ledgerOf(first), other), rerun);
  assert.deepEqual(ledger.hosts, [other, rerun]);
});
