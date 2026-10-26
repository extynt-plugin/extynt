// Tests when recorded verification evidence is stale.
import test from "node:test";
import assert from "node:assert/strict";
import { present } from "./present.js";
import { planTypeVerification, planVerificationReport, EVIDENCE_PRODUCT_VERSION, type HostVerificationLedger } from "../src/index.js";

test("planTypeVerification reports kit version when evidence exists", () => {
  const ledger: HostVerificationLedger = {
    schemaVersion: "0.1",
    hosts: [{
      hostKey: "AE 24.0.1 (300) macOS/unknown",
      hostLabel: "After Effects 24.0.1",
      runAt: "2024-01-01T00:00:00Z",
      reportDigest: "abc123",
      kit: { extyntVersion: "0.0.1e", packDigest: "def456" },
      planTypes: { render_composition: { status: "verified", cases: ["basic"] } },
    }],
  };

  const result = planTypeVerification("render_composition", {
    hostKey: "AE 24.0.1 (300) macOS/unknown",
    ledger,
  });

  assert.equal(result.evidenceKitVersion, "0.0.1e", "should report the kit version");
  assert.equal(result.staleEvidence, true, "a previous lettered build is stale");
});

test("planTypeVerification reports staleEvidence when kit version is older", () => {
  const ledger: HostVerificationLedger = {
    schemaVersion: "0.1",
    hosts: [{
      hostKey: "AE 24.0.1 (300) macOS/unknown",
      hostLabel: "After Effects 24.0.1",
      runAt: "2024-01-01T00:00:00Z",
      reportDigest: "abc123",
      kit: { extyntVersion: "0.0.0", packDigest: "def456" },
      planTypes: { render_composition: { status: "verified", cases: ["basic"] } },
    }],
  };

  const result = planTypeVerification("render_composition", {
    hostKey: "AE 24.0.1 (300) macOS/unknown",
    ledger,
  });

  assert.equal(result.evidenceKitVersion, "0.0.0", "should report the kit version");
  assert.equal(result.staleEvidence, true, "should be stale when version is older");
});

test("planTypeVerification handles unrecorded kit identity", () => {
  const ledger: HostVerificationLedger = {
    schemaVersion: "0.1",
    hosts: [{
      hostKey: "AE 24.0.1 (300) macOS/unknown",
      hostLabel: "After Effects 24.0.1",
      runAt: "2024-01-01T00:00:00Z",
      reportDigest: "abc123",
      kit: { extyntVersion: "unrecorded", packDigest: "unrecorded" },
      planTypes: { render_composition: { status: "verified", cases: ["basic"] } },
    }],
  };

  const result = planTypeVerification("render_composition", {
    hostKey: "AE 24.0.1 (300) macOS/unknown",
    ledger,
  });

  assert.equal(result.evidenceKitVersion, "unrecorded", "should report unrecorded kit");
  assert.equal(result.staleEvidence, true, "unrecorded kit age is unknown and cannot be treated as current");
});

test("planTypeVerification reports null evidence when no host", () => {
  const result = planTypeVerification("render_composition", {
    hostKey: null,
  });

  assert.equal(result.evidenceKitVersion, null, "should be null when no host");
  assert.equal(result.staleEvidence, false, "should be false when no host");
});

test("the latest applicable kit supplies both the verdict and its age", () => {
  const hostKey = "AE 24.0.1 (300) macOS/arm64";
  const row = (version: string, runAt: string, status: "verified" | "failed", key = hostKey) => ({
    hostKey: key, hostLabel: key, runAt, reportDigest: version,
    kit: { extyntVersion: version, packDigest: version },
    planTypes: { render_composition: { status, cases: [version] } },
  });
  const ledger: HostVerificationLedger = { schemaVersion: "0.1", hosts: [
    row("0.0.1e", "2026-09-01T00:00:00Z", "failed"),
    row(EVIDENCE_PRODUCT_VERSION, "2026-09-02T00:00:00Z", "verified"),
    row("0.0.1e", "2026-09-03T00:00:00Z", "failed", "AE 24.0.1 (300) macOS/unknown"),
  ] };
  const result = planTypeVerification("render_composition", { hostKey, ledger });
  assert.equal(result.status, "verified");
  assert.equal(result.evidenceKitVersion, EVIDENCE_PRODUCT_VERSION);
  assert.equal(result.staleEvidence, false);
  const report = planVerificationReport(["render_composition"], { hostKey, ledger });
  assert.equal(report.operations[0]?.evidenceKitVersion, EVIDENCE_PRODUCT_VERSION);
  assert.equal(report.warnings.some((warning) => warning.startsWith("STALE_HOST_EVIDENCE")), false);
  const old = planVerificationReport(["render_composition"], { hostKey, ledger: { schemaVersion: "0.1", hosts: [present(ledger.hosts[0], "the ledger run")] } });
  assert.equal(old.operations[0]?.staleEvidence, true);
  assert.equal(old.warnings.some((warning) => warning.startsWith("STALE_HOST_EVIDENCE")), true);
});

