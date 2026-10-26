// scripts/lib/shell-check.ts header rules: allowed shebangs and strict mode as the first statement.
import assert from "node:assert/strict";
import test from "node:test";
import { headerFailures } from "../scripts/lib/shell-check.ts";

test("bash scripts need the env shebang and set -euo pipefail first", () => {
  assert.deepEqual(headerFailures("a.sh", "#!/usr/bin/env bash\n# note\n\nset -euo pipefail\necho hi\n"), []);
  assert.equal(headerFailures("a.sh", "#!/bin/bash\nset -euo pipefail\n").length, 1);
  assert.equal(headerFailures("a.sh", "echo hi\n").length, 1);
});

test("strict mode must be the first statement, not merely present", () => {
  assert.equal(headerFailures("a.sh", "#!/usr/bin/env bash\necho hi\nset -euo pipefail\n").length, 1);
  assert.equal(headerFailures("a.sh", "#!/usr/bin/env bash\nset -eu\n").length, 1);
});

test("a POSIX sh script uses set -eu", () => {
  assert.deepEqual(headerFailures("a.sh", "#!/bin/sh\nset -eu\n"), []);
  assert.equal(headerFailures("a.sh", "#!/bin/sh\nset -euo pipefail\n").length, 1);
});

test("powershell limits: parameters, function length, complexity and strict error handling", async () => {
  const { powershellFileFailures } = await import("../scripts/lib/ps1-rules.ts");
  const strict = "$ErrorActionPreference = 'Stop'\nSet-StrictMode -Version Latest\n";
  assert.deepEqual(powershellFileFailures("a.ps1", `${strict}function A([string]$x) {\n  if ($x) { return 1 }\n  return 2\n}\n`), []);
  assert.equal(powershellFileFailures("a.ps1", "function A() { return 1 }\n").length, 2);
  assert.equal(powershellFileFailures("a.ps1", `${strict}function A($a, $b, $c, $d, $e, $f) { return 1 }\n`).length, 1);
  const branches = Array.from({ length: 10 }, (_, index) => `  if ($x -eq ${index}) { return ${index} }`).join("\n");
  assert.equal(powershellFileFailures("a.ps1", `${strict}function A($x) {\n${branches}\n}\n`).length, 1);
  const body = Array.from({ length: 80 }, (_, index) => `  $v${index} = ${index}`).join("\n");
  assert.equal(powershellFileFailures("a.ps1", `${strict}function A() {\n${body}\n}\n`).length, 1);
});

test("powershell comments and strings are not counted as code", async () => {
  const { powershellFileFailures } = await import("../scripts/lib/ps1-rules.ts");
  const text = "$ErrorActionPreference = 'Stop'\nSet-StrictMode -Version Latest\nfunction A() {\n  # if if if if if if if if if if if if\n  return 'if if if if if if if if if if if'\n}\n";
  assert.deepEqual(powershellFileFailures("a.ps1", text), []);
});

test("powershell scripts must set strict mode, except the listed pending script", async () => {
  const { powershellFileFailures, STRICT_MODE_PENDING } = await import("../scripts/lib/ps1-rules.ts");
  const stop = "$ErrorActionPreference = 'Stop'\n";
  assert.equal(powershellFileFailures("a.ps1", stop).length, 1);
  assert.deepEqual(powershellFileFailures("a.ps1", `${stop}Set-StrictMode -Version Latest\n`), []);
  assert.equal(powershellFileFailures("a.ps1", `${stop}Set-StrictMode -Off\n`).length, 1);
  for (const key of STRICT_MODE_PENDING) assert.deepEqual(powershellFileFailures(key, stop), []);
});

test("a CRLF script is judged by the same header rules as an LF one", () => {
  assert.deepEqual(headerFailures("a.sh", "#!/usr/bin/env bash\r\n# note\r\nset -euo pipefail\r\necho hi\r\n"), []);
  assert.equal(headerFailures("a.sh", "#!/usr/bin/env bash\r\necho hi\r\nset -euo pipefail\r\n").length, 1);
});
