/** The track-matte name table is cached only after a successful build: a failed first build is retried on the next read. */

import assert from "node:assert/strict";
import test from "node:test";
import { loadHostContext } from "./host-vm-context.js";

test("a track-matte table whose reflection throws is not cached, so the next read rebuilds it", () => {
  const host = loadHostContext({ TrackMatteType: { reflect: { properties: [null] } } });
  assert.throws(() => host.call("aeProbeTrackMatteEnumName(1)"), /reading .name./);
  host.call("(TrackMatteType = { ALPHA: 1, reflect: { properties: [{ name: 'ALPHA' }] } }, 0)");
  assert.equal(host.call("aeProbeTrackMatteEnumName(1)"), "ALPHA");
});

test("a built table is cached and answers every later read", () => {
  const host = loadHostContext({ TrackMatteType: { ALPHA: 1, reflect: { properties: [{ name: "ALPHA" }] } } });
  assert.equal(host.call("aeProbeTrackMatteEnumName(1)"), "ALPHA");
  host.call("(TrackMatteType = undefined, 0)");
  assert.equal(host.call("aeProbeTrackMatteEnumName(1)"), "ALPHA");
});
