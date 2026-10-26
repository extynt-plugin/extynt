// scripts/lib/native-core.ts: an unset AE_SDK_ROOT skips the SDK checks, a configured but missing one fails the stage.
import assert from "node:assert/strict";
import test from "node:test";
import { sdkRootFailure } from "../scripts/lib/native-core.ts";

test("an unset AE_SDK_ROOT is not a failure", () => {
  assert.equal(sdkRootFailure({}), null);
});

test("an AE_SDK_ROOT that exists is not a failure", () => {
  assert.equal(sdkRootFailure({ AE_SDK_ROOT: process.cwd() }), null);
});

test("an AE_SDK_ROOT that does not exist fails and names the path", () => {
  const failure = sdkRootFailure({ AE_SDK_ROOT: "/no/such/after-effects-sdk" });
  assert.equal(failure?.ok, false);
  assert.match(failure?.output ?? "", /\/no\/such\/after-effects-sdk/);
  assert.equal(failure?.summary, "AE_SDK_ROOT not found");
});
