/** Panel contract: starting inside the native host, the bootstrap, and what the page never does. */
import assert from "node:assert/strict";
import test from "node:test";
import { createPanelHarness } from "./contract.test.js";
import { nth } from "./contract-helpers.js";

test("the panel boots from the injected session: bootstrap, sessions, model settings and the live stream, all with the bearer", () => {
  const harness = createPanelHarness();
  const boot = harness.requestsTo("/v1/ui/bootstrap");
  assert.equal(boot.length, 1);
  assert.equal(nth(boot, 0).headers.Authorization, "Bearer test-token");
  assert.equal(harness.streamCount(), 1, "the event stream is open");
  assert.ok(harness.requestsTo("/v1/settings/model").length >= 1);
  assert.equal(harness.el("status-bar")?.getAttribute("data-state"), "idle", "a healthy panel is a quiet idle strip");
});

test("outside the native panel nothing is sent to any sidecar", () => {
  const harness = createPanelHarness({ native: null });
  assert.equal(harness.requests.length, 0);
});
