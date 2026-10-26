/** Ordinal lookups check the group before reading it, and the dropped parameters did not change what the host calls do. */

import assert from "node:assert/strict";
import test from "node:test";
import { loadHostContext } from "./host-vm-context.js";

test("a layer without a mask or shape group has no mask or shape at any ordinal, without reading the missing group", () => {
  const host = loadHostContext();
  const layer = "{ property: function () { return null; }, numProperties: 0 }";
  assert.equal(host.call(`aeApplyMaskByOrdinal(${layer}, 1)`), null);
  assert.equal(host.call(`aeApplyShapeByOrdinal(${layer}, 1)`), null);
});

test("the property-walk budget check takes the config and the read kind", () => {
  const host = loadHostContext();
  const config = "{ maxReadMs: 1e9, maxTotalProperties: 5, maxProjectItems: 5 }";
  assert.equal(host.call(`(aeProbeReadStartedAt = (new Date()).getTime(), aeProbeReadProperties = 0, aeProbeReadProgress = 1, aeProbeBudgetStops(${config}, "property"))`), false);
  assert.equal(host.call(`(aeProbeReadProperties = 5, aeProbeBudgetStops(${config}, "property"))`), true, "over the property budget after progress stops the walk");
  assert.equal(host.call(`(aeProbeReadProgress = 0, aeProbeReadProperties = 5, aeProbeBudgetStops(${config}, "property"))`), false, "the first read of a call is never refused");
});
