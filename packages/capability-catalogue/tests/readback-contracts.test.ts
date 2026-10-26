// Contracts for the operations whose own host read-back now decides their verdict, and how an old "could not observe" ledger case yields to an exact receipt read-back from this build.
import test from "node:test";
import assert from "node:assert/strict";
import { PLAN_TYPE_CONTRACTS, planTypeVerification, type HostVerificationLedger } from "../src/index.js";
import { present } from "./present.js";

const HOST_READ = ["set_time_remap", "remove_mask", "create_shape_group", "set_shape_path", "ensure_shape_fill", "ensure_shape_stroke", "draw_vector_shapes", "add_shape_item", "update_shape_item", "add_text_animator", "update_text_animator", "ensure_text_animator", "ensure_effect", "ensure_layer_style", "render_composition", "export_mogrt", "add_essential_property"];

test("every operation with a targeted host read declares host-readback and says what it compares", () => {
  for (const planType of HOST_READ) {
    const contract = present(PLAN_TYPE_CONTRACTS[planType], planType);
    assert.equal(contract.readBack, "host-readback", planType);
    assert.ok((contract.notes ?? "").length > 40, `${planType} explains its read`);
  }
  assert.match(present(present(PLAN_TYPE_CONTRACTS.draw_vector_shapes, "draw_vector_shapes").notes, "its notes"), /0\.0005.*10 ppm/, "geometry tolerance is explicit");
  assert.match(present(present(PLAN_TYPE_CONTRACTS.draw_vector_shapes, "draw_vector_shapes").notes, "its notes"), /stroke above fill/);
  assert.match(present(present(PLAN_TYPE_CONTRACTS.render_composition, "render_composition").notes, "its notes"), /more than zero bytes/);
  assert.deepEqual(present(PLAN_TYPE_CONTRACTS.add_essential_property, "add_essential_property").unobserved, ["membership on After Effects builds without the controller getters"]);
});

test("expressions stay partial: only a literal wiggle and loopOut cycle are probed", () => {
  const expression = present(PLAN_TYPE_CONTRACTS.set_expression, "set_expression");
  assert.equal(expression.readBack, "partial");
  assert.match(expression.unobserved.join(" "), /other than a literal wiggle\(f, a\) or loopOut\("cycle"\)/);
  assert.match(expression.notes ?? "", /within \|a\| plus 5%/);
});

const HOST_KEY = "AE 26.2.1 macOS";
function ledgerSaying(status: "unverifiable" | "verified"): HostVerificationLedger {
  return { schemaVersion: "0.1", hosts: [{ hostKey: HOST_KEY, hostLabel: "After Effects 26.2.1", runAt: "2026-09-01T00:00:00Z", reportDigest: "r", kit: { extyntVersion: "0.8.0", packDigest: "p" }, planTypes: { add_essential_property: { status, cases: ["essential.add"], notes: "no getter" } } }] };
}

test("an exact receipt read-back outranks a ledger case that could not observe the result", () => {
  const receipt = { add_essential_property: { count: 2, lastVerifiedAt: "2026-10-01T00:00:00Z", hostVersion: "26.2.1" } };
  const read = planTypeVerification("add_essential_property", { hostKey: HOST_KEY, ledger: ledgerSaying("unverifiable"), runtimeEvidence: receipt });
  assert.deepEqual([read.status, read.basis], ["verified", "receipt-readback"]);
  const unread = planTypeVerification("add_essential_property", { hostKey: HOST_KEY, ledger: ledgerSaying("unverifiable") });
  assert.deepEqual([unread.status, unread.basis], ["unverifiable", "live-matrix"], "with no receipt the ledger's verdict still stands");
  const failing = planTypeVerification("add_essential_property", { hostKey: HOST_KEY, ledger: ledgerSaying("unverifiable"), runtimeEvidence: { add_essential_property: { ...receipt.add_essential_property, lastFailedAt: "2026-10-02T00:00:00Z", failures: 1 } } });
  assert.equal(failing.status, "regressed", "a later failing receipt still wins");
});