for (const [version, stale] of [
  ["0.0.1f", true], ["0.0.1j", true],
  ["0.0.2-rc.0", true], ["0.0.2-rc", true],
  ["0.0.2-1", true], ["0.0.2-beta.10", true],
  ["0.0.2-rc.1", true], ["0.0.2-rc.1+matrix.42", true],
  ["0.0.2-rc.2", true], ["0.0.2-rc.10", true],
  ["0.0.2-rc.1.0", true], ["0.0.2-rc.1a", true],
  ["0.0.2", true], ["0.0.2+matrix.42", true],
  ["0.0.2a", true], ["0.0.2a+matrix.42", true],
  ["0.0.2b", true], ["0.0.2b+matrix.42", true],
  ["0.0.2c", true], ["0.0.2c+matrix.42", true], ["0.0.2d", true], ["0.0.2d+matrix.42", true],
  ["0.0.2e", true], ["0.0.2e+matrix.42", true],
  ["0.0.2f", true], ["0.0.2f+matrix.42", true],
  ["0.0.3-rc.1", true], ["0.0.3", true], ["0.0.3+matrix.42", true],
  ["0.0.3a", true], ["0.0.3a+matrix.42", true],
  ["0.0.3b", true], ["0.0.3b+matrix.42", true],
  ["0.0.3c", true], ["0.0.3c+matrix.42", true],
  ["0.0.3d", true], ["0.0.3d+matrix.42", true],
  ["0.0.3e", true], ["0.0.3e+matrix.42", true],
  ["0.0.4a", true], ["0.0.4a+matrix.42", true],
  ["0.0.4b", true], ["0.0.4b+matrix.42", true],
  ["0.0.4c", true], ["0.0.4c+matrix.42", true],
  ["0.0.5", true], ["0.0.5+matrix.42", true],
  ["0.0.5b", true], ["0.0.5b+matrix.42", true],
  ["0.0.6a", true], ["0.0.6a+matrix.42", true],
  ["0.0.7a", true], ["0.0.7a+matrix.42", true],
  ["0.0.7b", true], ["0.0.7b+matrix.42", true],
  ["0.0.8a", true], ["0.0.8a+matrix.42", true],
  ["0.0.8b", true], ["0.0.8b+matrix.42", true],
  ["0.0.8c", true], ["0.0.8c+matrix.42", true],
  ["0.0.8d", true], ["0.0.8d+matrix.42", true],
  ["0.0.8e", true], ["0.0.8e+matrix.42", true],
  ["0.0.8f", true], ["0.0.8f+matrix.42", true],
  ["0.0.8g", true], ["0.0.8g+matrix.42", true],
  ["0.0.8h", true], ["0.0.8h+matrix.42", true],
  ["0.0.8i", true], ["0.0.8i+matrix.42", true],
  ["0.0.8j", true], ["0.0.8j+matrix.42", true],
  ["0.0.8k", true], ["0.0.8k+matrix.42", true],
  ["0.0.8l", true], ["0.0.8l+matrix.42", true],
  ["0.0.8m", true], ["0.0.8m+matrix.42", true],
  ["0.0.8n", true], ["0.0.8n+matrix.42", true],
  ["0.0.8o", true], ["0.0.8o+matrix.42", true],
  ["0.0.8p", true], ["0.0.8p+matrix.42", true],
  ["0.0.8q", true], ["0.0.8q+matrix.42", true],
  ["0.0.8r", true], ["0.0.8r+matrix.42", true],
  ["0.0.8s", true], ["0.0.8s+matrix.42", true],
  ["0.0.8t", true], ["0.0.8t+matrix.42", true],
  ["0.0.9a", true], ["0.0.9a+matrix.42", true],
  ["0.1.0", false], ["0.1.0+matrix.42", false],
  ["unrecorded", true], ["not-a-version", true],
  ["0.0.2-rc.01", true], ["0.0.2-", true], ["0.0.2+", true],
] as const) {
  test(`recorded kit ${version} has ${stale ? "stale" : "no stale"} host evidence warning`, () => {
    const hostKey = "AE 24.0.1 (300) macOS/arm64";
    const ledger: HostVerificationLedger = { schemaVersion: "0.1", hosts: [{
      hostKey, hostLabel: hostKey, runAt: "2026-09-01T00:00:00Z", reportDigest: "recorded",
      kit: { extyntVersion: version, packDigest: "recorded" },
      planTypes: { set_layer_name: { status: "verified", cases: ["rename-readback"] } },
    }] };
    const result = planTypeVerification("set_layer_name", { hostKey, ledger });
    assert.equal(result.evidenceKitVersion, version);
    assert.equal(result.status, "verified");
    assert.equal(result.basis, "live-matrix");
    assert.equal(result.staleEvidence, stale);
    const report = planVerificationReport(["set_layer_name"], { hostKey, ledger });
    assert.equal(report.operations[0]?.staleEvidence, stale);
    assert.equal(report.warnings.some((warning) => warning.startsWith("STALE_HOST_EVIDENCE:")), stale);
  });
}

test("an absent ledger does not fabricate kit verification", () => {
  const report = planVerificationReport(["set_layer_name"], { hostKey: "AE 24.0.1 (300) macOS/arm64" });
  assert.equal(report.operations[0]?.status, "unverified");
  assert.equal(report.operations[0]?.evidenceKitVersion, null);
  assert.equal(report.operations[0]?.staleEvidence, false);
  assert.equal(report.warnings.some((warning) => warning.startsWith("STALE_HOST_EVIDENCE:")), false);
});

test("an effect add that scoped Undo reverts carries no Undo-only warning, a layer style does", () => {
  const evidence = { hostKey: "AE 26.0 (1) macOS/unknown", ledger: { schemaVersion: "0.1" as const, hosts: [] } };
  const unavailable = (type: string) => planVerificationReport([type], evidence).warnings.some((warning) => warning.startsWith("CLEANUP_UNAVAILABLE"));
  assert.equal(unavailable("ensure_effect"), false);
  assert.equal(unavailable("ensure_layer_style"), false, "a style can be turned off by an operation");
});
