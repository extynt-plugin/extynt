// scripts/lib/native-windows-tidy.ts: the Windows pass is the main or wrapper configuration with the two mingw-mis-firing checks off.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { wrapperTidyConfig } from "../scripts/lib/native-wrapper-tidy.ts";
import { windowsTidyConfig } from "../scripts/lib/native-windows-tidy.ts";

const main = readFileSync(new URL("../native/extynt-core/.clang-tidy", import.meta.url), "utf8");

test("the Windows configuration turns off duplicate-include and include-cleaner and nothing else", () => {
  const text = windowsTidyConfig(main);
  for (const name of ["readability-duplicate-include", "misc-include-cleaner"]) {
    assert.match(text, new RegExp(`^\\s*-${name},?$`, "m"));
  }
  assert.match(text, /^WarningsAsErrors:/m);
  assert.equal(main.includes("-misc-include-cleaner"), false);
});

test("the Windows wrapper configuration keeps the wrapper relaxations", () => {
  const text = windowsTidyConfig(wrapperTidyConfig(main));
  assert.match(text, /^\s*-cppcoreguidelines-pro-type-vararg,?$/m);
  assert.match(text, /^\s*-misc-include-cleaner,?$/m);
});

test("a configuration without WarningsAsErrors is refused", () => {
  assert.throws(() => windowsTidyConfig("Checks: 'x'\n"), /WarningsAsErrors/);
});
