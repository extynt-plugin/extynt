// scripts/lib/native-wrapper-tidy.ts: wrapper files get the main clang-tidy configuration minus the cast and vararg checks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SDK_WRAPPER_FILE, wrapperTidyConfig } from "../scripts/lib/native-wrapper-tidy.ts";

const main = readFileSync(new URL("../native/extynt-core/.clang-tidy", import.meta.url), "utf8");

test("the wrapper configuration turns the cast, union and vararg checks off", () => {
  const text = wrapperTidyConfig(main);
  for (const name of ["reinterpret-cast", "const-cast", "cstyle-cast", "union-access", "vararg"]) {
    assert.match(text, new RegExp(`^\\s*-cppcoreguidelines-pro-type-${name},?$`, "m"));
  }
  assert.match(text, /^\s*-performance-no-int-to-ptr,?$/m);
});

test("the wrapper configuration narrows the header filter to the wrapper headers and keeps the rest of the checks", () => {
  const text = wrapperTidyConfig(main);
  assert.match(text, /^HeaderFilterRegex: '\.\*\/native\/extynt-core\/\(ae\|transport\|catalogue-window\)\/sdk_\[\^\/\]\*\\\.h'$/m);
  assert.match(text, /^  bugprone-\*,$/m);
  assert.equal(main.includes("-cppcoreguidelines-pro-type-reinterpret-cast"), false);
});

test("a configuration that lacks a relaxed check or the header filter is refused", () => {
  assert.throws(() => wrapperTidyConfig(main.replace("cppcoreguidelines-pro-type-vararg", "x")), /vararg/);
  assert.throws(() => wrapperTidyConfig(main.replace(/^HeaderFilterRegex:.*$/m, "")), /HeaderFilterRegex/);
});

test("wrapper files are the sdk_ headers and sources of ae, transport and catalogue-window, and nothing else", () => {
  for (const file of ["native/extynt-core/transport/sdk_posix_open.cpp", "native/extynt-core/ae/sdk_cocoa.mm", "/work/native/extynt-core/catalogue-window/sdk_win_catalogue.h"]) assert.ok(SDK_WRAPPER_FILE.test(file), file);
  for (const file of ["native/extynt-core/core/sdk_x.cpp", "native/extynt-core/tests/sdk_x.cpp", "native/extynt-core/ae/ae_sdk.h", "native/extynt-core/ae/sdk_ref.txt", "ae/sdk_cocoa.mm", "sdk_ref.h", "native/extynt-core/ae/sub/sdk_x.h"]) {
    assert.equal(SDK_WRAPPER_FILE.test(file), false, file);
  }
});
