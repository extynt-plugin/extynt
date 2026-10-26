/** The release package installs the sidecar as a production build, so its dev-only switches stay off. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the installer makes the release package a production build and every other install a development build", () => {
  const installer = readFileSync("packaging/macos/sidecar-launchd/install-sidecar.sh", "utf8");
  const template = readFileSync("packaging/macos/sidecar-launchd/com.extynt.sidecar.plist.template", "utf8");
  assert.match(template, /<key>NODE_ENV<\/key>\s*<string>__NODE_ENV__<\/string>/);
  assert.match(installer, /node_env="development"\nif \[\[ "\$\{EXTYNT_INSTALL_CONTEXT:-\}" == "pkg" \]\]; then node_env="production"; fi/);
  assert.match(installer, /-e "s#__NODE_ENV__#\$\{node_env\}#g"/);
});

test("the sidecar and the MCP launcher run Node without Sparkplug (Node 24.21's V8 can crash in a GC with baseline frames)", () => {
  const installer = readFileSync("packaging/macos/sidecar-launchd/install-sidecar.sh", "utf8");
  const template = readFileSync("packaging/macos/sidecar-launchd/com.extynt.sidecar.plist.template", "utf8");
  const plist = [
    "<string>__NODE_BIN__</string>\\s*(<!--[\\s\\S]*?-->\\s*)?<string>--no-sparkplug</string>\\s*",
    "<string>__INSTALL_ROOT__/sidecar/apps/sidecar/dist/src/main\\.js</string>",
  ].join("");
  assert.match(template, new RegExp(plist));
  assert.match(installer, /exec "\$\{node_bin\}" --no-sparkplug "\$\{install_root\}\/sidecar\/packages\/mcp-server\/dist\/src\/stdio\.js"/);
});

test("the sidecar is not a Background process: the catalogue's render engine inherits its priority", () => {
  const template = readFileSync("packaging/macos/sidecar-launchd/com.extynt.sidecar.plist.template", "utf8");
  assert.match(template, /<key>ProcessType<\/key>\s*<string>Standard<\/string>/);
});
