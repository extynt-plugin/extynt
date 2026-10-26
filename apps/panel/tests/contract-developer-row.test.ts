/** Panel contract: the Developer row only shows while the Developer page preference is on. */
import assert from "node:assert/strict";
import test from "node:test";
import { createPanelHarness } from "./contract.test.js";
import { element } from "./contract-helpers.js";

const row = (harness: ReturnType<typeof createPanelHarness>) => harness.el("developer-section");

test("the Developer row shows while the Developer page preference is on and is hidden otherwise", () => {
  assert.equal(row(createPanelHarness())?.hidden, false);
  const plain = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.prefs = { ...sidecar.prefs, diagnostics: false };
    },
  });
  assert.equal(row(plain)?.hidden, true);
  plain.click("open-settings");
  plain.click("open-developer");
  assert.equal(plain.el("page-title")?.textContent, "Settings", "the Developer page is out of reach while the preference is off");
});

test("the Developer page preference toggle shows and hides the Developer row", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.prefs = { ...sidecar.prefs, diagnostics: false };
    },
  });
  harness.click("open-settings");
  const box = element(harness, "developer-page");
  box.checked = true;
  box.dispatch("change");
  assert.equal(row(harness)?.hidden, false);
  box.checked = false;
  box.dispatch("change");
  assert.equal(row(harness)?.hidden, true);
});
