// Whether a store file with group or other permission bits is refused, per platform.
import assert from "node:assert/strict";
import test from "node:test";
import { opensToOthers } from "../src/store-file-permissions.js";

test("group or other bits make a POSIX store file unsafe", () => {
  for (const platform of ["darwin", "linux"] as const) {
    assert.equal(opensToOthers(0o100600, platform), false);
    assert.equal(opensToOthers(0o100640, platform), true);
    assert.equal(opensToOthers(0o100604, platform), true);
  }
});

test("Windows modes carry no ACL, so the 0o666 every file reports is not a refusal", () => {
  assert.equal(opensToOthers(0o100666, "win32"), false);
  assert.equal(opensToOthers(0o100444, "win32"), false);
});
