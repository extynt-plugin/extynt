/**
 * Apply-plan host contract: Windows file paths
 *
 * The first real-Windows host run refused every path-carrying op with "Command was not valid JSON." The product path is the
 * sidecar's JSON.stringify -> the native host's escapeJsString string literal -> aeApplyPlan(raw) -> JSON.parse; each layer is
 * exercised here with drive-letter paths with a space and a UNC path; drive-letter paths must get as far as the file check,
 * and a UNC path is refused by value policy (packages/action-plan keeps UNC out), never as malformed JSON. The string-literal
 * layer mirrors escapeJsString in native/extynt-core/core/host_call.cpp: backslash, quote and newline become escapes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { loadApplyPlan } from "./host-apply-harness.js";
import { applyPlan } from "./host-plan-io.js";
import { fieldOf, readJson } from "./json-narrow.js";

const DRIVE_LETTER_PATHS = ["C:\\Users\\x\\a b\\png-red.png", "C:/Users/x/a b/png-red.png"];
const UNC_PATH = "\\\\fileserver\\share\\a b\\png-red.png";
const RELATIVE_PATHS = ["relative\\a.png", "\\a.png", "\\\\/a.png", "C:a.png"];

function escapeJsString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\x0a");
}

function importFile(path: string) {
  return { operation: "import_file", newItemId: "__new__:rel", path };
}

test("a command with Windows paths survives the native host's string-literal round trip byte for byte", () => {
  for (const path of [...DRIVE_LETTER_PATHS, UNC_PATH]) {
    const command = JSON.stringify({ operation: "apply_plan", operations: [{ operation: "import_file", path }] });
    const received = String(vm.runInNewContext(`(function (raw) { return raw; })("${escapeJsString(command)}")`));
    assert.equal(received, command);
    assert.deepEqual(readJson(received), readJson(command));
  }
});

test("import_file, replace_footage and set_footage_proxy take drive-letter paths: the JSON parses, validation passes and the host reaches the file check", () => {
  for (const path of DRIVE_LETTER_PATHS) {
    const { apply, footage, projectItems } = loadApplyPlan();
    projectItems.push(footage);
    const imported = applyPlan(apply, "windows-paths", [{ operation: "import_file", newItemId: "__new__:win", path, importAs: "footage" }]);
    assert.equal(fieldOf(imported, "error", "code"), "IMPORT_FILE_NOT_FOUND", path);
    for (const operation of ["replace_footage", "set_footage_proxy"]) {
      const code = fieldOf(applyPlan(apply, `windows-${operation}`, [{ operation, itemId: "footage-plate", path }]), "error", "code");
      assert.ok(code !== "INVALID_COMMAND" && code !== "INVALID_VALUE", `${operation} ${path} -> ${String(code)}`);
    }
  }
});

test("a UNC path is parsed but refused as a value (network shares are not an accepted source), not as invalid JSON", () => {
  const { apply } = loadApplyPlan();
  const refused = applyPlan(apply, "windows-paths", [{ operation: "import_file", newItemId: "__new__:unc", path: UNC_PATH }]);
  assert.equal(fieldOf(refused, "error", "code"), "INVALID_VALUE");
});

test("a relative path or a lone leading backslash is still not an absolute path", () => {
  const { apply } = loadApplyPlan();
  for (const path of RELATIVE_PATHS) {
    assert.equal(fieldOf(applyPlan(apply, "windows-paths", [importFile(path)]), "error", "code"), "INVALID_VALUE", path);
  }
});
