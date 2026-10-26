// Proves that every verification label the host or panel can emit is classified into host-evidence rules, and that only the exact strong allowlist can confirm a verdict.
import test from "node:test";
import assert from "node:assert/strict";
import { COERCION_BASES, HOST_EVIDENCE_RULES, VERIFIED_OUTCOMES, hostEvidenceOf, isVerifiedOutcome } from "../src/receipts.js";
import { readdirSync } from "node:fs";
import { hostSource, repoFile } from "./support/fixtures.js";
import type { JsonObject } from "@extynt/decode";

const probe = hostSource();
const panel = readdirSync("apps/sidecar/src/verify").filter((entry) => entry.endsWith(".ts")).sort().map((entry) => repoFile(`apps/sidecar/src/verify/${entry}`)).join("\n");

function labelsIn(expression: string): ReadonlyArray<string> {
  const quoted = [...expression.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
  return quoted
    .filter((match) => /^$|[?:]$/.test(expression.slice(0, match.index ?? 0).trimEnd()))
    .map((match) => (match[1] ?? "").replace(/\\(.)/g, "$1"));
}

function hostVerificationLabels(): Set<string> {
  const labels = new Set<string>();
  const expressions = [...probe.matchAll(/verification:\s*([^,}\n]*)/g), ...probe.matchAll(/\baeApply\w*Step\((?:[^;\n]*,\s*)?("[^"\n]*")\)/g)];
  for (const match of expressions) for (const label of labelsIn(match[1] ?? "")) labels.add(label);
  return labels;
}

test("every label the host can emit is classified before it can move a verdict", () => {
  const labels = hostVerificationLabels();
  assert.equal(labels.size, 59, `the host's verification vocabulary changed: ${JSON.stringify([...labels].sort())}`);
  const classified = new Set(HOST_EVIDENCE_RULES.map((rule) => rule.evidence));
  assert.deepEqual([...labels].filter((label) => !classified.has(label)), [], "a host label with no rule would prove nothing and say nothing about why");
});

test("every rule's token exists in the source that emits it", () => {
  for (const rule of HOST_EVIDENCE_RULES) {
    const source = rule.field === "basis" ? panel : probe;
    const who = rule.field === "basis" ? "the panel" : "the host";
    assert.ok(source.includes(`"${rule.evidence}"`), `${rule.evidence} (${rule.field}) is not a token ${who} can emit`);
  }
});

test("the strong allowlist is exact, per-value, and never a family", () => {
  assert.deepEqual(
    HOST_EVIDENCE_RULES.filter((rule) => rule.strength === "strong").map((rule) => `${rule.type}|${rule.field}|${rule.evidence}`),
    [
      "set_project_settings|hostVerification|project-settings-read-back",
      "set_project_settings|basis|project-settings-host-read-back",
      "render_composition|submission|render-file-written",
      "export_mogrt|hostVerification|mogrt-file-written",
      "edit_keyframes|hostVerification|keyframe-edit-read-back",
      "resize_solid|hostVerification|solid-resized",
      "center_anchor|hostVerification|anchor-centred",
      "set_composition_settings|hostVerification|composition-settings-read-back",
      "set_layer_attribute|hostVerification|layer-attribute-read-back",
      "set_puppet_pins|hostVerification|puppet-pins-placed",
      "remove_effect|hostVerification|effect-removed",
      "reorder_effect|hostVerification|effect-reordered",
    ],
  );
  for (const label of ["shape-group-read-back", "shape-fill-read-back", "shape-stroke-read-back", "track-matte-set", "composition-settings-written", "time-remap-state-written", "render-queued"]) {
    assert.equal(HOST_EVIDENCE_RULES.find((rule) => rule.evidence === label)?.strength, "weak", `${label} attests only that the writer returned`);
  }
  assert.equal(HOST_EVIDENCE_RULES.some((rule) => rule.evidence === "enabled" || rule.evidence === "value" || rule.evidence === "levelDb"), false);
});

test("host evidence is classified by token and type, never by presence", () => {
  const step = (extra: JsonObject): JsonObject => ({ verificationState: "applied_unverified", ...extra });
  assert.equal(hostEvidenceOf({ type: "ensure_shape_fill" }, step({ hostVerification: "shape-fill-read-back" }))?.strength, "weak");
  assert.equal(hostEvidenceOf({ type: "create_shape_group" }, step({ hostVerification: "shape-fill-read-back" }))?.strength, "weak");
  assert.equal(hostEvidenceOf({ type: "ensure_shape_fill" }, step({ hostVerification: null })), undefined);
  assert.equal(hostEvidenceOf({ type: "export_mogrt" }, step({ hostVerification: "mogrt-file-written" }))?.strength, "strong");
});

test("only the three success bands are verified outcomes", () => {
  assert.deepEqual([...VERIFIED_OUTCOMES], ["confirmed", "host_confirmed", "coerced_equivalent"]);
  assert.equal(isVerifiedOutcome("host_confirmed"), true);
  assert.equal(isVerifiedOutcome("applied_unconfirmed"), false, "the pass-with-warning band is still worth telling the agent about");
  assert.equal(isVerifiedOutcome("readback_mismatch"), false);
  assert.equal(isVerifiedOutcome("something-new"), false, "an unknown band is never silently treated as success");
  assert.equal(isVerifiedOutcome(undefined), false);
  assert.deepEqual([...COERCION_BASES.keys()], ["property-value-coerced", "property-value-broadcast", "property-value-under-expression"]);
});
