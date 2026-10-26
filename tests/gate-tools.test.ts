// scripts/lib/tools.ts: pinned tools resolve from the repo venv or PATH, and a missing tool fails with the setup command.
import assert from "node:assert/strict";
import test from "node:test";
import { SETUP_COMMAND, missingToolMessage, requireTools, toolPath } from "../scripts/lib/tools.ts";

test("a missing tool fails the gate with the exact setup command", () => {
  assert.equal(toolPath("extynt-no-such-tool"), null);
  assert.throws(() => requireTools(["extynt-no-such-tool"]), /Run: pnpm setup:tools/);
  assert.equal(SETUP_COMMAND, "pnpm setup:tools");
  assert.match(missingToolMessage(["a", "b"]), /missing tools: a, b\. Run: pnpm setup:tools/);
});

test("a tool that exists resolves to a path", () => {
  assert.ok(requireTools(["node"]).get("node"));
});
